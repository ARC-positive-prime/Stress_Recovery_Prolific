/*
 * The participant's data file: ONE JSON object holding everything
 * (format: docs/DATA_FORMAT.md), plus its upload and local backup.
 *
 *   Data.set(section, obj)     store a form / info section (demographics, …)
 *   Data.stream(table, row)    add a trial row (stroop_trials, mist_trials, vas, image_trials)
 *   Data.checkpoint(step)      after every step: local backup + (optional) upload of a
 *                              full snapshot to  progress/<pid>__<load>__p<seq>_<step>.json
 *   Data.finish()              at the end: upload the complete file to
 *                              complete/<pid>__<load>.json (retries until a deadline)
 *   page closed early          small snapshot to quit/<pid>__<load>__quit_<seq>.json
 *                              (status "quit"; or status "complete" + partial = 1 if the study
 *                              was finished but the complete file could not be uploaded)
 *   Data.downloadJSON()        the same file as a download (no receiver / upload failed)
 *
 * Every upload has a NEW file name, so the receiver never overwrites
 * anything (see receivers/README.md for the receiver side). You should not
 * need to edit this file; the upload address is CONFIG.DATA.UPLOAD_URL.
 */
(function () {
  "use strict";
  const { iso, sleep, now } = Core;

  const SCHEMA_VERSION = "2.0";
  const LS_PREFIX = "stress_recovery_prolific_backup__";   // + <pid>__<page_load_id>; newest MAX_BACKUPS kept
  const MAX_BACKUPS = 3;
  const KEEPALIVE_BUDGET = 60000;   // bytes; browsers cap keepalive bodies at ~64 KB
  const TABLES = ["stroop_trials", "mist_trials", "vas", "image_trials"];
  const SECTIONS = ["participant", "session", "consent", "demographics", "mist_calibration", "feedback"];

  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "unknown";
  const pad = (n) => String(n).padStart(2, "0");

  const Data = {
    pid: "",
    attempt: 1,
    session: 1,
    loadId: Core.randomCode(8),
    sections: Object.fromEntries(SECTIONS.map((s) => [s, {}])),
    tables: Object.fromEntries(TABLES.map((t) => [t, []])),
    status: "in_progress",
    lastStep: "",
    seq: 0,
    started: false,          // consent given (before that, closing the page sends nothing)
    finished: false,         // all steps done
    completeUploaded: false,
    uploadEnabled: false,    // set by main.js (URL set, not debug unless &upload=1)
    uploadUrl: "",
    frameMs: null,           // for the summary's late-onset count
    queuedProgress: null,
    progressLoop: null,

    // ── Storing ──────────────────────────────────────────────────────────
    set(section, obj) { this.sections[section] = { ...(obj || {}) }; },
    merge(section, obj) { this.sections[section] = { ...(this.sections[section] || {}), ...(obj || {}) }; },
    stream(table, row) { (this.tables[table] = this.tables[table] || []).push(row); },
    all(table) { return (this.tables[table] || []).slice(); },

    fileBase() { return `${safe(this.pid)}__${this.loadId}`; },

    // ── The file ─────────────────────────────────────────────────────────
    snapshot(status, folder, step, opts = {}) {
      const fileName = folder === "progress" ? `${this.fileBase()}__p${pad(this.seq)}_${safe(step).replace(/_/g, "-")}.json`
        : folder === "quit" ? `${this.fileBase()}__quit_${this.seq}.json`
        : `${this.fileBase()}.json`;
      let summary = {};
      try {
        summary = window.Summary ? Summary.build({ tables: this.tables, sections: this.sections, frameMs: this.frameMs }) : {};
      } catch (e) { summary = { error: String(e && e.message || e) }; }
      const data = {};
      for (const t of TABLES) data[t] = this.tables[t] || [];
      data.events = opts.noEvents ? [] : Core.Events.rows;
      const out = {
        schema_version: SCHEMA_VERSION,
        app_version: CONFIG.APP_VERSION,
        study: "stress_recovery_prolific",
        upload: { folder, file_name: fileName, seq: this.seq },
        status,
        last_step: this.lastStep,
        saved_at: iso(),
      };
      for (const s of SECTIONS) out[s] = this.sections[s] || {};
      out.integrity = Core.Integrity.report();
      out.summary = summary;
      // Keep the documented key order: … summary, feedback, data.
      const fb = out.feedback; delete out.feedback; out.feedback = fb;
      out.data = data;
      return out;
    },

    // ── Upload ───────────────────────────────────────────────────────────
    // One POST of one snapshot. Success = 2xx, or 409 (the receiver already
    // has this exact file name: an earlier try succeeded but its reply was lost).
    async send(body, attempts = 3) {
      if (!this.uploadEnabled) return false;
      if (typeof body !== "string") body = JSON.stringify(body);
      // ≥ UPLOAD_TIMEOUT_MS, and at least 1 s per 10 KB (≈ 80 kbit/s upload)
      const timeout = Math.max(CONFIG.DATA.UPLOAD_TIMEOUT_MS || 30000, Math.round(body.length / 10));
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetchWithTimeout(this.uploadUrl, {
            method: "POST",
            // text/plain keeps this a CORS "simple request" (no preflight).
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body,
          }, timeout);
          if (res.status === 409) return true;
          if (res.ok) {
            let j = null;
            try { j = await res.json(); } catch (_) { /* non-JSON 2xx reply is fine */ }
            if (!j || j.ok !== false) return true;
            console.warn("Upload rejected", j);
          } else {
            console.warn("Upload failed: HTTP", res.status);
          }
        } catch (err) {
          console.warn("Upload failed", err);
        }
        if (i < attempts - 1) await sleep(2000 * (i + 1));
      }
      return false;
    },

    // After every step: back up locally and upload a progress snapshot.
    // Only the newest waiting snapshot is sent (each one contains everything).
    checkpoint(step) {
      this.lastStep = step;
      if (!this.started) return;            // before consent nothing is stored or sent
      this.backup();
      if (!this.uploadEnabled || !CONFIG.DATA.UPLOAD_PROGRESS || this.finished) return;
      this.seq++;
      // Serialised now, so the file shows exactly the state at this step.
      this.queuedProgress = JSON.stringify(this.snapshot("in_progress", "progress", step));
      if (!this.progressLoop) {
        this.progressLoop = (async () => {
          while (this.queuedProgress) {
            const s = this.queuedProgress;
            this.queuedProgress = null;
            await this.send(s, 3);
          }
          this.progressLoop = null;
        })();
      }
    },

    // End of the study: upload the complete file. True when it was saved.
    async finish() {
      this.finished = true;
      this.status = "complete";
      this.seq++;
      const snap = this.snapshot("complete", "complete", this.lastStep);
      this.lastSnapshot = snap;
      this.lastBody = JSON.stringify(snap);  // every retry sends exactly these bytes
      this.backup(snap);
      if (!this.uploadEnabled) return false;
      const end = now() + (CONFIG.DATA.FINAL_UPLOAD_DEADLINE_MS || 60000);
      while (now() < end) {
        if (await this.send(this.lastBody, 1)) { this.completeUploaded = true; this.backup(snap); return true; }
        if (now() < end - 3000) await sleep(2500);
      }
      return false;
    },

    // "Try uploading again" on the last page.
    async retryFinal() {
      const body = this.lastBody || JSON.stringify(this.snapshot("complete", "complete", this.lastStep));
      if (await this.send(body, 2)) { this.completeUploaded = true; return true; }
      return false;
    },

    // Page is closing before the complete file was saved: send a small
    // snapshot (no event log; large tables dropped if needed to fit the
    // browser's ~64 KB limit for requests sent while a page closes).
    quitFlush() {
      if (!this.started || this.completeUploaded) return;
      if (!this.finished) {
        this.status = "quit";
        this.merge("session", { quit_time: iso() });
      }
      this.backup();
      if (!this.uploadEnabled) return;
      this.seq++;
      const snap = this.snapshot(this.finished ? "complete" : "quit", "quit", this.lastStep, { noEvents: true });
      snap.partial = 1;                     // no event log; tables may be dropped (see dropped_tables)
      snap.dropped_tables = [];
      const dropOrder = ["image_trials", "mist_trials", "stroop_trials", "vas"];
      let body = JSON.stringify(snap);
      const dropped = [];
      while (new TextEncoder().encode(body).length > KEEPALIVE_BUDGET && dropOrder.length) {
        const t = dropOrder.shift();
        dropped.push(t);
        snap.data[t] = [];
        snap.dropped_tables = dropped.slice();
        snap.integrity.incidents = snap.integrity.incidents.slice(-50);
        body = JSON.stringify(snap);
      }
      try {
        fetch(this.uploadUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, keepalive: true })
          .catch(() => {});
      } catch (_) { /* nothing more we can do */ }
    },

    // ── Local copy ───────────────────────────────────────────────────────
    // Copy in this browser (debug.html lists them with a Download button).
    backup(snap) {
      try {
        const s = { ...(snap || this.snapshot(this.status, "backup", this.lastStep)), backup_uploaded: Number(this.completeUploaded) };
        const key = LS_PREFIX + this.fileBase();
        const old = Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX) && k !== key)
          .map((k) => { let t = ""; try { t = JSON.parse(localStorage.getItem(k)).saved_at || ""; } catch (_) {} return [k, t]; })
          .sort((a, b) => (a[1] < b[1] ? -1 : 1));
        while (old.length > MAX_BACKUPS - 1) localStorage.removeItem(old.shift()[0]);
        try { localStorage.setItem(key, JSON.stringify(s)); }
        catch (_) { localStorage.setItem(key, JSON.stringify({ ...s, data: { ...s.data, events: [] } })); }
      } catch (_) { /* storage full / blocked: the upload is the primary path */ }
    },

    downloadJSON() {
      const snap = this.finished ? (this.lastSnapshot || this.snapshot("complete", "complete", this.lastStep))
        : this.snapshot(this.status, "download", this.lastStep);
      const blob = new Blob([JSON.stringify(snap, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${this.fileBase()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
  };

  async function fetchWithTimeout(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal, redirect: "follow" }); }
    finally { clearTimeout(t); }
  }

  window.addEventListener("pagehide", () => Data.quitFlush());

  window.Data = Data;
  Core.Data = Data;
})();
