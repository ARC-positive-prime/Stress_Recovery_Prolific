/*
 * Session flow: runs the steps listed in CONFIG.FLOW (js/config.js), in
 * order. Default:
 *
 *   consent → demographics → setup (sound check, full screen) → intro
 *   → stroop:baseline         (first Stroop run: instructions + practice)
 *   → vas:pre_mist
 *   → mist_baseline           (practice, nothing at stake → sets the MIST time limit)
 *   → mist                    (stressor)
 *   → vas:post_mist
 *   → stroop:post_stress
 *   → vas:pre_images
 *   → images                  (the participant's image condition, 5 min)
 *   → blank                   (1 min rest)
 *   → vas:post_recovery       (+ "How did the images make you feel?")
 *   → stroop:post_recovery
 *   → feedback → upload → debrief → back to Prolific
 *
 * To change the order: edit CONFIG.FLOW. To test parts: debug.html.
 * To add a new kind of step: add a function to RUNNERS below.
 *
 * Data (js/data.js): after every step a snapshot of the whole data file is
 * backed up locally and uploaded to progress/; the complete file goes to
 * complete/ at the end; if the page is closed early a small file goes to quit/.
 */
(function () {
  "use strict";
  const D = Core.Data;
  const { iso, el } = Core;
  const params = new URLSearchParams(location.search);
  const DEBUG = Debug.active;

  const REST_TRIGGERS = { rest_start: 80, rest_end: 81 };
  const FORM_STEPS = ["consent", "demographics", "setup", "feedback"];

  let who = null;
  let startedAt = null;
  let started = false;
  let device = null;
  let frameMs = null;
  let stroopRuns = 0;
  const stepsRun = [];

  // The settings this session ran with (saved in the data file, without the upload URL),
  // and a fingerprint of all participant texts: a change during data collection is visible.
  function configForFile() {
    const c = JSON.parse(JSON.stringify(CONFIG));
    if (c.DATA) c.DATA.UPLOAD_URL = c.DATA.UPLOAD_URL ? "(set)" : "";
    return c;
  }
  function textsHash() {
    const str = JSON.stringify(window.TEXTS || {});
    let h = 0x811c9dc5;                       // FNV-1a, 32 bit
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  // "Leave site?" warning until the complete file is saved (or there is no upload).
  function warnOnLeave(e) {
    if (D.completeUploaded || (D.finished && !D.uploadEnabled)) return;
    e.preventDefault(); e.returnValue = "";
  }

  // Things that need the first click (audio) or should start early (images).
  // Called once: after consent, or by the debug start screen.
  function onStarted() {
    if (started) return;
    started = true;
    if (!DEBUG && who) who.commit();         // a later reopen of the link becomes attempt 2
    startedAt = iso();
    D.started = true;
    D.merge("session", { start_time: startedAt });
    try { Core.audio = Core.audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { Core.audio = null; }
    Images.preload();                        // download the images in the background
    if (!DEBUG) window.addEventListener("beforeunload", warnOnLeave);
  }

  // Display / timing / audio, measured in full screen before the first task.
  async function measureDevice(nFrames = 120) {
    Core.showStage();
    Core.clearStage();
    device = await Core.deviceInfo(nFrames);
    frameMs = device.frame_ms_median || 1000 / 60;
    D.frameMs = frameMs;
    D.merge("session", { device, image_tier: Images.chooseTier() });
  }

  // Fixation cross / blank screen for `ms` (rest after the images).
  async function rest(ms) {
    Core.phase = "rest";
    Core.showStage();
    await Core.ensureFullscreen();
    Core.clearStage();
    const fix = CONFIG.REST.SHOW_FIXATION ? el("div", "stim fixation", "+", Core.stage()) : null;
    const onset = await Core.present(() => { if (fix) fix.style.visibility = "visible"; });
    Core.Events.log("Rest_Markers", REST_TRIGGERS.rest_start, "rest_start", fix ? "fixation" : "blank");
    await Core.wait(Math.max(0, onset + ms - Core.now()));
    Core.Events.log("Rest_Markers", REST_TRIGGERS.rest_end, "rest_end");
    Core.clearStage();
  }

  // ── Steps ──────────────────────────────────────────────────────────────
  // Each runner gets the part after ":" of the step id (e.g. "post_stress").
  const practiceParam = params.get("practice");
  const RUNNERS = {
    consent: async () => {
      const c = await Forms.consent();
      D.set("consent", c);
      onStarted();
    },
    demographics: async () => {
      const d = await Forms.demographics();
      D.set("demographics", { ...d, submitted: iso() });
    },
    setup: async () => {
      const s = await Forms.setup();
      D.merge("session", s);
      Core.Events.log("Session", 0, "tasks_start", JSON.stringify(s));
      await measureDevice();
    },
    intro: async () => {
      Core.phase = "intro";
      await Core.instructions(TEXTS.TASK_INTRO, { minMs: 4000 });
    },
    stroop: (phase) => Stroop.run({
      phase: phase || "baseline",
      // debug practice=1 / 0: force / suppress the practice of the FIRST Stroop step
      practice: DEBUG && practiceParam != null && stroopRuns++ === 0 ? practiceParam === "1" : undefined,
    }),
    vas: (timepoint) => VAS.run(timepoint || "vas"),
    mist_baseline: () => MIST.runBaseline(),
    mist: () => MIST.run(),
    images: () => Images.run({ phase: "intervention", frameMs: frameMs || 1000 / 60 }),
    blank: () => rest(CONFIG.REST.DURATION),
    feedback: async () => {
      // Frame timing again before leaving full screen (did the machine slow down?).
      if (Core.isFullscreen()) D.merge("session", { end_frames: await Core.measureFrames(60) });
      await Core.exitFullscreen();
      Core.phase = "feedback";
      const fb = await Forms.feedback();
      D.set("feedback", { ...fb, submitted: iso() });
    },
  };

  function runnerFor(id) {
    const [name, arg] = String(id).split(":");
    const r = RUNNERS[name];
    if (!r) throw new Error(`Unknown step "${id}" in CONFIG.FLOW (known: ${Object.keys(RUNNERS).join(", ")})`);
    return () => r(arg);
  }

  async function runStep(id) {
    const run = runnerFor(id);
    const name = id.split(":")[0];
    Core.step = id;
    Core.Skip.reset();
    Debug.setStep(id);
    // A task step needs the device measured first (normally done by "setup").
    if (!device && !FORM_STEPS.includes(name)) await measureDevice(60);
    const t0 = Core.now();
    const rec = { step: id, start: iso(), end: "", duration_s: "" };
    stepsRun.push(rec);
    D.merge("session", { steps_run: stepsRun });
    Core.Events.log("Session", 0, "step_start", id);
    if (DEBUG && FORM_STEPS.includes(name)) await Promise.race([run(), Core.Skip.promise()]);   // F2 skips forms too
    else await run();
    rec.end = iso();
    rec.duration_s = Math.round((Core.now() - t0) / 100) / 10;
    Core.Events.log("Session", 0, "step_end", id);
    D.checkpoint(id);
  }

  // A real Prolific participant must not reach the end of a study that can't
  // save data or pay them: check the setup before they start.
  function setupProblem(prolific) {
    if (DEBUG || !prolific.prolific_pid || params.get("pilot") === "1") return null;
    const code = (CONFIG.PROLIFIC && CONFIG.PROLIFIC.COMPLETION_CODE) || "";
    if (!CONFIG.DATA.UPLOAD_URL || !code || /EDIT/i.test(code) || /EDIT ME|you@university/i.test(CONFIG.RESEARCHER_CONTACT || ""))
      return "Sorry, this study is not ready yet (it has not been fully set up). Please return it on Prolific. You have not lost anything.";
    return null;
  }

  async function main() {
    Debug.init();
    const prolific = Core.prolificInfo();
    who = Core.identity(DEBUG ? "DEBUG_" : "P");
    D.pid = who.pid;
    D.attempt = who.attempt;

    // Upload: on when an address is set; in debug mode only with &upload=1.
    const urlOverride = DEBUG ? params.get("upload_url") : null;
    D.uploadUrl = urlOverride || CONFIG.DATA.UPLOAD_URL || "";
    D.uploadEnabled = !!D.uploadUrl && (!DEBUG || params.get("upload") === "1" || !!urlOverride);

    const skipCheck = DEBUG || (params.get("skipcheck") === "1" && !prolific.prolific_pid);
    const problem = (skipCheck ? null : Forms.deviceProblem()) || setupProblem(prolific);
    if (problem) { Forms.blocked(problem); return; }

    // Image condition and Stroop keys for this participant.
    const requested = (params.get("condition") || "").trim().toLowerCase();
    if (requested && !Images.availableConditions().includes(requested)) {
      const msg = `Unknown image condition "${requested}" in the study link (known: ${Images.availableConditions().join(", ")}).`;
      if (DEBUG) throw new Error(msg);
      console.error(msg);
      Forms.blocked("Sorry, this study link is not set up correctly. Please return the study on Prolific and message the researcher. You have not lost anything.");
      return;
    }
    const cond = Images.assignCondition({ requested, baseId: who.base, forget: DEBUG });
    const mapping = Stroop.chooseMapping();

    const steps = Debug.selectSteps(CONFIG.FLOW);
    steps.forEach(runnerFor);   // stop now if a step name is wrong
    const dup = steps.find((s, i) => steps.indexOf(s) !== i);
    if (dup) throw new Error(`Step "${dup}" appears twice. Each step id must be unique: use a new name, e.g. "stroop:follow_up" (see CONFIG.FLOW).`);

    D.set("participant", {
      participant_id: D.pid, attempt: D.attempt, page_load_id: D.loadId, ...prolific,
      image_condition: cond.condition, image_condition_source: cond.source, image_condition_requested: requested,
      stroop_key_mapping: mapping,
      quick_mode: Number(!!CONFIG.QUICK_MODE), debug_mode: Number(DEBUG),
      test_run: Number(!prolific.prolific_pid),   // no Prolific ID: a pilot / launcher / bare-URL run (analysis drops these)
    });
    D.set("session", {
      start_time: "", app_version: CONFIG.APP_VERSION, url_params: location.search,
      flow: CONFIG.FLOW.slice(), steps_planned: steps, steps_run: stepsRun,
      config: configForFile(), texts_hash: textsHash(),
    });
    if (!Core.fsSupported()) Core.Integrity.unsupported = 1;

    if (DEBUG) {
      await Debug.startScreen({ steps, pid: D.pid, condition: cond.condition, conditionSource: cond.source, mapping, upload: D.uploadEnabled ? D.uploadUrl : "" });
      onStarted();
    } else if (steps[0] !== "consent") {
      throw new Error('CONFIG.FLOW must start with "consent"');
    }

    for (const id of steps) await runStep(id);

    // ── End ──────────────────────────────────────────────────────────────
    Core.step = "end";
    Debug.setStep("end");
    if (Core.isFullscreen()) {
      D.merge("session", { end_frames: await Core.measureFrames(60) });   // did the machine slow down?
      await Core.exitFullscreen();
    }
    const end = iso();
    D.merge("session", {
      end_time: end,
      duration_min: startedAt ? Math.round((Date.parse(end) - Date.parse(startedAt)) / 600) / 100 : "",
    });
    if (D.uploadEnabled) Forms.uploading();
    const ok = await D.finish();
    if (ok || !D.uploadEnabled) window.removeEventListener("beforeunload", warnOnLeave);
    if (DEBUG && params.get("end") !== "debrief") Debug.endScreen(D.lastSnapshot, ok);
    else Forms.debrief(ok);
  }

  window.addEventListener("DOMContentLoaded", () => {
    main().catch((err) => {
      console.error(err);
      Core.Events.log("Session", 0, "error", String(err && err.stack || err));
      try { D.checkpoint("error"); } catch (_) {}
      Core.showPage();
      Core.page().innerHTML = "";
      const c = el("div", "card", null, Core.page());
      el("h1", null, "Something went wrong", c);
      el("p", null, `Sorry, the study hit an error. Please contact ${CONFIG.RESEARCHER_CONTACT} and quote code ${D.pid}.`, c);
      el("pre", "error", String(err && err.message || err), c);
      const b = el("button", "btn", "Download data collected so far", c);
      b.onclick = () => D.downloadJSON();
    });
  });

  window.App = { VERSION: CONFIG.APP_VERSION, RUNNERS };
})();
