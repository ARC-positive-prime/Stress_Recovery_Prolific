/*
 * Session flow (one session per participant, ~30 min):
 *
 *   Device check → Info + consent → Demographics → Setup (sound, full screen)
 *   → VAS (baseline)
 *   → Stroop (baseline)            first run: instructions + practice
 *   → VAS (pre_mist)
 *   → MIST stressor (+ white noise)
 *   → VAS (post_mist)
 *   → Stroop (post_stress)
 *   → Image intervention           120 Positive Prime images × 2.5 s = 5 min
 *   → Rest: fixation cross, 1 min
 *   → VAS (post_recovery) + "How did the images make you feel?"
 *   → Stroop (post_recovery)
 *   → Feedback → Upload → Debrief → back to Prolific
 *
 * Phase / timepoint labels follow the lab (stress-recovery-exp-with-stroop):
 * VAS pre_mist / post_mist / post_recovery, plus an online-only `baseline`
 * VAS before the first Stroop run.
 *
 * Data are kept wherever a participant stops:
 *   - trial rows are uploaded while each task runs (Core.Data.stream);
 *   - after every section a fresh `summary` row is saved with
 *     status = "in_progress" and last_step = the section just finished;
 *   - if the page is closed early, a final summary row with status = "quit"
 *     and everything not yet uploaded are sent (Core.Data.quitFlush);
 *   - the last summary row of a finished session has status = "complete".
 *   The newest summary row per participant_id is the one to use.
 *
 * A participant who opens the study again (same PROLIFIC_PID, same browser)
 * after consenting once gets "(2)", "(3)", … appended to their code.
 */
(function () {
  "use strict";
  const D = Core.Data;
  const VERSION = "1.1.0";

  const REST_TRIGGERS = { rest_start: 80, rest_end: 81 };

  let sessionInfo = null;
  let startedAt = null;
  let lastStep = "";
  let frameMs = null;
  let prolific = {};

  function saveEvents() { D.save("events", Core.Events.take()); }

  function warnOnLeave(e) { e.preventDefault(); e.returnValue = ""; }

  const minutesSince = (isoStart) =>
    isoStart ? Math.round((Date.now() - Date.parse(isoStart)) / 600) / 100 : "";

  // Summary of everything done so far (built from all rows, saved or buffered).
  function summaryRow(status) {
    const s = Summary.build({
      cogRows: D.all("stroop_trials"),
      mistRows: D.all("mist_trials"),
      vasRows: D.all("vas"),
      imageRows: D.all("image_trials"),
      frameMs,
    });
    return {
      ...s, ...prolific,
      attempt: D.attempt,
      status,                        // in_progress | quit | complete
      complete: Number(status === "complete"),
      last_step: lastStep,
      minutes_since_start: minutesSince(startedAt),
      saved_at: Core.iso(),
      app_version: VERSION,
      quick_mode: Number(!!CONFIG.QUICK_MODE),
    };
  }

  // End of a section: upload its remaining rows, the event log, and a fresh summary.
  function sectionDone(step) {
    lastStep = step;
    D.flushStreams();
    saveEvents();
    D.save("summary", [summaryRow("in_progress")]);
  }

  // Called by Core.Data.quitFlush() if the page closes before the end.
  function onQuit() {
    const out = [["summary", [summaryRow("quit")]]];
    out.push(["sessions", [{
      ...(sessionInfo || { participant_id: D.pid, ...prolific, attempt: D.attempt, app_version: VERSION }),
      status: "quit", last_step: lastStep, quit_time: Core.iso(), duration_min: minutesSince(startedAt),
      window_blur_count: Core.Quality.blurCount, tab_hidden_count: Core.Quality.hiddenCount,
      fullscreen_exit_count: Core.Quality.fullscreenExits,
    }]]);
    return out;
  }

  async function cog(phase, firstRun) {
    await Stroop.run({ phase, firstRun });   // rows are streamed as they happen
    sectionDone("stroop_" + phase);
  }

  async function vas(timepoint, opts) {
    await VAS.run(timepoint, opts);          // rows are streamed as they happen
    sectionDone("vas_" + timepoint);
  }

  // Fixation cross for `ms` (after the images, before the post-recovery VAS).
  async function rest(ms) {
    Core.phase = "rest";
    Core.showStage();
    await Core.ensureFullscreen();
    Core.clearStage();
    const fix = Core.el("div", "stim fixation", "+", Core.stage());
    const onset = await Core.present(() => { fix.style.visibility = "visible"; });
    Core.Events.log("Rest_Markers", REST_TRIGGERS.rest_start, "rest_start");
    await Core.sleep(Math.max(0, onset + ms - Core.now()));
    Core.Events.log("Rest_Markers", REST_TRIGGERS.rest_end, "rest_end");
    Core.clearStage();
  }

  // A real Prolific participant must not reach the end of a study that can't
  // save data or pay them: check the setup before they start.
  function setupProblem(params) {
    if (!prolific.prolific_pid || params.get("pilot") === "1") return null;
    const code = (CONFIG.PROLIFIC && CONFIG.PROLIFIC.COMPLETION_CODE) || "";
    if (!CONFIG.DATA_URL || !code || /EDIT/i.test(code))
      return "Sorry, this study is not ready yet (it has not been fully set up). Please return it on Prolific — you have not lost anything.";
    return null;
  }

  async function main() {
    const params = new URLSearchParams(location.search);
    prolific = Core.prolificInfo();
    const who = Core.identity();
    D.pid = who.pid;
    D.attempt = who.attempt;

    const problem = (params.get("skipcheck") === "1" ? null : Forms.deviceProblem()) || setupProblem(params);
    if (problem) { Forms.blocked(problem); return; }

    // ── Consent ──────────────────────────────────────────────────────────
    const consent = await Forms.consent();
    who.commit();                       // a later reopen of the link becomes attempt 2
    startedAt = Core.iso();
    D.onQuit = onQuit;
    // Audio must be created on a user gesture (the consent click).
    try { Core.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { Core.audio = null; }
    // Start downloading the intervention images in the background.
    Images.preload();
    window.addEventListener("beforeunload", warnOnLeave);
    lastStep = "consent";

    // ── Demographics ─────────────────────────────────────────────────────
    const demo = await Forms.demographics();
    D.save("demographics", [{ participant_id: D.pid, ...prolific, attempt: D.attempt, ...consent, ...demo, submitted: Core.iso() }]);
    lastStep = "demographics";

    // ── Setup ────────────────────────────────────────────────────────────
    const setup = await Forms.setup();
    Core.Events.log("Session", 0, "tasks_start", JSON.stringify(setup));

    // Display / timing / audio, measured in full screen just before the tasks.
    Core.showStage();
    Core.clearStage();
    const device = await Core.deviceInfo();
    frameMs = device.frame_ms_median || 1000 / 60;
    sessionInfo = {
      participant_id: D.pid, status: "started", task: "stroop", ...prolific, attempt: D.attempt,
      start_time: startedAt, app_version: VERSION, quick_mode: Number(!!CONFIG.QUICK_MODE),
      url_params: location.search, image_tier: Images.chooseTier(), ...setup, ...device,
    };
    D.save("sessions", [sessionInfo]);
    lastStep = "setup";

    // ── 1. VAS, baseline ─────────────────────────────────────────────────
    Core.phase = "vas_baseline";
    await Core.instructions(`HOW DO YOU FEEL?

A few times during the study you will be asked how you feel right now.

Click anywhere on the line to give your answer
(you can click again or drag to change it), then click Confirm.

Press SPACE to continue.`);
    await vas("baseline");

    // ── 2. Stroop, baseline (with instructions + practice) ───────────────
    await cog("baseline", true);

    // ── 3. VAS before the stressor ───────────────────────────────────────
    await vas("pre_mist");

    // ── 4. Stressor ──────────────────────────────────────────────────────
    await MIST.run();                         // rows are streamed as they happen
    sectionDone("mist");

    // ── 5. VAS after the stressor ────────────────────────────────────────
    await vas("post_mist");

    // ── 6. Stroop, post-stress ───────────────────────────────────────────
    await cog("post_stress", false);

    // ── 7. Image intervention ────────────────────────────────────────────
    await Images.run({ phase: "intervention", frameMs });
    sectionDone("images");

    // ── 8. Rest: fixation cross ──────────────────────────────────────────
    await rest(CONFIG.REST_DURATION);
    sectionDone("rest");

    // ── 9. VAS after recovery, plus the image question ───────────────────
    await vas("post_recovery", { imageQuestion: true });

    // ── 10. Stroop, post-recovery ────────────────────────────────────────
    await cog("post_recovery", false);

    // Frame timing again at the end (did the machine slow down?).
    const endFrames = await Core.measureFrames(60);

    // ── Feedback ─────────────────────────────────────────────────────────
    if (Core.isFullscreen()) { try { await document.exitFullscreen(); } catch (_) {} }
    Core.phase = "feedback";
    const fb = await Forms.feedback();
    D.save("feedback", [{ participant_id: D.pid, ...fb, submitted: Core.iso() }]);
    lastStep = "feedback";

    // ── Final rows ───────────────────────────────────────────────────────
    D.save("summary", [summaryRow("complete")]);
    const end = Core.iso();
    D.save("sessions", [{
      ...sessionInfo, status: "completed", end_time: end,
      duration_min: Math.round((Date.parse(end) - Date.parse(startedAt)) / 600) / 100,
      window_blur_count: Core.Quality.blurCount, tab_hidden_count: Core.Quality.hiddenCount,
      fullscreen_exit_count: Core.Quality.fullscreenExits,
      end_refresh_rate_hz: endFrames.refresh_rate_hz, end_frame_ms_sd: endFrames.frame_ms_sd,
      end_frames_dropped_pct: endFrames.frames_dropped_pct,
    }]);
    saveEvents();
    D.finished = true;                  // closing the page now is not a "quit"

    // ── Upload + debrief ─────────────────────────────────────────────────
    Forms.uploading();
    const ok = await D.flush();
    if (ok) await D.markComplete();
    window.removeEventListener("beforeunload", warnOnLeave);
    Forms.debrief(ok);
  }

  window.addEventListener("DOMContentLoaded", () => {
    main().catch((err) => {
      console.error(err);
      Core.Events.log("Session", 0, "error", String(err && err.stack || err));
      try { D.flushStreams(); saveEvents(); } catch (_) {}
      Core.showPage();
      Core.page().innerHTML = "";
      const c = Core.el("div", "card", null, Core.page());
      Core.el("h1", null, "Something went wrong", c);
      Core.el("p", null, `Sorry, the study hit an error. Please contact ${CONFIG.RESEARCHER_CONTACT} and quote code ${D.pid}.`, c);
      Core.el("pre", "error", String(err && err.message || err), c);
      const b = Core.el("button", "btn", "Download data collected so far", c);
      b.onclick = () => D.downloadJSON();
    });
  });

  window.App = { VERSION };
})();
