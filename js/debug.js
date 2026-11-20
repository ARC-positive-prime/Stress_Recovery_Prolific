/*
 * Debug mode: test any part of the experiment on its own.
 *
 * Easiest: open debug.html and click what you want to test. It opens
 * index.html with these URL options (only honoured together with debug=1):
 *
 *   debug=1                 debug mode: no device check, no upload (unless upload=1),
 *                           participant code DEBUG_…, a step label in the corner,
 *                           F2 = skip the rest of the current step,
 *                           and at the end a screen with the data file.
 *   only=a,b,c              run only these steps, in this order. A step is an entry
 *                           of CONFIG.FLOW ("stroop:post_stress", "mist_baseline", …);
 *                           a bare name ("stroop", "vas") means all such steps of FLOW.
 *   from=<step> / to=<step> run CONFIG.FLOW from / up to (and including) a step.
 *   condition=<name>        image condition (also works without debug, see config.js).
 *   practice=1 / practice=0 force / suppress the practice of the FIRST Stroop step run
                           (it still gets the full instructions; later steps are unaffected).
 *   quick=1                 short blocks (see the end of js/config.js).
 *   upload=1                also upload in debug mode (to DATA.UPLOAD_URL, or to
 *   upload_url=<url>        this address, e.g. http://localhost:8787/upload).
 *   pid=<code>              participant code.

 Outside debug mode: quick=1 (short blocks) and skipcheck=1 (no device check)
 only work for links WITHOUT a PROLIFIC_PID, and every run without a Prolific
 ID is marked participant.test_run = 1 (analysis/analyze.py drops these).
 *
 * In the browser console (F12) while the study runs:
 *   Debug.snapshot()   the data file as it is now
 *   Debug.download()   download it
 *   Debug.skip()       same as F2
 */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const active = params.get("debug") === "1";
  const { el } = Core;

  let label = null;

  // Which steps to run, from CONFIG.FLOW and only= / from= / to=.
  function selectSteps(flow) {
    if (!active) return flow.slice();
    const only = (params.get("only") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (only.length) {
      const out = [];
      for (const item of only) {
        if (item.includes(":") || flow.includes(item)) out.push(item);
        else {
          const group = flow.filter((s) => s.split(":")[0] === item);
          out.push(...(group.length ? group : [item]));
        }
      }
      return out;
    }
    let steps = flow.slice();
    const from = params.get("from"), to = params.get("to");
    const find = (name) => steps.findIndex((s) => s === name || s.split(":")[0] === name);
    if (from) { const i = find(from); if (i < 0) throw new Error(`debug: from=${from} is not in CONFIG.FLOW`); steps = steps.slice(i); }
    if (to) {
      const idx = steps.map((s, i) => (s === to || s.split(":")[0] === to ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) throw new Error(`debug: to=${to} is not in CONFIG.FLOW`);
      steps = steps.slice(0, idx[idx.length - 1] + 1);
    }
    return steps;
  }

  function init() {
    if (!active) return;
    Core.Skip.enabled = true;
    window.addEventListener("keydown", (e) => {
      if (e.key === "F2" || e.code === "F2") {
        e.preventDefault();
        if (!Core.Skip.requested) {
          Core.Events.log("Debug", 0, "skip_requested", Core.step);
          Core.Skip.request();
          setStep(Core.step, "skipping…");
        }
      }
    }, true);
    label = el("div", "debug-label", "DEBUG", document.body);
  }

  function setStep(step, extra) {
    if (!label) return;
    const cond = window.Images && Images.condition ? ` · images: ${Images.condition}` : "";
    label.textContent = `DEBUG · step: ${step || "-"}${cond} · F2 = skip step${extra ? " · " + extra : ""}`;
  }

  // Start screen: shows what will run; the click enters full screen and
  // starts audio (browsers need a click for both).
  function startScreen(info) {
    return new Promise((resolve) => {
      const c = Forms.card("Debug run");
      const ul = el("ul", null, null, c);
      const li = (k, v) => { const i = el("li", null, null, ul); el("strong", null, k + ": ", i); i.appendChild(document.createTextNode(v)); };
      li("Steps", info.steps.join("  →  "));
      li("Participant code", info.pid);
      li("Image condition", `${info.condition} (${info.conditionSource})`);
      li("Stroop keys", `match = ${info.mapping.match}, mismatch = ${info.mapping.mismatch}`);
      li("Quick mode", CONFIG.QUICK_MODE ? "yes" : "no");
      li("Upload", info.upload ? `yes → ${info.upload}` : "no (download the file at the end)");
      el("p", "muted", "Press F2 at any time to skip the rest of the current step. The data file is shown at the end.", c);
      const b = el("button", "btn", "Start (full screen)", c);
      const back = el("a", "btn btn-secondary", "Back to debug launcher", c);
      back.href = "debug.html";
      b.onclick = async () => {
        await Core.requestFullscreen();
        resolve();
      };
    });
  }

  function endScreen(snap, uploadOk) {
    const c = Forms.card("Debug run finished");
    el("p", null, `Steps run: ${(snap.session.steps_run || []).map((s) => s.step).join(", ") || "none"}`, c);
    el("p", null, `File: ${snap.upload.file_name}  ·  upload: ${Core.Data.uploadEnabled ? (uploadOk ? "saved ✓" : "FAILED ✗") : "off"}`, c);
    const I = snap.integrity || {};
    el("p", null, `Integrity: full-screen exits ${I.fullscreen_exit_count}, tab switches ${I.tab_hidden_count}, focus lost ${I.window_blur_count}, ` +
      `time outside full screen ${I.time_outside_fullscreen_s} s, hidden ${I.time_hidden_s} s`, c);
    const counts = Object.entries(snap.data).map(([k, v]) => `${k}: ${v.length}`).join(" · ");
    el("p", "muted", `Rows: ${counts}`, c);
    const dl = el("button", "btn", "Download JSON", c);
    dl.onclick = () => Core.Data.downloadJSON();
    const again = el("button", "btn btn-secondary", "Run again", c);
    again.onclick = () => location.reload();
    const back = el("a", "btn btn-secondary", "Back to debug launcher", c);
    back.href = "debug.html";
    el("h3", null, "Summary", c);
    el("pre", "json-view", JSON.stringify(snap.summary, null, 1), c);
    el("h3", null, "Whole file (without events)", c);
    el("pre", "json-view", JSON.stringify({ ...snap, data: { ...snap.data, events: `[${snap.data.events.length} rows]` } }, null, 1), c);
  }

  window.Debug = {
    active, params, selectSteps, init, setStep, startScreen, endScreen,
    snapshot: () => Core.Data.snapshot(Core.Data.status, "debug", Core.step),
    download: () => Core.Data.downloadJSON(),
    skip: () => Core.Skip.request(),
  };
})();
