/*
 * Participant-facing pages: device check, information + consent,
 * demographics, setup (sound + full screen), feedback and debrief.
 *
 *  ── Wording ──
 *   Information sheet and debrief text:  js/texts.js (INFO_HTML, DEBRIEF_HTML)  ← EDIT ME
 *   Demographic questions:               demographics() below                   ← EDIT HERE
 *   End-of-study questions:              feedback() below                       ← EDIT HERE
 *  Each question's first argument (e.g. "psychoactive_drugs") is its name in
 *  the data file; keep names unique.
 *  Test alone: debug.html → "Forms only", or "Custom" with consent /
 *  demographics / feedback ticked.
 */
(function () {
  "use strict";
  const { el, page } = Core;

  // ── Helpers ────────────────────────────────────────────────────────────
  function card(title) {
    Core.showPage();
    const p = page();
    p.innerHTML = "";
    const c = el("div", "card", null, p);
    if (title) el("h1", null, title, c);
    return c;
  }

  function idBadge() {
    return el("div", "pid-badge", `Code: ${Core.Data.pid}`, page());
  }

  // Field builders. Each returns the wrapper; inputs carry name = key.
  function radioGroup(form, name, label, options, required = true) {
    const fs = el("fieldset", "field", null, form);
    el("legend", null, label, fs);
    for (const [value, text] of options) {
      const l = el("label", "opt", null, fs);
      const i = el("input", null, null, l);
      Object.assign(i, { type: "radio", name, value, required });
      l.appendChild(document.createTextNode(" " + text));
    }
    return fs;
  }
  function scale(form, name, label, lowText, highText, n = 5) {
    const fs = el("fieldset", "field scale", null, form);
    el("legend", null, label, fs);
    const row = el("div", "scale-row", null, fs);
    el("span", "scale-end", lowText, row);
    for (let v = 1; v <= n; v++) {
      const l = el("label", "scale-opt", null, row);
      const i = el("input", null, null, l);
      Object.assign(i, { type: "radio", name, value: String(v), required: true });
      el("span", null, String(v), l);
    }
    el("span", "scale-end", highText, row);
    return fs;
  }
  function numberField(form, name, label, attrs) {
    const w = el("label", "field", null, form);
    el("span", "flabel", label, w);
    const i = el("input", null, null, w);
    Object.assign(i, { type: "number", name, required: true, ...attrs });
    return w;
  }
  function textArea(form, name, label, required = false) {
    const w = el("label", "field", null, form);
    el("span", "flabel", label + (required ? "" : " (optional)"), w);
    const t = el("textarea", null, null, w);
    Object.assign(t, { name, rows: 3, maxLength: 2000, required });
    return w;
  }
  function submitButton(form, text) {
    const b = el("button", "btn", text, form);
    b.type = "submit";
    return b;
  }
  // Every named field, also when left empty (so the data always has the key).
  function formValues(form) {
    const out = {};
    for (const e of form.elements) if (e.name) out[e.name] = "";
    for (const [k, v] of new FormData(form).entries()) out[k] = v;
    return out;
  }
  // Show `target` only while radio `name` has value `value`.
  function showWhen(form, name, value, target) {
    const update = () => {
      const on = !!form.querySelector(`input[name="${name}"][value="${value}"]:checked`);
      target.hidden = !on;
    };
    form.addEventListener("change", update);
    update();
  }

  // ── Pages ──────────────────────────────────────────────────────────────
  function deviceProblem() {
    const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) ||
      (navigator.userAgentData && navigator.userAgentData.mobile);
    const noFinePointer = window.matchMedia && !window.matchMedia("(any-pointer: fine)").matches;
    if (mobileUA || noFinePointer) return "This study needs a laptop or desktop computer with a physical keyboard. Please open the link on a computer.";
    if (screen.width < CONFIG.MIN_SCREEN_WIDTH || screen.height < CONFIG.MIN_SCREEN_HEIGHT)
      return `Your screen is too small for this study (minimum ${CONFIG.MIN_SCREEN_WIDTH} × ${CONFIG.MIN_SCREEN_HEIGHT}). Please use a laptop or desktop computer.`;
    return null;
  }

  function blocked(message) {
    const c = card(CONFIG.STUDY_TITLE);
    el("p", "warn", message, c);
  }

  function consent() {
    return new Promise((resolve) => {
      const c = card(CONFIG.STUDY_TITLE);
      const info = el("div", "info", null, c);
      info.innerHTML = Core.fill(TEXTS.INFO_HTML, { CONTACT: CONFIG.RESEARCHER_CONTACT });
      const form = el("form", null, null, c);
      const items = [
        ["age18", "I am 18 years or older."],
        ["agree", "I have read the information above and agree to take part."],
      ];
      for (const [name, text] of items) {
        const l = el("label", "check", null, form);
        const i = el("input", null, null, l);
        Object.assign(i, { type: "checkbox", name, required: true });
        l.appendChild(document.createTextNode(" " + text));
      }
      submitButton(form, "I agree, continue");
      form.onsubmit = (e) => {
        e.preventDefault();
        resolve({ consent_given: 1, consent_time: Core.iso() });
      };
      idBadge();
    });
  }

  // ── EDIT HERE: demographic questions ──────────────────────────────────
  function demographics() {
    return new Promise((resolve) => {
      const c = card("About you");
      el("p", "muted", "All questions are needed to interpret the results. Your answers are stored under a random code.", c);
      const form = el("form", null, null, c);
      numberField(form, "age", "Age (years)", { min: 18, max: 100, step: 1 });
      const g = radioGroup(form, "gender", "Gender", [
        ["woman", "Woman"], ["man", "Man"], ["non_binary", "Non-binary"],
        ["self_describe", "Prefer to self-describe"], ["prefer_not", "Prefer not to say"],
      ]);
      const sd = el("input", "inline-text", null, g);
      Object.assign(sd, { type: "text", name: "gender_self_describe", placeholder: "Self-describe (optional)", maxLength: 100 });
      radioGroup(form, "handedness", "Which hand do you write with?", [["right", "Right"], ["left", "Left"], ["ambidextrous", "Both / ambidextrous"]]);
      scale(form, "english_comfort", "How comfortable are you reading and understanding English?",
        "1 = not comfortable", "5 = very comfortable / fluent");
      radioGroup(form, "colour_vision", "Do you have any colour-vision deficiency (colour blindness)?", [["no", "No"], ["yes", "Yes"], ["not_sure", "Not sure"]]);
      radioGroup(form, "vision", "Your eyesight right now", [
        ["normal", "Normal, no glasses or lenses needed"],
        ["corrected_wearing", "I need glasses or lenses and am wearing them"],
        ["corrected_not_wearing", "I need glasses or lenses but am NOT wearing them"],
      ]);
      radioGroup(form, "education", "Current or highest education", [
        ["ug_student", "Undergraduate student"], ["bachelors", "Bachelor's degree"],
        ["masters", "Master's student or degree"], ["phd", "PhD student or degree"], ["other", "Other"],
      ]);
      numberField(form, "sleep_hours", "Hours of sleep last night (approximately)", { min: 0, max: 24, step: 0.5 });
      radioGroup(form, "caffeine_2h", "Have you had caffeine (coffee, tea, energy drink) in the last 2 hours?", [["no", "No"], ["yes", "Yes"]]);

      // Psychoactive medication / drugs (+ optional description when "yes").
      radioGroup(form, "psychoactive_drugs",
        "Are you currently taking any psychoactive medication or substances? " +
        "(for example antidepressants, anti-anxiety medication, ADHD medication or other stimulants, " +
        "sleeping pills, antipsychotics, mood stabilisers, or recreational drugs)",
        [["no", "No"], ["yes", "Yes"], ["prefer_not", "Prefer not to say"]]);
      const drugDetail = textArea(form, "psychoactive_drugs_detail",
        "If yes: what are you taking, and for what reason? Share only as much as you are comfortable with");
      showWhen(form, "psychoactive_drugs", "yes", drugDetail);

      radioGroup(form, "prior_participation", "Have you taken part in a study with a timed mental-arithmetic stress task before?", [["no", "No"], ["yes", "Yes"], ["not_sure", "Not sure"]]);
      radioGroup(form, "keyboard", "Which keyboard will you use?", [["laptop", "Built-in laptop keyboard"], ["external", "Separate (external) keyboard"]]);
      submitButton(form, "Continue");
      form.onsubmit = (e) => {
        e.preventDefault();
        const v = formValues(form);
        if (v.psychoactive_drugs !== "yes") v.psychoactive_drugs_detail = "";
        resolve(v);
      };
      idBadge();
    });
  }

  // Sound check + enter full screen (both need a click).
  function setup() {
    return new Promise((resolve) => {
      const c = card("Get ready");
      const ol = el("ol", null, null, c);
      el("li", null, "Close other tabs and apps, and silence your phone.", ol);
      el("li", null, "Turn your sound on. Click the button below to play a short sample of the background noise used later, and set your volume so it is clearly audible but comfortable.", ol);
      el("li", null, "When you are ready, click Start. The study will switch to full screen; please stay in full screen until the end. Leaving full screen or switching tabs is recorded.", ol);
      const play = el("button", "btn btn-secondary", "▶ Play sound sample", c);
      play.type = "button";
      play.onclick = () => playSample();
      const heard = el("label", "check", null, c);
      const hc = el("input", null, null, heard);
      hc.type = "checkbox";
      heard.appendChild(document.createTextNode(" I can hear the sound."));
      const start = el("button", "btn", "Start (full screen)", c);
      start.disabled = true;
      hc.onchange = () => (start.disabled = !hc.checked);
      start.onclick = async () => {
        await Core.requestFullscreen();
        if (!Core.isFullscreen() && Core.fsSupported()) { Core.fullscreenDeclined = true; Core.Integrity.declined = 1; }
        resolve({ sound_check_confirmed: 1, fullscreen_at_start: Number(Core.isFullscreen()) });
      };
      idBadge();
    });
  }

  function playSample() {
    const ctx = Core.audio;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const dur = 2;
    const buf = ctx.createBuffer(2, ctx.sampleRate * dur, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = CONFIG.MIST.WHITE_NOISE_VOLUME;
    src.connect(g).connect(ctx.destination);
    src.start();
  }

  // ── EDIT HERE: end-of-study questions ─────────────────────────────────
  function feedback() {
    return new Promise((resolve) => {
      const taskName = "colour–word task";
      const c = card("A few last questions");
      const form = el("form", null, null, c);

      el("h3", null, "The colour–word task", form);
      scale(form, "stroop_difficulty", `How difficult was the ${taskName} (deciding whether the ink colour matched the word)?`, "Very easy", "Very hard");
      radioGroup(form, "performance_change",
        `Did you notice any change in how you did on the ${taskName} after the arithmetic task, compared with before it?`,
        [["worse_after", "Yes, I did worse after"], ["no_change", "No change"],
         ["better_after", "Yes, I did better after"], ["not_sure", "Not sure"]]);
      textArea(form, "performance_change_detail", "What did you notice?");
      radioGroup(form, "performance_change_images",
        `Did you notice any change in how you did on the ${taskName} after the images, compared with just after the arithmetic task?`,
        [["worse_after", "Yes, I did worse after the images"], ["no_change", "No change"],
         ["better_after", "Yes, I did better after the images"], ["not_sure", "Not sure"]]);
      textArea(form, "performance_change_images_detail", "What did you notice?");
      scale(form, "instructions_clarity", `How clear were the instructions for the ${taskName}?`, "Very unclear", "Very clear");

      el("h3", null, "The images", form);
      radioGroup(form, "images_feeling", "Overall, how did the images make you feel?", [
        ["very_negative", "Very negative"], ["somewhat_negative", "Somewhat negative"], ["neutral", "Neutral"],
        ["somewhat_positive", "Somewhat positive"], ["very_positive", "Very positive"],
      ]);
      scale(form, "images_pleasant", "How pleasant were the images?", "Very unpleasant", "Very pleasant");
      scale(form, "images_relaxing", "How much did viewing the images help you relax or feel better after the arithmetic task?", "Not at all", "Very much");
      scale(form, "images_attention", "How closely did you look at the images?", "Hardly at all", "Very closely");
      radioGroup(form, "images_mood_change", "Compared with just before the images, how did you feel right after them?", [
        ["much_worse", "Much worse"], ["a_bit_worse", "A bit worse"], ["same", "About the same"],
        ["a_bit_better", "A bit better"], ["much_better", "Much better"],
      ]);
      textArea(form, "images_feeling_detail", "In your own words, how did the images make you feel?");
      radioGroup(form, "images_seen_before", "Had you seen any of these images before?", [["no", "No"], ["some", "Some of them"], ["not_sure", "Not sure"]]);

      el("h3", null, "Overall", form);
      scale(form, "effort", "How much effort did you put into the tasks?", "Very little", "Maximum");
      scale(form, "arithmetic_stress", "How stressful was the arithmetic task?", "Not at all", "Extremely");
      // Manipulation check for the "average performance / scaled score / reward" instructions.
      scale(form, "believed_performance_counts", "During the arithmetic test, how much did you believe that your performance would count (be compared with others and affect the reward)?", "Not at all", "Completely");
      radioGroup(form, "heard_noise", "Did you hear background noise during the arithmetic task?", [["yes", "Yes"], ["no", "No"], ["sound_off", "My sound was off"]]);
      radioGroup(form, "distracted", "Were you interrupted or distracted during the tasks?", [["no", "No"], ["briefly", "Briefly"], ["a_lot", "Yes, a lot"]]);
      radioGroup(form, "tech_problems", "Did you have any technical problems (lag, freezing, display or sound issues, images not loading)?", [["no", "No"], ["yes", "Yes"]]);
      textArea(form, "tech_problems_detail", "If yes, what happened?");
      textArea(form, "purpose_guess", "What do you think this study was testing?");
      textArea(form, "comments", "Any other comments or suggestions?");
      submitButton(form, "Submit");
      form.onsubmit = (e) => {
        e.preventDefault();
        resolve(formValues(form));
      };
      idBadge();
    });
  }

  function uploading() {
    const c = card("Saving your data…");
    el("p", null, "Please keep this window open for a moment.", c);
    el("div", "spinner", null, c);
  }

  // ── Prolific hand-off ──────────────────────────────────────────────────
  const prolificCode = () => (CONFIG.PROLIFIC && CONFIG.PROLIFIC.COMPLETION_CODE) || "";
  const prolificUrl = () => (CONFIG.PROLIFIC.COMPLETION_URL || "https://app.prolific.com/submissions/complete?cc=") + encodeURIComponent(prolificCode());
  const prolificReady = () => !!prolificCode() && !/EDIT/i.test(prolificCode());

  function goToProlific() {
    Core.Events.log("Session", 0, "prolific_redirect");
    window.location.href = prolificUrl();
  }

  // Auto-redirect only after a successful upload (a participant whose upload
  // failed must have time to download their file first). One timer at most.
  let redirectTimer = null;
  function prolificBox(parent, uploadOk) {
    clearTimeout(redirectTimer);
    const box = el("div", "prolific-box", null, parent);
    if (!prolificReady()) {
      el("p", null, "Completion code not set (CONFIG.PROLIFIC.COMPLETION_CODE). Set it before publishing on Prolific.", box);
      return;
    }
    el("p", null, "To be paid, return to Prolific by clicking the button below. If the button does not work, enter this completion code on Prolific:", box);
    el("p", "prolific-code", prolificCode(), box);
    const b = el("button", "btn", "Return to Prolific", box);
    b.onclick = goToProlific;
    const secs = Number(CONFIG.PROLIFIC.AUTO_REDIRECT_SEC) || 0;
    if (secs > 0 && uploadOk) {
      const note = el("p", "muted", "", box);
      let left = secs;
      const tick = () => {
        note.textContent = `You will be taken back to Prolific automatically in ${left} s.`;
        if (left-- <= 0) goToProlific(); else redirectTimer = setTimeout(tick, 1000);
      };
      tick();
    }
  }

  function debrief(uploadOk) {
    const c = card("Thank you!");
    const d = el("div", "info", null, c);
    const cond = window.Images ? Images.condition : "";
    const labels = (CONFIG.IMAGES.ASSIGN_FROM || []).map((c) => Images.label(c));
    const list = labels.length > 1 ? labels.slice(0, -1).join(", ") + " or " + labels[labels.length - 1] : labels.join("");
    const vars = { CONTACT: CONFIG.RESEARCHER_CONTACT, CONDITION_LABEL: cond ? Images.label(cond) : "", CONDITION_LIST: list };
    d.innerHTML = Core.fill(TEXTS.DEBRIEF_HTML, vars) +
      ((TEXTS.DEBRIEF_BY_CONDITION && TEXTS.DEBRIEF_BY_CONDITION[cond]) ? Core.fill(TEXTS.DEBRIEF_BY_CONDITION[cond], vars) : "");
    const box = el("div", uploadOk ? "status ok" : "status bad", null, c);
    if (uploadOk) {
      el("p", null, `Your data has been saved. Your participant code is ${Core.Data.pid}.`, box);
    } else {
      el("p", null,
        Core.Data.uploadEnabled
          ? `We could not upload all of your data (the connection may have dropped). Please click the button below to download it, and send the file to ${CONFIG.RESEARCHER_CONTACT} (or via a Prolific message). Your participant code is ${Core.Data.pid}.`
          : `Pilot mode: no upload address is set. Click below to download the data file. Participant code: ${Core.Data.pid}.`,
        box);
      const b = el("button", "btn", "Download data file", box);
      b.onclick = () => Core.Data.downloadJSON();
      if (Core.Data.uploadEnabled) {
        const retry = el("button", "btn btn-secondary", "Try uploading again", box);
        retry.onclick = async () => {
          retry.disabled = true;
          retry.textContent = "Uploading…";
          const ok = await Core.Data.retryFinal();
          if (ok) debrief(true);
          else { retry.disabled = false; retry.textContent = "Try uploading again"; }
        };
      }
    }
    // Participants who finished get the completion code either way: an
    // upload failure is not their fault, and they can still send the file.
    prolificBox(c, uploadOk);
  }

  window.Forms = { deviceProblem, blocked, consent, demographics, setup, feedback, uploading, debrief, card };
})();
