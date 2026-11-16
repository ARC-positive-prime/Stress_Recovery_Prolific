/*
 * Image-viewing intervention — port of image_viewing.py.
 *
 *   Instructions → N_IMAGES images × IMAGE_DURATION, back to back (no gap).
 *   Default: 120 × 2.5 s = 5 min, as in the lab.
 *
 * Image set (js/image_list.js, CONFIG.IMAGES): each participant gets a
 * fresh random draw. By default only full-HD 16:9 images are used (446 of
 * the 920); MIX_OTHER_FRACTION mixes in a share of the other shapes.
 *
 * Resolution tier: images/1920/ for screens ≥ 1600 × 900 physical pixels,
 * images/1280/ otherwise (CONFIG.IMAGES.TIER = "auto"). The files were made
 * from the original Positive Prime images.
 *
 * Fit on screen (never stretched):
 *   - "cover"        image shape within COVER_TOLERANCE of the screen's:
 *                    fills the whole screen (a thin strip may be trimmed);
 *   - "contain_blur" any other shape: the whole image is shown, and the
 *                    empty areas are filled with a blurred, darkened copy of
 *                    the same image (no grey bars, nothing cropped).
 *
 * Loading: preload() is called right after consent, so the images download
 * in the background during the first parts of the study. A failed file is
 * retried (LOAD_RETRIES, with back-off, waiting for the connection to come
 * back) before it is replaced by an unused image, so a brief network drop
 * doesn't use up the spares. The next image is decoded while the current
 * one is on screen.
 *
 * Timing: onsets are locked to screen refreshes and scheduled from the
 * first image's onset (planned onset of image i = start + i × duration), so
 * frame jitter never accumulates. If the page is hidden (tab switch,
 * minimised) the browser stops drawing; images whose whole slot passed
 * while hidden are NOT flashed through afterwards — they are recorded with
 * shown = 0 and the block resumes on schedule. Tab switches are also in the
 * events tab (Browser: tab_hidden / tab_visible) and in focus_lost.
 */
(function () {
  "use strict";
  const C = () => CONFIG.IMAGES;
  const { el, stage, frame, now, sec, sleep } = Core;

  const TRIGGERS = { phase_start_viewing: 50, image_onset: 51, image_offset: 52, task_end: 99 };
  const IMAGE_SET = "positive_prime";

  const INSTRUCT = `You will now view a series of images.

Simply look at each image as it appears.
This takes about %MIN% minutes. You do not need to press any keys.

After the images, a cross ( + ) will appear in the middle of the screen
for about a minute. Please keep looking at it and relax.

Press SPACE to begin.`;

  // ── Manifest ───────────────────────────────────────────────────────────
  function manifest() {
    const cols = window.IMAGE_COLUMNS || [];
    return (window.IMAGE_MANIFEST || []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  }

  function chooseTier() {
    const t = String(C().TIER || "auto");
    if (t === "1280" || t === "1920") return t;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(screen.width * dpr), h = Math.round(screen.height * dpr);
    return w >= 1600 || h >= 900 ? "1920" : "1280";
  }

  // ── Selection + preload ────────────────────────────────────────────────
  let selection = null;   // [{file, ar, img, ok, replaced_from, attempts}]
  let loadPromise = null;
  let tier = null;
  const Preload = { total: 0, done: 0, failed: 0 };

  function loadOnce(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `${C().DIR}${tier}/${encodeURIComponent(file)}`;
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

  // Load one file, retrying with back-off (and waiting for the connection).
  async function loadWithRetry(file) {
    const retries = Math.max(0, C().LOAD_RETRIES | 0);
    for (let a = 0; a <= retries; a++) {
      if (a > 0) { await waitOnline(30000); await sleep(1500 * a); }
      const img = await loadOnce(file);
      if (img) return { img, attempts: a + 1 };
    }
    return { img: null, attempts: retries + 1 };
  }

  /*
   * Pick the images and start loading them. Safe to call more than once;
   * returns the same promise, which resolves to the final list.
   */
  function preload() {
    if (loadPromise) return loadPromise;
    tier = chooseTier();
    const all = manifest().filter((m) => !m.dup);
    const primary = Core.shuffle(all.filter((m) => m.wide && m.hd));
    const other = Core.shuffle(all.filter((m) => !(m.wide && m.hd)));
    const n = Math.min(C().N_IMAGES, primary.length + other.length);
    const nOther = Math.min(other.length, Math.round(n * Math.max(0, Math.min(1, C().MIX_OTHER_FRACTION || 0))));
    const chosen = Core.shuffle(other.slice(0, nOther).concat(primary.slice(0, n - nOther)));
    // Spares: unused images of the main pool first.
    const spares = primary.slice(n - nOther).concat(other.slice(nOther));
    selection = chosen.map((m) => ({ file: m.file, ar: m.ar, img: null, ok: false, replaced_from: "", attempts: 0 }));
    Preload.total = selection.length;
    Preload.done = 0;
    Core.Events.log("Image_Markers", 0, "preload_start", JSON.stringify({ tier, n: selection.length, n_other: nOther }));

    loadPromise = Promise.all(selection.map(async (slot) => {
      let r = await loadWithRetry(slot.file);
      while (!r.img && spares.length) {
        Preload.failed++;
        Core.Events.log("Image_Markers", 0, "image_load_failed", slot.file);
        slot.replaced_from = slot.replaced_from || slot.file;
        const sp = spares.shift();
        slot.file = sp.file;
        slot.ar = sp.ar;
        r = await loadWithRetry(slot.file);
      }
      slot.img = r.img;
      slot.ok = !!r.img;
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
    while (!finished && now() - t0 < C().PRELOAD_TIMEOUT) {
      box.textContent = `Loading images… ${Preload.done} / ${Preload.total}\n\nPlease wait.`;
      await sleep(250);
    }
    Core.clearStage();
    return finished;
  }

  // ── Slides ─────────────────────────────────────────────────────────────
  // Build the on-screen element for one image for the current screen shape.
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
        // Cover-fit the image into the small canvas.
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

  // Draw on the first frame that lands within half a frame of `target`
  // (performance.now() ms); resolve with the frame time the drawing reached
  // the screen. Same principle as Core.present(). With `slotEnd`, resolves
  // null without drawing if that frame would already be past the slot (the
  // page was hidden and frames stopped), so overdue images never flash.
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
    await Core.instructions(INSTRUCT.replace("%MIN%", String(Math.max(1, Math.round((slots.length * D) / 60000)))));
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
      if (!s || s.slide) return;
      buildSlide(s, screenAr);
      if (s.img.decode) s.img.decode().catch(() => {});
    };
    prepare(0);
    prepare(1);
    if (slots[0].img.decode) { try { await slots[0].img.decode(); } catch (_) {} }

    Core.Events.log("Image_Markers", TRIGGERS.phase_start_viewing, "phase_start_viewing", IMAGE_SET);
    let start = null;
    let prev = null;   // {row, onset} of the image currently on screen

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      prepare(i);
      const base = {
        participant_id: Core.Data.pid,
        session: Core.Data.session,
        phase,
        image_set: IMAGE_SET,
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

      // Draw at the planned onset — unless the whole slot is already over
      // (page was hidden): then skip it rather than flash it.
      const target = start == null ? now() : start + i * D;
      const slotEnd = start == null ? Infinity : start + (i + 1) * D;
      const onset = await presentAt(target, () => holder.replaceChildren(slot.slide), frameMs, slotEnd);
      if (onset == null) {
        const row = { ...base, shown: 0, onset_s: "", onset_error_ms: "", trial_onset_time: "", onset_frame_ms: "",
          offset_time: "", duration_ms: 0, focus_lost: 1, fullscreen: Number(Core.isFullscreen()) };
        rows.push(row);
        Core.Data.stream("image_trials", row);
        Core.Events.log("Image_Markers", 0, "image_skipped_hidden", slot.file);
        if (slots[i].slide) slots[i].slide = null;
        continue;
      }
      const frameAtOnset = Core.lastFrameMs;
      if (start == null) start = onset;
      if (prev) {
        Core.Events.log("Image_Markers", TRIGGERS.image_offset, "image_offset", prev.row.image_file);
        finishRow(prev, onset);   // reads the focus flag gathered while prev was on screen
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
      // previous one (its decoded pixels can be dropped).
      prepare(i + 1);
      if (i >= 1) { slots[i - 1].slide = null; slots[i - 1].img = null; }
    }

    // Offset of the last image shown.
    const end = await presentAt(start + slots.length * D, () => holder.replaceChildren(), frameMs);
    if (prev) {
      Core.Events.log("Image_Markers", TRIGGERS.image_offset, "image_offset", prev.row.image_file);
      finishRow(prev, end);
      Core.Data.stream("image_trials", prev.row);
    }
    Core.Events.log("Image_Markers", TRIGGERS.task_end, "task_end");
    Core.clearStage();
    return rows;
  }

  function finishRow(prev, offset) {
    prev.row.offset_time = sec(offset);
    prev.row.duration_ms = Math.round((offset - prev.onset) * 10) / 10;
    prev.row.focus_lost = Number(Core.Quality.trialFlags.focusLost);
    prev.row.fullscreen = Number(Core.isFullscreen());
  }

  window.Images = { preload, run, chooseTier, TRIGGERS, IMAGE_SET, Preload };
})();
