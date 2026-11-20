# Stress & Recovery: online version (Prolific), v2

A browser-based, single-session version of the `stress-recovery-exp-with-stroop`
lab protocol, built to run on Prolific. Participants open a link on their own
laptop or desktop and finish in about 35–40 minutes. **Each participant's data
is saved as one JSON file** (every trial, rating, image, event and browser-
integrity record) to Microsoft storage (OneDrive / SharePoint via Power
Automate, or Azure Blob Storage). At the end they return to Prolific with your
completion code.

**Question:** does an acute stressor (MIST) change attention on a colour–word
Stroop task, and does viewing images afterwards (one of four image
conditions) change recovery of performance and self-reported stress?

```
Consent → Demographics → Setup (sound check, full screen) → "Before you start" (average-performance rule)
  → Stroop      (baseline; instructions + practice)           ~4 min
  → VAS         (pre_mist)                                     ~20 s
  → MIST baseline (practice, self-paced, nothing at stake)     ~2 min   → sets the MIST time limit
  → MIST stressor (timed, performance bar, white noise)        ~4 min
  → VAS         (post_mist)
  → Stroop      (post_stress)                                  ~3 min
  → VAS         (pre_images)
  → Images      (120 images × 2.5 s, ONE condition per person)  5 min
  → Blank screen (rest)                                         1 min
  → VAS         (post_recovery) + "How did the images make you feel?"
  → Stroop      (post_recovery)                                ~3 min
→ Feedback → Upload → Debrief → back to Prolific
```

Image conditions: `positive_prime`, `positive`, `negative`, `neutral`
(random, equal chances; one per participant).

---

## Where to change what

| I want to change… | Edit | Look for |
|---|---|---|
| **Any instruction or text participants read** | [js/texts.js](js/texts.js) | the list at the top says which text appears where |
| the first-page information sheet / consent text | [js/texts.js](js/texts.js) | `INFO_HTML` (**EDIT ME**) |
| the "average range to be selected" rule at the start | [js/texts.js](js/texts.js) | `TASK_INTRO` (task screen) and `INFO_HTML` ("Please note") |
| the MIST practice ("nothing at stake") wording | [js/texts.js](js/texts.js) | `MIST_BASELINE.INTRO` |
| the MIST "this one counts / scaled / reward" wording | [js/texts.js](js/texts.js) | `MIST.INTRO` and `MIST.BAR_INSTRUCTIONS` |
| Stroop instructions, key names, reminder line | [js/texts.js](js/texts.js) | `STROOP.*` |
| the debrief (must reveal the deception) | [js/texts.js](js/texts.js) | `DEBRIEF_HTML` (**EDIT ME**), `DEBRIEF_BY_CONDITION` |
| demographic or feedback **questions** | [js/forms.js](js/forms.js) | `demographics()` / `feedback()` (**EDIT HERE**) |
| VAS questions | [js/vas.js](js/vas.js) | `QUESTIONS` (**EDIT HERE**) |
| **the order of the experiment** (add/remove/repeat steps) | [js/config.js](js/config.js) | `FLOW` |
| upload address, Prolific completion code, contact | [js/config.js](js/config.js) | `DATA.UPLOAD_URL`, `PROLIFIC`, `RESEARCHER_CONTACT` (**EDIT ME**) |
| Stroop keys, trial counts, timings | [js/config.js](js/config.js) | `STROOP` |
| MIST baseline length / calibration rule | [js/config.js](js/config.js) | `MIST_BASELINE` |
| MIST stressor settings | [js/config.js](js/config.js) | `MIST` |
| image conditions, number/duration of images | [js/config.js](js/config.js) | `IMAGES` (and see "Image conditions" below) |
| rest length, blank vs fixation cross | [js/config.js](js/config.js) | `REST` |
| how short `?quick=1` runs are | [js/config.js](js/config.js) | `applyQuickMode` at the end |
| analysis thresholds (exclusions etc.) | [analysis/analyze.py](analysis/analyze.py) | `# ── EDIT HERE ──` |

The other files in `js/` are the engine; you should not need to touch them.
Each one starts with a comment saying what it does and where its settings are.

## Debugging: test any part on its own

Open **[debug.html](debug.html)** (double-click it, or via the local server below).

- **Quick tests**: one click each: forms only, the "before you start"
  screen, Stroop first run (with practice), Stroop later run, MIST baseline,
  MIST baseline + MIST, MIST only, all VAS, images + blank, "from the stressor
  on", "from the images on", the whole study.
- **Custom**: tick any steps of `CONFIG.FLOW` and run just those.
- **Options**: quick mode, image condition (or random), Stroop practice
  on/off, upload on/off (and to which address), participant code.
- **Image sets**: a table of every condition (number of images, sizes, how
  many are full-HD 16:9) and a button that **loads every image of a set and
  lists any that fail**, with a random sample of thumbnails.
- **As a participant sees it**: the real flow (not debug mode), quick or full.

In a debug run: a label in the top-left corner shows the current step,
**F2 skips the rest of the current step**, nothing is uploaded unless you tick
"Upload", and the end screen shows the summary and the whole data file (with a
Download button). In the browser console (F12): `Debug.snapshot()`,
`Debug.download()`, `Debug.skip()`.

The same works by URL, e.g.
`index.html?debug=1&quick=1&only=mist_baseline,mist` or
`index.html?debug=1&from=images&condition=negative`
(all options are listed at the top of [js/debug.js](js/debug.js)). Debug options
only work together with `debug=1`. `quick=1` and `skipcheck=1` also work without it,
but only in links **without** a Prolific ID, so Prolific participants can't shorten
the study. Every run without a Prolific ID is marked `participant.test_run = 1`,
and `analyze.py` leaves those out unless you add `--include-test`.

### Local test server (recommended for piloting)

```bash
node receivers/local_test_server.js
```
Then open http://localhost:8787/debug.html. It serves the study like GitHub
Pages does **and** acts as a data receiver: tick "Upload" and use
`http://localhost:8787/upload`. Files appear in
`receivers/received/complete|progress|quit/`. Needs Node.js only.

## Data: one JSON file per participant

Full description: **[docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)**. In short:

- Each file holds: `participant` (IDs, image condition, Stroop key mapping),
  `session` (device, timings, steps run), `consent`, `demographics`,
  `mist_calibration`, `integrity`, `summary`, `feedback`, and the tables
  `data.stroop_trials`, `data.mist_trials`, `data.vas`, `data.image_trials`,
  `data.events`.
- The browser uploads to a receiver you set up once (see
  **[receivers/README.md](receivers/README.md)**):
  **Power Automate** (HTTP request → create file in OneDrive / SharePoint; needs a
  Premium licence for the HTTP trigger) or an **Azure Function** (→ Blob Storage;
  works with Azure for Students). Paste its URL into `DATA.UPLOAD_URL` in
  [js/config.js](js/config.js).
- Every upload is a **new file**, so nothing is ever overwritten:
  - `complete/<pid>__<load>.json`: **the participant's file** (end of study);
  - `progress/…__p<nn>_<step>.json`: a full snapshot after every step (keeps
    the data of people who drop out; can be deleted later);
  - `quit/…__quit_<n>.json`: a small snapshot sent if the page is closed early.
- With no `DATA.UPLOAD_URL` (piloting) or if the upload fails, the last page
  offers the same file as a **download**, and participants are asked to send it.
- A copy is also kept in the participant's browser (localStorage key
  `stress_recovery_prolific_backup`).

## Browser integrity: full screen, tab switches, focus

All of this is **recorded for every participant**, whatever the settings:

| What | How it shows up in the file |
|---|---|
| leaving full screen (Esc, or switching apps on some systems) | `integrity.fullscreen_exit_count`, `time_outside_fullscreen_s` |
| switching tab / minimising the window | `integrity.tab_hidden_count`, `time_hidden_s` |
| the window losing focus (Alt+Tab, clicking another app or screen) | `integrity.window_blur_count`, `time_blurred_s` |
| being asked to go back to full screen | `integrity.fullscreen_return_prompts` (and `fullscreen_declined` if the browser refused) |
| per step (e.g. how many tab switches during `mist`) | `integrity.by_step.<step>.*` |
| each incident with start, end and duration | `integrity.incidents[]` |
| per trial | `focus_lost` = 1 if any of the above happened during that trial; `fullscreen` = 1 if in full screen at its end |
| every change with a timestamp | `data.events`, stream `Browser` |

The participant is also **asked to go back to full screen** before every
VAS and instruction screen, and between Stroop and MIST trials
(`INTEGRITY.REQUIRE_FULLSCREEN_BETWEEN_TRIALS`); the image block is never
paused, only recorded. The study's own exit from full screen before the
feedback form is not counted. The participant summary carries the totals, and
`analysis/analyze.py` writes `integrity.csv` and flags heavy cases.

Verified in automated tests (headless Chrome): a full-screen exit during the
Stroop, a hidden tab + lost focus during the MIST, and a real second tab
opened during the images were all recorded with their step and duration, and
the affected trials were flagged.

## The tasks

### Stroop (2 keys, colour–word match)
A colour word (RED, GREEN, BLUE, YELLOW) appears in a coloured ink. **← LEFT
arrow = the ink colour matches the word, → RIGHT arrow = it doesn't** (set in
`STROOP.KEYS`; `COUNTERBALANCE_KEYS: true` swaps them for a random half).
Congruent (RED in red) = match; incongruent (RED in blue) = mismatch.

| Part | Trials | ≈ Time |
|---|---|---|
| Practice (first Stroop step only, with Correct / Incorrect / Too slow) | 12 (half congruent) | 30 s |
| Each test run | 36 congruent + 36 incongruent = 72 | 3 min |

Each colour word appears 9× in its own ink and 3× in each other ink; each ink
appears 18×. Order: same ink ≤ 2 in a row, same answer ≤ 3 in a row, never the
same word twice in a row. Trial: blank 500 ms → fixation 500 ms → word until a
key or 2000 ms → fixation 500 ms. Measures: RT and accuracy, **Stroop
interference** = RT incongruent − congruent (and accuracy congruent − incongruent).

### MIST baseline (calibration) and MIST stressor
- **Baseline** (`mist_baseline`), the classic MIST training phase (Dedovic et
  al., 2005): 15 problems at the same difficulty as the stressor, **self-paced,
  no countdown, no performance bar, no noise**, presented as a practice block
  where nothing is at stake. The participant's **mean time on correct answers
  × 0.9** ("10 % less than their average") becomes the stressor's starting
  time limit, kept within 2.5–7 s. With fewer than 3 correct answers the
  default 5 s is used (`mist_calibration.source = "default"`).
- **Stressor** (`mist`): "this one counts" instructions (average range,
  scaled score, reward), the performance-bar screen, then 35 timed problems
  with countdown, performance bar and white noise; 3 correct in a row → 10 %
  less time, 3 wrong/too slow in a row → 10 % more (within 2.5–7 s).
- Answers: number keys 0–9 (shown on the dial), ENTER submits, BACKSPACE clears.

### VAS
Stressed, tense, calm (0–100; calm reverse-scored); composite = mean(stressed,
tense, 100 − calm). At `post_recovery` also "How did the images make you feel?"
(0 = positive, 50 = neutral, 100 = negative; not part of the composite).

### Image conditions
- Folders: `images/<condition>/`, one per condition: currently
  `positive_prime/` (918 images in two sizes, `1280/` and `1920/`; the right
  size is chosen per screen), `positive/` (240), `negative/` (240),
  `neutral/` (122, GAPED + OASIS; the GAPED BMPs were converted to JPG).
- Each participant gets **one** condition at random (equal chances), kept if
  they reopen the link in the same browser. `?condition=<name>` in the study
  URL forces one: for exactly balanced groups you can publish one Prolific
  study per condition, each with its own `&condition=…`.
- Each participant sees a fresh random 120 images of their set (2.5 s each,
  no gap = 5 min); full-HD 16:9 images first. A set with fewer images than
  needed is cycled.
- **To change images or add a condition:**
  1. put the images in `images/<name>/` (flat, or `1280/` + `1920/`
     subfolders with the same file names); list files to never show in
     `images/<name>/exclude.txt`;
  2. run **`tools/build_image_manifest.bat`** (or
     `node tools/build_image_manifest.js`). It rewrites
     `js/image_manifest.js` and warns about problems (missing sizes, too few
     images, conditions without a folder…);
  3. for a new condition, add it to `IMAGES.CONDITIONS` and `IMAGES.ASSIGN_FROM`
     in [js/config.js](js/config.js);
  4. open debug.html → "Image sets" → load every image, then run "Images + blank"
     with that condition.

## Prolific setup

1. **Study URL** ("I'll use URL parameters"):
   ```
   https://<your-username>.github.io/stress_recovery_prolific/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
   ```
   (add `&condition=negative` etc. if you run one study per condition).
2. **Completion code** → `PROLIFIC.COMPLETION_CODE` in [js/config.js](js/config.js).
3. **Device:** desktop only. Estimated time: about 40 minutes.
4. A real Prolific participant is turned away with a polite message if
   `DATA.UPLOAD_URL` or the completion code is not set (add `&pilot=1` to test
   the Prolific link anyway).
5. **Deception and payment:** the instructions say the score decides whether
   participants "qualify for the monetary reward". Make sure your ethics
   approval covers this, that the debrief (`DEBRIEF_HTML`) says what everyone
   actually receives, and that you pay it (Prolific does not allow withholding
   pay for performance; a "bonus" paid to everyone is the usual solution).

## Put it online (GitHub Pages, free)

Upload `index.html`, `debug.html`, `css/`, `js/` and `images/` to a GitHub
repository → Settings → Pages → Deploy from branch `main` / root. File names
are case-sensitive. `images/` is about 490 MB in about 2,440 files, all far
below GitHub's 100 MB per-file limit; use `git push` (the web uploader is too
slow for this). `analysis/`, `receivers/`, `tools/`, `docs/`, `legacy/` are
harmless to include. Each participant downloads only their 120 images.

## Pilot checklist

- [ ] Edit `INFO_HTML` and `DEBRIEF_HTML` in [js/texts.js](js/texts.js) to match your ethics approval.
- [ ] Set `RESEARCHER_CONTACT`, `DATA.UPLOAD_URL`, `PROLIFIC.COMPLETION_CODE` in [js/config.js](js/config.js).
- [ ] Set up the receiver ([receivers/README.md](receivers/README.md)) and send one test.
- [ ] debug.html → Image sets → load every image of every condition.
- [ ] One full-length run per condition (debug.html → "Real flow, full length"); check `session.duration_min`.
- [ ] Check the white noise is audible during the MIST stressor (and absent in the practice).
- [ ] Check files arrive in `complete/`, `progress/` and (close a run early) `quit/`.
- [ ] Run `analysis/analyze.py` on the pilot files (add `--include-test`, and `--include-quick` for quick runs: pilot runs have no Prolific ID).

## Analysis

`analysis/analyze.py` reads a folder of participant files (e.g. the synced
`complete/` folder, or all three folders with `--include-incomplete`) and
recomputes everything from the trial tables. See the docstring at the top of
the script for options and outputs. Python via `uv`, nothing to install:

```bash
cd analysis
uv run --python 3.12 --with pandas --with numpy --with scipy --with matplotlib python analyze.py <folder with the JSON files> --plots
```

## Files

```
index.html               the study
debug.html               debug launcher (test parts, check image sets)
css/style.css            layout
js/config.js             ← settings: upload URL, Prolific code, FLOW (order), tasks, image conditions
js/texts.js              ← every text participants read
js/forms.js              consent, demographics, setup, feedback, debrief  (questions: EDIT HERE)
js/stroop.js             2-key colour–word match Stroop
js/mist.js               MIST baseline (calibration) + MIST stressor
js/mist_bank.js          verified problems per level (from question_bank.json)
js/images.js             image intervention, condition assignment
js/image_manifest.js     GENERATED list of image files per condition (tools/build_image_manifest.js)
js/vas.js                VAS + image question
js/summary.js            per-participant summary (inside the data file)
js/core.js               timing, keyboard, full screen, integrity tracking
js/data.js               the participant JSON file, uploads, local backup, download
js/debug.js              debug mode (?debug=1)
js/main.js               runs CONFIG.FLOW
images/<condition>/      image sets (+ optional exclude.txt)
tools/build_image_manifest.js / .bat   rebuild js/image_manifest.js after changing images
receivers/README.md      setting up the Microsoft receiver (Power Automate / Azure Function)
receivers/azure_function/            Azure Function receiver (Node.js)
receivers/local_test_server.js       local server + receiver for piloting
docs/DATA_FORMAT.md      the data file, field by field
analysis/analyze.py      analysis of the participant files (+ make_test_data.py)
legacy/                  the v1 Google-Sheets receiver (not used)
```

The previous version (v1.1, Google Sheet + emotional Stroop) is backed up in
`../stress_recovery_prolific_BACKUP_v1.1_code_2026-11-18/`.

## Differences from the lab protocol (for your methods section)

| | Lab (`stress-recovery-exp-with-stroop`) | Online v2 |
|---|---|---|
| Sessions | MIST staircase in session 1, then one session per image condition | 1 session |
| Conditions | Positive, negative, neutral (within-subject) | Positive Prime, positive, negative, neutral (**between-subject**, one per person) |
| Image set | Fixed-seed set per condition | A fresh random 120 per person from their condition's folder |
| Cognitive task | Emotional Stroop (4 keys) | Colour–word **match** Stroop, congruent/incongruent only, 2 keys |
| MIST calibration | Level staircase (levels 1–5) + time limit from RTs | Fixed level 4; self-paced baseline block, limit = 0.9 × mean correct RT (Dedovic et al., 2005) |
| Flow | Blank → VAS → MIST → VAS → Task → Images → Blank (5 min) → VAS → Task | Stroop → VAS → MIST baseline → MIST → VAS → Stroop → VAS → Images → Blank (1 min) → VAS → Stroop |
| Recording | EEG + LSL markers | Behaviour only; markers in `data.events` |
| Setting | Experimenter present | Alone at home; weaker stressor expected |

## Privacy notes

- No names or emails are collected. People are identified by their Prolific
  ID (pseudonymous but linkable); treat the data folder as personal data.
- The demographics include psychoactive medication (and an optional free-text
  reason): sensitive health data. Make sure your ethics approval and
  data-management plan cover it, and restrict access to the storage folder.
- The receiver URL is write-only but public: don't post it; the participant
  link is enough.
