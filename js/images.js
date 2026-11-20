/*
 * Image-viewing intervention: port of image_viewing.py, with conditions.
 *
 *   Each participant is assigned ONE image condition (CONFIG.IMAGES):
 *     ?condition=<name> in the URL  →  that condition       (source "url")
 *     same ID reopened in this browser → same as before     (source "saved")
 *     otherwise → random among CONFIG.IMAGES.ASSIGN_FROM    (source "random")
 *   Images come from images/<folder>/ as listed in js/image_manifest.js,
 *   which tools/build_image_manifest.js writes. Re-run that tool after
 *   changing any image folder.
 *
 *   Instructions → N_IMAGES images × IMAGE_DURATION, back to back (no gap).
 *   Default: 120 × 2.5 s = 5 min, a fresh random draw per participant.
 *
 * Selection: full-HD 16:9 images ("wide" + "hd" in the manifest) first;
 * MIX_OTHER_FRACTION mixes in a share of other shapes; sets without such
 * images use the others. A set smaller than N_IMAGES is cycled
 * (REPEAT_IF_FEWER) or shown once.
 *
 * Two-size sets (images/<folder>/1280/ + 1920/): images/<folder>/1920/ for
 * screens ≥ 1600 × 900 physical pixels, 1280/ otherwise (TIER "auto").
 *
 * Fit on screen (never stretched):
 *   "cover"        image shape within COVER_TOLERANCE of the screen's: fills
 *                  the screen (a thin strip may be trimmed);
 *   "contain_blur" other shapes: the whole image over a blurred, darkened
 *                  copy of itself (no grey bars, nothing cropped).
 *
 * Loading starts right after consent (preload()); failed files are retried
 * (LOAD_RETRIES) and then replaced by an unused image (replaced_file).
 *
 * Timing: onsets locked to screen refreshes and scheduled from the first
 * image's onset (planned onset of image i = start + i × duration), so frame
 * jitter never accumulates. If the tab is hidden, images whose whole slot
 * passed are NOT flashed afterwards: recorded with shown = 0.
 *
 * Test alone: debug.html → "Images" (pick the condition there).
 */
(function () {
  "use strict";
  const C = () => CONFIG.IMAGES;
  const { el, stage, frame, now, sec, sleep } = Core;

  const TRIGGERS = { phase_start_viewing: 50, image_onset: 51, image_offset: 52, task_end: 99 };
  const COND_KEY = "stress_recovery_prolific_condition_";

  // ── Condition ──────────────────────────────────────────────────────────
  let condition = null;          // e.g. "negative"
  let conditionSource = "";

  // Conditions that are both configured and present in the manifest.
  function availableConditions() {
    const M = window.IMAGE_MANIFEST || {};
    return Object.keys(C().CONDITIONS).filter((c) => {
      const f = C().CONDITIONS[c].folder || c;
      return M[f] && M[f].images && M[f].images.length;
    });
  }

  /*
   * Pick this participant's condition. `requested` = ?condition= value (or
   * ""), `baseId` = Prolific ID / ?pid= (for keeping the same condition on
   * a reopen), `forget` = do not use/store the saved one (debug).
   */
  function assignCondition({ requested = "", baseId = "", forget = false } = {}) {
    const avail = availableConditions();
    const pool = (C().ASSIGN_FROM || []).filter((c) => avail.includes(c));
    if (!pool.length) throw new Error("No image condition available: check CONFIG.IMAGES and run tools/build_image_manifest.js");
    let src = "random", cond = null;
    if (requested) {
      if (avail.includes(requested)) { cond = requested; src = "url"; }
      else console.warn(`Unknown or empty image condition "${requested}"; assigning at random`);
    }
    if (!cond && baseId && !forget) {
      try {
        const saved = localStorage.getItem(COND_KEY + baseId);
        if (saved && pool.includes(saved)) { cond = saved; src = "saved"; }
      } catch (_) {}
    }
    if (!cond) cond = Core.choice(pool);
    if (baseId && !forget) { try { localStorage.setItem(COND_KEY + baseId, cond); } catch (_) {} }
    condition = cond;
    conditionSource = src;
    return { condition: cond, source: src, label: label(cond) };
  }

  const label = (c) => (C().CONDITIONS[c] && C().CONDITIONS[c].label) || c;

  function setEntry() {
    if (!condition) assignCondition({});
    const folder = C().CONDITIONS[condition].folder || condition;
    const m = (window.IMAGE_MANIFEST || {})[folder];
    if (!m) throw new Error(`Image folder "${folder}" is not in js/image_manifest.js: run tools/build_image_manifest.js`);
    return { folder, ...m };
  }

  // Manifest rows → objects ({file, w, h, ar, wide, hd, …}).
  function manifestRows() {
    const m = setEntry();
    return m.images.map((r) => Object.fromEntries(m.columns.map((c, i) => [c, r[i]])));
  }

  // ── Resolution tier (two-size sets only) ───────────────────────────────
  function chooseTier() {
    const m = setEntry();
    const tiers = m.tiers || [];
    if (!tiers.length) return "";
    const t = String(C().TIER || "auto");
    if (tiers.includes(t)) return t;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(screen.width * dpr), h = Math.round(screen.height * dpr);
    const big = tiers.slice().sort((a, b) => Number(b) - Number(a))[0];
    const small = tiers.slice().sort((a, b) => Number(a) - Number(b))[0];
    return w >= 1600 || h >= 900 ? big : small;
  }

  // ── Selection + preload ────────────────────────────────────────────────
  let selection = null;   // [{file, ar, img, ok, replaced_from, attempts}]
  let loadPromise = null;
  let tier = null;
  let folder = null;
  const Preload = { total: 0, done: 0, failed: 0 };

  const srcOf = (file) => `${C().ROOT}${folder}/${tier ? tier + "/" : ""}${encodeURIComponent(file)}`;

  function loadOnce(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = srcOf(file);
    });
  }

  function waitOnline(maxMs) {
    if (navigator.onLine !== false) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(done, maxMs);
      function done() { clearTimeout(t); window.removeEventListener("online", done); resolve(); }
      window.addEventListener("online", done);
    });
  }

  async function loadWithRetry(file) {
    const retries = Math.max(0, C().LOAD_RETRIES | 0);
    for (let a = 0; a <= retries; a++) {
      if (a > 0) { await waitOnline(30000); await sleep(1500 * a); }
      const img = await loadOnce(file);
      if (img) return { img, attempts: a + 1 };
    }
    return { img: null, attempts: retries + 1 };
  }

  // Choose which files this participant sees (and the spares).
  function choose(n) {
    const all = manifestRows();
    const primary = Core.shuffle(all.filter((m) => m.wide && m.hd));
    const other = Core.shuffle(all.filter((m) => !(m.wide && m.hd)));
    const total = primary.length + other.length;
    const nShow = C().REPEAT_IF_FEWER ? n : Math.min(n, total);
    const nUnique = Math.min(nShow, total);
    let nOther = Math.min(other.length, Math.round(nUnique * Math.max(0, Math.min(1, C().MIX_OTHER_FRACTION || 0))));
    const nPrimary = Math.min(primary.length, nUnique - nOther);
    nOther = Math.min(other.length, nUnique - nPrimary);      // top up with other shapes if needed
    let chosen = Core.shuffle(primary.slice(0, nPrimary).concat(other.slice(0, nOther)));
    const spares = primary.slice(nPrimary).concat(other.slice(nOther));
    // Smaller set than needed: cycle through reshuffled copies (no image twice in a row).
    const base = chosen.slice();
    while (chosen.length < nShow && base.length) {
      let more = Core.shuffle(base.slice());
      if (more.length > 1 && more[0].file === chosen[chosen.length - 1].file) more.push(more.shift());
      chosen = chosen.concat(more.slice(0, nShow - chosen.length));
    }
    return { chosen, spares, nOther, repeated: Math.max(0, chosen.length - base.length) };
  }

  /*
   * Pick the images and start loading them. Safe to call more than once;
   * returns the same promise, which resolves to the final list.
   */
  function preload() {
    if (loadPromise) return loadPromise;
    folder = setEntry().folder;
    tier = chooseTier();
    const { chosen, spares, nOther, repeated } = choose(C().N_IMAGES);
    selection = chosen.map((m) => ({ file: m.file, ar: m.ar, img: null, ok: false, replaced_from: "", attempts: 0 }));
    Preload.total = selection.length;
    Preload.done = 0;
    Core.Events.log("Image_Markers", 0, "preload_start",
      JSON.stringify({ condition, folder, tier, n: selection.length, n_other: nOther, n_repeated: repeated }));

    // Repeated files share one download (the browser caches them anyway).
    const cache = new Map();
    const used = new Set();
    const load = (file) => { if (!cache.has(file)) cache.set(file, loadWithRetry(file)); return cache.get(file); };

    loadPromise = Promise.all(selection.map(async (slot) => {
      let r = await load(slot.file);
      while (!r.img && spares.length) {
        Preload.failed++;
        Core.Events.log("Image_Markers", 0, "image_load_failed", slot.file);
        slot.replaced_from = slot.replaced_from || slot.file;
        const sp = spares.shift();
        slot.file = sp.file;
        slot.ar = sp.ar;
        r = await load(slot.file);
      }
      // Each slot needs its own <img> element (the same picture may be shown twice).
      let img = r.img;
      if (img && used.has(slot.file)) img = await cloneImg(img);
      if (img) used.add(slot.file);
      slot.img = img;
      slot.ok = !!img;
      slot.attempts = r.attempts;
      Preload.done++;
      return slot;
    })).then(() => {
      Core.Events.log("Image_Markers", 0, "preload_done",
        JSON.stringify({ ok: selection.filter((s) => s.ok).length, failed_files: Preload.failed }));
      return selection;
    });
    return loadPromise;
  }

  // A second <img> of an already loaded file (from the browser cache).
  function cloneImg(img) {
    return new Promise((resolve) => {
      const c = new Image();
      c.decoding = "async";
      c.onload = () => resolve(c);
      c.onerror = () => resolve(null);
      c.src = img.src;
    });
  }

  // Wait for loading, showing progress on the stage if it isn't finished.
  async function waitForImages() {
    preload();
    let finished = false;
    loadPromise.then(() => { finished = true; });
    await sleep(50);
    if (finished) return true;
    const t0 = now();
    Core.showStage();
    Core.clearStage();
    const box = el("div", "instruct", "", stage());
    while (!finished && now() - t0 < C().PRELOAD_TIMEOUT && !Core.Skip.requested) {
      box.textContent = Core.fill(TEXTS.IMAGES.LOADING, { DONE: Preload.done, TOTAL: Preload.total });
      await sleep(250);
    }
    Core.clearStage();
    return finished;
  }

  // ── Slides ─────────────────────────────────────────────────────────────
  function buildSlide(slot, screenAr) {
    const img = slot.img;
    const imgAr = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : slot.ar;
    const cover = Math.abs(Math.log(imgAr / screenAr)) <= Math.log(1 + C().COVER_TOLERANCE);
    const slide = el("div", "img-slide");
    if (!cover) {
      // Blurred, darkened copy of the same image filling the screen behind it.
      const cv = document.createElement("canvas");
      cv.width = 96;
      cv.height = Math.max(1, Math.round(96 / screenAr));
      cv.className = "img-bg";
      try {
        const ctx = cv.getContext("2d");
        let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
        if (imgAr > screenAr) { sw = sh * screenAr; sx = (img.naturalWidth - sw) / 2; }
        else { sh = sw / screenAr; sy = (img.naturalHeight - sh) / 2; }
        if ("filter" in ctx) ctx.filter = "blur(2px)";
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        ctx.filter = "none";
        ctx.fillStyle = "rgba(0,0,0,0.30)";
        ctx.fillRect(0, 0, cv.width, cv.height);
      } catch (_) { /* leave the grey stage behind */ }
      slide.appendChild(cv);
    }
    img.className = "stim-image " + (cover ? "fit-cover" : "fit-contain");
    slide.appendChild(img);
    slot.slide = slide;
    slot.fill_mode = cover ? "cover" : "contain_blur";
    slot.image_w = img.naturalWidth;
    slot.image_h = img.naturalHeight;
    return slide;
  }

  // Draw on the first frame that lands within half a frame of `target`;
  // resolve with the frame time the drawing reached the screen. With
  // `slotEnd`, resolves null without drawing if that frame would already be
  // past the slot (the page was hidden), so overdue images never flash.
  async function presentAt(target, render, frameMs, slotEnd = Infinity) {
    for (;;) {
      const t = await frame();
      if (t + frameMs > slotEnd - frameMs) return null;
      if (t + frameMs >= target - frameMs / 2) {
        render();
        const t2 = await frame();
        Core.lastFrameMs = Math.round((t2 - t) * 100) / 100;
        return t2;
      }
    }
  }

  // ── Block ──────────────────────────────────────────────────────────────
  async function run({ phase = "intervention", frameMs = 1000 / 60 } = {}) {
    Core.phase = phase;
    const loadedAll = await waitForImages();
    const slots = (selection || []).filter((s) => s.ok);
    if (!loadedAll || slots.length < (selection || []).length) {
      Core.Events.log("Image_Markers", 0, "images_incomplete",
        JSON.stringify({ loaded_all: loadedAll, n_ok: slots.length, n_selected: (selection || []).length }));
    }

    const D = C().IMAGE_DURATION;
    const restMin = Math.max(1, Math.round((CONFIG.REST.DURATION || 60000) / 60000));
    const T = TEXTS.IMAGES;
    const restSentence = Core.fill(CONFIG.REST.SHOW_FIXATION ? T.REST_FIXATION : T.REST_BLANK, { REST_MIN: restMin });
    await Core.instructions(Core.fill(T.INTRO, {
      MIN: String(Math.max(1, Math.round((slots.length * D) / 60000))),
      REST_SENTENCE: restSentence,
    }));
    Core.showStage();
    Core.clearStage();
    const holder = el("div", "image-holder", null, stage());

    const rows = [];
    if (!slots.length) {
      Core.Events.log("Image_Markers", 0, "no_images_available");
      return rows;
    }

    const screenAr = (window.innerWidth || screen.width) / (window.innerHeight || screen.height);
    const prepare = (i) => {
      const s = slots[i];
      if (!s || s.slide || !s.img) return;
      buildSlide(s, screenAr);
      if (s.img.decode) s.img.decode().catch(() => {});
    };
    prepare(0);
    prepare(1);
    if (slots[0].img && slots[0].img.decode) { try { await slots[0].img.decode(); } catch (_) {} }

    Core.Events.log("Image_Markers", TRIGGERS.phase_start_viewing, "phase_start_viewing", condition);
    let start = null;
    let prev = null;   // {row, onset} of the image currently on screen

    for (let i = 0; i < slots.length; i++) {
      if (Core.Skip.requested) break;                         // debug: F2
      const slot = slots[i];
      prepare(i);
      const base = {
        participant_id: Core.Data.pid,
        session: Core.Data.session,
        step: Core.step,
        phase,
        image_set: condition,
        image_condition: condition,
        trial: i + 1,
        image_file: slot.file,
        replaced_file: slot.replaced_from,
        tier,
        fill_mode: slot.fill_mode,
        image_w: slot.image_w,
        image_h: slot.image_h,
        screen_aspect: Math.round(screenAr * 1000) / 1000,
        planned_onset_s: Math.round(i * D) / 1000,
      };

      const target = start == null ? now() : start + i * D;
      const slotEnd = start == null ? Infinity : start + (i + 1) * D;
      const onset = await presentAt(target, () => holder.replaceChildren(slot.slide), frameMs, slotEnd);
      if (onset == null) {
        const row = { ...base, shown: 0, onset_s: "", onset_error_ms: "", trial_onset_time: "", onset_frame_ms: "",
          offset_time: "", duration_ms: 0, focus_lost: 1, fullscreen: Number(Core.isFullscreen()) };
        rows.push(row);
        Core.Data.stream("image_trials", row);
        Core.Events.log("Image_Markers", 0, "image_skipped_hidden", slot.file);
        slots[i].slide = null;
        continue;
      }
      const frameAtOnset = Core.lastFrameMs;
      if (start == null) start = onset;
      if (prev) {
        Core.Events.log("Image_Markers", TRIGGERS.image_offset, "image_offset", prev.row.image_file);
        finishRow(prev, onset);
        Core.Data.stream("image_trials", prev.row);
      }
      Core.Quality.resetTrial();
      Core.Events.log("Image_Markers", TRIGGERS.image_onset, "image_onset", slot.file);

      const row = {
        ...base,
        shown: 1,
        onset_s: sec(onset - start),
        onset_error_ms: Math.round((onset - (start + i * D)) * 10) / 10,
        trial_onset_time: sec(onset),
        onset_frame_ms: frameAtOnset,
      };
      prev = { row, onset };
      rows.push(row);

      // Get the next image ready while this one is on screen; release the
      // previous one.
      prepare(i + 1);
      if (i >= 1) { slots[i - 1].slide = null; slots[i - 1].img = null; }
    }

    // Offset of the last image shown (at its planned end, or now if skipped).
    const lastEnd = start == null ? now() : Core.Skip.requested ? now() : start + slots.length * D;
    const end = await presentAt(lastEnd, () => holder.replaceChildren(), frameMs);
    if (prev) {
      Core.Events.log("Image_Markers", TRIGGERS.image_offset, "image_offset", prev.row.image_file);
      finishRow(prev, end);
      Core.Data.stream("image_trials", prev.row);
    }
    Core.Events.log("Image_Markers", TRIGGERS.task_end, "task_end");
    Core.clearStage();
    loadPromise = null;   // shown images were released: another image step draws afresh
    selection = null;
    return rows;
  }

  function finishRow(prev, offset) {
    prev.row.offset_time = sec(offset);
    prev.row.duration_ms = Math.round((offset - prev.onset) * 10) / 10;
    prev.row.focus_lost = Number(Core.Quality.trialFlags.focusLost);
    prev.row.fullscreen = Number(Core.isFullscreen());
  }

  window.Images = {
    preload, run, chooseTier, assignCondition, availableConditions, label, TRIGGERS, Preload,
    get condition() { return condition; },
    get conditionSource() { return conditionSource; },
  };
})();
