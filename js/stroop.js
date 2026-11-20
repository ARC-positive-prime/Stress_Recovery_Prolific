/*
 * Stroop: traditional colour–word MATCH task with 2 keys.
 *
 *   A colour word (RED / GREEN / BLUE / YELLOW) appears in a coloured ink.
 *   Does the ink colour match the word?
 *     match key    (default ← LEFT arrow)  = yes, they match   → congruent trials
 *     mismatch key (default → RIGHT arrow) = no, they don't    → incongruent trials
 *   Stroop interference = RT incongruent − RT congruent (and accuracy).
 *
 *   First Stroop step of the session: instructions → practice with feedback
 *   → test. Later steps: a short reminder → test.
 *   Trial: blank ITI → fixation → word (until key / WORD_TIMEOUT) →
 *          fixation (test) or "Correct / Incorrect / Too slow" (practice).
 *
 * Settings:  CONFIG.STROOP in js/config.js  (keys, trial counts, timings)
 * Wording:   TEXTS.STROOP in js/texts.js
 * Test alone: debug.html → "Stroop".
 */
(function () {
  "use strict";
  const C = () => CONFIG.STROOP;
  const T = () => TEXTS.STROOP;
  const { el, stage, present, sleep, sec } = Core;

  // Ink colours (as in the lab stroop.py).
  const INK_RGB = {
    red: "rgb(165,0,0)",
    green: "rgb(0,230,0)",
    blue: "rgb(0,0,200)",
    yellow: "rgb(255,255,0)",
  };
  const INKS = Object.keys(INK_RGB);
  const COLOUR_WORD = { red: "RED", green: "GREEN", blue: "BLUE", yellow: "YELLOW" };

  const TRIGGERS = {
    block_start: 13, practice_block_start: 14, fixation: 1,
    word_congruent: 74, word_incongruent: 75,
    response_correct: 41, response_incorrect: 42, response_timeout: 43, block_end: 9,
  };

  // Key mapping for this participant (set once by main.js via setMapping()).
  let mapping = null;
  function getMapping() {
    if (!mapping) mapping = { match: C().KEYS.match, mismatch: C().KEYS.mismatch };
    return mapping;
  }
  // COUNTERBALANCE_KEYS: swap the two keys for a random half of participants.
  function chooseMapping() {
    const k = C().KEYS;
    mapping = C().COUNTERBALANCE_KEYS && Math.random() < 0.5
      ? { match: k.mismatch, mismatch: k.match }
      : { match: k.match, mismatch: k.mismatch };
    return mapping;
  }
  function setMapping(m) { mapping = { match: m.match, mismatch: m.mismatch }; }

  const keyLabel = (k) => (T().KEY_LABELS && T().KEY_LABELS[k]) || k.toUpperCase();
  const fillKeys = (text) => Core.fill(text, {
    MATCH_KEY: keyLabel(getMapping().match),
    MISMATCH_KEY: keyLabel(getMapping().mismatch),
  });

  // Bottom-of-screen reminder: each meaning on the side of its key.
  function reminderText() {
    const m = getMapping();
    const left = m.match === "left" ? T().REMINDER_MATCH : m.mismatch === "left" ? T().REMINDER_MISMATCH : "";
    const right = m.match === "right" ? T().REMINDER_MATCH : m.mismatch === "right" ? T().REMINDER_MISMATCH : "";
    if (left && right) return `←  ${left}                    ${right}  →`;
    return `${keyLabel(m.match)} = ${T().REMINDER_MATCH}        ${keyLabel(m.mismatch)} = ${T().REMINDER_MISMATCH}`;
  }

  // Coloured examples under the first instructions: RED in red = match, RED in blue = no match.
  function examplesElement() {
    const wrap = el("div", "stroop-examples");
    const ex = (inkKey, answer) => {
      const box = el("div", "stroop-example", null, wrap);
      const w = el("div", "stroop-example-word", "RED", box);
      w.style.color = INK_RGB[inkKey];
      el("div", "stroop-example-answer", answer, box);
    };
    const m = getMapping();
    const items = [
      ["red", `${T().REMINDER_MATCH}  (${keyLabel(m.match)})`, m.match],
      ["blue", `${T().REMINDER_MISMATCH}  (${keyLabel(m.mismatch)})`, m.mismatch],
    ];
    if (items[0][2] === "right") items.reverse();   // each example on the side of its key
    for (const [ink, text] of items) ex(ink, text);
    return wrap;
  }

  // ── Sequences (constrained shuffle, as stroop._constrained_order) ──────
  function runOk(seq, item, attr, maxRun) {
    if (maxRun == null || seq.length < maxRun) return true;
    return seq.slice(-maxRun).some((t) => t[attr] !== item[attr]);
  }

  // Random order with: same ink ≤ MAX_INK_RUN in a row, same answer
  // (congruency) ≤ MAX_TYPE_RUN in a row, never the same word twice in a row.
  function constrainedOrder(trials, maxInkRun, maxTypeRun, maxAttempts = 5000) {
    for (let a = 0; a < maxAttempts; a++) {
      const pool = Core.shuffle(trials.slice());
      const seq = [];
      while (pool.length) {
        const cands = pool.filter((t) =>
          runOk(seq, t, "ink", maxInkRun) &&
          runOk(seq, t, "congruency", maxTypeRun) &&
          runOk(seq, t, "word", 1));
        if (!cands.length) break;
        const pick = Core.choice(cands);
        pool.splice(pool.indexOf(pick), 1);
        seq.push(pick);
      }
      if (!pool.length) return seq;
    }
    // Constraints impossible for these counts (e.g. odd quick-mode numbers):
    // fall back to the word rule only, then to a plain shuffle.
    console.warn("Stroop: ordering constraints could not be met; relaxing them");
    Core.Events.log("Stroop_Markers", 0, "order_constraints_relaxed", String(trials.length));
    return maxInkRun != null || maxTypeRun != null ? constrainedOrder(trials, null, null, 2000) : Core.shuffle(trials.slice());
  }

  function makeTrial(wordInk, ink) {
    const congruent = wordInk === ink;
    const answer = congruent ? "match" : "mismatch";
    return {
      word: COLOUR_WORD[wordInk],
      word_colour: wordInk,
      ink,
      congruency: congruent ? "congruent" : "incongruent",
      correct_answer: answer,
      correct_resp: getMapping()[answer],
    };
  }

  // Test run: N_CONGRUENT congruent (each word equally often in its own ink)
  // + N_INCONGRUENT incongruent (each word equally often in each other ink).
  function makeTestSequence(nCong = C().N_CONGRUENT, nIncong = C().N_INCONGRUENT) {
    const trials = [];
    for (let i = 0; i < nCong; i++) {
      const ink = INKS[i % INKS.length];
      trials.push(makeTrial(ink, ink));
    }
    const pairs = [];
    for (const w of INKS) for (const ink of INKS) if (ink !== w) pairs.push([w, ink]);
    const pairOrder = Core.shuffle(pairs.slice());   // a non-multiple of 12 still spreads evenly
    for (let i = 0; i < nIncong; i++) {
      const [w, ink] = pairOrder[i % pairOrder.length];
      trials.push(makeTrial(w, ink));
    }
    return constrainedOrder(trials, C().MAX_INK_RUN, C().MAX_TYPE_RUN);
  }

  // Practice: half congruent, half incongruent, built like the test run
  // (inks cycled, word–ink pairs spread evenly), so the order rules can be met.
  function makePracticeSequence(n = C().N_PRACTICE_TRIALS) {
    const nCong = Math.floor(n / 2);
    return makeTestSequence(nCong, n - nCong);
  }

  // ── Display ────────────────────────────────────────────────────────────
  function buildStims() {
    const s = stage();
    s.innerHTML = "";
    return {
      fixation: el("div", "stim fixation", "+", s),
      word: el("div", "stim stroop-word", "", s),
      feedback: el("div", "stim feedback-text", "", s),
      reminder: el("div", "stim reminder", reminderText(), s),
    };
  }
  function show(st, which) {
    for (const [k, node] of Object.entries(st)) node.style.visibility = which.includes(k) ? "visible" : "hidden";
  }

  // ── Trial / block ──────────────────────────────────────────────────────
  async function runTrial(st, trial) {
    const ev = (code, label) => Core.Events.log("Stroop_Markers", code, label);

    await present(() => show(st, []));                       // blank ITI
    await sleep(C().ITI_DUR);
    Core.Quality.resetTrial();

    await present(() => show(st, ["fixation", "reminder"])); // fixation
    ev(TRIGGERS.fixation, "fixation");
    await sleep(C().FIXATION_DUR);

    const onset = await present(() => {                      // word
      st.word.textContent = trial.word;
      st.word.style.color = INK_RGB[trial.ink];
      show(st, ["word", "reminder"]);
    });
    ev(TRIGGERS["word_" + trial.congruency], "word_" + trial.congruency);
    const frameMs = Core.lastFrameMs;

    const m = getMapping();
    const r = await Core.waitForKey([m.match, m.mismatch], { timeout: C().WORD_TIMEOUT, onset });
    if (r.timedOut) ev(TRIGGERS.response_timeout, "response_timeout");
    else if (r.key === trial.correct_resp) ev(TRIGGERS.response_correct, "response_correct");
    else ev(TRIGGERS.response_incorrect, "response_incorrect");
    return { ...r, onset, frameMs };
  }

  async function runBlock(st, trials, blockType, phase) {
    const isPractice = blockType === "practice";
    Core.Events.log("Stroop_Markers", isPractice ? TRIGGERS.practice_block_start : TRIGGERS.block_start,
      isPractice ? "practice_block_start" : "block_start");
    const rows = [];
    const m = getMapping();
    for (let i = 0; i < trials.length; i++) {
      if (Core.Skip.requested) break;                         // debug: F2
      if (!Core.isFullscreen()) {                              // left full screen: pause between trials
        await Core.betweenTrials();
        Core.showStage();
      }
      const t = trials[i];
      const r = await runTrial(st, t);
      if (r.skipped) break;
      const outcome = r.timedOut ? "missed" : r.key === t.correct_resp ? "correct" : "incorrect";

      if (isPractice) {
        await present(() => {
          const F = T().FEEDBACK;
          st.feedback.textContent = r.timedOut ? F.too_slow : outcome === "correct" ? F.correct : F.incorrect;
          show(st, ["feedback"]);
        });
      } else {
        await present(() => show(st, ["fixation"]));
      }
      await sleep(C().FEEDBACK_DUR);

      const row = {
        participant_id: Core.Data.pid,
        session: Core.Data.session,
        step: Core.step,
        phase,
        block_type: blockType,
        is_practice: Number(isPractice),
        trial: i + 1,
        word: t.word,
        word_colour: t.word_colour,
        ink_color: t.ink,
        congruency: t.congruency,
        trial_type: t.congruency,
        correct_answer: t.correct_answer,
        correct_response: t.correct_resp,
        participant_response: r.key || "",
        response_answer: r.key === m.match ? "match" : r.key === m.mismatch ? "mismatch" : "",
        outcome,
        accuracy: r.timedOut ? "" : Number(outcome === "correct"),
        rt: r.timedOut ? "" : Math.round(r.rt * 10000) / 10000,
        timed_out: Number(r.timedOut),
        trial_onset_time: sec(r.onset),
        onset_frame_ms: r.frameMs,
        focus_lost: Number(Core.Quality.trialFlags.focusLost),
        fullscreen: Number(Core.isFullscreen()),
      };
      rows.push(row);
      Core.Data.stream("stroop_trials", row);
    }
    Core.Events.log("Stroop_Markers", TRIGGERS.block_end, "block_end");
    return rows;
  }

  let runsDone = 0;   // the first run of the session gets instructions + practice

  /*
   * Run one Stroop step. The first Stroop step of the session shows the full
   * instructions and (by default) the practice; later steps a short reminder.
   * practice: true / false forces / suppresses the practice (debug).
   * Returns all rows (practice + test).
   */
  async function run({ phase, practice } = {}) {
    Core.phase = phase;
    const first = runsDone === 0;
    const withPractice = (practice != null ? practice : first) && C().N_PRACTICE_TRIALS > 0;
    runsDone++;
    let rows = [];
    if (first) await Core.instructions(fillKeys(T().GENERAL), { extra: examplesElement(), minMs: 3000 });
    if (withPractice) {
      await Core.instructions(fillKeys(T().PRACTICE));
      Core.showStage();
      rows = rows.concat(await runBlock(buildStims(), makePracticeSequence(), "practice", phase));
      await Core.instructions(fillKeys(T().TEST_START));
    } else if (first) {
      await Core.instructions(fillKeys(T().TEST_START_NO_PRACTICE));
    } else {
      await Core.instructions(fillKeys(T().RETURN));
    }
    Core.showStage();
    rows = rows.concat(await runBlock(buildStims(), makeTestSequence(), "test", phase));
    await Core.instructions(T().END);
    return rows;
  }

  window.Stroop = {
    run, chooseMapping, setMapping, getMapping,
    makeTestSequence, makePracticeSequence, constrainedOrder,
    INKS, INK_RGB, COLOUR_WORD, TRIGGERS,
  };
})();
