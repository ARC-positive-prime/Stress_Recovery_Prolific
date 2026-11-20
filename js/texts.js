/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERYTHING PARTICIPANTS READ: edit the wording here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Task screens are plain text: line breaks are kept exactly as typed.
 *  Words in {CURLY_BRACKETS} are filled in by the program. Keep them.
 *    {MATCH_KEY} / {MISMATCH_KEY}  the Stroop keys (set in CONFIG.STROOP.KEYS)
 *    {MIN} / {REST_MIN}            minutes (images / rest), from js/config.js
 *    {CONTACT}                     CONFIG.RESEARCHER_CONTACT
 *    {CONDITION_LABEL}             the participant's image condition (debrief)
 *    {CONDITION_LIST}              all conditions in CONFIG.IMAGES.ASSIGN_FROM, e.g.
 *                                  "Positive Prime, Positive, Negative or Neutral" (debrief)
 *
 *  Where each text appears (in the order of the experiment):
 *    INFO_HTML ............ first page (information + consent)          ← EDIT ME (ethics)
 *    TASK_INTRO ........... first task screen ("before you start": average-performance rule)
 *    STROOP.* ............. colour–word task (first run: GENERAL → PRACTICE → TEST_START;
 *                           later runs: RETURN)
 *    VAS_INTRO ............ before the first "how do you feel" rating
 *    MIST_BASELINE.* ...... arithmetic PRACTICE block (nothing at stake)
 *    MIST.* ............... arithmetic test (stressor: average rule, score scaled, reward)
 *    IMAGES.INTRO ......... before the images
 *    DEBRIEF_HTML ......... last page                                    ← EDIT ME (ethics)
 *  Demographic and feedback QUESTIONS are in js/forms.js.
 */
window.TEXTS = {

  // ── Information sheet + consent (first page; HTML) ── EDIT ME ─────────
  INFO_HTML: `
    <p>Thank you for your interest. This study looks at how a brief period of
    stress, and viewing a series of images afterwards, affect attention and
    how you feel.</p>
    <h3>What you will do (about 35–40 minutes)</h3>
    <ol>
      <li>A few questions about you (age, vision, sleep, medication, etc.).</li>
      <li>A short colour–word task where you press the left and right arrow keys
          (about 3 minutes). You will do this task three times.</li>
      <li>Quick ratings of how you feel right now. These are repeated a few times.</li>
      <li>A mental-arithmetic task: first a short practice at your own pace, then a
          timed test with background noise (about 8 minutes in total).
          The test is <strong>designed to be difficult</strong> and may feel stressful.</li>
      <li>About 5 minutes of looking at a series of pictures, then 1 minute of rest.</li>
      <li>A few feedback questions.</li>
    </ol>
    <p><strong>Please note:</strong> your performance on the tasks needs to be in the
    <strong>average range</strong> (or better) for your data to be selected for the results.
    Please stay focused throughout.</p>
    <h3>What you need</h3>
    <ul>
      <li>A <strong>laptop or desktop computer with a physical keyboard</strong> (phones and tablets will not work).</li>
      <li>A quiet place where you will not be interrupted for 40 minutes.</li>
      <li>Sound switched on at a comfortable level (headphones are best).</li>
      <li>Please close other tabs, silence your phone, and do not switch windows or tabs during the tasks.
          The study runs in full screen, and leaving full screen or switching tabs is recorded.</li>
    </ul>
    <h3>Your data</h3>
    <p>Your responses are stored under a random code, not your name. Taking part
    is voluntary, and you can stop at any time by closing this window.
    The data from an unfinished session may still be kept, unless you ask
    {CONTACT} to delete it (quote the code shown at the end or in the
    page corner).</p>`,

  // ── First task screen (step "intro"): the average-performance rule ────
  TASK_INTRO: `BEFORE YOU START

You will now do a series of short tasks.

IMPORTANT
To be selected for the results, your performance must be
in the AVERAGE range or better, compared with other participants.
Please stay focused and do your best on every task.

Stay in full screen, do not switch to other tabs or windows,
and keep your hands on the keyboard.

Press SPACE to continue.`,

  // ── VAS ("how do you feel"), shown before the first rating ────────────
  VAS_INTRO: `HOW DO YOU FEEL?

A few times during the study you will be asked how you feel right now.

Click anywhere on the line to give your answer
(you can click again or drag to change it), then click Confirm.

Press SPACE to continue.`,

  // ── Stroop: colour–word match task (2 keys) ───────────────────────────
  STROOP: {
    // How the keys are named on screen.
    KEY_LABELS: { left: "← LEFT arrow", right: "RIGHT arrow →" },
    // Words in the reminder at the bottom of the screen during the task.
    REMINDER_MATCH: "MATCH",
    REMINDER_MISMATCH: "NO MATCH",

    GENERAL: `COLOUR–WORD TEST

A colour word (RED, GREEN, BLUE or YELLOW) will appear,
printed in a coloured ink.

Decide whether the INK COLOUR matches the WORD.

{MATCH_KEY}   =   YES, they match
{MISMATCH_KEY}   =   NO, they do not match

Keep one finger on each arrow key.
Respond as quickly and accurately as possible.

Press SPACE to continue.`,

    PRACTICE: `PRACTICE

First, a short practice. After each answer you will see
whether it was correct.

{MATCH_KEY}  =  MATCH          {MISMATCH_KEY}  =  NO MATCH

Press SPACE to begin the practice.`,

    // Shown instead of PRACTICE + TEST_START when the practice is switched off.
    TEST_START_NO_PRACTICE: `The test begins now.

{MATCH_KEY}  =  MATCH          {MISMATCH_KEY}  =  NO MATCH

Respond as quickly and accurately as possible.

Press SPACE to begin.`,

    TEST_START: `PRACTICE COMPLETE

Now the real test begins. There is no more feedback.

{MATCH_KEY}  =  MATCH          {MISMATCH_KEY}  =  NO MATCH

Respond as quickly and accurately as possible.

Press SPACE to begin.`,

    RETURN: `COLOUR–WORD TEST (again)

The same task as before.
Does the INK COLOUR match the WORD?

{MATCH_KEY}  =  YES, MATCH
{MISMATCH_KEY}  =  NO MATCH

Respond as quickly and accurately as possible.

Press SPACE to begin.`,

    END: `Task complete. Thank you!

Press SPACE to continue.`,

    FEEDBACK: { correct: "Correct", incorrect: "Incorrect", too_slow: "Too slow" },
  },

  // ── MIST baseline = arithmetic PRACTICE block (nothing at stake) ──────
  MIST_BASELINE: {
    INTRO: `ARITHMETIC: PRACTICE BLOCK

This is a practice block. Nothing is at stake here:
your answers in this block are NOT scored and do not count.
Use it to get used to the task.

Solve each problem. Every answer is a single digit from 0 to 9.
Type it with the NUMBER KEYS at the top of your keyboard
(your choice lights up on the dial), then press ENTER.
BACKSPACE clears your choice.

There is no time limit. Work at your own comfortable pace,
but please keep going without breaks.

Press SPACE to begin the practice.`,

    END: `Practice complete.

Press SPACE to continue.`,

    // Feedback after each practice answer (CONFIG.MIST_BASELINE.SHOW_FEEDBACK).
    FEEDBACK: { correct: "CORRECT", incorrect: "INCORRECT", no_answer: "NO ANSWER" },
  },

  // ── MIST stressor: the test that "counts" ─────────────────────────────
  MIST: {
    INTRO: `MENTAL ARITHMETIC TEST: THIS ONE COUNTS

Now the real test begins. Unlike the practice, this block is scored.

Your performance must be in the AVERAGE range (the white zone) or better.
Your correct responses will be scaled at the end to calculate your score,
and this score decides whether you qualify for the monetary reward.

Each problem now has a TIME LIMIT. A countdown shows the time left.
If the time runs out, the problem counts as wrong.
Type your answer with the number keys and press ENTER.

This part plays background noise. Please keep your sound on.

Press SPACE to continue.`,

    // Optional timed practice (only if CONFIG.MIST.N_PRACTICE_TRIALS > 0).
    PRACTICE: `PRACTICE

You will now solve a few problems with the countdown timer active.
Select your answer and press ENTER before time runs out.

Press SPACE to begin.`,

    // Title of the screen that explains the performance bar.
    BAR_TITLE: "STRESS TEST",
    BAR_ZONES: ["Below average\n(0 – 60 %)", "Average\n(60 – 80 %)", "Above average\n(80 – 100 %)"],
    BAR_LEGEND: "Upward marker (below the bar)   =  Your score\nDownward marker (above the bar) =  Group average",
    BAR_INSTRUCTIONS: `Keep your score in the AVERAGE (white) zone or better: your correct
responses are scaled at the end and decide whether you qualify for the reward.
Solve the problems as quickly and accurately as possible.

Press SPACE to begin.`,

    FEEDBACK: { correct: "CORRECT", incorrect: "INCORRECT", too_slow: "Too Slow!" },

    END: `The task is complete. Thank you!

Press SPACE to continue.`,
  },

  // ── Images ────────────────────────────────────────────────────────────
  IMAGES: {
    INTRO: `You will now view a series of images.

Simply look at each image as it appears.
This takes about {MIN} minutes. You do not need to press any keys.

{REST_SENTENCE}

Press SPACE to begin.`,
    // {REST_SENTENCE} above becomes one of these (CONFIG.REST.SHOW_FIXATION):
    REST_BLANK: `After the images, the screen will stay blank for about {REST_MIN} minute(s).
Please keep looking at the screen and relax.`,
    REST_FIXATION: `After the images, a cross ( + ) will appear in the middle of the screen
for about {REST_MIN} minute(s). Please keep looking at it and relax.`,
    LOADING: "Loading images… {DONE} / {TOTAL}\n\nPlease wait.",
  },

  // ── Debrief (last page; HTML) ── EDIT ME ──────────────────────────────
  DEBRIEF_HTML: `
    <p>Thank you, you have finished the study.</p>
    <h3>What the study was about</h3>
    <p>We are studying how viewing different kinds of images after a brief
    stressor affects recovery. Different participants see different image
    sets ({CONDITION_LIST}); you saw the <strong>{CONDITION_LABEL}</strong> set. The colour–word task
    measures attention: you did it before the stressor, after the stressor,
    and after the images, so we can see how attention changed at each step.
    The ratings track how stressed you felt along the way.</p>
    <h3>About the arithmetic task and the performance rule</h3>
    <p>The arithmetic task is a standard laboratory stressor (the Montreal
    Imaging Stress Task). It was <strong>deliberately made very hard</strong>:
    the time limit got shorter whenever you did well, so almost everyone ends
    up in the red zone. The "group average" marker was a fixed value, not real
    data from other people. <strong>Your score on it says nothing about your
    ability.</strong></p>
    <p>We also told you that your performance had to be in the average range to
    be selected, and that your scaled score decided whether you qualify for the
    reward. This was part of the stress manipulation and was <strong>not
    true</strong>: your data are used whatever your score, and your score does
    not change what you receive. <!-- EDIT ME: say exactly what everyone receives,
    and pay it to everyone (e.g. as a Prolific bonus). -->Everyone who completes
    the study receives the full payment, including the reward mentioned in the
    arithmetic task. We are sorry for any stress this caused.</p>
    <p>Please do not tell other possible participants about the arithmetic
    task or the performance rule, as this would affect their results.</p>`,

  // Extra debrief paragraph for some conditions (optional; HTML).
  DEBRIEF_BY_CONDITION: {
    negative: `<p>The pictures in your set were chosen to be unpleasant. If they are
    still on your mind, it can help to take a short break, think about
    something you enjoy, or talk to someone. If you would like to talk to us,
    contact {CONTACT}.</p>`,
  },
};
