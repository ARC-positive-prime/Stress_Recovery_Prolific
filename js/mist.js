/*
 * MIST (Montreal Imaging Stress Task): port of the lab mist_l5.py / mist.py,
 * plus the classic baseline (calibration) block.
 *
 * Step "mist_baseline": MIST.runBaseline()
 *   PRACTICE block, nothing at stake (Dedovic et al., 2005 training phase):
 *   self-paced (no countdown shown, no time limit except a hidden safety cap),
 *   no performance bar, no noise, "Correct / Incorrect" after each answer.
 *   The participant's average time on correct answers sets the starting
 *   time limit of the stressor:
 *     initial limit = TIME_LIMIT_FACTOR (0.9) × mean RT of correct answers,
 *     kept within [MIST.MIN_TIME_LIMIT, MIST.MAX_TIME_LIMIT];
 *   fewer than MIN_CORRECT correct answers → MIST.TIME_LIMIT (default).
 *   Saved as "mist_calibration" in the data file.
 *
 * Step "mist": MIST.run()  (the stressor)
 *   Intro (average-performance rule, scaled score, reward) → [optional timed
 *   practice] → performance-bar screen → 35 timed trials with countdown,
 *   performance bar, white noise and an adaptive time limit (3 correct in a
 *   row → −10 %, 3 wrong/too slow in a row → +10 %, within 2.5–7 s).
 *
 * Trial: problem (until ENTER / time limit) → feedback 0.5 s → blank 1.5 s.
 * Responding: number keys 0–9 select a digit on the dial (re-pressing
 * replaces it, BACKSPACE clears); ENTER submits.
 *
 * Settings: CONFIG.MIST_BASELINE and CONFIG.MIST (js/config.js)
 * Wording:  TEXTS.MIST_BASELINE and TEXTS.MIST (js/texts.js)
 * Test alone: debug.html → "MIST baseline" / "MIST".
 */
(function () {
  "use strict";
  const C = () => CONFIG.MIST;
  const B = () => CONFIG.MIST_BASELINE;
  const { el, stage, present, sleep, sec, iso, now } = Core;

  const TRIGGERS = { block_start_baseline: 21, block_start_exp: 20, trial_onset: 1, response: 2, feedback_onset: 3, block_end: 9 };
  const DIGIT_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const r4 = (x) => Math.round(x * 10000) / 10000;

  // ── Problems ───────────────────────────────────────────────────────────
  let bank = [], bankPos = 0;
  function nextProblem() {
    if (!bank.length || bankPos >= bank.length) {
      bank = Core.shuffle((window.MIST_BANK[String(C().LEVEL)] || window.MIST_BANK["4"]).slice());
      bankPos = 0;
    }
    const [display, answer] = bank[bankPos++];
    return { display, answer };
  }

  /*
   * Adaptive time limit. A change needs ADAPTIVE_WINDOW same-kind answers
   * in a row (3 correct → −10 %, 3 wrong/too slow → +10 %); both run counts
   * restart after every change. The limit stays within [MIN, MAX].
   */
  function makeAdapter() {
    let correctRun = 0, wrongRun = 0;
    return function next(limit, correct) {
      const P = C();
      if (correct) { correctRun++; wrongRun = 0; } else { wrongRun++; correctRun = 0; }
      if (correctRun >= P.ADAPTIVE_WINDOW) {
        correctRun = 0;
        return Math.max(P.MIN_TIME_LIMIT, limit * (1 - P.ADAPTIVE_STEP));
      }
      if (wrongRun >= P.ADAPTIVE_WINDOW) {
        wrongRun = 0;
        return Math.min(P.MAX_TIME_LIMIT, limit * (1 + P.ADAPTIVE_STEP));
      }
      return limit;
    };
  }

  // ── Calibration from the baseline block ────────────────────────────────
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Uses correct answers only, and only those given with the page in focus
  // (a trial with a tab switch / lost focus / full-screen exit would inflate
  // the average and make the stressor too easy).
  function calibrate(rows) {
    const P = B(), M = C();
    const answered = rows.filter((r) => r.answered === 1);
    const correctRows = rows.filter((r) => r.accuracy === 1);
    const correctRts = correctRows.filter((r) => r.focus_lost !== 1).map((r) => r.rt);
    const m = mean(correctRts), md = median(correctRts);
    const stat = P.STATISTIC === "median" ? md : m;
    const enough = correctRts.length >= P.MIN_CORRECT && stat != null;
    const raw = enough ? stat * P.TIME_LIMIT_FACTOR : null;
    const initial = enough ? Math.max(M.MIN_TIME_LIMIT, Math.min(M.MAX_TIME_LIMIT, raw)) : M.TIME_LIMIT;
    return {
      level: M.LEVEL,
      n_trials: rows.length,
      n_answered: answered.length,
      n_correct: correctRows.length,
      n_correct_used: correctRts.length,
      n_excluded_focus_lost: correctRows.length - correctRts.length,
      accuracy: rows.length ? r4(correctRows.length / rows.length) : "",
      mean_rt_correct: m == null ? "" : r4(m),
      median_rt_correct: md == null ? "" : r4(md),
      statistic: P.STATISTIC === "median" ? "median" : "mean",
      factor: P.TIME_LIMIT_FACTOR,
      raw_time_limit: raw == null ? "" : r4(raw),
      initial_time_limit: r4(initial),
      min_time_limit: M.MIN_TIME_LIMIT,
      max_time_limit: M.MAX_TIME_LIMIT,
      min_correct: P.MIN_CORRECT,
      source: enough ? "baseline" : "default",
    };
  }

  let calibration = null;   // set by runBaseline(); read by run()

  // ── White noise (Web Audio) ────────────────────────────────────────────
  let noiseNode = null;
  function startNoise() {
    if (!C().WHITE_NOISE || !Core.audio) return;
    try {
      const ctx = Core.audio;
      if (ctx.state === "suspended") ctx.resume();
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = C().WHITE_NOISE_VOLUME;
      src.connect(gain).connect(ctx.destination);
      src.start();
      noiseNode = src;
      Core.Events.log("MIST_Markers", 0, "white_noise_start");
    } catch (e) {
      console.warn("White noise unavailable", e);
    }
  }
  function stopNoise() {
    if (noiseNode) {
      try { noiseNode.stop(); } catch (_) {}
      noiseNode = null;
      Core.Events.log("MIST_Markers", 0, "white_noise_stop");
    }
  }

  // ── Display ────────────────────────────────────────────────────────────
  function buildPerfBar(parent) {
    const bar = el("div", "perf-bar", null, parent);
    el("div", "zone zone-red", null, bar);
    el("div", "zone zone-white", null, bar);
    el("div", "zone zone-green", null, bar);
    const avg = el("div", "tri tri-down", null, bar);
    avg.style.left = C().TARGET_ACCURACY * 100 + "%";
    const me = el("div", "tri tri-up", null, bar);
    me.style.left = "0%";
    return { bar, set: (pct) => (me.style.left = Math.max(0, Math.min(1, pct)) * 100 + "%") };
  }

  function buildDial(parent) {
    const dial = el("div", "dial", null, parent);
    const btns = [];
    for (let d = 0; d < 10; d++) {
      const cw = (d * 36 - 36 + 360) % 360;
      const th = ((90 - cw) * Math.PI) / 180;
      const b = el("div", "dial-btn", String(d), dial);
      // Positions in vh relative to the dial centre (see .dial in style.css).
      b.style.left = `calc(${16 * Math.cos(th)}vh - 4vh)`;
      b.style.top = `calc(${-16 * Math.sin(th)}vh - 4vh)`;
      btns.push(b);
    }
    let flashTimer = null;
    return {
      dial,
      select(d) {
        btns.forEach((b, i) => { b.classList.toggle("selected", i === d); b.classList.remove("flash"); });
        btns[d].classList.add("flash");
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => btns[d].classList.remove("flash"), 120);
      },
      clear() { btns.forEach((b) => b.classList.remove("selected", "flash")); },
    };
  }

  // withBar: performance bar (stressor only). withTimer: countdown visible.
  function buildStims({ withBar, withTimer }) {
    const s = stage();
    s.innerHTML = "";
    const st = {
      screen: el("div", "mist-screen", null, s),
      feedback: el("div", "mist-feedback", null, s),
    };
    st.perf = withBar ? buildPerfBar(st.screen) : null;
    st.problemBox = el("div", "mist-problem", null, st.screen);
    st.timer = el("div", "mist-timer", "00:00", st.screen);
    if (!withTimer) st.timer.style.display = "none";
    st.withTimer = withTimer;
    st.dial = buildDial(st.screen);
    st.feedbackText = el("span", null, "", st.feedback);
    return st;
  }

  const fmt = (t) => {
    const s = Math.max(0, Math.floor(t));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // Blank screen between the feedback and the next problem (fixed).
  async function gap(st) {
    await present(() => { st.screen.style.visibility = "hidden"; st.feedback.style.visibility = "hidden"; });
    await sleep(C().GAP_AFTER_FEEDBACK);
  }

  // ── Trial ──────────────────────────────────────────────────────────────
  async function runTrial(st, problem, timeLimit) {
    const ev = (code, label) => Core.Events.log("MIST_Markers", code, label);
    let selected = null;
    st.dial.clear();
    st.problemBox.textContent = problem.display + " = ?";
    st.timer.textContent = fmt(timeLimit);

    const trialStart = iso();
    Core.Quality.resetTrial();
    const onset = await present(() => {
      st.feedback.style.visibility = "hidden";
      st.screen.style.visibility = "visible";
    });
    ev(TRIGGERS.trial_onset, "trial_onset");
    const frameMs = Core.lastFrameMs;

    // Countdown display, refreshed every frame (stressor only).
    let running = st.withTimer;
    (function tick() {
      if (!running) return;
      st.timer.textContent = fmt(timeLimit - (now() - onset) / 1000);
      requestAnimationFrame(tick);
    })();

    const r = await Core.waitForKey([...DIGIT_KEYS, "backspace", "return"], {
      timeout: timeLimit * 1000,
      onset,
      onKey(k) {
        if (k === "return") return selected != null;    // submit only with a selection
        if (k === "backspace") { selected = null; st.dial.clear(); return false; }
        selected = k; st.dial.select(Number(k)); return false;
      },
    });
    running = false;
    ev(TRIGGERS.response, "response");

    const answer = selected || "";   // on a timeout: the digit selected but not submitted (counts as wrong)
    const timedOut = r.timedOut;
    const correct = !timedOut && answer !== "" && Number(answer) === problem.answer;
    return {
      onset, frameMs, trialStart, trialEnd: iso(), answer, timedOut, correct, skipped: !!r.skipped,
      rt: timedOut ? timeLimit : r.rt,
    };
  }

  async function showFeedback(st, text, colour) {
    await present(() => {
      st.screen.style.visibility = "hidden";
      st.feedbackText.textContent = text;
      st.feedbackText.style.color = colour;
      st.feedback.style.visibility = "visible";
    });
    Core.Events.log("MIST_Markers", TRIGGERS.feedback_onset, "feedback_onset");
    await sleep(C().FEEDBACK_DUR);
  }
  const GREEN = "rgb(0,128,0)", RED = "red", ORANGE = "orange";

  function row(block, n, problem, res, timeLimit, nextLimit, extra = {}) {
    return {
      participant_id: Core.Data.pid,
      session: Core.Data.session,
      step: Core.step,
      phase: block === "baseline" ? "mist_baseline" : "stressor",
      block,
      trial: n,
      level: C().LEVEL,
      problem: problem.display,
      correct_answer: problem.answer,
      participant_answer: res.answer,
      accuracy: Number(res.correct),
      answered: Number(!res.timedOut && res.answer !== ""),
      outcome: res.timedOut ? "missed" : res.correct ? "correct" : "incorrect",
      timed_out: Number(res.timedOut),
      rt: r4(res.rt),
      time_limit: timeLimit === "" ? "" : r4(timeLimit),
      max_time_s: extra.max_time_s != null ? extra.max_time_s : "",
      next_time_limit: nextLimit === "" ? "" : r4(nextLimit),
      trial_start_time: res.trialStart,
      trial_end_time: res.trialEnd,
      trial_onset_time: sec(res.onset),
      onset_frame_ms: res.frameMs,
      focus_lost: Number(Core.Quality.trialFlags.focusLost),
      fullscreen: Number(Core.isFullscreen()),
    };
  }

  function keep(rows, r) {
    rows.push(r);
    Core.Data.stream("mist_trials", r);
  }

  // Pause between trials if the participant left full screen.
  async function checkFullscreen() {
    if (!Core.isFullscreen()) { await Core.betweenTrials(); Core.showStage(); }
  }

  // ── Baseline block (step "mist_baseline") ──────────────────────────────
  async function runBaseline() {
    Core.phase = "mist_baseline";
    const TB = TEXTS.MIST_BASELINE;
    await Core.instructions(TB.INTRO, { minMs: 4000 });
    Core.showStage();
    const st = buildStims({ withBar: false, withTimer: false });
    const cap = B().MAX_TRIAL_S;
    const rows = [];
    Core.Events.log("MIST_Markers", TRIGGERS.block_start_baseline, "block_start_baseline");
    for (let i = 0; i < B().N_TRIALS; i++) {
      if (Core.Skip.requested) break;
      await checkFullscreen();
      const p = nextProblem();
      await gap(st);
      const res = await runTrial(st, p, cap);
      if (res.skipped) break;
      if (B().SHOW_FEEDBACK) {
        const F = TB.FEEDBACK;
        if (res.timedOut) await showFeedback(st, F.no_answer, ORANGE);
        else await showFeedback(st, res.correct ? F.correct : F.incorrect, res.correct ? GREEN : RED);
      } else {
        await present(() => { st.screen.style.visibility = "hidden"; });
      }
      keep(rows, row("baseline", i + 1, p, res, "", "", { max_time_s: cap }));
    }
    Core.Events.log("MIST_Markers", TRIGGERS.block_end, "block_end");
    calibration = calibrate(rows);
    Core.Data.set("mist_calibration", calibration);
    Core.Events.log("MIST_Markers", 0, "time_limit_set", JSON.stringify(calibration));
    await Core.instructions(TB.END);
    return rows;
  }

  // ── Stressor (step "mist") ─────────────────────────────────────────────
  async function runPractice(limit) {
    const rows = [];
    const st = buildStims({ withBar: false, withTimer: true });
    const F = TEXTS.MIST.FEEDBACK;
    for (let i = 0; i < C().N_PRACTICE_TRIALS; i++) {
      if (Core.Skip.requested) break;
      await checkFullscreen();
      const p = nextProblem();
      await gap(st);
      const res = await runTrial(st, p, limit);
      if (res.skipped) break;
      await showFeedback(st, res.timedOut ? F.too_slow : res.correct ? F.correct : F.incorrect,
        res.timedOut ? ORANGE : res.correct ? GREEN : RED);
      keep(rows, row("practice", i + 1, p, res, limit, limit));
    }
    return rows;
  }

  async function runExperimental(startLimit) {
    const rows = [];
    const st = buildStims({ withBar: true, withTimer: true });
    const F = TEXTS.MIST.FEEDBACK;
    const window10 = [];
    const adapt = makeAdapter();
    let timeLimit = startLimit;
    Core.Events.log("MIST_Markers", TRIGGERS.block_start_exp, "block_start_exp");

    for (let i = 0; i < C().N_EXP_TRIALS; i++) {
      if (Core.Skip.requested) break;
      await checkFullscreen();
      const p = nextProblem();
      await gap(st);

      const usedLimit = timeLimit;
      const res = await runTrial(st, p, usedLimit);
      if (res.skipped) break;

      window10.push(Number(res.correct));
      if (window10.length > 10) window10.shift();
      st.perf.set(window10.reduce((a, b) => a + b, 0) / window10.length);

      timeLimit = adapt(timeLimit, res.correct);

      await showFeedback(st, res.timedOut ? F.too_slow : res.correct ? F.correct : F.incorrect,
        res.timedOut ? ORANGE : res.correct ? GREEN : RED);
      keep(rows, row("experimental", i + 1, p, res, usedLimit, timeLimit));
    }
    Core.Events.log("MIST_Markers", TRIGGERS.block_end, "block_end");
    return rows;
  }

  // Annotated performance-bar instructions (mist.show_exp_instructions).
  function barInstructionsExtra() {
    const T = TEXTS.MIST;
    const wrap = el("div", "exp-instruct");
    const p = buildPerfBar(wrap);
    p.bar.classList.add("perf-bar-static");
    p.set(0.4);
    const zones = el("div", "zone-labels", null, wrap);
    el("div", "zl zl-red", T.BAR_ZONES[0], zones);
    el("div", "zl zl-white", T.BAR_ZONES[1], zones);
    el("div", "zl zl-green", T.BAR_ZONES[2], zones);
    el("div", "legend", T.BAR_LEGEND, wrap);
    el("div", "legend-instr", T.BAR_INSTRUCTIONS, wrap);
    return wrap;
  }

  async function run() {
    Core.phase = "stressor";
    // Starting time limit: from the baseline block if it ran in this session.
    if (!calibration) {
      calibration = { ...calibrate([]), source: "default", note: "mist_baseline step not run" };
      Core.Data.set("mist_calibration", calibration);
    }
    const startLimit = calibration.initial_time_limit;
    Core.Data.merge("mist_calibration", { stressor_initial_time_limit: startLimit });
    Core.Events.log("MIST_Markers", 0, "time_limit_set", JSON.stringify({ initial_time_limit: startLimit, source: calibration.source }));
    let rows = [];
    try {
      await Core.instructions(TEXTS.MIST.INTRO, { minMs: 5000 });
      startNoise();
      if (C().N_PRACTICE_TRIALS > 0) {
        await Core.instructions(TEXTS.MIST.PRACTICE);
        Core.showStage();
        rows = rows.concat(await runPractice(startLimit));
      }
      await Core.instructions(TEXTS.MIST.BAR_TITLE, { extra: barInstructionsExtra(), minMs: 3000 });
      Core.showStage();
      rows = rows.concat(await runExperimental(startLimit));
    } finally {
      stopNoise();
    }
    await Core.instructions(TEXTS.MIST.END);
    return rows;
  }

  window.MIST = {
    run, runBaseline, calibrate, nextProblem, makeAdapter, TRIGGERS,
    get calibration() { return calibration; },
  };
})();
