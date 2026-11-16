/*
 * Study configuration — edit this file, nothing else, for normal use.
 *
 * Timings are in milliseconds unless a comment says otherwise. Values mirror
 * the PsychoPy originals in stress-recovery-exp-with-stroop (stroop.py,
 * mist_l5.py, mist.py, vas.py, image_viewing.py) unless a comment says
 * otherwise.
 */
window.CONFIG = {
  STUDY_TITLE: "Stress, Attention and Images Study",

  // Google Apps Script web-app URL (ends in /exec). See README → "Data
  // collection setup". Leave "" to run without uploading (data can still be
  // downloaded as JSON on the last screen — useful for piloting).
  DATA_URL: "",

  // Shown to participants if their upload fails, so they can send the file.
  RESEARCHER_CONTACT: "Shreelekha Basavaraja Sangapur : UTS  at shreelekha.basavaraja@student.uts.edu.au",

  // ── Prolific ──────────────────────────────────────────────────────────
  // The study link on Prolific should be:
  //   https://<you>.github.io/<repo>/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
  // PROLIFIC_PID becomes the participant code. At the end, participants are
  // sent to Prolific with COMPLETION_CODE (copy it from your Prolific study's
  // "Completion paths" section).
  PROLIFIC: {
    COMPLETION_CODE: "C1DQL3O3",
    COMPLETION_URL: "https://app.prolific.com/submissions/complete?cc=C1DQL3O3",
    AUTO_REDIRECT_SEC: 0,   // 0 = participant clicks "Return to Prolific"; >0 = also redirect after this many seconds
  },

  // Minimum screen size; smaller screens (phones, tablets) are turned away.
  MIN_SCREEN_WIDTH: 900,
  MIN_SCREEN_HEIGHT: 500,

  // ── Emotional Stroop with colour words (4 keys) ───────────────────────
  // One test run = 12 congruent colour words (RED in red) + 12 incongruent
  // colour words (RED in blue) + 16 negative + 16 positive + 16 neutral
  // words = 72 trials. Measures: Stroop interference (incongruent −
  // congruent) and emotional interference (negative/positive − neutral).
  STROOP: {
    N_PRACTICE_TRIALS: 12,     // "XXXXX" strings before the first run only (multiple of 4)
    N_CONGRUENT: 12,           // multiple of 4: each colour word equally often in its own ink
    N_INCONGRUENT: 12,         // multiple of 12: each colour word equally often in each of the 3 other inks
    WORDS_PER_EMOTION: 16,     // per category (negative/positive/neutral); multiple of 4, ≤ 20
    FIXATION_DUR: 500,
    WORD_TIMEOUT: 2000,
    FEEDBACK_DUR: 500,         // practice feedback / test post-response fixation
    ITI_DUR: 500,
    MAX_INK_RUN: 2,            // same ink (= same correct key) at most 2 trials in a row
    MAX_TYPE_RUN: 3,           // same trial type at most 3 in a row
  },

  MIST: {
    // Online there is no session-1 staircase, so every participant gets the
    // same starting level and time limit (mist_l5.py standalone defaults).
    LEVEL: 4,                // 3, 4 or 5 (5 adds integer division)
    N_PRACTICE_TRIALS: 5,
    N_EXP_TRIALS: 35,
    // Adaptive time limit (experimental trials). It changes only after
    // ADAPTIVE_WINDOW answers IN A ROW of the same kind — 3 correct → 10 %
    // less time, 3 wrong/too slow → 10 % more — and the count starts again
    // after every change, so a 4th miss alone does not add more time.
    // Always kept between MIN_TIME_LIMIT and MAX_TIME_LIMIT.
    // (The lab code re-checked after every trial with no limits, so the
    // timer could climb to 10–20 s for someone who stopped answering.)
    TIME_LIMIT: 5.0,         // starting limit, seconds
    MIN_TIME_LIMIT: 2.5,
    MAX_TIME_LIMIT: 7.0,
    ADAPTIVE_WINDOW: 3,
    ADAPTIVE_STEP: 0.10,
    TARGET_ACCURACY: 0.85,   // "group average" marker on the performance bar
    // After each answer: CORRECT / INCORRECT / Too Slow! for FEEDBACK_DUR,
    // then a blank screen for GAP_AFTER_FEEDBACK, so the next problem appears
    // 2 s after the feedback. Fixed for every trial. (The lab's adaptive pause
    // was 0.5–3 s and longest after the fastest answers.)
    FEEDBACK_DUR: 500,
    GAP_AFTER_FEEDBACK: 1500,
    WHITE_NOISE: true,
    WHITE_NOISE_VOLUME: 0.1, // 0–1, same as the lab
  },

  // ── Image intervention (image_viewing.py) ─────────────────────────────
  // Each participant sees N_IMAGES images drawn at random, IMAGE_DURATION
  // each with no gap: 120 × 2.5 s = 5 min, as in the lab.
  //
  // Pool (js/image_list.js): by default only the full-HD widescreen (16:9)
  // Positive Prime images — 446 of the 920; the 4:3 / 3:2 ones are mostly
  // ~1000 px wide and look soft on a laptop. MIX_OTHER_FRACTION > 0 mixes in
  // that share of the other images (e.g. 0.2 → 24 of 120).
  //
  // Fit: an image whose shape is within COVER_TOLERANCE of the screen's
  // fills the screen (at most a thin strip trimmed: a 16:9 image on a 16:10
  // MacBook loses ~5 % at each side). Any other shape is shown whole, with
  // the empty side areas filled by a blurred copy of the same image — never
  // cropped, never grey bars.
  //
  // Resolution: TIER "auto" picks images/1920/ for screens of at least
  // 1600 × 900 physical pixels and images/1280/ for smaller ones.
  IMAGES: {
    DIR: "images/",
    N_IMAGES: 120,
    IMAGE_DURATION: 2500,
    MIX_OTHER_FRACTION: 0,
    COVER_TOLERANCE: 0.12,
    TIER: "auto",            // "auto" | "1280" | "1920"
    PRELOAD_TIMEOUT: 120000, // max wait for the images to finish loading before the block
    LOAD_RETRIES: 3,         // retries of the same file (with back-off) before using a spare
  },

  // Fixation cross after the images, before the post-recovery VAS.
  REST_DURATION: 60000,
};

// ?quick=1 shortens every block for a fast run-through while piloting. The
// session is flagged quick_mode=1 in the data so it is easy to exclude.
(function applyQuickMode() {
  const p = new URLSearchParams(location.search);
  if (p.get("quick") !== "1") return;
  const c = window.CONFIG;
  c.QUICK_MODE = true;
  c.STROOP.N_PRACTICE_TRIALS = 4;
  c.STROOP.N_CONGRUENT = 4;
  c.STROOP.N_INCONGRUENT = 12;
  c.STROOP.WORDS_PER_EMOTION = 4;
  c.MIST.N_PRACTICE_TRIALS = 2;
  c.MIST.N_EXP_TRIALS = 5;
  c.IMAGES.N_IMAGES = 6;
  c.REST_DURATION = 5000;
})();
