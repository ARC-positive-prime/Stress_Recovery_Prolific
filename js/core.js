/*
 * Core engine: timing, keyboard, screens, event log, browser-integrity
 * tracking (full screen / tab switches / focus) and the debug "skip" switch.
 * Shared by every task. You should not need to edit this file.
 *
 * Timing
 *   Stimuli are drawn inside a requestAnimationFrame callback, and the onset
 *   is the timestamp of the NEXT frame: the closest a browser gets to
 *   PsychoPy's flip-locked onset. RTs are keydown event.timeStamp − onset;
 *   both are on the performance.now() clock, so RT precision is ~1 ms plus
 *   keyboard latency (typically 5–30 ms on laptops, constant within a person,
 *   so pre/post comparisons are unaffected).
 */
(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const now = () => performance.now();
  const sec = (ms) => Math.round(ms) / 1000; // ms → s, 3 dp
  const iso = () => new Date().toISOString();
  const r2 = (x) => Math.round(x * 100) / 100;

  // Fill {PLACEHOLDERS} in a text from js/texts.js.
  function fill(text, vars = {}) {
    return String(text).replace(/\{([A-Z_]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  // Draw `render` on the next frame; resolve with the timestamp of the frame
  // after that, i.e. when the drawn frame reached the screen. Also records
  // the duration of the frame that carried the stimulus (Core.lastFrameMs):
  // ≈ 1000/refresh normally, larger if a frame was dropped at onset.
  async function present(render) {
    const t1 = await frame();
    render();
    const t2 = await frame();
    window.Core.lastFrameMs = Math.round((t2 - t1) * 100) / 100;
    return t2;
  }

  // ── Random helpers ─────────────────────────────────────────────────────
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const choice = (a) => a[Math.floor(Math.random() * a.length)];

  // ── Debug skip (only active in debug mode, see js/debug.js) ────────────
  // Pressing F2 in debug mode sets Skip.requested: key waits resolve at once,
  // task loops stop at the next trial, so the current step ends quickly.
  // main.js resets it at the start of every step.
  const Skip = {
    enabled: false,
    requested: false,
    _waiters: [],
    request() {
      if (!this.enabled) return;
      this.requested = true;
      const w = this._waiters; this._waiters = [];
      w.forEach((r) => r());
    },
    reset() { this.requested = false; },
    promise() {
      return new Promise((r) => (this.requested ? r() : this._waiters.push(r)));
    },
  };

  // Sleep that ends early when a debug skip is requested (long waits only).
  const wait = (ms) => (Skip.enabled ? Promise.race([sleep(ms), Skip.promise()]) : sleep(ms));

  // ── Keyboard ───────────────────────────────────────────────────────────
  // Physical-key names, matching PsychoPy key names used in the originals.
  function keyName(e) {
    if (/^[0-9]$/.test(e.key)) return e.key;
    // Arrow keys first: the numpad arrows (NumLock off) have e.code Numpad4/6.
    const ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (ARROWS[e.key]) return ARROWS[e.key];
    // Letters: the letter printed on the key (works on any Latin layout);
    // non-Latin layouts fall back to position.
    if (e.key && /^[a-zA-Z]$/.test(e.key)) return e.key.toLowerCase();
    const c = e.code || "";
    if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
    if (/^(Digit|Numpad)[0-9]$/.test(c)) return c.slice(-1);
    switch (c) {
      case "ArrowLeft": return "left";
      case "ArrowRight": return "right";
      case "ArrowUp": return "up";
      case "ArrowDown": return "down";
      case "Space": return "space";
      case "Enter": case "NumpadEnter": return "return";
      case "Backspace": return "backspace";
    }
    if (e.key === "ArrowLeft") return "left";
    if (e.key === "ArrowRight") return "right";
    if (e.key === " ") return "space";
    if (e.key === "Enter") return "return";
    if (e.key === "Backspace") return "backspace";
    return (e.key || "").toLowerCase();
  }

  function eventTime(e) {
    // event.timeStamp is a performance.now()-clock value in all current
    // browsers; very old ones used epoch ms, so fall back if it looks wrong.
    const t = e.timeStamp;
    return t > 0 && t < 1e11 ? t : now();
  }

  /*
   * Wait for one of `keys`. With `timeout` (ms), resolves {timedOut:true}
   * if nothing arrives within `timeout` of `onset` (or of the call).
   * Returns {key, t, rt (s from onset), timedOut, skipped}.
   */
  function waitForKey(keys, opts = {}) {
    const { timeout = null, onset = null, onKey = null } = opts;
    const t0 = onset != null ? onset : now();
    return new Promise((resolve) => {
      let timer = null;
      let finished = false;
      const done = (val) => {
        if (finished) return;
        finished = true;
        window.removeEventListener("keydown", handler, true);
        if (timer) clearTimeout(timer);
        resolve(val);
      };
      function handler(e) {
        const k = keyName(e);
        if (["space", "left", "right", "up", "down", "backspace"].includes(k)) e.preventDefault();
        if (e.repeat || !keys.includes(k)) return;
        const t = eventTime(e);
        if (timeout != null && t - t0 > timeout) return; // arrived after deadline
        if (onKey && onKey(k, t) === false) return;      // consumed, keep waiting
        done({ key: k, t, rt: (t - t0) / 1000, timedOut: false, skipped: false });
      }
      window.addEventListener("keydown", handler, true);
      if (timeout != null) {
        timer = setTimeout(
          () => done({ key: null, t: null, rt: null, timedOut: true, skipped: false }),
          Math.max(0, t0 + timeout - now())
        );
      }
      if (Skip.enabled) Skip.promise().then(() => done({ key: null, t: null, rt: null, timedOut: true, skipped: true }));
    });
  }

  // ── Screen ─────────────────────────────────────────────────────────────
  const stage = () => document.getElementById("stage");
  const page = () => document.getElementById("page");

  function showStage() {
    page().hidden = true;
    stage().hidden = false;
    document.body.classList.add("task-mode");
  }
  function showPage() {
    stage().hidden = true;
    page().hidden = false;
    document.body.classList.remove("task-mode");
    window.scrollTo(0, 0);
  }
  function clearStage() { stage().innerHTML = ""; }

  function el(tag, cls, text, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  // Full-screen instruction text (PsychoPy-style) that waits for SPACE.
  // opts.minMs: SPACE is ignored for this long, so key screens can't be
  // skipped unread by a double key press. Every screen's display time is
  // logged (Session event "instructions", detail = {screen, shown_s}).
  async function instructions(text, opts = {}) {
    showStage();
    await ensureFullscreen();
    clearStage();
    const box = el("div", "instruct", null, stage());
    box.textContent = text;
    if (opts.extra) box.appendChild(opts.extra);
    await frame();
    const t0 = now();
    const minMs = opts.minMs || 0;
    await waitForKey(opts.keys || ["space"], { onKey: () => now() - t0 >= minMs });
    Events.log("Session", 0, "instructions", JSON.stringify({ screen: String(text).split("\n")[0].slice(0, 60), shown_s: sec(now() - t0) }));
    clearStage();
  }

  async function blank(ms) {
    await present(clearStage);
    await sleep(ms);
  }

  // ── Fullscreen ─────────────────────────────────────────────────────────
  const fsSupported = () =>
    !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  // Resolves once the browser is in full screen, or after about 1 s if it
  // is not (old Safari's webkitRequestFullscreen enters full screen later).
  async function requestFullscreen() {
    const d = document.documentElement;
    const changed = new Promise((r) => {
      const h = () => { document.removeEventListener("fullscreenchange", h); document.removeEventListener("webkitfullscreenchange", h); r(); };
      document.addEventListener("fullscreenchange", h);
      document.addEventListener("webkitfullscreenchange", h);
    });
    try {
      if (d.requestFullscreen) await d.requestFullscreen({ navigationUI: "hide" });
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
    } catch (_) { /* denied: carry on windowed */ }
    if (!isFullscreen()) await Promise.race([changed, sleep(1000)]);
  }

  // Ask the participant to go back to full screen if they left it. Needs a
  // click (browsers only allow full screen on a user gesture). Each prompt
  // and how long it took is recorded (integrity + Browser events).
  // opts.resume: after the click, also wait for SPACE ("ready to continue"),
  // so a timed trial does not start while the hand is still on the mouse.
  function ensureFullscreen(opts = {}) {
    if (!fsSupported() || isFullscreen() || Core.fullscreenDeclined) return Promise.resolve(false);
    Integrity.prompt();
    const shownAt = now();
    return new Promise((resolve) => {
      const ov = el("div", "overlay", null, document.body);
      const card = el("div", "overlay-card", null, ov);
      el("p", null, "The study needs to run in full screen. Please click the button to continue.", card);
      const btn = el("button", "btn", "Return to full screen", card);
      btn.onclick = async () => {
        btn.disabled = true;
        await requestFullscreen();
        if (!isFullscreen()) { Core.fullscreenDeclined = true; Integrity.declined = 1; } // browser refused
        Events.log("Browser", 0, "fullscreen_prompt_closed", JSON.stringify({ waited_s: sec(now() - shownAt), fullscreen: Number(isFullscreen()) }));
        if (opts.resume) {
          card.innerHTML = "";
          el("p", null, "Thank you. Put your hands back on the keyboard and press SPACE to continue.", card);
          await waitForKey(["space"]);
        }
        ov.remove();
        resolve(true);
      };
    });
  }

  // Called by the Stroop and MIST before every trial.
  function betweenTrials() {
    const I = window.CONFIG && CONFIG.INTEGRITY;
    if (I && I.REQUIRE_FULLSCREEN_BETWEEN_TRIALS) return ensureFullscreen({ resume: true });
    return Promise.resolve();
  }

  // ── Event-marker log (same codes as the LSL triggers in the lab) ────────
  const Events = {
    rows: [],
    log(stream, code, label, extra) {
      const D = window.Core && window.Core.Data;
      const r = {
        participant_id: D ? D.pid : "", session: D ? D.session : 1,
        step: (window.Core && Core.step) || "", phase: (window.Core && Core.phase) || "",
        stream, code, label, time: sec(now()), wall_time: iso(),
      };
      if (extra != null) r.detail = extra;
      this.rows.push(r);
    },
  };

  // ── Browser integrity: full screen, tab switches, focus ────────────────
  // Everything is recorded three ways:
  //   1. Events (stream "Browser"): every change with a timestamp;
  //   2. integrity section of the data file: counts, total durations, the
  //      same per step (by_step) and a list of incidents with durations;
  //   3. per trial: focus_lost = 1 if any of this happened during the trial,
  //      fullscreen = 1 if in full screen at the end of the trial.
  const MAX_INCIDENTS = 1000;
  const Integrity = {
    counts: { fullscreen_exit_count: 0, tab_hidden_count: 0, window_blur_count: 0, fullscreen_return_prompts: 0 },
    totals: { time_outside_fullscreen_s: 0, time_hidden_s: 0, time_blurred_s: 0 },
    byStep: {},
    incidents: [],
    open: {},             // type → open incident (not yet ended)
    declined: 0,
    unsupported: 0,       // 1 = this browser has no full-screen API at all
    nIncidents: 0,
    fsEverEntered: false,

    stepEntry(step) {
      const k = step || "(none)";
      return (this.byStep[k] = this.byStep[k] || {
        fullscreen_exit_count: 0, tab_hidden_count: 0, window_blur_count: 0,
        fullscreen_return_prompts: 0, time_outside_fullscreen_s: 0, time_hidden_s: 0, time_blurred_s: 0,
      });
    },
    begin(type, countKey) {
      if (this.open[type]) return;  // already open
      this.counts[countKey]++;
      this.stepEntry(Core.step)[countKey]++;
      const inc = {
        type, step: Core.step || "", phase: Core.phase || "",
        during_task: Number(document.body.classList.contains("task-mode")),
        start: iso(), end: null, start_time_s: sec(now()), duration_s: null,
        _t0: now(),
      };
      this.open[type] = inc;
      this.nIncidents++;
      if (this.incidents.length < MAX_INCIDENTS) this.incidents.push(inc);
    },
    end(type, totalKey) {
      const inc = this.open[type];
      if (!inc) return;
      delete this.open[type];
      const d = (now() - inc._t0) / 1000;
      inc.end = iso();
      inc.duration_s = r2(d);
      this.totals[totalKey] += d;
      this.stepEntry(inc.step)[totalKey] += d;
    },
    prompt() {
      this.counts.fullscreen_return_prompts++;
      this.stepEntry(Core.step).fullscreen_return_prompts++;
      Events.log("Browser", 0, "fullscreen_prompt");
    },
    // Snapshot for the data file (open incidents counted up to now).
    report() {
      const totals = { ...this.totals };
      const byStep = JSON.parse(JSON.stringify(this.byStep));
      const KEY = { fullscreen_exit: "time_outside_fullscreen_s", tab_hidden: "time_hidden_s", window_blur: "time_blurred_s" };
      for (const [type, inc] of Object.entries(this.open)) {
        const d = (now() - inc._t0) / 1000;
        totals[KEY[type]] += d;
        const s = byStep[inc.step || "(none)"];
        if (s) s[KEY[type]] += d;
      }
      for (const s of Object.values(byStep)) for (const k of Object.values(KEY)) s[k] = r2(s[k]);
      const out = { ...this.counts, fullscreen_declined: this.declined, fullscreen_unsupported: this.unsupported };
      for (const [k, v] of Object.entries(totals)) out[k] = r2(v);
      out.by_step = byStep;
      out.incidents_total = this.nIncidents;
      out.incidents_truncated = Number(this.nIncidents > this.incidents.length);
      // Incidents still going on now: duration so far, marked open = 1.
      out.incidents = this.incidents.map(({ _t0, ...rest }) =>
        rest.end == null ? { ...rest, open: 1, duration_s: r2((now() - _t0) / 1000) } : rest);
      return out;
    },
  };

  // Per-trial flag: tasks reset it at trial start and copy it into each row.
  const Quality = {
    trialFlags: { focusLost: false },
    // A trial starts as "focus lost" if the window is still unfocused, hidden
    // or out of full screen from before; otherwise any new incident sets it.
    resetTrial() {
      this.trialFlags.focusLost = Object.keys(Integrity.open).length > 0 || document.hidden ||
        (typeof document.hasFocus === "function" && !document.hasFocus());
    },
    get blurCount() { return Integrity.counts.window_blur_count; },
    get hiddenCount() { return Integrity.counts.tab_hidden_count; },
    get fullscreenExits() { return Integrity.counts.fullscreen_exit_count; },
  };

  window.addEventListener("blur", () => {
    Quality.trialFlags.focusLost = true;
    Integrity.begin("window_blur", "window_blur_count");
    Events.log("Browser", 0, "window_blur");
  });
  window.addEventListener("focus", () => {
    Integrity.end("window_blur", "time_blurred_s");
    Events.log("Browser", 0, "window_focus");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      Quality.trialFlags.focusLost = true;
      Integrity.begin("tab_hidden", "tab_hidden_count");
    } else {
      Integrity.end("tab_hidden", "time_hidden_s");
    }
    Events.log("Browser", 0, document.hidden ? "tab_hidden" : "tab_visible");
  });
  let studyExit = false;   // the study itself is leaving full screen (before the feedback form)
  const onFs = () => {
    if (isFullscreen()) {
      Integrity.fsEverEntered = true;
      Integrity.end("fullscreen_exit", "time_outside_fullscreen_s");
    } else if (Integrity.fsEverEntered && !studyExit) {
      Quality.trialFlags.focusLost = true;
      Integrity.begin("fullscreen_exit", "fullscreen_exit_count");
    }
    Events.log("Browser", 0, isFullscreen() ? "fullscreen_enter" : "fullscreen_exit", !isFullscreen() && studyExit ? "by_study" : undefined);
    if (!isFullscreen()) studyExit = false;
  };
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);

  // Leave full screen on purpose (end of the tasks): not counted as an exit,
  // and full-screen tracking stops until the participant enters it again.
  async function exitFullscreen() {
    // Tracking stops here: close an exit incident that is still open (the
    // participant left full screen just before) and stop counting.
    Integrity.end("fullscreen_exit", "time_outside_fullscreen_s");
    if (!isFullscreen()) { Integrity.fsEverEntered = false; return; }
    studyExit = true;
    Integrity.fsEverEntered = false;
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (_) { studyExit = false; }
  }

  // ── Device info ────────────────────────────────────────────────────────
  // Display refresh: median/mean/SD frame interval over `nFrames` frames, and
  // the share of frames that took > 1.5× the median (dropped frames).
  async function measureFrames(nFrames = 120) {
    const ts = [];
    for (let i = 0; i < nFrames; i++) ts.push(await frame());
    const d = ts.slice(1).map((t, i) => t - ts[i]);
    const s = d.slice().sort((a, b) => a - b);
    const median = s[Math.floor(s.length / 2)];
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1));
    return {
      refresh_rate_hz: median > 0 ? Math.round(1000 / median) : null,
      frame_ms_median: r2(median), frame_ms_mean: r2(mean), frame_ms_sd: r2(sd),
      frames_dropped_pct: r2((100 * d.filter((x) => x > 1.5 * median).length) / d.length),
    };
  }

  // Smallest step of performance.now() (browsers coarsen it: ~0.1 ms in
  // Chrome/Edge, 1 ms in Firefox/Safari): the floor of RT precision.
  function timerResolution() {
    let best = Infinity;
    for (let i = 0; i < 50; i++) {
      const a = performance.now();
      let b = a;
      while (b === a) b = performance.now();
      best = Math.min(best, b - a);
    }
    return Math.round(best * 1000) / 1000;
  }

  function browserName() {
    const ua = navigator.userAgent;
    const m = ua.match(/Edg\/([\d.]+)/) ? ["Edge", ua.match(/Edg\/([\d.]+)/)[1]]
      : ua.match(/OPR\/([\d.]+)/) ? ["Opera", ua.match(/OPR\/([\d.]+)/)[1]]
      : ua.match(/Firefox\/([\d.]+)/) ? ["Firefox", ua.match(/Firefox\/([\d.]+)/)[1]]
      : ua.match(/Chrome\/([\d.]+)/) ? ["Chrome", ua.match(/Chrome\/([\d.]+)/)[1]]
      : ua.match(/Version\/([\d.]+).*Safari/) ? ["Safari", ua.match(/Version\/([\d.]+)/)[1]]
      : ["other", ""];
    const os = /Windows NT 10/.test(ua) ? "Windows 10/11" : /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "other";
    return { browser: m[0], browser_version: m[1], os };
  }

  // Everything about the display, timing and audio, measured once the page
  // is full screen (call after the participant clicks Start).
  async function deviceInfo(nFrames = 120) {
    const dpr = window.devicePixelRatio || 1;
    const frames = await measureFrames(nFrames);
    const a = window.Core.audio;
    return {
      ...browserName(),
      screen_w: screen.width, screen_h: screen.height,                       // CSS pixels
      screen_w_px: Math.round(screen.width * dpr), screen_h_px: Math.round(screen.height * dpr), // physical pixels
      device_pixel_ratio: dpr,
      window_w: innerWidth, window_h: innerHeight,                          // area the tasks drew in
      color_depth: screen.colorDepth,
      fullscreen_active: Number(isFullscreen()),
      ...frames,
      timer_resolution_ms: timerResolution(),
      audio_sample_rate_hz: a ? a.sampleRate : "",
      audio_base_latency_ms: a && a.baseLatency != null ? Math.round(a.baseLatency * 10000) / 10 : "",
      audio_output_latency_ms: a && a.outputLatency ? Math.round(a.outputLatency * 10000) / 10 : "",
      cpu_cores: navigator.hardwareConcurrency || "",
      device_memory_gb: navigator.deviceMemory || "",
      max_touch_points: navigator.maxTouchPoints || 0,
      user_agent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    };
  }

  // ── IDs ────────────────────────────────────────────────────────────────
  // Prolific passes PROLIFIC_PID / STUDY_ID / SESSION_ID in the study URL.
  // Unreplaced placeholders ("{{%PROLIFIC_PID%}}") are ignored.
  function urlId(name) {
    const v = new URLSearchParams(location.search).get(name);
    if (!v || v.includes("{") || v.includes("%")) return "";
    return v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  }
  function prolificInfo() {
    return {
      prolific_pid: urlId("PROLIFIC_PID"),
      prolific_study_id: urlId("STUDY_ID"),
      prolific_session_id: urlId("SESSION_ID"),
    };
  }

  function randomCode(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").toUpperCase().slice(0, n);
  }

  /*
   * Participant code + attempt number. If the same PROLIFIC_PID (or ?pid=)
   * opens the study again in the same browser after giving consent once,
   * the code gets "(2)", "(3)", … appended, so a restart is never mixed up
   * with the first try. The attempt is counted (commit()) only when consent
   * is given, so reloading the consent page doesn't count. A restart in a
   * different browser can't be seen here; files still differ in page_load_id.
   */
  const ATTEMPT_KEY = "stress_recovery_prolific_attempts_";
  function identity(prefix = "P") {
    const base = urlId("PROLIFIC_PID") || urlId("pid");
    if (!base) return { pid: prefix + randomCode(7), base: "", attempt: 1, commit() {} };
    let prev = 0;
    try { prev = parseInt(localStorage.getItem(ATTEMPT_KEY + base) || "0", 10) || 0; } catch (_) {}
    const attempt = prev + 1;
    return {
      pid: attempt === 1 ? base : `${base}(${attempt})`,
      base,
      attempt,
      commit() { try { localStorage.setItem(ATTEMPT_KEY + base, String(attempt)); } catch (_) {} },
    };
  }

  window.Core = {
    sleep, wait, frame, now, sec, iso, fill, present, shuffle, choice, randomCode,
    keyName, waitForKey, showStage, showPage, clearStage, el, stage, page,
    instructions, blank, requestFullscreen, exitFullscreen, ensureFullscreen, betweenTrials, isFullscreen, fsSupported,
    measureFrames, deviceInfo, identity, prolificInfo, urlId,
    lastFrameMs: null,
    Events, Integrity, Quality, Skip,
    Data: null,          // set by js/data.js
    audio: null,
    step: "", phase: "", fullscreenDeclined: false,
  };
})();
