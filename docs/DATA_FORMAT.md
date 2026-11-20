# Data format: one JSON file per participant (schema 2.0)

Every participant produces **one self-contained JSON file** that holds every
detail of their session: IDs, condition, device, consent, demographics, every
trial of every task, every VAS rating, every image shown, the full event log,
the browser-integrity record (full-screen exits, tab switches, focus loss) and
a computed summary.

Nothing is stored in a spreadsheet. The browser builds the file and POSTs it
to a receiver (Power Automate → OneDrive/SharePoint, or an Azure Function →
Blob Storage; see `receivers/README.md`), which saves it as a file.

## Folders and file names

The receiver writes each upload to `<root>/<upload.folder>/<upload.file_name>`.
**Every upload has a new, unique file name**, so the receiver never needs to
overwrite anything.

| folder | when | file name | contents |
|---|---|---|---|
| `complete/` | once, at the very end | `<pid>__<page_load_id>.json` | **The participant's file.** Everything, `status = "complete"`. |
| `progress/` | after every step (≈ 16 per person) | `<pid>__<page_load_id>__p<seq>_<step>.json` (e.g. `…__p05_stroop-baseline.json`) | Full snapshot so far, `status = "in_progress"`. Only needed for people who drop out; safe to delete later. |
| `quit/` | when the page is closed early | `<pid>__<page_load_id>__quit_<seq>.json` | Small snapshot, `partial = 1`: no `events`, and large tables may be emptied to fit 60 KB (listed in `dropped_tables`). `status = "quit"`, or `"complete"` if the study was finished but the complete file could not be uploaded. |

`<pid>` is the participant ID made file-safe (anything other than
`A–Z a–z 0–9 _ -` becomes `_`, so `5f01…345(2)` → `5f01…345_2_`). The real ID
is inside the file. `<page_load_id>` is a random 8-character code per page
load, so two browser sessions with the same Prolific ID never collide.
`<seq>` counts every upload of that page load (progress, complete, quit), so
the newest file has the highest `upload.seq`.

For analysis: read every file in `complete/`. For drop-outs (or a finished
session whose complete file is missing), per `(participant_id, page_load_id)`:
take the sections (participant, demographics, …) from the file with the
highest `upload.seq`, but take **each table from the file that has the most
rows of it**: progress files hold every table in full, quit files may not
(`dropped_tables`). `analysis/analyze.py` does exactly this.

If no receiver is set (piloting), or the upload fails, the participant can
download the same file from the last screen (`Download data file`).

## Top level

```jsonc
{
  "schema_version": "2.0",
  "app_version": "2.0.0",
  "study": "stress_recovery_prolific",
  "upload": { "folder": "complete", "file_name": "…json", "seq": 17 },
  "status": "complete",          // in_progress | quit | complete
  "last_step": "feedback",       // last step finished (step ids: see "Steps")
  "saved_at": "2026-11-18T10:22:31.123Z",

  "participant": { … },
  "session": { … },
  "consent": { … },
  "demographics": { … },
  "mist_calibration": { … },
  "integrity": { … },
  "summary": { … },
  "feedback": { … },

  "data": {
    "stroop_trials": [ … ],
    "mist_trials":   [ … ],
    "vas":           [ … ],
    "image_trials":  [ … ],
    "events":        [ … ]
  }
}
```

Sections that were not reached are `{}` (objects) or `[]` (tables).

### `participant`
`participant_id` (Prolific ID, or `?pid=`, or random `P…`; `(2)`, `(3)` …
appended on a repeat attempt in the same browser), `attempt`,
`page_load_id`, `prolific_pid`, `prolific_study_id`, `prolific_session_id`,
`image_condition` (`positive_prime` / `positive` / `negative` / `neutral` …),
`image_condition_source` (`random` / `url` / `saved`),
`image_condition_requested` (the `?condition=` value, or `""`),
`stroop_key_mapping` (`{"match": "left", "mismatch": "right"}`),
`quick_mode` (0/1), `debug_mode` (0/1), `test_run` (1 = no Prolific ID in
the link: a pilot or launcher run; the analysis drops these by default).

### `session`
`start_time`, `end_time`, `duration_min`, `url_params`, `app_version`, `flow`
(`CONFIG.FLOW`), `steps_planned` (the steps this run was set to do; differs
from `flow` only in debug runs), `steps_run` (`[{step, start, end,
duration_s}]`), `quit_time` (only if the page was closed early),
`sound_check_confirmed`, `fullscreen_at_start`, `image_tier`, `device`
(screen/window size, pixel ratio, refresh rate, frame timing, timer
resolution, browser, OS, CPU, memory, audio latency, user agent, timezone,
language), `end_frames` (frame timing re-measured before the feedback form),
`config` (every setting of `js/config.js` this session ran with; the upload
URL is replaced by `"(set)"`), `texts_hash` (fingerprint of all of
`js/texts.js`: changes when any wording changes).

### `consent`
`consent_given` (1), `consent_time`.

### `demographics`
`age`, `gender`, `gender_self_describe`, `handedness`, `english_comfort`
(1–5), `colour_vision` (no / yes / not_sure), `vision`, `education`,
`sleep_hours`, `caffeine_2h`, **`psychoactive_drugs`** (no / yes /
prefer_not), **`psychoactive_drugs_detail`** (free text, optional; asked when
`yes`), `prior_participation`, `keyboard`, `submitted`. All values are
strings as entered.

### `mist_calibration` (from the MIST baseline block)
`n_trials`, `n_answered`, `n_correct`, `accuracy`, `mean_rt_correct`,
`median_rt_correct` (both from correct answers given with the page in focus:
`n_correct_used`; `n_excluded_focus_lost` were left out), `statistic`
(`mean` / `median`), `factor` (0.9),
`raw_time_limit` (statistic × factor), `initial_time_limit` (clamped to
`[MIN_TIME_LIMIT, MAX_TIME_LIMIT]`), `source` (`baseline`, or `default` when
the baseline had too few correct answers or was not run), `min_correct`,
`stressor_initial_time_limit` (the limit the stressor actually started with).

### `integrity` (browser behaviour; see also `events`, stream `Browser`)
```jsonc
{
  "fullscreen_exit_count": 0, "tab_hidden_count": 0, "window_blur_count": 0,
  "fullscreen_return_prompts": 0,   // times the "Return to full screen" box was shown
  "fullscreen_declined": 0,         // 1 = the browser refused full screen (never asked again)
  "fullscreen_unsupported": 0,      // 1 = this browser has no full-screen API
  "incidents_total": 3, "incidents_truncated": 0,   // the list keeps the first 1000
  "time_outside_fullscreen_s": 0,   // counted from the first time full screen was entered
  "time_hidden_s": 0, "time_blurred_s": 0,
  "by_step": { "mist": { same six fields } , … },
  "incidents": [
    { "type": "tab_hidden",          // fullscreen_exit | tab_hidden | window_blur
      "step": "stroop:post_stress", "phase": "post_stress", "during_task": 1,
      "start": "ISO", "end": "ISO", "start_time_s": 812.4, "duration_s": 3.2 }
    // an incident still going on when the file was saved: "end": null, "open": 1,
    // "duration_s" = time so far
  ]
}
```
Each trial row also carries `focus_lost` (1 if the page lost focus, was hidden
or left full screen during that trial, or still was from before) and
`fullscreen` (1 if in full screen at the end of the trial). Tracking of full
screen stops when the study itself leaves full screen before the feedback form.

### `feedback`
`stroop_difficulty` (1–5), `performance_change`, `performance_change_detail`,
`performance_change_images`, `performance_change_images_detail`,
`instructions_clarity` (1–5), `images_feeling`, `images_pleasant`,
`images_relaxing`, `images_attention` (1–5), `images_mood_change`,
`images_feeling_detail`, `images_seen_before`, `effort` (1–5),
`arithmetic_stress` (1–5), `believed_performance_counts` (1–5),
`heard_noise`, `distracted`, `tech_problems`, `tech_problems_detail`,
`purpose_guess`, `comments`, `submitted`.

## Tables (`data.*`)

All rows have `participant_id`, `session` (always 1) and `step`.

### `stroop_trials` — 2-key colour–word match Stroop
`phase` (`baseline` / `post_stress` / `post_recovery`), `block_type`
(`practice` / `test`), `is_practice` (1/0), `trial` (1-based within the
block), `word` (`RED`), `word_colour` (`red`), `ink_color` (`blue`),
`congruency` (`congruent` / `incongruent`), `trial_type` (same as
`congruency`), `correct_answer` (`match` / `mismatch`), `correct_response`
(key: `left` / `right`), `participant_response` (key or `""`),
`response_answer` (`match` / `mismatch` / `""`), `outcome` (`correct` /
`incorrect` / `missed`), `accuracy` (1 / 0 / `""` if missed), `rt` (s from
word onset, `""` if missed), `timed_out`, `trial_onset_time` (s since page
load), `onset_frame_ms`, `focus_lost`, `fullscreen`.

Congruent = the word names the ink colour (correct answer **match**);
incongruent = it names another colour (correct answer **mismatch**).

### `mist_trials`
`phase` (`mist_baseline` / `stressor`), `block` (`baseline` / `practice` /
`experimental`), `trial`, `level`, `problem`, `correct_answer`,
`participant_answer`, `accuracy`, `answered`, `outcome` (`correct` /
`incorrect` / `missed`), `timed_out`, `rt` (s; for a timeout the limit),
`time_limit` (s in force; `""` in the self-paced baseline), `max_time_s`
(baseline only: the hidden safety cap), `next_time_limit`,
`trial_start_time`, `trial_end_time` (ISO), `trial_onset_time`,
`onset_frame_ms`, `focus_lost`, `fullscreen`.

### `vas`
`timepoint` (`pre_mist` / `post_mist` / `pre_images` / `post_recovery`),
`measure` (`stressed` / `tense` / `calm`; plus `image_feeling` at
`post_recovery`: 0 = positive, 50 = neutral, 100 = negative),
`reverse_scored` (`"True"` for calm), `rating` (0–100), `rt`, `timestamp`.
Stress composite = mean(stressed, tense, 100 − calm).

### `image_trials`
`phase` (`intervention`), `image_set` and `image_condition` (the condition),
`trial`, `image_file`, `replaced_file`, `tier` (`1280` / `1920` / `""`),
`fill_mode` (`cover` / `contain_blur`), `image_w`, `image_h`,
`screen_aspect`, `planned_onset_s`, `shown` (0 = skipped because the tab was
hidden for its whole slot), `onset_s`, `onset_error_ms`, `trial_onset_time`,
`onset_frame_ms`, `offset_time`, `duration_ms`, `focus_lost`, `fullscreen`.

### `events` (marker log, same codes as the lab LSL triggers)
`phase`, `stream`, `code`, `label`, `time` (s since page load), `wall_time`,
`detail`.

| stream | codes |
|---|---|
| `Stroop_Markers` | 13 block_start, 14 practice_block_start, 1 fixation, 74 word_congruent, 75 word_incongruent, 41 response_correct, 42 response_incorrect, 43 response_timeout, 9 block_end; 0 order_constraints_relaxed |
| `MIST_Markers` | 21 block_start_baseline, 20 block_start_exp, 1 trial_onset, 2 response, 3 feedback_onset, 9 block_end; 0 white_noise_start / white_noise_stop / time_limit_set |
| `VAS_Markers` | 60 vas_onset, 61 vas_response (`detail` = measure) |
| `Image_Markers` | 50 phase_start_viewing, 51 image_onset, 52 image_offset, 99 task_end; 0 preload_start / preload_done / image_load_failed / image_skipped_hidden / images_incomplete / no_images_available |
| `Rest_Markers` | 80 rest_start, 81 rest_end |
| `Session` | 0 step_start / step_end (`detail` = step), tasks_start, instructions (`detail` = {screen, shown_s}), error |
| `Browser` | 0 tab_hidden / tab_visible, window_blur / window_focus, fullscreen_enter / fullscreen_exit (`detail` = `by_study` when the study itself leaves full screen before the feedback form; not counted), fullscreen_prompt / fullscreen_prompt_closed (`detail` = seconds waited) |
| `Debug` | 0 skip_requested (debug mode only) |

## `summary` (computed in the browser by `js/summary.js`)

- Stroop, per phase, prefixed `baseline_`, `post_stress_`, `post_recovery_`
  (test trials only): `n_trials, n_correct, n_incorrect, n_missed, accuracy`
  (correct ÷ responded), `accuracy_all` (correct ÷ all), `mean_rt, median_rt,
  sd_rt` (correct trials, rt ≥ 0.2 s), `n_focus_lost, n_late_onset`,
  `rt_congruent, rt_incongruent, acc_congruent, acc_incongruent,
  stroop_interference_rt` (incongruent − congruent),
  `stroop_interference_acc` (congruent − incongruent).
- Changes for every numeric Stroop measure: `stress_*` = post_stress −
  baseline, `recovery_*` = post_recovery − post_stress, `net_*` =
  post_recovery − baseline.
- MIST baseline: `mist_baseline_n_trials, mist_baseline_accuracy,
  mist_baseline_mean_rt_correct, mist_initial_time_limit,
  mist_time_limit_source`.
- MIST stressor (experimental block): `mist_n_trials, mist_accuracy,
  mist_n_timeouts, mist_mean_rt_correct, mist_final_time_limit`.
- VAS: `vas_<timepoint>_<stressed|tense|calm|composite>` for `pre_mist,
  post_mist, pre_images, post_recovery`; `vas_stress_change` (post_mist −
  pre_mist), `vas_task_change` (pre_images − post_mist),
  `vas_recovery_change` (post_recovery − pre_images), `vas_net_change`
  (post_recovery − pre_mist), `vas_image_feeling`.
- Images: `image_condition, images_n_planned, images_n_shown,
  images_n_skipped_hidden, images_n_replaced, images_tier, images_n_cover,
  images_n_contain_blur, images_mean_duration_ms,
  images_max_abs_onset_error_ms, images_n_focus_lost, images_total_s`.
- Integrity: `fullscreen_exit_count, tab_hidden_count, window_blur_count,
  time_outside_fullscreen_s, time_hidden_s`.
- `participant_id, prolific_pid, quick_mode, debug_mode`.

`analysis/analyze.py` recomputes all of this from the trial tables; the
trial tables are the source of truth.

## Steps (`last_step`, `step` columns, `session.flow`)

Set in `CONFIG.FLOW` (`js/config.js`). Default order:

```
consent → demographics → setup → intro
→ stroop:baseline → vas:pre_mist → mist_baseline → mist → vas:post_mist
→ stroop:post_stress → vas:pre_images → images → blank → vas:post_recovery
→ stroop:post_recovery → feedback
```
