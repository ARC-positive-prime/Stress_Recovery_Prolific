/*
 * Emotional Stroop with colour words — 4 keys.
 * Based on stroop.py (stress-recovery-exp-with-stroop) with colour-word
 * trials added, so one run gives two effects:
 *
 *   Stroop interference    = RT incongruent − RT congruent   (RED in blue vs RED in red)
 *   Emotional interference = RT negative − RT neutral, RT positive − RT neutral
 *
 *   [Practice: "XXXXX" strings, first run only]  →  Test block (72 trials)
 *   Trial: blank ITI → fixation → word (until response / 2 s) →
 *          fixation (test) / white feedback (practice)
 *   Keys:  D = RED   F = GREEN   J = BLUE   K = YELLOW
 *
 * Test-run composition (CONFIG.STROOP):
 *   congruent    12  each colour word 3× in its own ink
 *   incongruent  12  each colour word once in each of the 3 other inks
 *   negative     16  4 per ink   ┐ drawn from 20-word lists (stroop.py),
 *   positive     16  4 per ink   │ a fresh random 16 and word→ink pairing
 *   neutral      16  4 per ink   ┘ every run
 * Every ink appears 18 times. Order constraints: same ink ≤ 2 in a row,
 * same trial type ≤ 3 in a row, never the same word twice in a row.
 *
 * Emotional/neutral word lists, ink colours, timings and lab trigger codes
 * are identical to stroop.py; 74/75 are new codes for colour-word trials.
 */
(function () {
  "use strict";
  const C = () => CONFIG.STROOP;
  const { el, stage, present, sleep, sec } = Core;

  const INK_RGB = {
    red: "rgb(165,0,0)",
    green: "rgb(0,230,0)",
    blue: "rgb(0,0,200)",
    yellow: "rgb(255,255,0)",
  };
  const INKS = Object.keys(INK_RGB);
  const KEY_FOR_INK = { red: "d", green: "f", blue: "j", yellow: "k" };
  const RESP_KEYS = Object.values(KEY_FOR_INK);
  const PRACTICE_STRING = "XXXXX";

  const TRIGGERS = {
    block_start: 13, practice_block_start: 14, fixation: 1,
    word_practice: 70, word_neutral: 71, word_negative: 72, word_positive: 73,
    word_congruent: 74, word_incongruent: 75,
    response_correct: 41, response_incorrect: 42, response_timeout: 43, block_end: 9,
  };

  const WORDS = {
    negative: [
      "panic", "failure", "worry", "afraid", "fear",
      "scared", "threat", "crisis", "shame", "stress",
      "trouble", "mistake", "tense", "chaos", "disaster",
      "anxiety", "struggle", "terror", "ruin", "dumb",
    ],
    positive: [
      "happy", "party", "cheer", "lucky", "surprise",
      "proud", "amazing", "music", "joke", "weekend",
      "genius", "freedom", "reward", "success", "victory",
      "prize", "award", "awesome", "magic", "travel",
    ],
    neutral: [
      "door", "table", "floor", "building", "glass",
      "bottle", "shirt", "coat", "wall", "street",
      "station", "bathroom", "corner", "bridge", "stairs",
      "closet", "shoulder", "basket", "drawer", "ceiling",
    ],
  };
  // Colour word for each ink (the word names the colour).
  const COLOUR_WORD = { red: "red", green: "green", blue: "blue", yellow: "yellow" };

  const REMINDER = "D = RED        F = GREEN        J = BLUE        K = YELLOW";

  const INSTRUCT_GENERAL = `COLOUR NAMING TEST

On each trial a word appears on screen, printed in one of four colours.

Press the key for the COLOUR OF THE LETTERS.
Ignore what the word says — even when the word is itself a colour name.

  D  =  RED
  F  =  GREEN
  J  =  BLUE
  K  =  YELLOW

Keep two fingers of each hand on D F and J K.
Respond as quickly and accurately as possible.

Press SPACE to continue.`;

  const INSTRUCT_PRACTICE = `PRACTICE

First, a short practice with rows of X's.

Press the key for the colour of the letters.

  D = RED     F = GREEN     J = BLUE     K = YELLOW

Press SPACE to begin practice.`;

  const INSTRUCT_TEST = `COLOUR NAMING TEST

Now real words will appear. Some of them are colour names.
Ignore the word — respond only to the COLOUR OF THE LETTERS.

For example, if you see  BLUE  printed in red letters, press D (red).

  D = RED     F = GREEN     J = BLUE     K = YELLOW

Press SPACE to begin.`;

  const INSTRUCT_RETURN = `COLOUR NAMING TEST — again

The same task as before.
Press the key for the COLOUR OF THE LETTERS and ignore the word,
even when the word is a colour name.

  D  =  RED
  F  =  GREEN
  J  =  BLUE
  K  =  YELLOW

Keep two fingers of each hand on D F and J K.
Respond as quickly and accurately as possible.

Press SPACE to begin.`;

  const INSTRUCT_END = `Task complete.  Thank you!

Press SPACE to continue.`;

  // ── Sequences (constrained shuffle, as stroop._constrained_order) ──────
  function runOk(seq, item, attr, maxRun) {
    if (maxRun == null || seq.length < maxRun) return true;
    return seq.slice(-maxRun).some((t) => t[attr] !== item[attr]);
  }

  function constrainedOrder(trials, maxInkRun, maxTypeRun, maxAttempts = 2000) {
    for (let a = 0; a < maxAttempts; a++) {
      const pool = Core.shuffle(trials.slice());
      const seq = [];
      while (pool.length) {
        const cands = pool.filter((t) =>
          runOk(seq, t, "ink", maxInkRun) &&
          runOk(seq, t, "trial_type", maxTypeRun) &&
          (t.word === PRACTICE_STRING || runOk(seq, t, "word", 1)));
        if (!cands.length) break;
        const pick = Core.choice(cands);
        pool.splice(pool.indexOf(pick), 1);
        seq.push(pick);
      }
      if (!pool.length) return seq;
    }
    throw new Error("Could not build a Stroop sequence satisfying the ordering constraints");
  }

  // trial_type: congruent | incongruent | negative | positive | neutral | practice
  // word_category: colour | negative | positive | neutral | practice
  // congruency: congruent | incongruent | "" (word is not a colour name)
  function makeTrial(word, wordCategory, trialType, ink) {
    return {
      word: word.toUpperCase(),
      word_category: wordCategory,
      trial_type: trialType,
      congruency: trialType === "congruent" || trialType === "incongruent" ? trialType : "",
      ink,
      correct_resp: KEY_FOR_INK[ink],
    };
  }

  // n copies of each ink, in order (red, green, blue, yellow, red, …).
  function inkCycle(n) {
    const out = [];
    while (out.length < n) out.push(...INKS);
    return out.slice(0, n);
  }

  function makeTestSequence() {
    const P = C();
    let trials = [];

    // Congruent: each colour word in its own ink, N_CONGRUENT / 4 times.
    for (let r = 0; r < Math.floor(P.N_CONGRUENT / INKS.length); r++)
      for (const ink of INKS) trials.push(makeTrial(COLOUR_WORD[ink], "colour", "congruent", ink));

    // Incongruent: each colour word in each other ink, N_INCONGRUENT / 12 times.
    const pairs = [];
    for (const wordInk of INKS) for (const ink of INKS) if (ink !== wordInk) pairs.push([wordInk, ink]);
    for (let r = 0; r < Math.floor(P.N_INCONGRUENT / pairs.length); r++)
      for (const [wordInk, ink] of pairs) trials.push(makeTrial(COLOUR_WORD[wordInk], "colour", "incongruent", ink));

    // Emotional / neutral words: a random subset per run, equal inks per category.
    const n = Math.min(P.WORDS_PER_EMOTION, 20);
    for (const [cat, words] of Object.entries(WORDS)) {
      const chosen = Core.shuffle(words.slice()).slice(0, n);
      const inks = Core.shuffle(inkCycle(n));
      chosen.forEach((w, i) => trials.push(makeTrial(w, cat, cat, inks[i])));
    }
    return constrainedOrder(trials, P.MAX_INK_RUN, P.MAX_TYPE_RUN);
  }

  function makePracticeSequence(n) {
    return constrainedOrder(inkCycle(n).map((ink) => makeTrial(PRACTICE_STRING, "practice", "practice", ink)), C().MAX_INK_RUN, null);
  }

  // ── Display ────────────────────────────────────────────────────────────
  function buildStims() {
    const s = stage();
    s.innerHTML = "";
    return {
      fixation: el("div", "stim fixation", "+", s),
      word: el("div", "stim stroop-word", "", s),
      feedback: el("div", "stim feedback-text", "", s),
      reminder: el("div", "stim reminder", REMINDER, s),
    };
  }
  function show(st, which) {
    for (const [k, node] of Object.entries(st)) node.style.visibility = which.includes(k) ? "visible" : "hidden";
  }

  // ── Trial / block ──────────────────────────────────────────────────────
  async function runTrial(st, trial) {
    const ev = (code, label) => Core.Events.log("Stroop_Markers", code, label);

    await present(() => show(st, []));                       // blank ITI
    await sleep(C().ITI_DUR);
    Core.Quality.resetTrial();

    await present(() => show(st, ["fixation", "reminder"])); // fixation
    ev(TRIGGERS.fixation, "fixation");
    await sleep(C().FIXATION_DUR);

    const onset = await present(() => {                      // word
      st.word.textContent = trial.word;
      st.word.style.color = INK_RGB[trial.ink];
      show(st, ["word", "reminder"]);
    });
    ev(TRIGGERS["word_" + trial.trial_type], "word_" + trial.trial_type);
    const frameMs = Core.lastFrameMs;

    const r = await Core.waitForKey(RESP_KEYS, { timeout: C().WORD_TIMEOUT, onset });
    if (r.timedOut) ev(TRIGGERS.response_timeout, "response_timeout");
    else if (r.key === trial.correct_resp) ev(TRIGGERS.response_correct, "response_correct");
    else ev(TRIGGERS.response_incorrect, "response_incorrect");
    return { ...r, onset, frameMs };
  }

  async function runBlock(st, trials, blockType, phase) {
    const isPractice = blockType === "practice";
    Core.Events.log("Stroop_Markers", isPractice ? TRIGGERS.practice_block_start : TRIGGERS.block_start,
      isPractice ? "practice_block_start" : "block_start");
    const rows = [];
    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      const r = await runTrial(st, t);
      const outcome = r.timedOut ? "missed" : r.key === t.correct_resp ? "correct" : "incorrect";

      if (isPractice) {
        await present(() => {
          st.feedback.textContent = r.timedOut ? "Too Slow" : outcome === "correct" ? "Correct" : "Incorrect";
          show(st, ["feedback"]);
        });
      } else {
        await present(() => show(st, ["fixation"]));
      }
      await sleep(C().FEEDBACK_DUR);

      const row = {
        participant_id: Core.Data.pid,
        session: Core.Data.session,
        phase,
        block_type: blockType,
        trial: i + 1,
        word: t.word,
        word_category: t.word_category,
        trial_type: t.trial_type,
        congruency: t.congruency,
        ink_color: t.ink,
        correct_response: t.correct_resp,
        participant_response: r.key || "",
        outcome,
        accuracy: r.timedOut ? "" : Number(outcome === "correct"),
        rt: r.timedOut ? "" : Math.round(r.rt * 10000) / 10000,
        timed_out: Number(r.timedOut),
        trial_onset_time: sec(r.onset),
        is_practice: Number(isPractice),
        onset_frame_ms: r.frameMs,
        focus_lost: Number(Core.Quality.trialFlags.focusLost),
        fullscreen: Number(Core.isFullscreen()),
      };
      rows.push(row);
      Core.Data.stream("stroop_trials", row);   // uploaded as it happens
    }
    Core.Events.log("Stroop_Markers", TRIGGERS.block_end, "block_end");
    return rows;
  }

  /*
   * Run one Stroop run. `firstRun` adds the general instructions + practice.
   * Returns all rows (practice + test).
   */
  async function run({ phase, firstRun }) {
    Core.phase = phase;
    let rows = [];
    if (firstRun) {
      await Core.instructions(INSTRUCT_GENERAL);
      if (C().N_PRACTICE_TRIALS > 0) {
        await Core.instructions(INSTRUCT_PRACTICE);
        Core.showStage();
        rows = rows.concat(await runBlock(buildStims(), makePracticeSequence(C().N_PRACTICE_TRIALS), "practice", phase));
      }
      await Core.instructions(INSTRUCT_TEST);
    } else {
      await Core.instructions(INSTRUCT_RETURN);
    }
    Core.showStage();
    rows = rows.concat(await runBlock(buildStims(), makeTestSequence(), "test", phase));
    await Core.instructions(INSTRUCT_END);
    return rows;
  }

  window.Stroop = { run, makeTestSequence, makePracticeSequence, WORDS, INKS, KEY_FOR_INK, TRIGGERS, COLOUR_WORD };
})();
