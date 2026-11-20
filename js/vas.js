/*
 * Visual Analogue Scale: port of vas.py (stress-recovery-exp-with-stroop).
 * Three items shown back to back; click (or drag) anywhere on the 0–100
 * line, then click Confirm. "calm" is reverse-scored (recorded per row).
 * Stress composite (computed later) = mean(stressed, tense, 100 − calm).
 *
 * The first VAS step of the session is preceded by TEXTS.VAS_INTRO.
 *
 * At the timepoints in CONFIG.VAS.IMAGE_QUESTION_AT (default: post_recovery,
 * the first VAS after the images) a 4th item follows: "How did the images
 * make you feel?", a bipolar line labelled Positive / Neutral / Negative,
 * recorded as measure `image_feeling` with 0 = positive, 50 = neutral,
 * 100 = negative (lab convention). It is a manipulation check, NOT a stress
 * item: it is not part of the composite.
 *
 * Items / wording: QUESTIONS below.  Test alone: debug.html → "VAS".
 */
(function () {
  "use strict";
  const { el, stage, present, iso } = Core;

  // ── EDIT HERE ── [measure, question, reverse-scored]
  const QUESTIONS = [
    ["stressed", "Right now, how stressed do you feel?", false],
    ["tense", "Right now, how tense do you feel?", false],
    ["calm", "Right now, how calm do you feel?", true],
  ];
  const IMAGE_QUESTION = ["image_feeling", "How did the images make you feel?", false];
  const IMAGE_QUESTION_LABELS = [[0, "Positive"], [50, "Neutral"], [100, "Negative"]];
  const TRIGGERS = { vas_onset: 60, vas_response: 61 };

  let introShown = false;

  // `labels`: [[position 0–100, text], …]; ticks are drawn at the same positions.
  // Resolves {rating, rt}, or null if skipped in debug mode (F2).
  function askOne(measure, prompt, labels) {
    return new Promise(async (resolve) => {
      const s = stage();
      s.innerHTML = "";
      document.body.classList.add("show-cursor");
      const wrap = el("div", "vas", null, s);
      el("div", "vas-prompt", prompt, wrap);
      const track = el("div", "vas-track", null, wrap);
      el("div", "vas-line", null, track);
      for (const [pos, text] of labels) {
        const tick = el("div", "vas-tick", null, track);
        tick.style.left = `calc(${pos}% - 1px)`;
        const lab = el("div", "vas-label", text, track);
        lab.style.left = pos + "%";
      }
      const marker = el("div", "vas-marker", null, track);
      marker.hidden = true;
      const btn = el("button", "vas-confirm", "Confirm", wrap);
      btn.disabled = true;

      let rating = null;
      let dragging = false;
      let finished = false;
      const finish = (val) => {
        if (finished) return;
        finished = true;
        document.body.classList.remove("show-cursor");
        resolve(val);
      };
      const setFromX = (clientX) => {
        const r = track.getBoundingClientRect();
        const v = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 100);
        rating = v;
        marker.hidden = false;
        marker.style.left = v + "%";
        btn.disabled = false;
      };
      track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); setFromX(e.clientX); });
      track.addEventListener("pointermove", (e) => { if (dragging) setFromX(e.clientX); });
      track.addEventListener("pointerup", () => { dragging = false; });
      if (Core.Skip.enabled) Core.Skip.promise().then(() => finish(null));

      const onset = await present(() => {});
      Core.Events.log("VAS_Markers", TRIGGERS.vas_onset, "vas_onset", measure);

      btn.addEventListener("click", () => {
        if (rating == null) return;
        const rt = (performance.now() - onset) / 1000;
        Core.Events.log("VAS_Markers", TRIGGERS.vas_response, "vas_response", measure);
        finish({ rating, rt });
      });
    });
  }

  async function run(timepoint, { imageQuestion } = {}) {
    Core.phase = "vas_" + timepoint;
    if (!introShown) {
      introShown = true;
      await Core.instructions(TEXTS.VAS_INTRO);
    }
    Core.showStage();
    await Core.ensureFullscreen();
    const withImageQ = imageQuestion != null ? imageQuestion
      : ((CONFIG.VAS && CONFIG.VAS.IMAGE_QUESTION_AT) || []).includes(timepoint);
    const items = QUESTIONS.map(([m, p, rev]) => [m, p, rev, [[0, `Not at all ${m}`], [100, `Extremely ${m}`]]]);
    if (withImageQ) items.push([...IMAGE_QUESTION, IMAGE_QUESTION_LABELS]);
    const rows = [];
    for (const [measure, prompt, reverse, labels] of items) {
      if (Core.Skip.requested) break;
      const ans = await askOne(measure, prompt, labels);
      if (!ans) break;
      const row = {
        participant_id: Core.Data.pid,
        session: Core.Data.session,
        step: Core.step,
        timepoint,
        measure,
        reverse_scored: reverse ? "True" : "False",
        rating: ans.rating,
        rt: Math.round(ans.rt * 10000) / 10000,
        timestamp: iso(),
      };
      rows.push(row);
      Core.Data.stream("vas", row);
    }
    Core.clearStage();
    return rows;
  }

  window.VAS = { run, QUESTIONS, IMAGE_QUESTION };
})();
