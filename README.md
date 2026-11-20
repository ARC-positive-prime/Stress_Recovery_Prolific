# Stress & Recovery - online version (Prolific)

A browser-based, single-session version of the `stress-recovery-exp-with-stroop`
lab protocol, built to run on Prolific. Participants open a link on their own
laptop or desktop and finish in about 30–35 minutes. Every trial is saved to a
Google Sheet. At the end they return to Prolific with your completion code.

**Question:** does an acute stressor (MIST) change attention on an emotional
Stroop task, and does performance (and self-reported stress) recover after
viewing positive images (Positive Prime)?

The design is within-subject, one group. Everyone does the same three Stroop
runs: at baseline, after the stressor and after the images.

```
Consent → Demographics → Setup (sound check, full screen)
  → VAS     (baseline)                             ~20 s
  → Stroop  (baseline, with instructions + practice) ~4 min
  → VAS     (pre_mist)                             ~20 s
  → MIST stressor (+ white noise)                  ~6 min incl. instructions
  → VAS     (post_mist)                            ~20 s
  → Stroop  (post_stress)                          ~3 min
  → Images  (120 Positive Prime images × 2.5 s)    5 min
  → Rest    (fixation cross "+")                   1 min
  → VAS     (post_recovery) + image question       ~30 s
  → Stroop  (post_recovery)                        ~3 min
→ Feedback → Upload → Debrief → back to Prolific
Forms (consent, demographics, setup, feedback) add about 5 min. Total: about 30–35 min.
```

The image question, shown only after the post-recovery VAS, asks "How did the
images make you feel?" on a 0–100 line labelled Positive (0), Neutral (50) and
Negative (100), which is the lab convention. It is a manipulation check and is
**not** part of the VAS stress composite.

Data are uploaded after every section, so someone who quits half-way still
leaves usable rows.

---

## 1. Try it locally (2 minutes)

Double-click `index.html`, or open it in Chrome. Running it from disk works;
no server is needed. Useful URL options:

| Add to the URL | Effect |
|---|---|
| `?quick=1` | Very short blocks, for checking the flow (Stroop practice 4 and test 28 trials; MIST 2 + 5; 6 images; 5 s rest). Sessions are flagged `quick_mode=1`. |
| `?skipcheck=1` | Skip the laptop / screen-size check (minimum 900 × 500). |
| `?pid=AB12` | Use your own participant code instead of a random one. |
| `?PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=…` | What Prolific adds. `PROLIFIC_PID` becomes the participant code; all three are saved. Unreplaced placeholders such as `{{%PROLIFIC_PID%}}` are ignored. |

Example: `index.html?quick=1&pid=test01`

The participant code is `PROLIFIC_PID` if present, otherwise `?pid=`,
otherwise a random code such as `P3K9X2QA`.

With no `DATA_URL` set, the last screen offers a **Download data file** button
(`stress_recovery_<ID>.json`) instead of uploading. The Prolific box then says
the completion code is not set until you set it.

## 2. Data collection setup (Google Sheet, ~10 minutes, free)

1. Create a new Google Sheet, e.g. "Stress Recovery Prolific — data". Use an
   institutional account if your ethics approval requires it.
2. In the Sheet: **Extensions → Apps Script**. Delete the sample code, paste
   the whole of [apps_script/Code.gs](apps_script/Code.gs), and save.
3. Pick `testSetup` in the function list and click **Run**. Authorise it. A
   `sessions` tab with a TEST row appears; delete that row.
4. **Deploy → New deployment** → type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**. This lets participants' browsers send data
     without a Google login. They can only append rows to the known tabs;
     they cannot read the Sheet.
5. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. Paste it into [js/config.js](js/config.js):
   ```js
   DATA_URL: "https://script.google.com/macros/s/AKfy.../exec",
   ```
   Also set `RESEARCHER_CONTACT`, e.g. `"Your Name (you@university.edu)"`.
   Participants see it in the information sheet and if an upload fails.
7. Reload the Sheet. A **Study** menu appears with *Refresh dashboard* and
   *Create / show export key* (see "Analysis").

> If you later edit `Code.gs`, use **Deploy → Manage deployments → Edit →
> Version: New version**. That keeps the same URL; a *new deployment* gives a
> new URL.

Tabs are created automatically the first time data arrive. Opening the `/exec`
URL in a browser shows a health check (`{"ok":true,"status":"running",…}`).

## 3. Put it online (GitHub Pages, free)

1. Create a GitHub repository, e.g. `stress_recovery_prolific`. Public
   repositories get free Pages; the code contains no data.
2. Upload the contents of this folder: `index.html`, `css/`, `js/` and
   **`images/`**. `analysis/` and `apps_script/` are harmless to include.
   - `images/` is about 121 MB in 920 files (`1.jpg` … `920.jpg`, about
     130 KB each). That is fine for a GitHub repository, since every file is
     far below GitHub's 100 MB per-file limit. Uploading through the web page
     may need several batches; `git push` does it in one go.
   - File names are **case-sensitive** on GitHub Pages. They must match
     [js/image_list.js](js/image_list.js) exactly (`12.jpg`, not `12.JPG`).
3. Repository **Settings → Pages → Source: Deploy from a branch → main / (root)**.
4. After about a minute your link is
   `https://<your-username>.github.io/stress_recovery_prolific/`.
   Check that an image loads, e.g. `…/stress_recovery_prolific/images/1.jpg`.

Each participant downloads only their 120 images (about 15 MB). The download
starts in the background right after consent, so it is normally finished long
before the image block.

## 4. Prolific setup

1. **Study URL** (in Prolific, choose "I'll use URL parameters"):
   ```
   https://<your-username>.github.io/stress_recovery_prolific/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
   ```
2. **Completion code:** copy it from the study's "Completion paths" section into
   [js/config.js](js/config.js):
   ```js
   PROLIFIC: {
     COMPLETION_CODE: "C1A2B3C4",
     COMPLETION_URL: "https://app.prolific.com/submissions/complete?cc=",
     AUTO_REDIRECT_SEC: 0,   // >0 also sends people back automatically after this many seconds
   },
   ```
   The debrief shows the code and a **Return to Prolific** button. People who
   finish get the code even if their upload failed, since that isn't their
   fault, and they are asked to download the file and send it to you.
3. **Device:** allow **desktop only**. The study also turns away phones,
   tablets and small screens itself.
4. **Estimated time:** about 35 minutes. Check the real duration in the
   `sessions` tab (`duration_min`) after piloting.
5. Prolific matches people by `prolific_pid`, which is saved in `sessions`,
   `demographics` and `summary`. Because `PROLIFIC_PID` is the participant
   code, `participant_id` equals it.
6. **Before publishing:** open the real study link with `&quick=1` added
   (or use Prolific's preview) and check that rows arrive in every tab and
   the Return-to-Prolific link works. Then delete those rows, or leave them;
   quick-mode rows are excluded from the dashboard and the analysis.

## 5. Piloting checklist

- [ ] Edit the consent and debrief wording in [js/forms.js](js/forms.js)
      (marked **EDIT ME**) so it matches your ethics approval exactly.
- [ ] Set `RESEARCHER_CONTACT`, `DATA_URL` and `PROLIFIC.COMPLETION_CODE` in
      [js/config.js](js/config.js).
- [ ] Do one full-length run (no `quick`) on a typical laptop. Note `duration_min`.
- [ ] Check the white noise plays during the MIST at a sensible volume.
- [ ] Check the images fill the screen sensibly and the block lasts 5 min
      (`images_total_s` ≈ 300 in `summary`).
- [ ] Check rows arrive in every tab and the `dashboard` tab updates.
- [ ] Delete pilot rows (or keep them flagged) before real data collection.

---

## Trial counts

| Part | Practice (with feedback) | Measured | ≈ Time |
|---|---|---|---|
| Stroop, baseline | 12 × "XXXXX" | 72 words (see below) | 4 min incl. instructions |
| Stroop, post_stress | – | 72 words | 3 min |
| Stroop, post_recovery | – | 72 words | 3 min |
| MIST | 5 | 35 (level 4, 5 s start, ±10 % adaptive) | 6 min incl. instructions |
| Images | – | 120 × 2.5 s, no gap | 5 min |
| Rest | – | fixation cross | 1 min |
| VAS | – | 3 items × 4 timepoints (+ image question once) | 20 s each |

Stroop trial: blank 500 ms → fixation 500 ms → word until response or
2000 ms → fixation 500 ms (in practice, "Correct" / "Incorrect" / "Too Slow"
instead). Keys **D = red, F = green, J = blue, K = yellow**; a key reminder
stays at the bottom of the screen.

### Stroop design (one test run = 72 trials)

| Trial type | Example | n | Balancing |
|---|---|---|---|
| congruent | RED in red | 12 | each colour word 3× in its own ink |
| incongruent | RED in blue | 12 | each colour word once in each of the 3 other inks |
| negative | THREAT in green | 16 | 4 per ink; a fresh random 16 of the 20 words each run |
| positive | HAPPY in yellow | 16 | 4 per ink; a fresh random 16 of 20 |
| neutral | TABLE in blue | 16 | 4 per ink; a fresh random 16 of 20 |

- Every ink appears 18 times per run.
- Order constraints: same ink (= same key) at most 2 in a row; same trial
  type at most 3 in a row; never the same word twice in a row.
- The negative, positive and neutral word lists, inks, timings and trigger
  codes are those of the lab `stroop.py`. The colour words are new.

One run gives two effects:

- **Stroop interference** = RT incongruent − RT congruent (also accuracy
  congruent − incongruent): cognitive control, expected to be sensitive to stress.
- **Emotional interference** = RT negative − neutral, positive − neutral,
  and negative − positive: emotional attentional bias.

Emotion words can't point to a wrong key, so they slow responses through
distraction rather than conflict. Neutral words are the baseline for them.

## Image intervention

- **Pool:** the 920 Positive Prime images in `images/` (compressed JPEGs),
  listed in [js/image_list.js](js/image_list.js).
- **Selection:** each participant gets a fresh random 120 of the 920, so
  different people see different subsets. The files shown are saved per row in
  `image_trials`.
- **Display:** 2.5 s each, back to back with no gap (120 × 2.5 s = 5 min, the
  lab values). Each image is scaled to fit the screen with its aspect ratio
  kept, on a grey background. No key presses are needed.
- **Preloading:** downloading starts right after consent and runs in the
  background. If the images are not all loaded by the image block, a
  "Loading images… n / 120" screen waits (up to 2 min, `PRELOAD_TIMEOUT`).
  An image that fails to load is replaced by an unused one from the pool
  (`replaced_file` records the original). If images are still missing, the
  block runs with the ones that loaded and logs `images_incomplete`.
- **Timing:** onsets are locked to screen refreshes and scheduled from the
  first image's onset (planned onset of image *i* = start + *i* × 2.5 s), so
  frame jitter does not add up over the 5 minutes. Each row records planned
  and actual onset, onset error, offset and duration.
- After the last image, a **1-minute fixation cross** (rest) follows, then the
  post-recovery VAS.

`analysis/image_labels.json` holds per-image emotion-classifier
probabilities for the 920 images (amusement, awe, contentment, excitement,
anger, disgust, fear, sadness), for reference. The study code does not use it.

---

## Data: one Sheet tab per type

Columns that are not in the lab CSVs are marked †. The server adds
`received_at` to every uploaded row. `session` is always 1.

### `stroop_trials`
`participant_id, session, phase, block_type, trial, word, word_category,
trial_type†, congruency†, ink_color, correct_response, participant_response,
outcome, accuracy, rt, timed_out, trial_onset_time`, plus † `is_practice,
onset_frame_ms, focus_lost, fullscreen`.

- `phase`: `baseline` / `post_stress` / `post_recovery`. `block_type`:
  `practice` (baseline run only) / `test`.
- `word_category`: `colour` / `negative` / `positive` / `neutral` / `practice`.
- `trial_type`: `congruent` / `incongruent` / `negative` / `positive` /
  `neutral` / `practice`. `congruency`: `congruent` / `incongruent`, empty for
  non-colour words.
- `ink_color`: red / green / blue / yellow. `correct_response` and
  `participant_response` are key names (`d f j k`).
- `outcome`: `correct` / `incorrect` / `missed`. `accuracy` (1/0) and `rt` are
  empty for missed trials, as in the lab.
- `rt` in seconds from word onset. `trial_onset_time` is seconds since page load.
- `onset_frame_ms`: how long the frame that showed the stimulus took. About
  16.7 ms at 60 Hz; more than 1.5 × the normal frame means a dropped frame
  delayed the onset.
- `focus_lost`: 1 if the page lost focus, was hidden or left full screen
  during the trial.

### `image_trials`
`participant_id, session, phase ("intervention"), image_set ("positive_prime"),
trial, image_file, replaced_file, planned_onset_s, onset_s, onset_error_ms,
trial_onset_time, onset_frame_ms, offset_time, duration_ms, focus_lost,
fullscreen`.

- `planned_onset_s` / `onset_s`: planned and actual onset, seconds from the
  first image's onset. `onset_error_ms` = actual − planned.
- `trial_onset_time`, `offset_time`: seconds since page load.
  `duration_ms` = offset − onset (target 2500).
- `replaced_file`: the originally drawn file if it failed to load, else empty.

### `vas`
`participant_id, session, timepoint, measure, reverse_scored, rating (0–100),
rt, timestamp`.

- `timepoint`: `baseline`† / `pre_mist` / `post_mist` / `post_recovery`.
- `measure`: `stressed` / `tense` / `calm`, plus `image_feeling` at
  `post_recovery` only (0 = positive, 50 = neutral, 100 = negative).
- `reverse_scored` is `"True"` for `calm`, otherwise `"False"`.
- Stress composite = mean(stressed, tense, 100 − calm). `image_feeling` is
  not part of it.

### `mist_trials` (same as `MIST_*.csv`)
`participant_id, session, block (practice/experimental), trial, level, problem,
correct_answer, participant_answer, accuracy, answered, rt, time_limit,
trial_start_time, trial_end_time`, plus † `phase ("stressor"), outcome,
timed_out, next_time_limit, trial_onset_time, onset_frame_ms, focus_lost,
fullscreen`.

- `time_limit` is the limit **in force on that trial**. The lab CSV wrote the
  post-adaptation value; here that is `next_time_limit`. For timeouts, `rt` is
  that trial's limit.

### `events` (the LSL marker stream, as a table)
`participant_id, session, phase, stream, code, label, time, wall_time, detail`.
`time` is seconds since page load (the same clock as `trial_onset_time`).

| Stream | Codes |
|---|---|
| `Stroop_Markers` | 13 block_start, 14 practice_block_start, 1 fixation, 70 practice / 71 neutral / 72 negative / 73 positive / **74 congruent / 75 incongruent** word, 41 correct, 42 incorrect, 43 timeout, 9 block_end |
| `MIST_Markers` | 20 block_start_exp, 1 trial_onset, 2 response, 3 feedback_onset, 9 block_end; 0 white_noise_start / stop |
| `VAS_Markers` | 60 vas_onset, 61 vas_response (`detail` = measure) |
| `Image_Markers` | 50 phase_start_viewing, 51 image_onset, 52 image_offset (`detail` = file), 99 task_end; 0 image_load_failed / images_incomplete / no_images_available |
| `Rest_Markers` | 80 rest_start, 81 rest_end |
| `Session` | 0 tasks_start, prolific_redirect, error |
| `Browser` | 0 tab_hidden / tab_visible, window_blur / window_focus, fullscreen_enter / fullscreen_exit |

### `sessions`
A `started` row and a `completed` row per person. Both carry
`participant_id, status, task ("stroop"), prolific_pid, prolific_study_id,
prolific_session_id, start_time, app_version, quick_mode, url_params,
sound_check_confirmed, fullscreen_at_start` and the device information
measured in full screen just before the first VAS:

- display: `screen_w/h` (CSS px), `screen_w_px/h_px` (physical px),
  `device_pixel_ratio`, `window_w/h`, `color_depth`, `fullscreen_active`;
- timing: `refresh_rate_hz`, `frame_ms_median/mean/sd`, `frames_dropped_pct`,
  `timer_resolution_ms`;
- system: `browser`, `browser_version`, `os`, `cpu_cores`, `device_memory_gb`,
  `max_touch_points`, `audio_sample_rate_hz`, `audio_base_latency_ms`,
  `audio_output_latency_ms`, `user_agent`, `timezone`, `language`.

The `completed` row adds `end_time, duration_min, window_blur_count,
tab_hidden_count, fullscreen_exit_count` and the frame timing measured again
at the end (`end_refresh_rate_hz, end_frame_ms_sd, end_frames_dropped_pct`).

### `demographics`
`participant_id, prolific_pid, prolific_study_id, prolific_session_id,
consent_given, consent_time, age, gender, gender_self_describe, handedness,
english_comfort (1–5), colour_vision (no/yes/not_sure), vision, education,
sleep_hours, caffeine_2h, prior_participation, keyboard, submitted`.

### `feedback`
The Stroop questions from `stress-cognition-online`, the performance question
asked for both steps, and a block about the images:

- `stroop_thrown_off` (yes / no / not_sure), `stroop_thrown_off_words`;
- `performance_change` (worse_after / no_change / better_after / not_sure;
  after vs before the arithmetic), `performance_change_detail`;
- `performance_change_images` (the same scale; after the images vs just after
  the arithmetic), `performance_change_images_detail`;
- `instructions_clarity` (1–5);
- `images_feeling` (very_negative / somewhat_negative / neutral /
  somewhat_positive / very_positive), `images_pleasant`, `images_relaxing`,
  `images_attention` (1–5), `images_mood_change` (much_worse / a_bit_worse /
  same / a_bit_better / much_better), `images_feeling_detail` (free text),
  `images_seen_before` (no / some / not_sure);
- `effort`, `arithmetic_stress` (1–5), `heard_noise`, `distracted`,
  `tech_problems`, `tech_problems_detail`, `purpose_guess`, `comments`, `submitted`.

### `summary` (one row per participant, built in the browser by `js/summary.js`)
- Per Stroop phase, prefixed `baseline_`, `post_stress_`, `post_recovery_`:
  `n_trials, n_correct, n_incorrect, n_missed, accuracy` (correct ÷
  responded), `accuracy_all` (correct ÷ all), `mean_rt, median_rt, sd_rt`
  (correct trials, RT ≥ 0.2 s), `n_focus_lost, n_late_onset` (onset frame
  > 1.5 × normal), `rt_<type>` and `acc_<type>` for congruent / incongruent /
  negative / positive / neutral, `stroop_interference_rt`,
  `stroop_interference_acc`, `emotional_interference_neg_neu / pos_neu /
  neg_pos`. Measured (test) trials only.
- Changes for each of those: `stress_*` = post_stress − baseline,
  `recovery_*` = post_recovery − post_stress, `net_*` = post_recovery − baseline.
- MIST (experimental block): `mist_n_trials, mist_accuracy, mist_n_timeouts,
  mist_mean_rt_correct, mist_final_time_limit`.
- VAS: `vas_<timepoint>_<stressed|tense|calm|composite>` for the four
  timepoints; `vas_stress_change` (post_mist − pre_mist), `vas_recovery_change`
  (post_recovery − post_mist), `vas_net_change` (post_recovery − baseline);
  `vas_image_feeling`.
- Images: `images_n_shown, images_n_replaced, images_mean_duration_ms,
  images_max_abs_onset_error_ms, images_n_focus_lost, images_total_s`.
- `participant_id, task, prolific_pid, prolific_study_id, prolific_session_id,
  quick_mode`.

### `completions` (written by the Apps Script, not the browser)
`participant_id, completed_at`: one row per person who reached the end and
uploaded everything.

---

## Analysis

**Automatic: the `dashboard` tab.** The Apps Script rebuilds it from the
`summary` tab whenever someone finishes, or on demand via **Study → Refresh
dashboard**. Quick-mode sessions and IDs starting with `test` are left out; if
someone has several summary rows, the last one counts. The tab contains:

- A header with counts of started (`sessions`), completed (`completions`) and
  analysed (with a summary row) participants, plus the median duration.
- **1. VAS:** composite, stressed, tense and calm at the four timepoints. Then
  paired change statistics (n, means, mean change, SD, dz, 95 % CI, n up /
  n down) for the stressor (pre_mist → post_mist), recovery (post_mist →
  post_recovery), net (baseline → post_recovery) and "first Stroop"
  (baseline → pre_mist). Finally, `image_feeling` mean and SD, with counts
  below, at and above 50.
- **2. Stroop:** phase means for `mean_rt, accuracy_all,
  stroop_interference_rt, emotional_interference_neg_neu / pos_neu` (people
  with all three phases), then stress / recovery / net change statistics for
  each.
- **3. Image block, MIST and data quality:** n, mean, SD, min, max and n > 0
  for images shown / replaced, mean duration, max onset error, block length,
  focus lost; MIST accuracy, trials and final time limit; Stroop focus losses
  and late onsets; session duration.
- **4. Participants:** one row per person with the VAS composites,
  image_feeling, stress and recovery changes in the main Stroop measures,
  MIST accuracy and focus losses.

With fewer than about 10 people, read the n up / n down counts and the
participant rows, not the CIs.

**On demand: `analysis/analyze.py`.** It recomputes everything from the trial
tabs (and checks its numbers against the browser's `summary` tab).

1. In the Sheet, click **Study → Create / show export key**. Keep the key private.
2. Run (Python via `uv`, no install needed):
   ```bash
   cd analysis
   uv run --python 3.10 --with pandas --with numpy --with scipy --with matplotlib --with openpyxl \
       python analyze.py --url "https://script.google.com/macros/s/.../exec" --key <key> --plots
   ```
   Or `pip install -r requirements.txt` and run `python analyze.py …`. Set
   `STUDY_URL` and `STUDY_KEY` once to skip `--url` / `--key`.

Other inputs, which can be combined (anyone found twice is taken from the
first source):
- the Sheet downloaded as `.xlsx` (`python analyze.py data.xlsx`);
- participants' JSON downloads (`stress_recovery_<ID>.json`), as files or a
  folder;
- a folder of `<tab>.csv` files.

Options:
- `--exclude` drops flagged participants.
- `--include-incomplete` keeps sessions without a `completed` row.
- `--include-quick` keeps `?quick=1` pilots.
- `--plots` saves figures.
- `--out DIR` changes the output folder (default `results/`).

The `--url` export leaves out the `events` tab to keep the download small,
so the rest-length check needs the `.xlsx` or the JSON downloads.

What it does:
1. Stroop metrics per person and phase, using the same rules as `summary.js`.
2. **Manipulation check:** the VAS composite at all four timepoints, and
   paired tests for stressor, recovery and net change (subscales too).
   `image_feeling` is tested against 50 and correlated with the VAS changes.
3. **Main effects:** stress / recovery / net change for every Stroop metric.
   Each gets the mean change with 95 % CI, paired t, Wilcoxon and Cohen's dz
   with a bootstrap CI, plus Spearman correlations with the matching VAS
   change (and, for recovery and net, with `image_feeling`). Four primary
   metrics print to the console: `mean_rt, accuracy_all,
   stroop_interference_rt, emotional_interference_neg_neu`.
4. **Across the three phases:** Friedman (+ Kendall's W) and a
   repeated-measures ANOVA (partial η², Greenhouse-Geisser). The VAS
   composite across its four timepoints gets the same.
5. **Image block quality** per person, plus the rest length when `events` is
   available.
6. **Exclusion flags** (always reported, applied with `--exclude`):
   - baseline `accuracy_all` < 0.60;
   - more than 10 % of Stroop trials with focus lost in any phase;
   - more than 10 % of trials with a late onset frame in any phase;
   - effort < 3;
   - colour vision deficiency = yes;
   - fewer than 90 % of the planned images shown;
   - more than 10 % of images with focus lost;
   - a missing Stroop phase.

   The planned image count (120, or 6 in quick mode) is hard-coded in
   `analyze.py`; keep it in step with `js/config.js`.

It works from n = 1: individual changes always print. Paired tests start at
n = 3, correlations at 4 and bootstrap CIs at 5.

Outputs in `results/`:
- `participant_metrics.csv`: everything per person, with `flag_*` columns
  and `exclusion_reasons`.
- `individual_changes.csv`: the primary changes per person (read these while
  n is small).
- `manipulation_check.csv`
- `effects.csv`
- `rm_tests.csv`
- `image_quality.csv`
- `feedback_summary.csv`
- with `--plots`: `vas_trajectory.png`, `stroop_phases.png`

## Differences from the lab protocol (for your methods section)

| | Lab (`stress-recovery-exp-with-stroop`) | Online |
|---|---|---|
| Sessions | MIST staircase in a separate first session, then one session per image condition | 1 session |
| Conditions | Positive, negative and neutral images across sessions | A single positive set (Positive Prime) |
| Image set | Fixed-seed set per condition | A fresh random 120 of 920 per person |
| Flow | Blank (2 min) → VAS → MIST → VAS → Task → Images → Blank (5 min) → VAS → Task | VAS → Stroop → VAS → MIST → VAS → Stroop → Images → fixation (1 min) → VAS + image question → Stroop |
| Baseline | No baseline Stroop; first VAS just before the MIST | Extra baseline VAS and baseline Stroop (practice folded into this run) |
| Rest after images | 5 min blank screen | 1 min fixation cross |
| Cognitive task | Emotional Stroop, or task switching as the alternative | Emotional Stroop only, with congruent and incongruent colour words added (72 trials per run) |
| MIST level | Individual (staircase) | Fixed: level 4, 5 s start, adaptive ±10 % (`mist_l5.py` defaults) |
| Recording | EEG + LSL markers | Behaviour only; markers saved in the `events` tab |
| Timing | PsychoPy, flip-locked | requestAnimationFrame-locked onsets, high-resolution key timestamps; ±1 frame plus keyboard latency (constant within a person) |
| Setting | Experimenter present (social-evaluative) | Alone at home; weaker stressor expected |

The image duration (2.5 s, no gap, 5 min), the Stroop timings, the
emotional/neutral word lists, the VAS items and the MIST settings match the
lab. All parameters are in [js/config.js](js/config.js).

## Files

```
index.html             page shell
css/style.css          layout
images/                920 Positive Prime images (1.jpg … 920.jpg, compressed)
js/config.js           ← all settings (DATA_URL, contact, Prolific code, task parameters, quick mode)
js/core.js             timing, keyboard, event log, Prolific IDs, upload with retry + local backup
js/stroop.js           4-key emotional Stroop with colour words (based on stroop.py)
js/mist.js             MIST stressor            (port of mist_l5.py / mist.py)
js/mist_bank.js        verified problems per level from question_bank.json
js/images.js           image intervention       (port of image_viewing.py)
js/image_list.js       the image pool (file names)
js/vas.js              VAS + image question     (port of vas.py)
js/forms.js            consent, demographics, setup, feedback, debrief, Prolific hand-off  ← EDIT ME texts
js/summary.js          per-participant summary row
js/main.js             session flow + 1-min fixation rest
apps_script/Code.gs    Google Apps Script receiver + dashboard (paste into the Sheet)
analysis/analyze.py    analysis script
analysis/requirements.txt
analysis/image_labels.json   per-image emotion-classifier output (reference only)
```

## Privacy notes

- No names or emails are collected. People are identified by their Prolific
  ID (or a random code / your `?pid=`). Prolific IDs are pseudonymous but
  linkable to Prolific accounts; treat the Sheet as personal data and follow
  your data-management plan.
- The Apps Script URL is write-only and public: anyone with it could add junk
  rows, but no one can read the Sheet without the export key. Don't post the
  URL publicly; the participant link is enough. Unknown tab names are
  rejected, and repeated batches are skipped.
- Every row is also backed up in the participant's browser (localStorage,
  key `stress_recovery_prolific_backup`). If an upload fails, they are asked to download the file and send it to
  you.
- The export key gives read access to all data. Keep it out of the repository.
