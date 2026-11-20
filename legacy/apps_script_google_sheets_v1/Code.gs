/**
 * Data receiver and live dashboard for the online stress-recovery study (Prolific), v1.1.
 * Flow: consent → demographics → setup → VAS → Stroop → VAS → MIST → VAS → Stroop
 *       → images → rest → VAS (+ image question) → Stroop → feedback.
 *
 * Setup (details in README.md → "Data collection setup"):
 *   1. Create a Google Sheet → Extensions → Apps Script → replace Code.gs with
 *      this file → Save.
 *   2. Run testSetup once from the editor. This authorises the script and
 *      writes a TEST row to the "sessions" tab; delete that row.
 *   3. Deploy → New deployment → Web app; Execute as: Me; Who has access: Anyone.
 *      Copy the /exec URL into js/config.js (DATA_URL).
 *   4. Reload the Sheet → Study → Create / show export key (for
 *      analysis/analyze.py --url <exec URL> --key <key>).
 *   After editing this file: Deploy → Manage deployments → edit → Version:
 *   New version. The /exec URL stays the same.
 *
 * Endpoints (any receiver that follows this protocol will do, e.g. Power Automate)
 *   POST {action:"append", participant_id, batch_id, sheet, rows:[{...}]}
 *        → {ok:true, n}. Appends rows to one of SHEETS. A batch_id seen in the
 *          last 6 h is not stored again → {ok:true, n:0, duplicate:true}. The
 *          browser resends a batch when a reply is lost, and resends every
 *          unconfirmed batch when the page closes, so this check matters.
 *   POST {action:"complete", participant_id} → log to "completions", rebuild "dashboard"
 *   GET  ?action=export&key=…[&events=1]     → every tab as JSON (key-protected)
 *   GET  (no params)                         → health check
 *
 * The browser writes the tabs in SHEETS. The script itself writes
 * "completions" (one row per finished participant) and "dashboard".
 * Each tab gets its header from the row keys; new keys add new columns.
 * POST bodies are sent as text/plain, so there is no CORS preflight.
 *
 * Summary rows (v1.1): the browser saves a new "summary" row after every
 * section (status = "in_progress", last_step = the section just finished), a
 * row with status = "quit" if the page is closed early, and a row with
 * status = "complete" at the end. The newest row per participant_id counts
 * (by saved_at, then row order). A "complete" row is never replaced by a
 * later row from another page load (the same ID opened in a second browser).
 * A participant who reopens the link in the same browser gets a new ID with
 * "(2)", "(3)", … appended.
 *
 * The dashboard is rebuilt after every completion, at most every 5 minutes
 * when summary rows arrive (so quits show up), and via Study → Refresh dashboard.
 */

var SHEETS = [
  'sessions', 'demographics', 'feedback', 'summary', 'vas',
  'stroop_trials', 'image_trials', 'mist_trials', 'events'
];
var SERVER_SHEETS = ['completions']; // written by the script only; included in export
var MAX_ROWS_PER_REQUEST = 5000;
var MAX_ID_LEN = 128;
var BATCH_TTL_S = 21600;             // remember batch_ids for 6 h (the CacheService maximum)
var DASHBOARD_MIN_GAP_S = 300;       // summary uploads rebuild the dashboard at most every 5 min
var ABANDONED_AFTER_MIN = 60;        // in_progress with no new data for this long → "abandoned"
// Whose data the statistics (dashboard sections 1–4) use. Add 'quit',
// 'in_progress' or 'abandoned' to include partial sessions. Section 5 lists everyone.
var STATS_STATUSES = ['complete'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'export') return json_(export_(p.key, p.events === '1'));
  return json_({ ok: true, status: 'running', study: 'stress_recovery_prolific' });
}

// Adds a "Study" menu to the Sheet.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Study')
    .addItem('Refresh dashboard', 'refreshDashboard')
    .addItem('Create / show export key', 'createExportKey')
    .addToUi();
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'complete') {
      return json_(withLock_(function () { return markComplete_(body.participant_id); }));
    }
    if (body.action === 'append') {
      return json_(withLock_(function () { return append_(body); }));
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function append_(body) {
  if (SHEETS.indexOf(body.sheet) < 0) return { ok: false, error: 'unknown sheet ' + body.sheet };
  var rows = body.rows || [];
  if (!Array.isArray(rows)) return { ok: false, error: 'rows must be a list' };
  if (!rows.length) return { ok: true, n: 0 };
  if (rows.length > MAX_ROWS_PER_REQUEST) return { ok: false, error: 'too many rows' };
  if (rows.some(function (r) { return !r || typeof r !== 'object' || Array.isArray(r); })) {
    return { ok: false, error: 'rows must be objects' };
  }

  // A batch is stored once, however often it is sent (retries, and the
  // resend of unconfirmed batches when the page closes). Runs inside the
  // script lock, so two copies arriving together are handled in turn.
  // If the cache fails, the rows are stored anyway: a duplicate beats a loss.
  var cache = cache_();
  var key = body.batch_id ? 'b_' + String(body.batch_id).slice(0, 200) : '';
  if (key && cache) {
    try { if (cache.get(key)) return { ok: true, n: 0, duplicate: true }; } catch (err) { Logger.log('cache get: ' + err); }
  }

  var received = new Date().toISOString();
  rows = rows.map(function (r) { r.received_at = received; return r; });
  writeRows_(body.sheet, rows);
  if (key && cache) {
    try { cache.put(key, '1', BATCH_TTL_S); } catch (err) { Logger.log('cache put: ' + err); }
  }

  // Keep the dashboard current for participants who never reach the end.
  if (body.sheet === 'summary') maybeRefreshDashboard_(cache);
  return { ok: true, n: rows.length };
}

function writeRows_(name, rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var header = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
    : [];
  var added = false;
  rows.forEach(function (r) {
    Object.keys(r).forEach(function (k) {
      if (header.indexOf(k) < 0) { header.push(k); added = true; }
    });
  });
  if (added) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var values = rows.map(function (r) {
    return header.map(function (k) { return cell_(r[k], k); });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, header.length).setValues(values);
}

// ID columns are always written with a leading ' so Sheets keeps them as text
// (the ' is hidden and not returned when the sheet is read). Without it, a
// Prolific ID like 5e0000000000000000000012 would become 5000000000000, and
// other IDs could turn into dates or numbers. Repeat-attempt IDs such as
// 5f01…345(2) stay exactly as sent. Other strings that look like formulas
// get the same prefix so they stay text.
var ID_KEYS = { participant_id: 1, prolific_pid: 1, prolific_study_id: 1, prolific_session_id: 1, page_load_id: 1 };
function cell_(v, key) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (ID_KEYS[key] && String(v).trim() !== '') return "'" + String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

// ── Completion log ──────────────────────────────────────────────────────
// One row per participant who reached the end and uploaded everything.
function markComplete_(pid) {
  pid = String(pid === null || pid === undefined ? '' : pid).slice(0, MAX_ID_LEN);
  if (!pid) return { ok: false, error: 'missing participant_id' };
  var already = readTab_('completions').some(function (r) { return String(r.participant_id) === pid; });
  if (!already) writeRows_('completions', [{ participant_id: pid, completed_at: new Date().toISOString() }]);
  try { updateDashboard_(); } catch (err) { Logger.log('dashboard: ' + err); }
  return { ok: true, logged: already ? 0 : 1 };
}

// ── Live dashboard ──────────────────────────────────────────────────────
// Built from the "summary", "sessions", "demographics" and "completions"
// tabs. Pilot sessions (quick_mode = 1) and IDs starting with "test" are left out.

var VAS_TIMEPOINTS = ['baseline', 'pre_mist', 'post_mist', 'post_recovery'];
var VAS_CONTRASTS = [
  ['stressor', 'pre_mist', 'post_mist'],
  ['recovery', 'post_mist', 'post_recovery'],
  ['net', 'baseline', 'post_recovery'],
  ['first Stroop', 'baseline', 'pre_mist']
];
var PHASES = ['baseline', 'post_stress', 'post_recovery'];
var PHASE_CONTRASTS = [
  ['stress', 'baseline', 'post_stress'],
  ['recovery', 'post_stress', 'post_recovery'],
  ['net', 'baseline', 'post_recovery']
];
var STROOP_METRICS = [
  'mean_rt', 'accuracy_all', 'stroop_interference_rt',
  'emotional_interference_neg_neu', 'emotional_interference_pos_neu'
];
var STATUS_ORDER = ['complete', 'quit', 'in_progress', 'abandoned'];
var T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145,
  2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

function refreshDashboard() { withLock_(updateDashboard_); }

// Rebuild unless the dashboard was rebuilt in the last DASHBOARD_MIN_GAP_S.
function maybeRefreshDashboard_(cache) {
  try {
    if (cache && cache.get('dashboard_recent')) return;
    updateDashboard_();
  } catch (err) { Logger.log('dashboard: ' + err); }
}

function readTab_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  return v.slice(1).map(function (row) {
    var o = {};
    h.forEach(function (k, i) { o[k] = row[i]; });
    return o;
  });
}

function num_(x) {
  return x === '' || x === null || x === undefined || typeof x === 'boolean' || isNaN(Number(x)) ? null : Number(x);
}
function round_(x, d) { var f = Math.pow(10, d); return x === null || x === undefined || isNaN(x) ? '' : Math.round(x * f) / f; }
function r3_(x) { return round_(x, 3); }
function r1_(x) { return round_(x, 1); }

// Milliseconds since 1970 for an ISO string, or a Date (Sheets may turn
// timestamps into dates); null when missing or unreadable.
function time_(v) {
  if (v === null || v === undefined || v === '') return null;
  var t = Object.prototype.toString.call(v) === '[object Date]' ? v.getTime() : Date.parse(String(v));
  return isNaN(t) ? null : t;
}
function fmtTime_(t) { return t === null || t === undefined ? '' : new Date(t).toISOString().slice(0, 16).replace('T', ' '); }
// A dashboard cell that must stay text (participant IDs).
function text_(v) { v = v === null || v === undefined ? '' : String(v); return v === '' ? '' : "'" + v; }
// "5f01…345(2)" → "5f01…345": repeat attempts share the Prolific ID.
function baseId_(pid) { return String(pid).replace(/\(\d+\)$/, ''); }
function isRepeatId_(pid) { return /\(\d+\)$/.test(String(pid)); }

// Two-sided 95% critical t; beyond df = 30 a close approximation (error < 0.002).
function tcrit_(df) { return df <= 30 ? T975[df - 1] : 1.96 + 2.5 / df; }

// Paired change post − pre over participants who have both values.
function changeStats_(rows, pre, post) {
  var ch = [];
  rows.forEach(function (r) { var a = num_(r[pre]), b = num_(r[post]); if (a !== null && b !== null) ch.push({ a: a, b: b, d: b - a }); });
  var n = ch.length;
  if (!n) return null;
  var mean = function (k) { return ch.reduce(function (s, x) { return s + x[k]; }, 0) / n; };
  var md = mean('d');
  var sd = n > 1 ? Math.sqrt(ch.reduce(function (s, x) { return s + Math.pow(x.d - md, 2); }, 0) / (n - 1)) : null;
  var t = n > 1 ? tcrit_(n - 1) : null;
  var se = sd !== null ? sd / Math.sqrt(n) : null;
  return {
    n: n, pre: mean('a'), post: mean('b'), change: md, sd: sd,
    dz: sd ? md / sd : null,
    lo: se !== null ? md - t * se : null, hi: se !== null ? md + t * se : null,
    up: ch.filter(function (x) { return x.d > 0; }).length,
    down: ch.filter(function (x) { return x.d < 0; }).length
  };
}

// n, mean, SD, min, max and count above zero of one column.
function describe_(rows, col) {
  var v = [];
  rows.forEach(function (r) { var x = typeof col === 'function' ? col(r) : num_(r[col]); if (x !== null) v.push(x); });
  var n = v.length;
  if (!n) return { n: 0, mean: null, sd: null, min: null, max: null, pos: 0 };
  var m = v.reduce(function (s, x) { return s + x; }, 0) / n;
  return {
    n: n, mean: m,
    sd: n > 1 ? Math.sqrt(v.reduce(function (s, x) { return s + Math.pow(x - m, 2); }, 0) / (n - 1)) : null,
    min: Math.min.apply(null, v), max: Math.max.apply(null, v),
    pos: v.filter(function (x) { return x > 0; }).length
  };
}

function median_(v) {
  if (!v.length) return null;
  var s = v.slice().sort(function (a, b) { return a - b; }), h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

// post − pre for one participant ('' when either is missing).
function delta_(r, pre, post) {
  var a = num_(r[pre]), b = num_(r[post]);
  return a === null || b === null ? '' : b - a;
}

// Does summary row key a beat key b? A complete row beats any other row;
// then the later saved_at; then the later row in the sheet.
function newerSummary_(a, b) {
  if (a.done !== b.done) return a.done > b.done;
  if (a.t !== null && b.t !== null && a.t !== b.t) return a.t > b.t;
  return a.i > b.i;
}

/*
 * One record per participant_id that sent anything (demographics, sessions or
 * summary rows), with its current status:
 *   complete     newest summary row has status "complete"
 *   quit         page closed early (summary or sessions row with status "quit")
 *   in_progress  still going: new data in the last ABANDONED_AFTER_MIN minutes
 *   abandoned    no new data for longer than that and no quit signal arrived
 */
function participants_(tabs, keep, nowMs) {
  var P = {}, order = [];
  var get = function (pid) {
    if (!P[pid]) {
      P[pid] = { pid: pid, first: null, lastRecv: null, loads: {}, best: null, bestKey: null, bestStatus: '',
                 started: false, completed: null, quit: null, quitT: null, prolific_pid: '', attempt: null };
      order.push(pid);
    }
    return P[pid];
  };
  var touch = function (p, r) {
    var t = time_(r.received_at);
    if (t !== null) {
      if (p.first === null || t < p.first) p.first = t;
      if (p.lastRecv === null || t > p.lastRecv) p.lastRecv = t;
    }
    if (r.page_load_id !== undefined && r.page_load_id !== '') p.loads[String(r.page_load_id)] = 1;
    if (r.prolific_pid) p.prolific_pid = String(r.prolific_pid);
    if (num_(r.attempt) !== null) p.attempt = num_(r.attempt);
  };
  var each = function (rows, fn) {
    rows.forEach(function (r, i) {
      var pid = String(r.participant_id === undefined ? '' : r.participant_id);
      if (!keep(pid)) return;
      var p = get(pid);
      touch(p, r);
      if (fn) fn(p, r, i);
    });
  };

  each(tabs.demographics);
  each(tabs.sessions, function (p, r) {
    var st = String(r.status || '');
    if (st === 'started') p.started = true;
    if (st === 'completed') p.completed = r;
    if (st === 'quit') {
      var qt = time_(r.quit_time) !== null ? time_(r.quit_time) : time_(r.received_at);
      if (!p.quit || qt === null || p.quitT === null || qt >= p.quitT) { p.quit = r; p.quitT = qt; }
    }
  });
  each(tabs.summary, function (p, r, i) {
    var st = String(r.status || '') || 'complete';   // v1.0 rows had no status: saved only at the end
    var k = { done: st === 'complete' ? 1 : 0, t: time_(r.saved_at), i: i };
    if (!p.best || newerSummary_(k, p.bestKey)) { p.best = r; p.bestKey = k; p.bestStatus = st; }
  });

  var recs = order.map(function (pid) {
    var p = P[pid], s = p.best;
    var status = s ? p.bestStatus : (p.quit ? 'quit' : 'in_progress');
    var lastStep = s ? String(s.last_step || '') : '';
    // A sessions "quit" row newer than the newest summary row (the summary
    // quit row may not have arrived) also means quit.
    if (status === 'in_progress' && p.quit &&
        (!s || p.bestKey.t === null || p.quitT === null || p.quitT >= p.bestKey.t)) {
      status = 'quit';
      if (p.quit.last_step) lastStep = String(p.quit.last_step);
    }
    if (status === 'quit' && !lastStep && p.quit) lastStep = String(p.quit.last_step || '');
    if (status === 'in_progress') {
      var ref = p.lastRecv !== null ? p.lastRecv : (s ? p.bestKey.t : null);
      if (ref !== null && (nowMs - ref) / 60000 > ABANDONED_AFTER_MIN) status = 'abandoned';
    }
    var minutes = s ? num_(s.minutes_since_start) : null;
    var dur = status === 'complete' && p.completed && num_(p.completed.duration_min) !== null ? num_(p.completed.duration_min)
      : status === 'quit' && p.quit && num_(p.quit.duration_min) !== null ? num_(p.quit.duration_min)
      : minutes;
    var attempt = p.attempt !== null ? p.attempt : (isRepeatId_(pid) ? Number(/\((\d+)\)$/.exec(pid)[1]) : 1);
    return {
      pid: pid, base: baseId_(pid), attempt: attempt, status: status, lastStep: lastStep, s: s,
      savedT: s ? p.bestKey.t : null, lastRecv: p.lastRecv, first: p.first, dur: dur,
      loads: Object.keys(p.loads).length, prolific_pid: p.prolific_pid, started: p.started,
      end: status === 'complete' ? p.completed : p.quit, inStats: false, statsNote: ''
    };
  });
  recs.sort(function (a, b) {
    if (a.first !== null && b.first !== null && a.first !== b.first) return a.first - b.first;
    return 0;
  });
  return recs;
}

// Participants whose summary the statistics use: status in STATS_STATUSES,
// one per Prolific ID (complete before partial, then the earliest attempt),
// so someone who did the study twice is not counted twice.
function chooseStats_(recs) {
  var byBase = {};
  var better = function (a, b) {
    var ca = a.status === 'complete' ? 1 : 0, cb = b.status === 'complete' ? 1 : 0;
    if (ca !== cb) return ca > cb;
    if (a.attempt !== b.attempt) return a.attempt < b.attempt;
    return (a.first || 0) < (b.first || 0);
  };
  recs.forEach(function (p) {
    if (!p.s || STATS_STATUSES.indexOf(p.status) < 0) return;
    if (!byBase[p.base] || better(p, byBase[p.base])) byBase[p.base] = p;
  });
  recs.forEach(function (p) {
    if (!p.s || STATS_STATUSES.indexOf(p.status) < 0) return;
    p.inStats = byBase[p.base] === p;
    if (!p.inStats) p.statsNote = 'repeat: ' + byBase[p.base].pid + ' used';
  });
  return recs.filter(function (p) { return p.inStats; });
}

function updateDashboard_() {
  var nowMs = Date.now();
  var isTestId = function (pid) { return /^test/i.test(pid); };
  var sessionsAll = readTab_('sessions');
  var summaryAll = readTab_('summary');

  // Pilot runs: quick_mode = 1 on any sessions or summary row.
  var pilot = {};
  sessionsAll.concat(summaryAll).forEach(function (r) {
    if (Number(r.quick_mode) === 1) pilot[String(r.participant_id)] = true;
  });
  var keep = function (pid) { pid = String(pid); return pid !== '' && !pilot[pid] && !isTestId(pid); };

  var recs = participants_({ sessions: sessionsAll, summary: summaryAll, demographics: readTab_('demographics') }, keep, nowMs);
  var stats = chooseStats_(recs);
  var rows = stats.map(function (p) { return p.s; });
  var recOf = {};
  recs.forEach(function (p) { recOf[p.pid] = p; });
  var rec = function (r) { return recOf[String(r.participant_id)]; };

  var count = function (st) { return recs.filter(function (p) { return p.status === st; }).length; };
  var repeats = recs.filter(function (p) { return isRepeatId_(p.pid); });
  var repeatBases = {};
  repeats.forEach(function (p) { repeatBases[p.base] = 1; });
  var nTasks = recs.filter(function (p) { return p.started; }).length;
  var completedLog = {};
  readTab_('completions').forEach(function (r) { if (keep(r.participant_id)) completedLog[String(r.participant_id)] = true; });
  var durs = recs.filter(function (p) { return p.status === 'complete' && p.dur !== null; }).map(function (p) { return p.dur; });
  var stopped = {};
  recs.forEach(function (p) {
    if (p.status !== 'quit' && p.status !== 'abandoned') return;
    var k = p.lastStep || 'before first section';
    stopped[k] = (stopped[k] || 0) + 1;
  });

  var out = [], bold = [];
  var add = function (r, isTitle) { if (isTitle) bold.push(out.length + 1); out.push(r); };
  var statCells = function (s) {
    return [s.n, r3_(s.pre), r3_(s.post), r3_(s.change), r3_(s.sd), r3_(s.dz), r3_(s.lo), r3_(s.hi), s.up, s.down];
  };

  add(['LIVE RESULTS — updated ' + fmtTime_(nowMs) + ' UTC'], true);
  add(['Participants: ' + recs.length + ' consented (any data received)   ·   ' + nTasks + ' started the tasks (sessions "started" row)   ·   ' +
       'complete: ' + count('complete') + '   ·   quit: ' + count('quit') + '   ·   in progress: ' + count('in_progress') +
       '   ·   abandoned (no data for > ' + ABANDONED_AFTER_MIN + ' min, no quit signal): ' + count('abandoned') +
       '   ·   repeat attempts: ' + repeats.length + ' (IDs ending in "(2)", "(3)"…, from ' + Object.keys(repeatBases).length + ' Prolific IDs)']);
  add(['Server completion log: ' + Object.keys(completedLog).length +
       '   ·   median duration of complete sessions: ' + (durs.length ? r1_(median_(durs)) + ' min' : '—') +
       '   ·   pilot (quick mode) and test IDs excluded.']);
  add(['Where people stopped (quit or abandoned; last section finished): ' +
       (Object.keys(stopped).length ? Object.keys(stopped).map(function (k) { return k + ' ' + stopped[k]; }).join('   ·   ') : '—')]);
  add(['Sections 1–4 use ' + STATS_STATUSES.join(' / ') + ' participants only (n = ' + rows.length +
       '; one attempt per Prolific ID). Section 5 lists everyone. ' +
       'n < 10: read the "n up / n down" counts and the participant rows, not the CIs. analysis/analyze.py does the full analysis.']);
  add(['']);

  // 1. VAS
  add(['1. Self-reported stress.  VAS composite = mean(stressed, tense, 100 − calm), 0–100; higher = more stressed'], true);
  add(['timepoint', 'n', 'composite mean', 'composite SD', 'stressed', 'tense', 'calm'], true);
  VAS_TIMEPOINTS.forEach(function (tp) {
    var c = describe_(rows, 'vas_' + tp + '_composite');
    add([tp, c.n, r1_(c.mean), r1_(c.sd),
         r1_(describe_(rows, 'vas_' + tp + '_stressed').mean),
         r1_(describe_(rows, 'vas_' + tp + '_tense').mean),
         r1_(describe_(rows, 'vas_' + tp + '_calm').mean)]);
  });
  add(['']);
  add(['change in composite', 'from → to', 'n', 'from', 'to', 'mean change', 'SD change', 'dz', '95% CI low', '95% CI high', 'n up', 'n down'], true);
  VAS_CONTRASTS.forEach(function (c) {
    var s = changeStats_(rows, 'vas_' + c[1] + '_composite', 'vas_' + c[2] + '_composite');
    add([c[0], c[1] + ' → ' + c[2]].concat(s ? statCells(s) : [0]));
  });
  add(['Expected: stressor > 0 (MIST raised stress), recovery < 0 (stress fell after the images). ' +
       '"first Stroop" checks whether the first Stroop block itself changed stress.']);
  var img = describe_(rows, 'vas_image_feeling');
  var nImg = function (f) { return rows.filter(function (r) { var x = num_(r.vas_image_feeling); return x !== null && f(x); }).length; };
  add(['']);
  add(['"How did the images make you feel?"  0 = positive, 50 = neutral, 100 = negative', 'n', 'mean', 'SD', 'n < 50 (positive)', 'n = 50', 'n > 50 (negative)'], true);
  add(['image_feeling', img.n, r1_(img.mean), r1_(img.sd),
       nImg(function (x) { return x < 50; }), nImg(function (x) { return x === 50; }), nImg(function (x) { return x > 50; })]);
  add(['']);

  // 2. Stroop
  add(['2. Stroop by phase  (RT in s, correct trials ≥ 0.2 s; accuracy_all = correct ÷ all trials; interference = RT difference)'], true);
  add(['metric', 'n (all 3 phases)', 'baseline', 'post_stress', 'post_recovery'], true);
  STROOP_METRICS.forEach(function (m) {
    var all3 = rows.filter(function (r) {
      return PHASES.every(function (p) { return num_(r[p + '_' + m]) !== null; });
    });
    add([m, all3.length].concat(PHASES.map(function (p) { return r3_(describe_(all3, p + '_' + m).mean); })));
  });
  add(['']);
  add(['metric', 'change', 'n', 'from', 'to', 'mean change', 'SD change', 'dz', '95% CI low', '95% CI high', 'n up', 'n down'], true);
  STROOP_METRICS.forEach(function (m) {
    PHASE_CONTRASTS.forEach(function (c) {
      var s = changeStats_(rows, c[1] + '_' + m, c[2] + '_' + m);
      add([m, c[0] + ' (' + c[1] + ' → ' + c[2] + ')'].concat(s ? statCells(s) : [0]));
    });
  });
  add(['stroop_interference_rt = incongruent − congruent; emotional_interference = negative (or positive) − neutral. ' +
       '|dz|: 0.2 small, 0.5 medium, 0.8 large.']);
  add(['']);

  // 3. Image block
  var measureRows = function (list) {
    add(['measure', 'n', 'mean', 'SD', 'min', 'max', 'n participants > 0'], true);
    list.forEach(function (q) {
      var d = describe_(rows, q[1]);
      add([q[0], d.n, r3_(d.mean), r3_(d.sd), r3_(d.min), r3_(d.max), d.pos]);
    });
  };
  add(['3. Image block'], true);
  measureRows([
    ['images planned', 'images_n_planned'],
    ['images shown', 'images_n_shown'],
    ['images skipped (page hidden for the whole slot)', 'images_n_skipped_hidden'],
    ['images replaced (failed loads)', 'images_n_replaced'],
    ['images shown whole over a blurred fill (other shape than the screen)', 'images_n_contain_blur'],
    ['images filling the screen (same shape, small crop)', 'images_n_cover'],
    ['mean image duration (ms)', 'images_mean_duration_ms'],
    ['max |onset error| (ms)', 'images_max_abs_onset_error_ms'],
    ['image block length (s)', 'images_total_s'],
    ['images with focus lost', 'images_n_focus_lost']
  ]);
  var tiers = {};
  rows.forEach(function (r) {
    var t = r.images_tier === '' || r.images_tier === undefined || r.images_tier === null ? 'unknown' : String(r.images_tier);
    tiers[t] = (tiers[t] || 0) + 1;
  });
  add(['image size tier (folder images/<tier>; chosen by screen size)', 'n participants'], true);
  Object.keys(tiers).sort().forEach(function (t) { add([t, tiers[t]]); });
  add(['Target: 120 images × 2500 ms = 300 s. Onset error near 0 means the display kept time. ' +
       'A skipped image was not drawn because the tab was hidden for its whole 2.5 s slot (the tab switch is logged).']);
  add(['']);

  // 4. MIST and data quality
  var phaseSum = function (suffix) {
    return function (r) {
      var v = PHASES.map(function (p) { return num_(r[p + suffix]); }).filter(function (x) { return x !== null; });
      return v.length ? v.reduce(function (s, x) { return s + x; }, 0) : null;
    };
  };
  var endCount = function (col) {
    return function (r) { var p = rec(r); return p && p.end ? num_(p.end[col]) : null; };
  };
  add(['4. MIST and data quality'], true);
  measureRows([
    ['MIST accuracy', 'mist_accuracy'],
    ['MIST trials', 'mist_n_trials'],
    ['MIST timeouts', 'mist_n_timeouts'],
    ['MIST final time limit (s; 2.5–7)', 'mist_final_time_limit'],
    ['Stroop trials with focus lost (3 phases)', phaseSum('_n_focus_lost')],
    ['Stroop late onsets (3 phases)', phaseSum('_n_late_onset')],
    ['tab switches (page hidden), whole session', endCount('tab_hidden_count')],
    ['window focus lost, whole session', endCount('window_blur_count')],
    ['full-screen exits, whole session', endCount('fullscreen_exit_count')],
    ['session duration (min)', function (r) { var p = rec(r); return p ? p.dur : null; }]
  ]);
  add(['']);

  // 5. Participants (everyone)
  add(['5. Participants (everyone; newest summary row per ID)'], true);
  add(['participant_id', 'prolific_pid', 'attempt', 'status', 'last step', 'minutes', 'last saved (UTC)', 'page loads', 'in stats',
       'VAS baseline', 'VAS pre_mist', 'VAS post_mist', 'VAS post_recovery', 'image_feeling',
       'Δ mean_rt stress', 'Δ mean_rt recovery', 'Δ accuracy_all stress', 'Δ accuracy_all recovery',
       'Δ Stroop interference stress', 'Δ Stroop interference recovery',
       'Δ emo neg−neu stress', 'Δ emo neg−neu recovery',
       'MIST accuracy', 'images shown / skipped', 'tab switches', 'focus lost (base/stress/recov/images)'], true);
  recs.forEach(function (p) {
    var r = p.s || {};
    var d = function (m, c) { return r3_(num_(delta_(r, c[1] + '_' + m, c[2] + '_' + m))); };
    var fl = p.s ? PHASES.map(function (ph) { return r[ph + '_n_focus_lost']; }).concat([r.images_n_focus_lost])
      .map(function (x) { return num_(x) === null ? '–' : num_(x); }).join(' / ') : '';
    var imgs = p.s && num_(r.images_n_planned) ? num_(r.images_n_shown) + ' / ' + (num_(r.images_n_skipped_hidden) || 0) : '';
    add([text_(p.pid), text_(p.prolific_pid), p.attempt, p.status, p.lastStep, r1_(p.dur),
         fmtTime_(p.savedT !== null ? p.savedT : p.lastRecv), p.loads,
         p.inStats ? 'yes' : (p.statsNote || 'no'),
         r1_(num_(r.vas_baseline_composite)), r1_(num_(r.vas_pre_mist_composite)),
         r1_(num_(r.vas_post_mist_composite)), r1_(num_(r.vas_post_recovery_composite)), r1_(num_(r.vas_image_feeling)),
         d('mean_rt', PHASE_CONTRASTS[0]), d('mean_rt', PHASE_CONTRASTS[1]),
         d('accuracy_all', PHASE_CONTRASTS[0]), d('accuracy_all', PHASE_CONTRASTS[1]),
         d('stroop_interference_rt', PHASE_CONTRASTS[0]), d('stroop_interference_rt', PHASE_CONTRASTS[1]),
         d('emotional_interference_neg_neu', PHASE_CONTRASTS[0]), d('emotional_interference_neg_neu', PHASE_CONTRASTS[1]),
         r3_(num_(r.mist_accuracy)), imgs, p.end ? r1_(num_(p.end.tab_hidden_count)) : '', fl]);
  });
  add(['Δ stress = post_stress − baseline; Δ recovery = post_recovery − post_stress. ' +
       'status: complete / quit (page closed early) / in_progress / abandoned. "page loads" > 1: the same ID was opened in another browser. ' +
       'minutes: whole session (complete), until quitting (quit), or until the last save.']);

  var width = out.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  out = out.map(function (r) { while (r.length < width) r.push(''); return r.map(function (v) { return cell_(v); }); });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('dashboard') || ss.insertSheet('dashboard', 0);
  sh.clear();
  sh.getRange(1, 1, out.length, width).setValues(out);
  bold.forEach(function (i) { sh.getRange(i, 1, 1, width).setFontWeight('bold'); });
  var cache = cache_();
  if (cache) { try { cache.put('dashboard_recent', '1', DASHBOARD_MIN_GAP_S); } catch (err) { Logger.log('cache put: ' + err); } }
  var byStatus = {};
  STATUS_ORDER.forEach(function (st) { byStatus[st] = count(st); });
  return { ok: true, participants: recs.length, analysed: rows.length, status: byStatus };
}

// ── Export for analysis/analyze.py (key-protected) ─────────────────────
function export_(key, withEvents) {
  var stored = PropertiesService.getScriptProperties().getProperty('EXPORT_KEY');
  if (!stored || key !== stored) return { ok: false, error: 'bad key' };
  var data = {};
  SHEETS.concat(SERVER_SHEETS).forEach(function (name) {
    if (name === 'events' && !withEvents) return;
    data[name] = readTab_(name);
  });
  return { ok: true, exported_at: new Date().toISOString(), sheets: data };
}

/** Run once (or Study → Create / show export key). Keep the key private. */
function createExportKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('EXPORT_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('EXPORT_KEY', key);
  }
  var msg = 'Export key: ' + key + '\n\nUse with analysis/analyze.py:\n  python analyze.py --url <web app URL> --key ' + key;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return key;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function cache_() {
  try { return CacheService.getScriptCache(); } catch (err) { Logger.log('cache: ' + err); return null; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to check the sheet is writable. */
function testSetup() {
  writeRows_('sessions', [{ participant_id: 'TEST', status: 'setup_test', start_time: new Date().toISOString() }]);
  Logger.log('OK — a TEST row was written to the "sessions" tab. Delete it before collecting data.');
}
