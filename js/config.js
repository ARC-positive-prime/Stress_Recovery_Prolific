/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  STUDY SETTINGS: edit this file (and js/texts.js for wording) for normal use.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Where is what?
 *    js/config.js   ← THIS FILE: upload address, Prolific code, the order of
 *                     the experiment (FLOW), trial counts, timings, keys,
 *                     image conditions.
 *    js/texts.js    ← every sentence participants read (instructions,
 *                     information sheet, debrief).
 *    debug.html     ← open this to test any single part of the experiment.
 *    images/<condition>/  + tools/build_image_manifest.bat ← image sets.
 *
 *  Timings are in milliseconds unless a comment says otherwise.
 *  Search this file for "EDIT ME" to find what must be set before going live.
 */
window.CONFIG = {
  STUDY_TITLE: "Stress, Attention and Images Study",
  APP_VERSION: "2.0.0",

  // ── Where the data go ──────────────────────────────────────────────────
  // Each participant's data is ONE JSON file (see docs/DATA_FORMAT.md),
  // uploaded to a Microsoft receiver (receivers/README.md):
  //   Power Automate "When an HTTP request is received" URL → OneDrive / SharePoint
  //   or an Azure Function URL → Blob Storage
  //   or http://localhost:8787/upload while piloting (node receivers/local_test_server.js).
  // Leave "" to run without uploading: the last screen then offers the file
  // as a download (handy for piloting).
  DATA: {
    UPLOAD_URL: "",                  // ← EDIT ME before going live
    UPLOAD_PROGRESS: true,           // also save a snapshot after every step (keeps data of drop-outs)
    UPLOAD_TIMEOUT_MS: 30000,        // one upload attempt
    FINAL_UPLOAD_DEADLINE_MS: 120000, // max time on the "Saving…" screen at the end (slow connections)
  },

  // Shown in the information sheet and when an upload fails.
  RESEARCHER_CONTACT: "EDIT ME — Your Name (you@university.edu)",

  // ── Prolific ──────────────────────────────────────────────────────────
  // Study URL on Prolific:
  //   https://<you>.github.io/<repo>/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
  PROLIFIC: {
    COMPLETION_CODE: "EDIT_ME",     // ← EDIT ME (from Prolific "Completion paths")
    COMPLETION_URL: "https://app.prolific.com/submissions/complete?cc=",
    AUTO_REDIRECT_SEC: 0,           // 0 = participant clicks "Return to Prolific"
  },

  // Smaller screens (phones, tablets) are turned away.
  MIN_SCREEN_WIDTH: 900,
  MIN_SCREEN_HEIGHT: 500,

  // ── ORDER OF THE EXPERIMENT ───────────────────────────────────────────
  // Each entry is one step. Re-order or remove steps here. Each step id may
  // appear only once: to run a task again, give it a new name (e.g.
  // "stroop:follow_up", "vas:follow_up") and add that new phase / timepoint
  // name to PHASES / VAS_TIMEPOINTS in js/summary.js and analysis/analyze.py.
  //   consent, demographics, setup   forms (always keep consent first)
  //   intro                          "before you start" screen (average-performance rule)
  //   stroop:<phase>                 colour–word task; the FIRST Stroop step run
  //                                  includes the instructions + practice
  //   vas:<timepoint>                "how do you feel" ratings; the image question
  //                                  is added at the timepoints in VAS.IMAGE_QUESTION_AT
  //   mist_baseline                  self-paced arithmetic practice → sets the MIST time limit
  //   mist                           MIST stressor (timed, performance bar, noise)
  //   images                         image intervention (the participant's condition)
  //   blank                          rest screen (REST below)
  //   feedback                       end questionnaire
  // To test parts on their own, open debug.html (no need to edit this list).
  FLOW: [
    "consent",
    "demographics",
    "setup",
    "intro",
    "stroop:baseline",
    "vas:pre_mist",
    "mist_baseline",
    "mist",
    "vas:post_mist",
    "stroop:post_stress",
    "vas:pre_images",
    "images",
    "blank",
    "vas:post_recovery",
    "stroop:post_recovery",
    "feedback",
  ],

  // ── Browser integrity (full screen, tab switches, focus) ──────────────
  // Everything is recorded whatever these say (see "integrity" in the data file).
  INTEGRITY: {
    // Between two trials of the Stroop and MIST, pause and ask the participant
    // to go back to full screen if they left it (the pause is recorded).
    REQUIRE_FULLSCREEN_BETWEEN_TRIALS: true,
  },

  // ── Stroop: traditional colour–word MATCH task, 2 keys ─────────────────
  // A colour word (RED, GREEN, BLUE, YELLOW) appears in a coloured ink.
  // Does the ink colour match the word?  match key = yes,  mismatch key = no.
  //   congruent   = RED in red     → correct answer "match"
  //   incongruent = RED in blue    → correct answer "mismatch"
  STROOP: {
    KEYS: { match: "left", mismatch: "right" },  // "left" / "right" = arrow keys
    COUNTERBALANCE_KEYS: false,  // true = half the participants get the keys swapped (random)
    N_PRACTICE_TRIALS: 12,       // with feedback, first Stroop run only (half congruent)
    N_CONGRUENT: 36,             // multiple of 4: each colour word equally often in its own ink
    N_INCONGRUENT: 36,           // multiple of 12: each word equally often in each of the 3 other inks
    FIXATION_DUR: 500,
    WORD_TIMEOUT: 2000,          // the word stays until a key press or this long
    FEEDBACK_DUR: 500,           // practice feedback / test post-response fixation
    ITI_DUR: 500,
    MAX_INK_RUN: 2,              // same ink at most 2 trials in a row
    MAX_TYPE_RUN: 3,             // same answer (match / mismatch) at most 3 in a row
  },

  // ── MIST baseline (calibration), the classic way ──────────────────────
  // Dedovic et al. (2005): a practice block WITHOUT time limit, performance
  // bar or noise. The participant's average time to solve a problem sets the
  // starting time limit of the MIST stressor: TIME_LIMIT_FACTOR × average
  // (0.9 = "10 % less than their average"), kept within MIST.MIN/MAX_TIME_LIMIT.
  MIST_BASELINE: {
    N_TRIALS: 15,
    MAX_TRIAL_S: 30,          // hidden safety cap per problem (someone who walks away); not shown
    SHOW_FEEDBACK: true,      // "Correct" / "Incorrect" after each answer
    STATISTIC: "mean",        // "mean" or "median" of the correct answers' times
    TIME_LIMIT_FACTOR: 0.9,
    MIN_CORRECT: 3,           // fewer correct answers → use MIST.TIME_LIMIT instead
  },

  // ── MIST stressor ─────────────────────────────────────────────────────
  MIST: {
    LEVEL: 4,                // 3, 4 or 5 (5 adds integer division); baseline uses the same level
    N_PRACTICE_TRIALS: 0,    // optional timed practice before the stressor (the baseline is the practice)
    N_EXP_TRIALS: 35,
    // Starting time limit if there is no baseline result (seconds).
    TIME_LIMIT: 5.0,
    MIN_TIME_LIMIT: 2.5,
    MAX_TIME_LIMIT: 7.0,
    // Adaptive: 3 correct in a row → 10 % less time; 3 wrong / too slow in a
    // row → 10 % more (the count restarts after every change).
    ADAPTIVE_WINDOW: 3,
    ADAPTIVE_STEP: 0.10,
    TARGET_ACCURACY: 0.85,   // "group average" marker on the performance bar
    FEEDBACK_DUR: 500,
    GAP_AFTER_FEEDBACK: 1500,
    WHITE_NOISE: true,
    WHITE_NOISE_VOLUME: 0.1, // 0–1
  },

  VAS: {
    IMAGE_QUESTION_AT: ["post_recovery"],  // timepoints that also ask "How did the images make you feel?"
  },

  // ── Image intervention: one condition per participant ─────────────────
  // Folder layout:  images/<folder>/  (flat), or images/<folder>/1280/ +
  // images/<folder>/1920/ (two sizes; the right one is picked per screen).
  // After adding/removing image files or folders, run
  //   tools/build_image_manifest.bat   (or: node tools/build_image_manifest.js)
  // which rewrites js/image_manifest.js (the list of files the browser uses).
  // To add a condition: put the images in images/<name>/, run the tool, add
  // an entry below and add its name to ASSIGN_FROM.
  IMAGES: {
    ROOT: "images/",
    CONDITIONS: {
      positive_prime: { label: "Positive Prime", folder: "positive_prime" },
      positive:       { label: "Positive",       folder: "positive" },
      negative:       { label: "Negative",       folder: "negative" },
      neutral:        { label: "Neutral",        folder: "neutral" },
    },
    // Each participant gets ONE of these at random (equal chances). A
    // participant who reopens the link in the same browser keeps theirs.
    // ?condition=<name> in the study URL forces one (e.g. a separate Prolific
    // study per condition, for exactly balanced groups).
    ASSIGN_FROM: ["positive_prime", "positive", "negative", "neutral"],

    N_IMAGES: 120,
    IMAGE_DURATION: 2500,      // 120 × 2.5 s = 5 min, no gap
    REPEAT_IF_FEWER: true,     // a set with fewer than N_IMAGES files is cycled (reshuffled) to fill
    // Preference for full-HD 16:9 pictures ("wide" + "hd" in the manifest):
    // they are used first; MIX_OTHER_FRACTION > 0 mixes in that share of the
    // other shapes. Sets without such pictures simply use the others.
    MIX_OTHER_FRACTION: 0,
    COVER_TOLERANCE: 0.12,     // image shape within 12 % of the screen's → fill the screen
    TIER: "auto",              // two-size sets: "auto" | "1280" | "1920"
    PRELOAD_TIMEOUT: 120000,   // max wait for the images before the block
    LOAD_RETRIES: 3,
  },

  // ── Rest after the images ─────────────────────────────────────────────
  REST: {
    DURATION: 60000,
    SHOW_FIXATION: false,      // false = plain blank screen, true = a "+" in the middle
  },
};

// ?quick=1 shortens every block for a fast run-through (flagged quick_mode=1).
// Ignored for real Prolific participants (a PROLIFIC_PID in the link) unless debug=1.
// ── EDIT HERE ── to change how short "quick" runs are.
(function applyQuickMode() {
  const p = new URLSearchParams(location.search);
  if (p.get("quick") !== "1") return;
  const pid = p.get("PROLIFIC_PID") || "";
  if (pid && !/[{%]/.test(pid) && p.get("debug") !== "1") return;
  const c = window.CONFIG;
  c.QUICK_MODE = true;
  c.STROOP.N_PRACTICE_TRIALS = 4;
  c.STROOP.N_CONGRUENT = 4;
  c.STROOP.N_INCONGRUENT = 12;
  c.MIST_BASELINE.N_TRIALS = 4;
  c.MIST_BASELINE.MIN_CORRECT = 2;
  c.MIST.N_EXP_TRIALS = 5;
  c.IMAGES.N_IMAGES = 6;
  c.REST.DURATION = 5000;
})();
