"""
Stress and recovery (Prolific browser study): does the stressor change Stroop
performance, does performance come back after the images, and does that depend
on WHICH images a person saw (image_condition)?

Design (one sequence for everyone; image_condition varies between people):
  Stroop (baseline) -> VAS (pre_mist) -> MIST baseline (self-paced practice block;
  calibrates the time limit) -> MIST stressor -> VAS (post_mist) ->
  Stroop (post_stress) -> VAS (pre_images) -> 120 images x 2.5 s from ONE condition
  (positive_prime / positive / negative / neutral / ... - taken from the data) ->
  blank screen 1 min -> VAS (post_recovery) + image_feeling -> Stroop (post_recovery)
  -> feedback

Run it whenever new data arrive - it works from n = 1 upward. With a few people it
prints each person's changes (read those, not p-values); paired tests appear from
n = 3, bootstrap CIs from n = 5, condition comparisons once >= 2 conditions have
>= 3 people each.

Input
  One JSON file per participant (schema 2.x, see docs/DATA_FORMAT.md), as saved by
  the receiver into complete/, progress/ and quit/ (or downloaded by a participant
  from the last screen). Give any number of files and/or folders; folders are
  searched recursively for *.json. Files without a top-level schema_version
  starting with "2" are skipped with a warning.

    uv run --python 3.12 --with pandas --with numpy --with scipy --with matplotlib python analyze.py <data folder> --plots
    python analyze.py D:/OneDrive/StudyData                       # complete/ progress/ quit/ inside
    python analyze.py D:/OneDrive/StudyData --exclude             # apply the exclusion flags
    python analyze.py D:/OneDrive/StudyData --include-incomplete  # analyse drop-outs too
    python analyze.py pilot/P123__ab12cd34.json --include-quick   # a ?quick=1 pilot file
    python analyze.py D:/OneDrive/StudyData --pid 5f01abc --include-incomplete   # one person only

Which file is used for whom
  1. debug_mode = 1 files are always dropped (unless --include-debug); quick_mode = 1
     files are dropped unless --include-quick; test runs without a Prolific ID
     (participant.test_run = 1) are dropped unless --include-test.
  2. Per session (participant_id + page_load_id): the file with status "complete" if
     there is one (one from the complete/ folder first), else the one with the highest
     upload.seq (the newest snapshot). For a drop-out (or a quit/ file only), a table
     that is shorter in that file than in an earlier snapshot (quit files have no events
     and may drop large tables) is taken from the snapshot that has the most rows of it;
     empty sections are filled the same way.
  3. Per Prolific ID (participant_id without a "(2)", "(3)" ... repeat suffix): one
     session - a complete one before a partial one, then the earliest attempt
     (--first-attempt-only: always the earliest attempt). A kept session that is not
     the person's first gets the report-only flag repeat_attempt.
  4. Only complete sessions are analysed unless --include-incomplete; the others are
     always listed (with their metrics) in incomplete_participants.csv.
  files_used.csv lists every file found, whether it was used, and why not.

Steps
  1. Stroop (2-key colour-word MATCH task; congruent / incongruent trials), per
     participant x phase (baseline / post_stress / post_recovery), test trials only:
     n_trials, n_correct, n_incorrect, n_missed, accuracy (correct / responded),
     accuracy_all (correct / all), mean / median / SD RT (correct, rt >= 0.2 s),
     n_focus_lost, n_late_onset, rt_ / acc_ congruent and incongruent,
       stroop_interference_rt  = RT incongruent - RT congruent
       stroop_interference_acc = acc congruent - acc incongruent
     Changes (later - earlier): stress = post_stress - baseline,
     recovery = post_recovery - post_stress, net = post_recovery - baseline.
     PRIMARY metrics: mean_rt, accuracy_all, stroop_interference_rt,
     stroop_interference_acc. Same rules as js/summary.js; the recomputed values are
     compared with the browser's `summary` object (mismatches -> summary_check.csv).
  2. Manipulation check: VAS stress composite = mean(stressed, tense, 100 - calm) at
     pre_mist, post_mist, pre_images, post_recovery; changes stress (pre_mist ->
     post_mist), task (post_mist -> pre_images), recovery (pre_images ->
     post_recovery), net (pre_mist -> post_recovery); image_feeling (0 = positive,
     50 = neutral, 100 = negative) vs 50.
  3. Main within-subject effects, pooled over conditions, for every Stroop metric:
     mean change with 95 % CI, paired t, Wilcoxon, Cohen's dz (+ bootstrap CI),
     Spearman rho with the matching VAS change and with image_feeling; Friedman +
     repeated-measures ANOVA (Greenhouse-Geisser) across the three phases.
  4. Image condition (between subjects): per condition n / mean / SD of the recovery
     outcomes (VAS recovery & net, Stroop recovery & net of the primary metrics,
     image_feeling) with the paired recovery test inside each condition; one-way
     ANOVA (+ eta squared) and Kruskal-Wallis across conditions; pairwise Welch t-tests
     with Holm correction and Hedges' g. Stress changes are tested the same way as a
     check that the groups were stressed equally.
  5. MIST: baseline block (accuracy, mean RT of correct answers), calibration
     (initial_time_limit, source = baseline / default) and the stressor block
     (accuracy, timeouts, adaptive time limit).
  6. Image block quality and browser integrity (full-screen exits, tab switches,
     window blur, time outside full screen / hidden, per step).
  7. Exclusion flags (always reported, applied with --exclude; flags in REPORT_ONLY
     are reported but never exclude). Thresholds: the "EDIT HERE" block below.
       low_accuracy        baseline accuracy_all < 0.60
       unfocused           > 10 % of Stroop test trials with focus lost (any phase)
       timing_unreliable   > 10 % of Stroop test trials with a late stimulus frame
                           (onset frame > 1.5 x the participant's normal frame)
       low_effort          feedback effort < 3 (1-5)
       colour_blind        demographics colour_vision == yes
       images_incomplete   < 90 % of the planned images shown (planned = the number picked
                           at preload, from the Image_Markers preload_start event; without
                           that event N_IMAGES_PLANNED, or N_IMAGES_QUICK in quick mode; never
                           fewer than the number of image rows)
       images_unfocused    > 10 % of the shown images with focus lost
       missing_phase       a Stroop phase has no test trials
       left_fullscreen     > 3 full-screen exits during the tasks (integrity.incidents with
                           during_task = 1; exits missing from a truncated incident list count
                           as during the tasks), or > 60 s outside full screen in total
       tab_hidden          > 30 s with the tab hidden
     report-only:
       mist_default_limit  MIST baseline did not calibrate (mist_calibration.source = default)
       psychoactive_drugs  demographics psychoactive_drugs == yes
       doubted_reward      feedback believed_performance_counts <= 2 (1-5)
       repeat_attempt      the kept session is not the person's first one
       fullscreen_declined the browser refused full screen (full-screen flags cannot fire)

Outputs (./results/ or --out)
  participant_metrics.csv   one row per analysed person (before --exclude): ids, status,
                            image_condition, device, every phase metric, change columns
                            (stress_*, recovery_*, net_*), VAS, MIST, images, integrity,
                            demographics, feedback, flag_* columns, exclusion_reasons
                            (excluding flags) and report_flags (report-only flags)
  incomplete_participants.csv  everyone kept who did not finish (always written)
  files_used.csv            every JSON file found: ids, status, seq, used, why not
  individual_changes.csv    the main changes per person (read these while n is small)
  manipulation_check.csv    VAS by timepoint, VAS changes, image_feeling
  effects.csv               stress / recovery / net statistics for every Stroop metric
  rm_tests.csv              Friedman + RM ANOVA across the Stroop phases / VAS timepoints
  condition_descriptives.csv  per condition (and all): n, mean, SD, CI and the paired
                            test against 0 (image_feeling: against 50)
  condition_effects.csv     per outcome: omnibus (ANOVA, eta squared, Kruskal-Wallis) and
                            pairwise Welch t (Holm p, Hedges' g) between conditions
  mist.csv                  MIST baseline, calibration and stressor per analysed person
  image_quality.csv         image block per analysed person
  integrity.csv             browser integrity of EVERY kept person (any status): counts,
                            durations, incidents during the tasks, and by_step as
                            <step>__<field>
  feedback_summary.csv      counts / means of the feedback questions (all + per condition)
  summary_check.csv         only if recomputed values differ from the browser summary
  --plots: vas_trajectory.png, stroop_phases.png (pooled), vas_by_condition.png,
           stroop_by_condition.png
  --export-tables: stroop_trials.csv, mist_trials.csv, vas.csv, image_trials.csv,
           events.csv (long format, all analysed people, after --exclude)

Debugging one part without running everything
  - One person:   --pid <Prolific ID> (repeatable; add --include-incomplete for drop-outs)
  - Which file?   files_used.csv (column note says why a file was not used)
  - Fake data:    python make_test_data.py <folder>  then  python analyze.py <folder>
  - In Python:    import analyze as A
                  kept, log = A.load_records([Path("data")])
                  tabs, sec = A.build_tables(kept), A.build_sections(kept)
                  A.stroop_test_trials(tabs["stroop_trials"])   # or A.vas_table(tabs["vas"]) ...
                  df, imgq = A.participant_table(kept, tabs, sec)

Needs pandas, numpy, scipy (matplotlib for --plots):  pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

# ════════════════════════════════════════════════════════════════════════════
# ── EDIT HERE ── exclusion thresholds, planned image count, report-only flags
# ════════════════════════════════════════════════════════════════════════════
# Every flag is computed and reported for everyone; --exclude drops people
# with at least one flag that is NOT in REPORT_ONLY.
MIN_ACCURACY_ALL = 0.60        # low_accuracy: baseline Stroop accuracy_all (misses count as errors) below this
MAX_FOCUS_LOST = 0.10          # unfocused: share of Stroop test trials with focus_lost = 1 (in any phase) above this
MAX_LATE_ONSET = 0.10          # timing_unreliable: share of Stroop test trials with a late stimulus frame above this
LATE_FACTOR = 1.5              #   "late" = onset_frame_ms > LATE_FACTOR x session.device.frame_ms_median
MIN_EFFORT = 3                 # low_effort: feedback effort (1-5) below this
MIN_IMAGES_SHOWN = 0.90        # images_incomplete: share of the planned images actually shown below this
MAX_IMAGES_FOCUS_LOST = 0.10   # images_unfocused: share of the shown images with focus lost above this
MAX_FULLSCREEN_EXITS = 3       # left_fullscreen: more full-screen exits than this DURING THE TASKS ...
MAX_OUTSIDE_FULLSCREEN_S = 60  #   ... or more seconds outside full screen than this
MAX_HIDDEN_S = 30              # tab_hidden: more seconds with the tab hidden DURING THE TASKS than this
MAX_BELIEVED_COUNTS = 2        # doubted_reward: believed_performance_counts (1-5) at or below this

# Planned number of images per person, used ONLY when a file has no preload_start
# event (quit files have no events); otherwise the number the browser picked at
# preload is used. Keep equal to CONFIG.IMAGES.N_IMAGES in js/config.js (and to
# the ?quick=1 value set in applyQuickMode there).
N_IMAGES_PLANNED = 120
N_IMAGES_QUICK = 6

# Flags in this set are reported (flag_* columns, report_flags) but never
# exclude anyone. Remove a name from the set to make --exclude use it.
REPORT_ONLY = {
    "mist_default_limit",   # MIST baseline did not calibrate the time limit (source = default)
    "psychoactive_drugs",   # demographics psychoactive_drugs == yes
    "doubted_reward",       # feedback believed_performance_counts <= MAX_BELIEVED_COUNTS
    "repeat_attempt",       # the kept session is not the first one of this Prolific ID
    "fullscreen_declined",  # the browser refused full screen, so left_fullscreen cannot fire
}

# Image conditions come from the data (participant.image_condition) - never a
# fixed list, so new condition folders need no change here. CONDITION_ORDER only
# sets the order (and colours) in tables and plots; conditions not listed are
# added after these, alphabetically.
CONDITION_ORDER = ["positive_prime", "positive", "neutral", "negative"]

# Statistics: minimum numbers of people.
MIN_N_TESTS = 3   # paired / repeated-measures / between-condition tests (per condition) from this many
MIN_N_STATS = 5   # bootstrap CIs from this many
MIN_N_CORR = 4    # correlations from this many
N_BOOT = 5000
RNG = np.random.default_rng(2026)
# ════════════════════════════════════════════════════════════════════════════

# ── Study structure (matches the browser app; change only if the app changes) ─
MIN_RT = 0.2   # s; faster correct responses are anticipations (same as js/summary.js)
PHASES = ["baseline", "post_stress", "post_recovery"]   # stroop_trials.phase
CONTRASTS = {  # name: (earlier, later); change = later - earlier
    "stress": ("baseline", "post_stress"),
    "recovery": ("post_stress", "post_recovery"),
    "net": ("baseline", "post_recovery"),
}
VAS_TIMEPOINTS = ["pre_mist", "post_mist", "pre_images", "post_recovery"]
VAS_ITEMS = ["stressed", "tense", "calm"]   # composite = mean(stressed, tense, 100 - calm)
VAS_CONTRASTS = {  # column vas_<name>_change = later - earlier (same names as the browser summary)
    "stress": ("pre_mist", "post_mist"),          # the stressor
    "task": ("post_mist", "pre_images"),          # the post-stress Stroop
    "recovery": ("pre_images", "post_recovery"),  # images + blank screen
    "net": ("pre_mist", "post_recovery"),
}
CONGRUENCY = ["congruent", "incongruent"]
METRICS = (["mean_rt", "median_rt", "sd_rt", "accuracy", "accuracy_all", "n_missed"]
           + [f"rt_{c}" for c in CONGRUENCY] + [f"acc_{c}" for c in CONGRUENCY]
           + ["stroop_interference_rt", "stroop_interference_acc"])
PRIMARY = ["mean_rt", "accuracy_all", "stroop_interference_rt", "stroop_interference_acc"]

# ── EDIT HERE ── what the condition analysis compares between image conditions.
# Any column of participant_metrics.csv can be added.
CONDITION_OUTCOMES = (["vas_recovery_change", "vas_net_change"]
                      + [f"recovery_{m}" for m in PRIMARY] + [f"net_{m}" for m in PRIMARY]
                      + ["vas_image_feeling"])
CONDITION_CHECKS = ["vas_stress_change"] + [f"stress_{m}" for m in PRIMARY]   # were all groups stressed alike?

DEMOGRAPHICS = ["age", "gender", "gender_self_describe", "handedness", "english_comfort", "colour_vision",
                "vision", "education", "sleep_hours", "caffeine_2h", "psychoactive_drugs",
                "psychoactive_drugs_detail", "prior_participation", "keyboard"]
FEEDBACK_SCALES = ["stroop_difficulty", "instructions_clarity", "images_pleasant", "images_relaxing",
                   "images_attention", "effort", "arithmetic_stress", "believed_performance_counts"]   # 1-5
FEEDBACK_CHOICES = {  # option order as in js/forms.js
    "images_feeling": ["very_negative", "somewhat_negative", "neutral", "somewhat_positive", "very_positive"],
    "images_mood_change": ["much_worse", "a_bit_worse", "same", "a_bit_better", "much_better"],
    "images_seen_before": ["no", "some", "not_sure"],
    "performance_change": ["worse_after", "no_change", "better_after", "not_sure"],
    "performance_change_images": ["worse_after", "no_change", "better_after", "not_sure"],
    "heard_noise": ["yes", "no", "sound_off"],
    "distracted": ["no", "briefly", "a_lot"],
    "tech_problems": ["no", "yes"],
}
FEEDBACK_SCORED = ["images_feeling", "images_mood_change"]   # options scored -2 .. +2
FEEDBACK_TEXT = ["performance_change_detail", "performance_change_images_detail", "images_feeling_detail",
                 "tech_problems_detail", "purpose_guess", "comments"]
DEVICE_INFO = ["browser", "browser_version", "os", "screen_w_px", "screen_h_px", "device_pixel_ratio",
               "window_w", "window_h", "refresh_rate_hz", "frame_ms_median", "frames_dropped_pct",
               "timer_resolution_ms"]
INTEGRITY_FIELDS = ["fullscreen_exit_count", "tab_hidden_count", "window_blur_count", "fullscreen_return_prompts",
                    "fullscreen_declined", "time_outside_fullscreen_s", "time_hidden_s", "time_blurred_s"]
INCIDENT_TYPES = ["fullscreen_exit", "tab_hidden", "window_blur", "resize"]

SECTIONS = ["participant", "session", "consent", "demographics", "mist_calibration", "integrity", "summary",
            "feedback"]
TABLES = ["stroop_trials", "mist_trials", "vas", "image_trials", "events"]
STATUSES = ["complete", "quit", "in_progress"]
ATTEMPT_RE = re.compile(r"^(.*?)\s*\((\d+)\)$")   # "5f01...345(2)" -> ("5f01...345", 2)


# ── Small helpers ───────────────────────────────────────────────────────────
def _col(df: pd.DataFrame, name: str) -> pd.Series:
    return df[name] if name in df else pd.Series(np.nan, index=df.index, dtype=float)


def _num(s: pd.Series) -> pd.Series:
    """Numbers from JSON values ("" -> NaN, true/false -> 1/0)."""
    if s.dtype == bool:
        return s.astype(float)
    out = pd.to_numeric(s, errors="coerce")
    if pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s):
        words = s.astype(str).str.strip().str.lower().map({"true": 1.0, "false": 0.0})
        out = out.where(out.notna(), words)
    return out.astype(float)


def _text(s: pd.Series) -> pd.Series:
    s = s.astype(object)
    return s.where(s.notna(), "").astype(str).str.strip().replace({"nan": "", "None": "", "NaN": ""})


def _float(v) -> float:
    if v is None or isinstance(v, (bool, np.bool_)) or (isinstance(v, str) and not v.strip()):
        return np.nan
    try:
        return float(v)
    except (TypeError, ValueError):
        return np.nan


def _str(v) -> str:
    if v is None or (np.ndim(v) == 0 and not isinstance(v, str) and pd.isna(v)):   # None, NaN, pd.NA, NaT
        return ""
    return str(v).strip()


def _is1(v) -> bool:
    return str(v).strip().lower() in ("1", "1.0", "true")


def _obj(d: dict, key: str) -> dict:
    v = d.get(key) if isinstance(d, dict) else None
    return v if isinstance(v, dict) else {}


def _quiet(fn, *args, **kw):
    """Run a scipy test, returning None instead of raising on degenerate input."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return fn(*args, **kw)
        except (ValueError, ZeroDivisionError, FloatingPointError, TypeError):
            return None


def _ts(v) -> pd.Timestamp:
    """One ISO time -> UTC Timestamp (NaT if missing or unreadable)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            t = pd.to_datetime(_str(v) or None, utc=True, errors="coerce")
        except (TypeError, ValueError):
            return pd.NaT
    return t if isinstance(t, pd.Timestamp) else pd.NaT


def _tkey(t: pd.Timestamp) -> float:
    return float(t.value) if pd.notna(t) else np.inf


def split_attempt(pid: str) -> tuple[str, int]:
    """Participant code -> (code without a "(n)" repeat suffix, attempt number)."""
    m = ATTEMPT_RE.match(pid)
    return (m.group(1), int(m.group(2))) if m and m.group(1) else (pid, 1)


def _ints(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Whole-number columns as nullable integers (16 instead of 16.0 in the CSVs and the console)."""
    for c in cols:
        if c in df:
            x = pd.to_numeric(df[c], errors="coerce")
            if ((x.dropna() % 1) == 0).all():
                df[c] = x.astype("Int64")
    return df


def flatten(d: dict, prefix: str = "", sep: str = "__") -> dict:
    """Nested dicts -> one level ("device__browser"); lists -> JSON text."""
    out: dict = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + sep, sep))
        elif isinstance(v, list):
            out[key] = json.dumps(v)
        else:
            out[key] = v
    return out


# ── Loading: files -> one record per participant ────────────────────────────
@dataclass
class Record:
    """One participant JSON file."""
    path: Path
    j: dict
    pid: str
    base: str
    attempt: int
    page_load: str
    status: str
    seq: float
    saved: pd.Timestamp
    start: pd.Timestamp
    quick: bool
    debug: bool
    test: bool = False      # participant.test_run = 1: no Prolific ID (pilot / launcher / bare URL)
    n_sessions: int = 1
    repeat: bool = False
    notes: list = field(default_factory=list)


def find_json_files(srcs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for src in srcs:
        if not src.exists():
            raise SystemExit(f"Not found: {src}")
        files += sorted(p for p in src.rglob("*.json") if p.is_file()) if src.is_dir() else [src]
    seen, out = set(), []
    for p in files:
        r = p.resolve()
        if r not in seen:
            seen.add(r)
            out.append(p)
    return out


def read_record(p: Path) -> tuple[Record | None, str]:
    """(record, "") for a schema 2.x participant file, else (None, why it was skipped)."""
    try:
        with open(p, encoding="utf-8-sig") as f:
            j = json.load(f)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
        return None, f"not readable as JSON ({type(e).__name__})"
    if not isinstance(j, dict) or not str(j.get("schema_version", "")).strip().startswith("2"):
        return None, "no schema_version 2.x (not a participant file of this app version)"
    part, summ = _obj(j, "participant"), _obj(j, "summary")
    pid = _str(part.get("participant_id")) or _str(summ.get("participant_id"))
    if not pid:
        for rows in _obj(j, "data").values():
            if isinstance(rows, list) and rows and isinstance(rows[0], dict) and _str(rows[0].get("participant_id")):
                pid = _str(rows[0]["participant_id"])
                break
    if not pid:
        return None, "no participant_id"
    base, suffix_attempt = split_attempt(pid)
    att = _float(part.get("attempt"))
    seq = _float(_obj(j, "upload").get("seq"))
    return Record(
        path=p, j=j, pid=pid, base=base,
        attempt=int(att) if np.isfinite(att) and att >= 1 else suffix_attempt,
        page_load=_str(part.get("page_load_id")),
        status=_str(j.get("status")).lower() or "in_progress",
        seq=seq if np.isfinite(seq) else -1.0,
        saved=_ts(j.get("saved_at")),
        start=_ts(_obj(j, "session").get("start_time")),
        quick=_is1(part.get("quick_mode", summ.get("quick_mode", 0))),
        debug=_is1(part.get("debug_mode", summ.get("debug_mode", 0))),
        test=_is1(part.get("test_run", 0)),
    ), ""


def _backfill(best: Record, others: list[Record]) -> None:
    """Snapshots only grow within one session, so for a drop-out take each table
    from whichever snapshot has the most rows of it (quit files have no events and
    may drop large tables), and fill empty sections from the newest snapshot that has them."""
    data = best.j.get("data") if isinstance(best.j.get("data"), dict) else {}
    best.j["data"] = data
    names = {k for o in others for k, v in _obj(o.j, "data").items() if isinstance(v, list)}
    for name in sorted(names):
        cur = data.get(name) if isinstance(data.get(name), list) else []
        cands = [o for o in others if isinstance(_obj(o.j, "data").get(name), list)]
        cand = max(cands, key=lambda o: (len(o.j["data"][name]), o.seq))
        if len(cand.j["data"][name]) > len(cur):
            data[name] = cand.j["data"][name]
            best.notes.append(f"{name} from {cand.path.name}")
    for sec in SECTIONS:
        if not _obj(best.j, sec):
            have = [o for o in others if _obj(o.j, sec)]
            if have:
                src = max(have, key=lambda o: o.seq)
                best.j[sec] = src.j[sec]
                best.notes.append(f"{sec} from {src.path.name}")


def select_records(recs: list[Record], include_quick: bool = False, include_debug: bool = False,
                   first_attempt_only: bool = False, only: list[str] | None = None,
                   include_test: bool = False) -> tuple[list[Record], dict]:
    """Apply the file rules (see the docstring). Returns (kept records, {id(record): reason not used})."""
    why: dict[int, str] = {}
    usable = []
    for r in recs:
        if r.debug and not include_debug:
            why[id(r)] = "debug_mode = 1 (--include-debug keeps it)"
        elif r.quick and not include_quick:
            why[id(r)] = "quick_mode = 1 (--include-quick keeps it)"
        elif r.test and not include_test:
            why[id(r)] = "test_run = 1: no Prolific ID (--include-test keeps it)"
        elif only and r.pid not in only and r.base not in only:
            why[id(r)] = "not in --pid"
        else:
            usable.append(r)

    # 1. One file per session (participant_id + page_load_id).
    # A file in the complete/ folder beats everything. js/data.js quitFlush() can also put a
    # status "complete" file into quit/ (page closed while the final upload was running): it has
    # a higher seq but no events and maybe dropped tables, so it must not win over complete/.
    in_complete_folder = lambda r: _str(_obj(r.j, "upload").get("folder")) == "complete"
    sessions: dict[tuple[str, str], list[Record]] = {}
    for r in usable:
        sessions.setdefault((r.pid, r.page_load), []).append(r)
    per_session = []
    for rs in sessions.values():
        rs.sort(key=lambda r: (r.status == "complete", in_complete_folder(r), r.seq, _tkey(r.saved)))
        best = rs[-1]
        for r in rs[:-1]:
            why[id(r)] = f"older snapshot of the same session (used {best.path.name})"
        if len(rs) > 1 and not (best.status == "complete" and in_complete_folder(best)):
            _backfill(best, rs[:-1])   # quit/ files (any status) may lack events and dropped tables
        per_session.append(best)

    # 2. One session per Prolific ID: complete before partial, then the earliest attempt.
    by_base: dict[str, list[Record]] = {}
    for r in per_session:
        by_base.setdefault(r.base, []).append(r)
    kept = []
    for rs in by_base.values():
        chrono = sorted(rs, key=lambda r: (r.attempt, _tkey(r.start), _tkey(r.saved), r.seq))
        pick = chrono[0] if first_attempt_only else sorted(chrono, key=lambda r: r.status != "complete")[0]
        pick.n_sessions, pick.repeat = len(rs), chrono.index(pick) > 0
        for r in rs:
            if r is not pick:
                why[id(r)] = f"another session of this Prolific ID was used ({pick.pid}, {pick.status})"
        kept.append(pick)
    return kept, why


def load_records(srcs: list[Path], include_quick: bool = False, include_debug: bool = False,
                 first_attempt_only: bool = False, only: list[str] | None = None,
                 verbose: bool = True, include_test: bool = False) -> tuple[list[Record], pd.DataFrame]:
    """Files/folders -> (kept records, files_used table)."""
    files = find_json_files(srcs)
    if not files:
        raise SystemExit("No .json files found.")
    recs, skipped = [], []
    for p in files:
        r, reason = read_record(p)
        if r is None:
            skipped.append((p, reason))
        else:
            recs.append(r)
    if skipped and verbose:
        print(f"Warning: skipped {len(skipped)} file(s) that are not schema 2.x participant files:")
        for p, reason in skipped[:10]:
            print(f"  {p}: {reason}")
        if len(skipped) > 10:
            print(f"  ... and {len(skipped) - 10} more (see files_used.csv)")
    kept, why = select_records(recs, include_quick, include_debug, first_attempt_only, only, include_test)
    kept_ids = {id(r) for r in kept}
    log = [{"file": str(r.path), "folder": _str(_obj(r.j, "upload").get("folder")), "participant_id": r.pid,
            "page_load_id": r.page_load, "status": r.status, "seq": r.seq, "last_step": _str(r.j.get("last_step")),
            "saved_at": _str(r.j.get("saved_at")), "quick_mode": int(r.quick), "debug_mode": int(r.debug),
            "used": int(id(r) in kept_ids),
            "note": why.get(id(r), "; ".join(["filled " + n for n in r.notes]))} for r in recs]
    log += [{"file": str(p), "used": 0, "note": reason} for p, reason in skipped]
    log_df = pd.DataFrame(log)
    if verbose:
        n_dbg = sum(1 for r in recs if r.debug and id(r) not in kept_ids)
        n_q = sum(1 for r in recs if r.quick and not r.debug and id(r) not in kept_ids)
        print(f"Found {len(files)} file(s): {len(recs)} participant file(s) from {len({r.pid for r in recs})} "
              f"code(s); using {len(kept)} (one per Prolific ID)")
        if n_dbg:
            print(f"Skipped {n_dbg} debug_mode file(s) (--include-debug keeps them)")
        if n_q:
            print(f"Skipped {n_q} ?quick=1 pilot file(s) (--include-quick keeps them)")
        n_t = sum(1 for r in recs if r.test and not r.quick and not r.debug and id(r) not in kept_ids)
        if n_t:
            print(f"Skipped {n_t} test-run file(s) without a Prolific ID (--include-test keeps them)")
        multi = [r for r in kept if r.n_sessions > 1]
        if multi:
            print(f"Note: {len(multi)} Prolific ID(s) have more than one session; used:")
            for r in multi:
                print(f"  {r.base:<26} {r.n_sessions} sessions -> {r.pid} ({r.status}, attempt {r.attempt})"
                      + ("  [not the first session: flag repeat_attempt]" if r.repeat else ""))
        for r in kept:
            if r.notes:
                print(f"Note: {r.pid} ({r.status}): filled from earlier snapshots - {'; '.join(r.notes)}")
    if not kept:
        raise SystemExit("No usable participant files (see the notes above).")
    return kept, log_df


def build_tables(kept: list[Record]) -> dict[str, pd.DataFrame]:
    """data.* of every kept record -> one long DataFrame per table (rows are the JSON objects)."""
    parts: dict[str, list[pd.DataFrame]] = {}
    for r in kept:
        for name, rows in _obj(r.j, "data").items():
            if isinstance(rows, list) and rows:
                d = pd.DataFrame([x for x in rows if isinstance(x, dict)])
                if len(d):
                    d["participant_id"] = r.pid   # the record's ID (rows carry the same)
                    parts.setdefault(name, []).append(d)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)
        out = {k: pd.concat(v, ignore_index=True) for k, v in parts.items()}
    for name in TABLES:
        out.setdefault(name, pd.DataFrame(columns=["participant_id"]))
    return out


def build_sections(kept: list[Record]) -> dict[str, pd.DataFrame]:
    """Object sections -> one row per participant (index = participant_id; nested keys joined by "__")."""
    idx = pd.Index([r.pid for r in kept], name="participant_id")
    return {s: pd.DataFrame([flatten(_obj(r.j, s)) for r in kept], index=idx) for s in SECTIONS}


# ── Per-phase Stroop metrics (same rules as js/summary.js) ─────────────────
def stroop_test_trials(t: pd.DataFrame) -> pd.DataFrame:
    """Test (non-practice) Stroop trials with clean text columns."""
    cols = ["participant_id", "phase", "block_type", "trial", "congruency", "outcome", "rt"]
    if t is None or t.empty or "phase" not in t:
        return pd.DataFrame(columns=cols)
    t = t.copy()
    for c in ("outcome", "phase", "block_type", "congruency", "trial_type"):
        if c in t:
            t[c] = _text(t[c])
    if "congruency" not in t or (t.congruency == "").all():
        t["congruency"] = _text(_col(t, "trial_type"))
    if "outcome" not in t:
        acc = _num(_col(t, "accuracy"))
        t["outcome"] = np.where(acc == 1, "correct", np.where(acc == 0, "incorrect", "missed"))
    bt, prac = _text(_col(t, "block_type")), _num(_col(t, "is_practice"))
    t = t[(bt == "test") | ((bt == "") & (prac == 0))]
    n0 = len(t)
    t = t.drop_duplicates([c for c in ("participant_id", "phase", "block_type", "trial") if c in t], keep="first")
    if len(t) < n0:
        print(f"Note: dropped {n0 - len(t)} duplicate Stroop trial row(s)")
    return t


def _rts(df: pd.DataFrame) -> pd.Series:
    rt = _num(df.rt)
    return rt[(df.outcome == "correct") & (rt >= MIN_RT)]


def _acc(df: pd.DataFrame) -> float:
    resp = df[df.outcome != "missed"]
    return (resp.outcome == "correct").mean() if len(resp) else np.nan


def phase_metrics(df: pd.DataFrame, late_limit: float) -> dict:
    rt = _rts(df)
    n = len(df)
    focus = int((_num(_col(df, "focus_lost")) == 1).sum())
    m = {
        "n_trials": n,
        "n_correct": int((df.outcome == "correct").sum()),
        "n_incorrect": int((df.outcome == "incorrect").sum()),
        "n_missed": int((df.outcome == "missed").sum()),
        "accuracy": _acc(df),
        "accuracy_all": (df.outcome == "correct").mean() if n else np.nan,
        "mean_rt": rt.mean(),
        "median_rt": rt.median(),
        "sd_rt": rt.std(ddof=1) if len(rt) > 1 else np.nan,
        "n_focus_lost": focus,
        "focus_lost_share": focus / n if n else np.nan,
    }
    if np.isfinite(late_limit):
        late = int((_num(_col(df, "onset_frame_ms")) > late_limit).sum())
        m["n_late_onset"], m["late_onset_share"] = late, (late / n if n else np.nan)
    else:   # normal frame duration unknown
        m["n_late_onset"] = m["late_onset_share"] = np.nan
    rt_c = {c: _rts(df[df.congruency == c]).mean() for c in CONGRUENCY}
    acc_c = {c: _acc(df[df.congruency == c]) for c in CONGRUENCY}
    m.update({f"rt_{c}": v for c, v in rt_c.items()})
    m.update({f"acc_{c}": v for c, v in acc_c.items()})
    m["stroop_interference_rt"] = rt_c["incongruent"] - rt_c["congruent"]
    m["stroop_interference_acc"] = acc_c["congruent"] - acc_c["incongruent"]
    return m


# ── Other per-participant tables ───────────────────────────────────────────
def vas_table(vas: pd.DataFrame) -> pd.DataFrame:
    if vas is None or vas.empty or "timepoint" not in vas or "measure" not in vas:
        return pd.DataFrame()
    v = vas.assign(rating=_num(vas.rating), timepoint=_text(vas.timepoint), measure=_text(vas.measure))
    v = v.drop_duplicates(["participant_id", "timepoint", "measure"], keep="last")
    wide = v.pivot(index="participant_id", columns=["timepoint", "measure"], values="rating")
    wide.columns = [f"{tp}|{m}" for tp, m in wide.columns]
    out = pd.DataFrame(index=wide.index)
    get = lambda c: wide[c] if c in wide else pd.Series(np.nan, index=wide.index)
    for tp in VAS_TIMEPOINTS:
        for m in VAS_ITEMS:
            out[f"vas_{tp}_{m}"] = get(f"{tp}|{m}")
        out[f"vas_{tp}_composite"] = (out[f"vas_{tp}_stressed"] + out[f"vas_{tp}_tense"]
                                      + (100 - out[f"vas_{tp}_calm"])) / 3
    for name, (a, b) in VAS_CONTRASTS.items():
        out[f"vas_{name}_change"] = out[f"vas_{b}_composite"] - out[f"vas_{a}_composite"]
    img = v[v.measure == "image_feeling"].drop_duplicates("participant_id", keep="last")
    out["vas_image_feeling"] = img.set_index("participant_id").rating.reindex(out.index)
    return out


def mist_table(mist: pd.DataFrame, cal: pd.DataFrame) -> pd.DataFrame:
    """MIST baseline block + calibration (mist_calibration) + stressor (experimental block), per person."""
    if mist is None or mist.empty or "block" not in mist:
        mist = pd.DataFrame(columns=["participant_id", "block", "trial", "accuracy", "rt"])
    block = _text(mist.block)
    pids = sorted(set(mist.participant_id) | set(cal.index[cal.notna().any(axis=1)] if len(cal.columns) else []))
    rows = {}
    for pid in pids:
        mine = mist.participant_id == pid
        b, e = mist[mine & (block == "baseline")], mist[mine & (block == "experimental")]
        b, e = (g.assign(_t=_num(_col(g, "trial"))).sort_values("_t", kind="stable") for g in (b, e))
        acc_b, rt_b = _num(_col(b, "accuracy")), _num(_col(b, "rt"))
        r = {
            "mist_baseline_n_trials": len(b),
            "mist_baseline_n_answered": int((_num(_col(b, "answered")) == 1).sum()),
            "mist_baseline_n_correct": int((acc_b == 1).sum()),
            "mist_baseline_accuracy": (acc_b == 1).mean() if len(b) else np.nan,   # correct / all baseline trials
            "mist_baseline_mean_rt_correct": rt_b[acc_b == 1].mean(),
            "mist_baseline_median_rt_correct": rt_b[acc_b == 1].median(),
            "mist_baseline_n_capped": int((_num(_col(b, "timed_out")) == 1).sum()),   # hit the hidden safety cap
        }
        c = cal.loc[pid] if pid in cal.index else pd.Series(dtype=object)
        r["mist_initial_time_limit"] = _float(c.get("initial_time_limit"))
        r["mist_time_limit_source"] = _str(c.get("source"))
        for k in ("n_trials", "n_correct", "accuracy", "mean_rt_correct", "median_rt_correct", "statistic",
                  "factor", "raw_time_limit", "min_correct"):
            r[f"mist_cal_{k}"] = c.get(k, np.nan)
        r["mist_n_practice"] = int((mine & (block == "practice")).sum())
        # Stressor (js/mist.js): time_limit = limit in force on the trial,
        # next_time_limit = limit after it (changes only after 3 alike answers in a row).
        acc, rt = _num(_col(e, "accuracy")), _num(_col(e, "rt"))
        lim, nxt = _num(_col(e, "time_limit")), _num(_col(e, "next_time_limit"))
        r.update({
            "mist_n_trials": len(e),
            "mist_accuracy": (acc == 1).mean() if len(e) else np.nan,
            "mist_n_timeouts": int((_num(_col(e, "timed_out")) == 1).sum()),
            "mist_mean_rt_correct": rt[acc == 1].mean(),
            "mist_time_limit_start": lim.iloc[0] if len(e) else np.nan,
            "mist_time_limit_min": lim.min(),
            "mist_time_limit_max": lim.max(),
            "mist_n_limit_changes": int((nxt.notna() & lim.notna() & ((nxt - lim).abs() > 1e-6)).sum()),
            "mist_final_time_limit": nxt.iloc[-1] if len(e) else np.nan,
        })
        rows[pid] = r
    out = pd.DataFrame.from_dict(rows, orient="index")
    if len(out):
        d = (out.mist_time_limit_start - out.mist_initial_time_limit).abs()
        odd = out.index[d > 1e-3]
        if len(odd):
            print(f"Note: first MIST stressor time limit differs from mist_calibration.initial_time_limit for "
                  f"{', '.join(odd)}")
    return out


def _preload_counts(ev: pd.DataFrame) -> dict[str, float]:
    """Images picked at preload per participant (events: Image_Markers preload_start, detail {"n": ...})."""
    if ev is None or ev.empty or "label" not in ev or "detail" not in ev:
        return {}
    e = ev[_text(ev.label) == "preload_start"]
    out = {}
    for pid, detail in zip(e.participant_id, e.detail):
        try:
            n = (detail if isinstance(detail, dict) else json.loads(str(detail))).get("n")
        except (json.JSONDecodeError, AttributeError):
            continue
        if isinstance(n, (int, float)) and n > 0:
            out[pid] = float(n)
    return out


def image_quality(img: pd.DataFrame, ev: pd.DataFrame, pids: list[str], quick: dict[str, bool]) -> pd.DataFrame:
    if img is None or img.empty:
        img = pd.DataFrame(columns=["participant_id"])
    picked = _preload_counts(ev)
    rows = []
    for pid in pids:
        g = img[img.participant_id == pid]
        if "trial" in g:
            g = g.assign(_t=_num(g.trial)).sort_values("_t", kind="stable")
        shown_col = _num(_col(g, "shown"))
        s = g[shown_col.fillna(1) == 1]
        n_rows, n = len(g), len(s)
        # Planned = images picked at preload (includes images that never loaded, which leave no
        # row; follows CONFIG.IMAGES.N_IMAGES / REPEAT_IF_FEWER automatically). Only when the
        # preload event is missing (e.g. a quit file) fall back to the constants at the top.
        planned_constant = N_IMAGES_QUICK if quick.get(pid) else N_IMAGES_PLANNED
        denom = int(max(picked[pid], n_rows) if pid in picked else max(planned_constant, n_rows))
        dur, err = _num(_col(s, "duration_ms")), _num(_col(s, "onset_error_ms")).abs()
        fill = _text(_col(s, "fill_mode"))
        tier = _text(_col(g, "tier")).str.replace(r"\.0$", "", regex=True)
        tier = tier[tier != ""]
        conds = sorted(set(_text(_col(g, "image_condition"))) - {""})
        r = {
            "participant_id": pid,
            "images_condition_rows": ";".join(conds),
            "images_n_planned": n_rows,   # image rows, as js/summary.js
            "images_n_expected": denom,   # picked at preload (or the planned constant), at least the rows
            "images_n_picked": picked.get(pid, np.nan),
            "images_n_shown": n,
            "images_n_skipped_hidden": int((shown_col == 0).sum()),
            "images_share_shown": n / denom if denom else np.nan,
            "images_tier": tier.iloc[0] if len(tier) else "",
            "images_n_cover": int((fill == "cover").sum()),
            "images_n_contain_blur": int((fill == "contain_blur").sum()),
            "images_screen_aspect": _num(_col(g, "screen_aspect")).median(),
            "images_n_replaced": int((_text(_col(g, "replaced_file")) != "").sum()),
            "images_mean_duration_ms": dur.mean(),
            "images_min_duration_ms": dur.min(),
            "images_max_duration_ms": dur.max(),
            "images_max_abs_onset_error_ms": err.max(),
            "images_n_focus_lost": int((_num(_col(g, "focus_lost")) == 1).sum()),   # all rows, as js/summary.js
            "images_focus_lost_share": (int((_num(_col(s, "focus_lost")) == 1).sum()) / n) if n else np.nan,
            "images_n_not_fullscreen": int((_num(_col(s, "fullscreen")) == 0).sum()),
            "images_total_s": (_num(_col(s, "offset_time")).max() - _num(_col(s, "trial_onset_time")).min()) if n else np.nan,
        }
        if ev is not None and "stream" in ev:
            e = ev[(ev.participant_id == pid) & (_text(ev.stream) == "Rest_Markers")]
            code, t = _num(_col(e, "code")), _num(_col(e, "time"))
            if (code == 80).any() and (code == 81).any():
                r["rest_s"] = t[code == 81].iloc[-1] - t[code == 80].iloc[-1]
        rows.append(r)
    return pd.DataFrame(rows)


def integrity_table(kept: list[Record]) -> pd.DataFrame:
    """integrity section per person: totals, incidents during the tasks, by_step as <step>__<field>."""
    rows = []
    for r in kept:
        integ = _obj(r.j, "integrity")
        row = {"participant_id": r.pid}
        row.update({f: _float(integ.get(f)) for f in INTEGRITY_FIELDS})
        inc = integ.get("incidents")
        if isinstance(inc, list):
            inc = pd.DataFrame([x for x in inc if isinstance(x, dict)])
            typ, task = _text(_col(inc, "type")), _num(_col(inc, "during_task")) == 1
            dur = _num(_col(inc, "duration_s"))
            row["n_incidents"] = len(inc)
            row["n_incidents_during_tasks"] = int(task.sum())
            for t in INCIDENT_TYPES:
                row[f"{t}_during_tasks"] = int(((typ == t) & task).sum())
            row["time_hidden_during_tasks_s"] = float(dur[(typ == "tab_hidden") & task].sum())
            row["time_outside_fullscreen_during_tasks_s"] = float(dur[(typ == "fullscreen_exit") & task].sum())
            row["incidents_available"] = 1
            # The browser keeps at most 1000 incidents, and a quit file only the last 50: exits
            # missing from the list are counted as during the tasks (conservative, as below).
            missing = row["fullscreen_exit_count"] - int((typ == "fullscreen_exit").sum())
            row["incidents_truncated"] = int(np.isfinite(missing) and missing > 0)
            if row["incidents_truncated"]:
                row["fullscreen_exit_during_tasks"] += int(missing)
        else:   # no incident list: count every exit as during the tasks (conservative)
            row["fullscreen_exit_during_tasks"] = row["fullscreen_exit_count"]
            row["incidents_available"] = 0
        for step, d in (integ.get("by_step") or {}).items():
            if isinstance(d, dict):
                row.update({f"{step}__{k}": v for k, v in d.items()})
        rows.append(row)
    out = pd.DataFrame(rows).set_index("participant_id") if rows else pd.DataFrame()
    return _ints(out, INTEGRITY_FIELDS[:5] + ["n_incidents", "n_incidents_during_tasks"]
                 + [f"{t}_during_tasks" for t in INCIDENT_TYPES])


# ── The participant table ──────────────────────────────────────────────────
def _image_condition(r: Record, tabs: dict[str, pd.DataFrame]) -> str:
    c = _str(_obj(r.j, "participant").get("image_condition")) or _str(_obj(r.j, "summary").get("image_condition"))
    if not c:
        img = tabs["image_trials"]
        if len(img):
            g = img[img.participant_id == r.pid]
            for col in ("image_condition", "image_set"):
                v = _text(_col(g, col))
                v = v[v != ""]
                if len(v):
                    return v.iloc[0]
    return c


def participant_table(kept: list[Record], tabs: dict[str, pd.DataFrame],
                      sec: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(one row per kept participant, any status; their image block quality)."""
    trials = stroop_test_trials(tabs["stroop_trials"])
    S = sec["session"]
    rows = []
    for r in kept:
        part, sess = _obj(r.j, "participant"), _obj(r.j, "session")
        dev = _obj(sess, "device")
        keys = _obj(part, "stroop_key_mapping")
        start, end, saved = _ts(sess.get("start_time")), _ts(sess.get("end_time")), r.saved
        minutes = _float(sess.get("duration_min"))
        if r.status != "complete" or not np.isfinite(minutes):
            last = end if pd.notna(end) else saved
            minutes = (last - start).total_seconds() / 60 if pd.notna(last) and pd.notna(start) else minutes
        row: dict = {
            "participant_id": r.pid, "base_pid": r.base, "attempt": r.attempt, "page_load_id": r.page_load,
            "n_sessions_found": r.n_sessions, "repeat_attempt": int(r.repeat),
            "status": r.status, "complete": int(r.status == "complete"),
            "last_step": _str(r.j.get("last_step")), "saved_at": _str(r.j.get("saved_at")),
            "image_condition": _image_condition(r, tabs),
            "image_condition_source": _str(part.get("image_condition_source")),
            "prolific_pid": _str(part.get("prolific_pid")), "prolific_study_id": _str(part.get("prolific_study_id")),
            "prolific_session_id": _str(part.get("prolific_session_id")),
            "quick_mode": int(r.quick), "debug_mode": int(r.debug),
            "stroop_key_match": _str(keys.get("match")), "stroop_key_mismatch": _str(keys.get("mismatch")),
            "app_version": _str(r.j.get("app_version")), "source_file": str(r.path),
            "start_time": _str(sess.get("start_time")), "end_time": _str(sess.get("end_time")),
            "minutes_since_start": minutes, "_when": _tkey(end if pd.notna(end) else saved if pd.notna(saved) else start),
            "sound_check_confirmed": sess.get("sound_check_confirmed", np.nan),
            "fullscreen_at_start": sess.get("fullscreen_at_start", np.nan),
            "image_tier": _str(sess.get("image_tier")),
        }
        row.update({c: dev.get(c, np.nan) for c in DEVICE_INFO})
        end_frames = _obj(sess, "end_frames")
        row.update({f"end_{k}": v for k, v in end_frames.items() if not isinstance(v, (dict, list))})
        g = trials[trials.participant_id == r.pid]
        row["stroop_phases"] = ";".join(p for p in PHASES if (g.phase == p).any())
        late_limit = LATE_FACTOR * _float(dev.get("frame_ms_median"))
        ph_m = {}
        for phase in PHASES:
            ph = g[g.phase == phase]
            if len(ph):
                ph_m[phase] = phase_metrics(ph, late_limit)
                row.update({f"{phase}_{k}": v for k, v in ph_m[phase].items()})
        for name, (a, b) in CONTRASTS.items():
            if a in ph_m and b in ph_m:
                row.update({f"{name}_{m}": ph_m[b][m] - ph_m[a][m] for m in METRICS})
        rows.append(row)
    df = pd.DataFrame(rows)
    order = df["_when"].rank(method="first").astype(int)
    df = df.assign(completion_order=order).drop(columns="_when").set_index("participant_id")

    integ = integrity_table(kept)   # its by_step columns (<step>__<field>) only go to integrity.csv
    integ = integ[[c for c in integ.columns if "__" not in c]]
    for extra in (vas_table(tabs["vas"]), mist_table(tabs["mist_trials"], sec["mist_calibration"]), integ):
        if len(extra):
            df = df.join(extra[[c for c in extra.columns if c not in df]], how="left")
    pids = list(df.index)
    imgq = image_quality(tabs["image_trials"], tabs["events"], pids, {r.pid: r.quick for r in kept})
    df = df.join(imgq.set_index("participant_id"), how="left")
    mism = df[(_text(df.images_condition_rows) != "") & (df.images_condition_rows != df.image_condition)]
    for pid, r in mism.iterrows():
        print(f"Warning: {pid}: image rows say condition '{r.images_condition_rows}' but participant.image_condition "
              f"is '{r.image_condition}'")

    dem = sec["demographics"]
    dem_cols = [c for c in DEMOGRAPHICS if c in dem] + [c for c in dem if c not in DEMOGRAPHICS
                                                        and c not in ("submitted", "participant_id", "session")]
    df = df.join(dem[[c for c in dem_cols if c not in df]], how="left")
    fb = sec["feedback"]
    df = df.join(fb[[c for c in fb.columns if c not in df and c not in ("submitted", "participant_id", "session")]],
                 how="left")
    df = add_flags(df.reset_index(), has_images=not tabs["image_trials"].empty)
    df = df.sort_values("completion_order").reset_index(drop=True)
    imgq = imgq.merge(df[["participant_id", "image_condition", "status", "exclusion_reasons"]],
                      on="participant_id", how="left")
    return df, imgq


def add_flags(df: pd.DataFrame, has_images: bool = True) -> pd.DataFrame:
    """flag_* columns, exclusion_reasons (excluding flags) and report_flags (REPORT_ONLY).
    NaN = unknown = not flagged, except a missing Stroop phase."""
    f = pd.DataFrame(index=df.index)
    any_phase = lambda m, lim: pd.concat([_num(_col(df, f"{p}_{m}")) > lim for p in PHASES], axis=1).any(axis=1)
    f["low_accuracy"] = _num(_col(df, "baseline_accuracy_all")) < MIN_ACCURACY_ALL
    f["unfocused"] = any_phase("focus_lost_share", MAX_FOCUS_LOST)
    f["timing_unreliable"] = any_phase("late_onset_share", MAX_LATE_ONSET)
    f["low_effort"] = _num(_col(df, "effort")) < MIN_EFFORT
    f["colour_blind"] = _text(_col(df, "colour_vision")).str.lower() == "yes"
    if has_images:
        f["images_incomplete"] = _num(_col(df, "images_share_shown")) < MIN_IMAGES_SHOWN
        f["images_unfocused"] = _num(_col(df, "images_focus_lost_share")) > MAX_IMAGES_FOCUS_LOST
    else:
        print("Note: no image_trials in the data - image block flags not checked")
    f["missing_phase"] = pd.concat([_num(_col(df, f"{p}_n_trials")).fillna(0) == 0 for p in PHASES],
                                   axis=1).any(axis=1)
    f["left_fullscreen"] = ((_num(_col(df, "fullscreen_exit_during_tasks")) > MAX_FULLSCREEN_EXITS)
                            | (_num(_col(df, "time_outside_fullscreen_s")) > MAX_OUTSIDE_FULLSCREEN_S))
    hidden = _num(_col(df, "time_hidden_during_tasks_s"))
    if hidden.isna().all():
        hidden = _num(_col(df, "time_hidden_s"))   # no incident list: whole-session total
    f["tab_hidden"] = hidden > MAX_HIDDEN_S
    # report-only (see REPORT_ONLY)
    f["mist_default_limit"] = _text(_col(df, "mist_time_limit_source")).str.lower() == "default"
    f["psychoactive_drugs"] = _text(_col(df, "psychoactive_drugs")).str.lower() == "yes"
    f["doubted_reward"] = _num(_col(df, "believed_performance_counts")) <= MAX_BELIEVED_COUNTS
    f["repeat_attempt"] = _num(_col(df, "repeat_attempt")) == 1
    f["fullscreen_declined"] = _num(_col(df, "fullscreen_declined")) == 1
    for c in f:
        df[f"flag_{c}"] = f[c].fillna(False).astype(int)
    excl = [c for c in f if c not in REPORT_ONLY]
    rep = [c for c in f if c in REPORT_ONLY]
    df["exclusion_reasons"] = f[excl].apply(lambda r: ";".join(k for k, v in r.items() if v), axis=1)
    df["report_flags"] = f[rep].apply(lambda r: ";".join(k for k, v in r.items() if v), axis=1)
    return df


def check_against_summary(df: pd.DataFrame, summ: pd.DataFrame, out: Path | None = None) -> None:
    """Compare the recomputed values with the browser's summary object (js/summary.js)."""
    if summ is None or summ.empty or not len(summ.columns):
        return
    prefixes = tuple(f"{p}_" for p in PHASES + list(CONTRASTS)) + ("vas_", "mist_", "images_")
    extra = {"fullscreen_exit_count", "tab_hidden_count", "window_blur_count", "time_outside_fullscreen_s",
             "time_hidden_s", "image_condition"}
    cols = [c for c in df.columns if c in summ.columns and (c.startswith(prefixes) or c in extra)]
    bad, checked = [], {}
    for _, r in df.iterrows():
        if r.participant_id not in summ.index:
            continue
        s = summ.loc[r.participant_id]
        if s.isna().all():
            continue
        checked[r.status] = checked.get(r.status, 0) + 1
        for c in cols:
            x, y = r[c], s[c]
            xn, yn = _float(x), _float(y)
            if np.isfinite(xn) and np.isfinite(yn):
                if abs(xn - yn) > max(2e-3, 1e-4 * abs(yn)):
                    bad.append({"participant_id": r.participant_id, "status": r.status, "column": c,
                                "recomputed": xn, "browser_summary": yn})
            elif np.isfinite(yn) and yn != 0 and not np.isfinite(xn) and not _str(x):
                # the browser had rows for this value that the file no longer has (e.g. a table
                # dropped from a quit file); 0 vs missing is just an empty table
                bad.append({"participant_id": r.participant_id, "status": r.status, "column": c,
                            "recomputed": "", "browser_summary": yn})
            elif not np.isfinite(xn) and not np.isfinite(yn):
                xs, ys = _str(x), _str(y)
                if xs and ys and xs != ys:
                    bad.append({"participant_id": r.participant_id, "status": r.status, "column": c,
                                "recomputed": xs, "browser_summary": ys})
    if out is not None and (out / "summary_check.csv").exists():
        (out / "summary_check.csv").unlink()   # from an earlier run
    if not checked:
        return
    who = ", ".join(f"{n} {s}" for s, n in checked.items())
    if bad:
        b = pd.DataFrame(bad)
        print(f"Check vs the in-browser summary ({who}): {len(b)} value(s) differ - "
              + ", ".join(f"{x.participant_id}:{x.column}" for x in b.head(8).itertuples())
              + (" ..." if len(b) > 8 else "")
              + ("  (a quit / in-progress summary can predate rows of the step that was running)"
                 if (b.status != "complete").any() else ""))
        if out is not None:
            b.to_csv(out / "summary_check.csv", index=False)
            print(f"  details: {out / 'summary_check.csv'}")
    else:
        print(f"Check vs the in-browser summary: {len(cols)} columns agree for {sum(checked.values())} "
              f"participant(s) ({who})")


# ── Statistics ─────────────────────────────────────────────────────────────
def dz(x: np.ndarray) -> float:
    return x.mean() / x.std(ddof=1) if len(x) > 1 and x.std(ddof=1) > 0 else np.nan


def boot_dz(x: np.ndarray) -> np.ndarray:
    idx = RNG.integers(0, len(x), size=(N_BOOT, len(x)))
    s = x[idx]
    sd = s.std(axis=1, ddof=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(sd > 0, s.mean(axis=1) / sd, np.nan)


def spearman(x: pd.Series, y: pd.Series) -> tuple[float, float]:
    x, y = pd.to_numeric(x, errors="coerce"), pd.to_numeric(y, errors="coerce")
    ok = x.notna() & y.notna()
    if ok.sum() < MIN_N_CORR or x[ok].nunique() < 2 or y[ok].nunique() < 2:
        return np.nan, np.nan
    r = _quiet(stats.spearmanr, x[ok], y[ok])
    return (r[0], r[1]) if r is not None else (np.nan, np.nan)


def one_sample(ch: np.ndarray) -> dict:
    """Mean, 95 % CI, t, Wilcoxon and dz of a set of differences (vs 0)."""
    n = len(ch)
    out: dict = {"n": n}
    if not n:
        return out
    out.update({"change_mean": ch.mean(), "change_median": np.median(ch),
                "n_increase": int((ch > 0).sum()), "n_decrease": int((ch < 0).sum())})
    if n >= 2:
        out["change_sd"] = ch.std(ddof=1)
    if n >= MIN_N_TESTS:
        sd = ch.std(ddof=1)
        half = stats.t.ppf(0.975, n - 1) * sd / np.sqrt(n)
        out.update({"change_ci_low": ch.mean() - half, "change_ci_high": ch.mean() + half, "df": n - 1})
        if sd > 0:
            t = ch.mean() / (sd / np.sqrt(n))
            out.update({"t": t, "p_ttest": 2 * stats.t.sf(abs(t), n - 1)})
        if np.any(ch != 0):
            w = _quiet(stats.wilcoxon, ch)
            out["p_wilcoxon"] = w.pvalue if w is not None else np.nan
        out["dz"] = dz(ch)
    if n >= MIN_N_STATS:
        b = boot_dz(ch)
        if np.isfinite(b).any():
            out.update({"dz_ci_low": np.nanpercentile(b, 2.5), "dz_ci_high": np.nanpercentile(b, 97.5)})
    return out


def paired(d: pd.DataFrame, a: str, b: str) -> tuple[dict, pd.Series]:
    """Change b - a over people with both values."""
    if a not in d or b not in d:
        return {"n": 0}, pd.Series(dtype=float)
    x = d[[a, b]].apply(pd.to_numeric, errors="coerce").dropna()
    ch = x[b] - x[a]
    out = {"n": len(x), "from_mean": x[a].mean() if len(x) else np.nan, "to_mean": x[b].mean() if len(x) else np.nan}
    out.update({k: v for k, v in one_sample(ch.to_numpy()).items() if k != "n"})
    return out, ch


def rm_test(y: pd.DataFrame) -> dict:
    """Friedman + one-way repeated-measures ANOVA over the columns of y (complete cases)."""
    y = y.apply(pd.to_numeric, errors="coerce").dropna()
    n, k = y.shape
    out: dict = {"n": n, "k": k}
    out.update({f"mean_{c}": y[c].mean() if n else np.nan for c in y.columns})
    if n < MIN_N_TESTS:
        return out
    fr = _quiet(stats.friedmanchisquare, *[y[c].to_numpy() for c in y.columns])
    if fr is not None and np.isfinite(fr.statistic):
        out.update({"friedman_chi2": fr.statistic, "friedman_p": fr.pvalue,
                    "kendall_w": fr.statistic / (n * (k - 1))})
    Y = y.to_numpy(dtype=float)
    grand = Y.mean()
    ss_cond = n * ((Y.mean(axis=0) - grand) ** 2).sum()
    ss_subj = k * ((Y.mean(axis=1) - grand) ** 2).sum()
    ss_err = ((Y - grand) ** 2).sum() - ss_cond - ss_subj
    df1, df2 = k - 1, (k - 1) * (n - 1)
    out.update({"anova_df1": df1, "anova_df2": df2})
    if ss_err > 1e-12 * max(ss_cond + ss_subj, 1e-12):
        F = (ss_cond / df1) / (ss_err / df2)
        S = np.cov(Y, rowvar=False)
        Sc = S - S.mean(axis=0, keepdims=True) - S.mean(axis=1, keepdims=True) + S.mean()
        with np.errstate(divide="ignore", invalid="ignore"):
            eps = np.trace(Sc) ** 2 / ((k - 1) * (Sc ** 2).sum())
        eps = float(np.clip(eps, 1 / (k - 1), 1)) if np.isfinite(eps) else np.nan
        out.update({"anova_F": F, "anova_p": stats.f.sf(F, df1, df2),
                    "partial_eta_sq": ss_cond / (ss_cond + ss_err), "gg_epsilon": eps,
                    "anova_p_gg": stats.f.sf(F, df1 * eps, df2 * eps) if np.isfinite(eps) else np.nan})
    return out


def describe(x: pd.Series) -> dict:
    x = pd.to_numeric(x, errors="coerce").dropna()
    return {"n": len(x), "mean": x.mean(), "sd": x.std(ddof=1) if len(x) > 1 else np.nan,
            "median": x.median(), "min": x.min(), "max": x.max()}


def holm(p: list[float]) -> np.ndarray:
    """Holm-Bonferroni adjusted p-values (NaN stays NaN and is not counted)."""
    p = np.asarray(p, dtype=float)
    out = np.full(p.shape, np.nan)
    ok = np.flatnonzero(np.isfinite(p))
    m, running = len(ok), 0.0
    for i, j in enumerate(ok[np.argsort(p[ok], kind="stable")]):
        running = max(running, min(1.0, (m - i) * p[j]))
        out[j] = running
    return out


def hedges_g(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """Hedges' g of a - b (pooled SD, small-sample corrected) with an approximate 95 % CI."""
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return np.nan, np.nan, np.nan
    sp = np.sqrt(((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2))
    if not sp > 0:
        return np.nan, np.nan, np.nan
    g = (1 - 3 / (4 * (na + nb) - 9)) * (a.mean() - b.mean()) / sp
    se = np.sqrt((na + nb) / (na * nb) + g ** 2 / (2 * (na + nb)))
    return g, g - 1.96 * se, g + 1.96 * se


def welch(a: np.ndarray, b: np.ndarray) -> dict:
    va, vb, na, nb = a.var(ddof=1), b.var(ddof=1), len(a), len(b)
    se2 = va / na + vb / nb
    if not se2 > 0:
        return {}
    t = (a.mean() - b.mean()) / np.sqrt(se2)
    df = se2 ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
    return {"welch_t": t, "welch_df": df, "welch_p": 2 * stats.t.sf(abs(t), df)}


def oneway(groups: dict[str, np.ndarray]) -> dict:
    """One-way between-subjects ANOVA (+ eta squared) and Kruskal-Wallis."""
    vals = list(groups.values())
    allv = np.concatenate(vals)
    k, n = len(vals), len(allv)
    ss_b = sum(len(v) * (v.mean() - allv.mean()) ** 2 for v in vals)
    ss_w = sum(((v - v.mean()) ** 2).sum() for v in vals)
    out: dict = {"anova_df1": k - 1, "anova_df2": n - k}
    if ss_w > 0 and n > k:
        F = (ss_b / (k - 1)) / (ss_w / (n - k))
        out.update({"anova_F": F, "anova_p": stats.f.sf(F, k - 1, n - k), "eta_sq": ss_b / (ss_b + ss_w)})
    kw = _quiet(stats.kruskal, *vals)
    if kw is not None and np.isfinite(kw.statistic):
        out.update({"kruskal_H": kw.statistic, "kruskal_p": kw.pvalue})
    return out


# ── Result tables ──────────────────────────────────────────────────────────
def manipulation_check(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for m in ["composite"] + VAS_ITEMS:
        for tp in VAS_TIMEPOINTS:
            c = f"vas_{tp}_{m}"
            if c in df:
                rows.append({"section": "vas_timepoint", "measure": m, "timepoint": tp, **describe(df[c])})
    for m in ["composite"] + VAS_ITEMS:
        for name, (a, b) in VAS_CONTRASTS.items():
            s, ch = paired(df, f"vas_{a}_{m}", f"vas_{b}_{m}")
            if not s["n"]:
                continue
            r = {"section": "vas_change", "measure": m, "contrast": name, "timepoint": f"{b} - {a}", **s}
            if m == "composite" and name in ("recovery", "net") and "vas_image_feeling" in df:
                r["rho_image_feeling"], r["p_rho_image_feeling"] = spearman(ch, df.loc[ch.index, "vas_image_feeling"])
            rows.append(r)
    if "vas_image_feeling" in df:
        x = pd.to_numeric(df.vas_image_feeling, errors="coerce").dropna()
        r = {"section": "image_feeling", "measure": "image_feeling", "timepoint": "post_recovery",
             **describe(x), "n_positive_side": int((x < 50).sum()), "n_neutral": int((x == 50).sum()),
             "n_negative_side": int((x > 50).sum())}
        # vs 50 (neutral): negative change_mean = images felt positive on average
        r.update({k: v for k, v in one_sample((x - 50).to_numpy()).items()
                  if k in ("change_mean", "change_ci_low", "change_ci_high", "t", "df", "p_ttest", "p_wilcoxon", "dz")})
        rows.append(r)
    return pd.DataFrame(rows)


def effects_table(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for name, (a, b) in CONTRASTS.items():
        vas_col = f"vas_{name}_change"
        for m in METRICS:
            s, ch = paired(df, f"{a}_{m}", f"{b}_{m}")
            r = {"contrast": name, "change": f"{b} - {a}", "metric": m, "primary": int(m in PRIMARY), **s}
            if len(ch):
                if vas_col in df:
                    r["rho_vas_change"], r["p_rho_vas_change"] = spearman(ch, df.loc[ch.index, vas_col])
                if name != "stress" and "vas_image_feeling" in df:
                    r["rho_image_feeling"], r["p_rho_image_feeling"] = spearman(ch, df.loc[ch.index, "vas_image_feeling"])
            rows.append(r)
    cols = ["contrast", "change", "metric", "primary", "n", "from_mean", "to_mean", "change_mean", "change_median",
            "change_sd", "change_ci_low", "change_ci_high", "n_increase", "n_decrease", "t", "df", "p_ttest",
            "p_wilcoxon", "dz", "dz_ci_low", "dz_ci_high", "rho_vas_change", "p_rho_vas_change",
            "rho_image_feeling", "p_rho_image_feeling"]
    e = pd.DataFrame(rows)
    return e.reindex(columns=[c for c in cols if c in e] + [c for c in e if c not in cols])


def rm_table(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for m in METRICS:
        cols = [f"{p}_{m}" for p in PHASES]
        if all(c in df for c in cols):
            y = df[cols].rename(columns=dict(zip(cols, PHASES)))
            rows.append({"metric": m, "primary": int(m in PRIMARY), "levels": " | ".join(PHASES), **rm_test(y)})
    cols = [f"vas_{tp}_composite" for tp in VAS_TIMEPOINTS]
    if all(c in df for c in cols):
        y = df[cols].rename(columns=dict(zip(cols, VAS_TIMEPOINTS)))
        rows.append({"metric": "vas_composite", "primary": 0, "levels": " | ".join(VAS_TIMEPOINTS), **rm_test(y)})
    return pd.DataFrame(rows)


# ── Image condition (between subjects) ─────────────────────────────────────
def conditions_in(df: pd.DataFrame) -> list[str]:
    """Conditions present in the data, in CONDITION_ORDER first, then alphabetically."""
    found = sorted(set(_text(_col(df, "image_condition"))) - {""})
    return [c for c in CONDITION_ORDER if c in found] + [c for c in found if c not in CONDITION_ORDER]


def _cond_outcomes(df: pd.DataFrame) -> list[tuple[str, str]]:
    return ([("outcome", c) for c in CONDITION_OUTCOMES if c in df]
            + [("check", c) for c in CONDITION_CHECKS if c in df])


def _values(df: pd.DataFrame, col: str, cond: str | None = None) -> np.ndarray:
    d = df if cond is None else df[_text(df.image_condition) == cond]
    return pd.to_numeric(d[col], errors="coerce").dropna().to_numpy(dtype=float)


def condition_descriptives(df: pd.DataFrame, conds: list[str]) -> pd.DataFrame:
    """Per outcome x condition (+ all): n, mean, SD, and the paired (within-condition) test of
    the change against 0 - image_feeling against 50 (neutral)."""
    rows = []
    for role, col in _cond_outcomes(df):
        ref = 50.0 if col == "vas_image_feeling" else 0.0
        for cond in conds + ["all"]:
            x = _values(df, col, None if cond == "all" else cond)
            r = {"role": role, "outcome": col, "condition": cond, **describe(pd.Series(x, dtype=float)),
                 "se": x.std(ddof=1) / np.sqrt(len(x)) if len(x) > 1 else np.nan, "test_against": ref}
            if len(x):
                t = one_sample(x - ref)
                r.update({"ci_low": t.get("change_ci_low", np.nan) + ref, "ci_high": t.get("change_ci_high", np.nan) + ref,
                          "n_above": t.get("n_increase"), "n_below": t.get("n_decrease")})
                r.update({k: t.get(k, np.nan) for k in ("t", "df", "p_ttest", "p_wilcoxon", "dz", "dz_ci_low", "dz_ci_high")})
            rows.append(r)
    return _ints(pd.DataFrame(rows), ["n", "n_above", "n_below", "df"])


def condition_effects(df: pd.DataFrame, conds: list[str]) -> pd.DataFrame:
    """Per outcome: omnibus across conditions with n >= MIN_N_TESTS (one-way ANOVA + eta squared,
    Kruskal-Wallis) and pairwise Welch t-tests (Holm within the outcome, Hedges' g = a - b)."""
    rows = []
    for role, col in _cond_outcomes(df):
        vals = {c: _values(df, col, c) for c in conds}
        groups = {c: v for c, v in vals.items() if len(v) >= MIN_N_TESTS}
        small = [f"{c} (n={len(v)})" for c, v in vals.items() if len(v) < MIN_N_TESTS]
        note = f"left out (n < {MIN_N_TESTS}): {', '.join(small)}" if small else ""
        if len(groups) < 2:
            rows.append({"role": role, "outcome": col, "test": "none", "comparison": " | ".join(conds),
                         "note": f"needs >= 2 conditions with n >= {MIN_N_TESTS}" + (f"; {note}" if note else "")})
            continue
        rows.append({"role": role, "outcome": col, "test": "omnibus", "comparison": " | ".join(groups),
                     "k": len(groups), "n": sum(len(v) for v in groups.values()), **oneway(groups), "note": note})
        pairs = []
        for a, b in itertools.combinations(groups, 2):
            x, y = groups[a], groups[b]
            g, lo, hi = hedges_g(x, y)
            pairs.append({"role": role, "outcome": col, "test": "pairwise", "comparison": f"{a} - {b}",
                          "n_a": len(x), "n_b": len(y), "mean_a": x.mean(), "mean_b": y.mean(),
                          "mean_diff": x.mean() - y.mean(), **welch(x, y),
                          "hedges_g": g, "g_ci_low": lo, "g_ci_high": hi})
        for r, p in zip(pairs, holm([r.get("welch_p", np.nan) for r in pairs])):
            r["welch_p_holm"] = p
        rows += pairs
    cols = ["role", "outcome", "test", "comparison", "k", "n", "anova_F", "anova_df1", "anova_df2", "anova_p",
            "eta_sq", "kruskal_H", "kruskal_p", "n_a", "n_b", "mean_a", "mean_b", "mean_diff", "welch_t", "welch_df",
            "welch_p", "welch_p_holm", "hedges_g", "g_ci_low", "g_ci_high", "note"]
    e = pd.DataFrame(rows)
    e = e.reindex(columns=[c for c in cols if c in e] + [c for c in e if c not in cols])
    return _ints(e, ["k", "n", "anova_df1", "anova_df2", "n_a", "n_b"])


# ── Feedback, individual changes ───────────────────────────────────────────
def feedback_summary(df: pd.DataFrame, conds: list[str]) -> pd.DataFrame:
    rows = []
    groups = [("all", df)] + [(c, df[_text(df.image_condition) == c]) for c in conds]
    for cond, d in groups:
        for item in FEEDBACK_SCALES:
            if item not in d:
                continue
            x = _num(d[item])
            rows.append({"condition": cond, "item": item, "kind": "scale 1-5", "level": "all", **describe(x)})
            n = int(x.notna().sum())
            for lv in range(1, 6):
                k = int((x == lv).sum())
                rows.append({"condition": cond, "item": item, "kind": "scale 1-5", "level": str(lv), "count": k,
                             "percent": 100 * k / n if n else np.nan})
        for item, levels in FEEDBACK_CHOICES.items():
            if item not in d:
                continue
            x = _text(d[item])
            x = x[x != ""]
            n = len(x)
            if item in FEEDBACK_SCORED:
                score = x.map({lv: i - 2 for i, lv in enumerate(levels)})
                rows.append({"condition": cond, "item": item, "kind": "choice", "level": "all (scored -2..+2)",
                             **describe(score)})
            for lv in levels + sorted(set(x) - set(levels)):
                k = int((x == lv).sum())
                rows.append({"condition": cond, "item": item, "kind": "choice", "level": lv, "count": k,
                             "percent": 100 * k / n if n else np.nan})
        for item in FEEDBACK_TEXT:
            if item in d:
                rows.append({"condition": cond, "item": item, "kind": "text", "level": "answered",
                             "count": int((_text(d[item]) != "").sum()), "n": len(d)})
    return _ints(pd.DataFrame(rows), ["n", "count"])


def individual_changes(df: pd.DataFrame) -> pd.DataFrame:
    cols = ["participant_id", "image_condition", "completion_order", "status", "attempt"]
    for name in CONTRASTS:
        cols += [f"{name}_{m}" for m in PRIMARY] + [f"vas_{name}_change"]
    cols += ["vas_task_change", "vas_image_feeling", "images_feeling", "images_relaxing", "exclusion_reasons",
             "report_flags"]
    return df[[c for c in cols if c in df]]


# ── Plots ──────────────────────────────────────────────────────────────────
INK, INK2, GRID, SERIES, INDIV, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#2a78d6", "#b9b8b2", "#fcfcfb"
# Categorical slots in fixed order (validated palette); a condition keeps its colour in every figure.
CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
PLOT_TITLES = {"mean_rt": "Mean RT (s, correct)", "accuracy_all": "Accuracy (misses = errors)",
               "stroop_interference_rt": "Stroop interference RT (s)\nincongruent - congruent",
               "stroop_interference_acc": "Stroop interference accuracy\ncongruent - incongruent"}
VAS_LABELS = ["Pre-MIST", "Post-MIST", "Pre-images", "Post-recovery"]
PHASE_LABELS = ["Baseline", "Post-stress", "Post-recovery"]


def _style(ax) -> None:
    ax.set_facecolor(SURFACE)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(INK2)
    ax.tick_params(colors=INK2, labelsize=9)
    ax.yaxis.grid(True, color=GRID, lw=0.8)
    ax.set_axisbelow(True)


def _mean_ci(y: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    m = y.mean().to_numpy()
    n = y.notna().sum().to_numpy()
    sd = y.std(ddof=1).to_numpy()
    with np.errstate(divide="ignore", invalid="ignore"):
        half = np.where(n > 1, stats.t.ppf(0.975, np.maximum(n - 1, 1)) * sd / np.sqrt(n), np.nan)
    return m, half


def _trajectories(ax, y: pd.DataFrame, labels: list[str]) -> None:
    x = np.arange(y.shape[1])
    for _, r in y.iterrows():
        ax.plot(x, r.to_numpy(dtype=float), color=INDIV, lw=1, alpha=0.8, zorder=1)
    m, half = _mean_ci(y)
    ax.errorbar(x, m, yerr=None if np.all(np.isnan(half)) else half, color=SERIES, lw=2, marker="o", ms=7,
                mec=SURFACE, mew=1.5, capsize=3, elinewidth=1.2, zorder=3)
    ax.set_xticks(x, labels)
    ax.set_xlim(-0.3, len(x) - 0.7)


def _condition_colors(conds: list[str]) -> dict[str, str]:
    # More than 8 conditions: the extra ones are drawn in neutral grey (never a generated hue).
    return {c: CATEGORICAL[i] if i < len(CATEGORICAL) else INK2 for i, c in enumerate(conds)}


def _condition_lines(ax, df: pd.DataFrame, cols: list[str], conds: list[str], colors: dict[str, str],
                     labels: list[str], direct_labels: bool) -> list:
    """Mean +- 95 % CI per condition across the columns (x positions slightly dodged)."""
    x = np.arange(len(cols))
    offs = (np.arange(len(conds)) - (len(conds) - 1) / 2) * 0.07
    ends, handles = [], []
    for i, c in enumerate(conds):
        y = df.loc[_text(df.image_condition) == c, cols].apply(pd.to_numeric, errors="coerce")
        if not y.notna().any().any():
            continue
        m, half = _mean_ci(y)
        h = ax.errorbar(x + offs[i], m, yerr=None if np.all(np.isnan(half)) else half, color=colors[c], lw=2,
                        marker="o", ms=6, mec=SURFACE, mew=1.5, capsize=3, elinewidth=1.2, zorder=3,
                        label=f"{c} (n = {int(y.notna().any(axis=1).sum())})")
        handles.append(h)
        if np.isfinite(m[-1]):
            ends.append((m[-1], c))
    ax.set_xticks(x, labels)
    ax.set_xlim(-0.35, len(x) - 1 + (0.95 if direct_labels else 0.35))
    if direct_labels and ends:   # names at the line ends, nudged apart so they do not overlap
        lo, hi = ax.get_ylim()
        gap = 0.06 * (hi - lo)
        ends.sort()
        ys = [ends[0][0]]
        for yv, _ in ends[1:]:
            ys.append(max(yv, ys[-1] + gap))
        for (yv, c), yl in zip(ends, ys):
            ax.text(len(x) - 1 + 0.18, yl, c, color=INK2, fontsize=8, va="center")
    return handles


def make_plots(df: pd.DataFrame, out: Path, conds: list[str]) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    saved = []
    vas_cols = [f"vas_{tp}_composite" for tp in VAS_TIMEPOINTS]
    has_vas = all(c in df for c in vas_cols) and df[vas_cols].notna().any().any()
    metrics = [m for m in PRIMARY if all(f"{p}_{m}" in df for p in PHASES)]

    def finish(fig, name):
        fig.savefig(out / name, dpi=150, facecolor=SURFACE)
        plt.close(fig)
        saved.append(name)

    def vas_notes(ax):
        for xm, txt in ((0.5, "MIST baseline\n+ MIST"), (1.5, "Stroop"), (2.5, "Images +\n1 min blank")):
            ax.text(xm, 1.0, txt, transform=ax.get_xaxis_transform(), ha="center", va="bottom", fontsize=8, color=INK2)

    # Pooled over conditions
    if has_vas:
        y = df[vas_cols].apply(pd.to_numeric, errors="coerce")
        fig, ax = plt.subplots(figsize=(6.4, 4.0), facecolor=SURFACE)
        _style(ax)
        _trajectories(ax, y, VAS_LABELS)
        vas_notes(ax)
        ax.set_ylim(0, 100)
        ax.set_ylabel("Stress composite (0-100)", color=INK, fontsize=10)
        ax.set_title(f"VAS stress composite, mean and 95 % CI (n = {int(y.notna().all(axis=1).sum())} complete)",
                     color=INK, fontsize=10, pad=26, loc="left")
        fig.tight_layout()
        finish(fig, "vas_trajectory.png")
    if metrics:
        fig, axes = plt.subplots(1, len(metrics), figsize=(3.4 * len(metrics), 3.8), facecolor=SURFACE, squeeze=False)
        for ax, m in zip(axes[0], metrics):
            _style(ax)
            y = df[[f"{p}_{m}" for p in PHASES]].apply(pd.to_numeric, errors="coerce")
            if m.startswith("stroop_interference"):
                ax.axhline(0, color=INK2, lw=0.8, zorder=0)
            _trajectories(ax, y, PHASE_LABELS)
            ax.set_title(PLOT_TITLES.get(m, m), color=INK, fontsize=10, loc="left")
            ax.tick_params(axis="x", labelsize=8)
        fig.suptitle(f"Stroop by phase: individuals (grey) and mean with 95 % CI (n = {len(df)})",
                     color=INK, fontsize=10, x=0.01, ha="left")
        fig.tight_layout()
        finish(fig, "stroop_phases.png")

    # By image condition
    if not conds:
        return saved
    colors = _condition_colors(conds)
    direct = len(conds) <= 4
    if has_vas:
        fig, ax = plt.subplots(figsize=(7.2, 4.4), facecolor=SURFACE)
        _style(ax)
        ax.set_ylim(0, 100)
        handles = _condition_lines(ax, df, vas_cols, conds, colors, VAS_LABELS, direct)
        vas_notes(ax)
        ax.set_ylabel("Stress composite (0-100)", color=INK, fontsize=10)
        ax.set_title("VAS stress composite by image condition, mean and 95 % CI", color=INK, fontsize=10, pad=26,
                     loc="left")
        if handles:
            ax.legend(handles=handles, frameon=False, fontsize=8, loc="upper left", labelcolor=INK2)
        fig.tight_layout()
        finish(fig, "vas_by_condition.png")
    if metrics:
        fig, axes = plt.subplots(1, len(metrics), figsize=(3.6 * len(metrics), 4.2), facecolor=SURFACE, squeeze=False)
        handles = []
        for i, (ax, m) in enumerate(zip(axes[0], metrics)):
            _style(ax)
            if m.startswith("stroop_interference"):
                ax.axhline(0, color=INK2, lw=0.8, zorder=0)
            h = _condition_lines(ax, df, [f"{p}_{m}" for p in PHASES], conds, colors, PHASE_LABELS,
                                 direct and i == len(metrics) - 1)
            handles = handles or h
            ax.set_title(PLOT_TITLES.get(m, m), color=INK, fontsize=10, loc="left")
            ax.tick_params(axis="x", labelsize=8)
        fig.suptitle("Stroop primary metrics by phase and image condition, mean and 95 % CI",
                     color=INK, fontsize=10, x=0.01, ha="left")
        if handles:
            fig.legend(handles=handles, frameon=False, fontsize=8, loc="upper right", ncol=min(len(handles), 4),
                       labelcolor=INK2)
        fig.tight_layout(rect=(0, 0, 1, 0.9))
        finish(fig, "stroop_by_condition.png")
    return saved


# ── Main ───────────────────────────────────────────────────────────────────
def _print_table(t: pd.DataFrame, title: str) -> None:
    print(f"\n{title}")
    print(t.round(3).to_string(index=False) if len(t) else "  (nothing to show)")


def _fmt(x: float, nd: int = 2) -> str:
    return "" if not np.isfinite(x) else f"{x:.{nd}f}"


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, nargs="+",
                    help="participant .json files and/or folders (searched recursively for *.json)")
    ap.add_argument("--out", type=Path, default=Path("results"), help="output folder (default ./results)")
    ap.add_argument("--exclude", action="store_true", help="drop participants with any excluding flag")
    ap.add_argument("--include-incomplete", action="store_true",
                    help="analyse sessions that did not finish (quit / in progress) with the rest, for whatever "
                         "phases they did (they are always listed in incomplete_participants.csv)")
    ap.add_argument("--include-quick", action="store_true", help="keep ?quick=1 pilot files (quick_mode = 1)")
    ap.add_argument("--include-debug", action="store_true", help="keep debug-mode files (debug_mode = 1)")
    ap.add_argument("--include-test", action="store_true",
                    help="keep test runs without a Prolific ID (participant.test_run = 1: pilots, the debug launcher's real-flow links)")
    ap.add_argument("--first-attempt-only", action="store_true",
                    help="per Prolific ID use the earliest session even when a later one finished")
    ap.add_argument("--pid", action="append", default=[], metavar="ID",
                    help="analyse only this participant (Prolific ID with or without the (n) suffix); repeatable")
    ap.add_argument("--plots", action="store_true", help="save VAS and Stroop plots, pooled and by condition")
    ap.add_argument("--export-tables", action="store_true",
                    help="also write the long trial tables (stroop_trials.csv, vas.csv, ...) of the analysed people")
    a = ap.parse_args()

    kept, files_log = load_records(a.source, a.include_quick, a.include_debug, a.first_attempt_only, a.pid,
                                   include_test=a.include_test)
    a.out.mkdir(parents=True, exist_ok=True)
    files_log.to_csv(a.out / "files_used.csv", index=False)
    tabs, sec = build_tables(kept), build_sections(kept)
    everyone, imgq = participant_table(kept, tabs, sec)

    counts = everyone.status.value_counts()
    print("Status: " + ", ".join(f"{counts.get(s, 0)} {s}" for s in STATUSES)
          + "".join(f", {n} {s}" for s, n in counts.items() if s not in STATUSES))
    check_against_summary(everyone, sec["summary"], a.out)
    integ = everyone[["participant_id", "status", "image_condition"]].merge(
        integrity_table(kept).reset_index(), on="participant_id", how="left")
    integ.to_csv(a.out / "integrity.csv", index=False)

    done = everyone.status == "complete"
    lead = ["participant_id", "base_pid", "attempt", "status", "last_step", "stroop_phases", "minutes_since_start",
            "saved_at", "image_condition", "quick_mode", "exclusion_reasons", "report_flags"]
    incomplete = everyone[~done]
    incomplete = incomplete[[c for c in lead if c in incomplete] + [c for c in incomplete if c not in lead]]
    incomplete.to_csv(a.out / "incomplete_participants.csv", index=False)
    if len(incomplete):
        n = incomplete.status.value_counts()
        print(f"Incomplete: {len(incomplete)} participant(s) ({n.get('quit', 0)} quit, {n.get('in_progress', 0)} "
              "in progress) " + ("- analysed with the rest (--include-incomplete)" if a.include_incomplete else
                                 "- not analysed (use --include-incomplete); see incomplete_participants.csv"))
        for _, r in incomplete.iterrows():
            print(f"  {r.participant_id:<28} {r.status:<12} last step {r.last_step or '-':<20} "
                  f"Stroop: {r.stroop_phases or 'none'}")
    df = (everyone if a.include_incomplete else everyone[done]).reset_index(drop=True)
    if df.empty:
        raise SystemExit(f"No completed sessions to analyse ({len(incomplete)} incomplete: see "
                         f"{a.out / 'incomplete_participants.csv'}, or use --include-incomplete).")
    df.to_csv(a.out / "participant_metrics.csv", index=False)
    imgq = imgq[imgq.participant_id.isin(df.participant_id)].reset_index(drop=True)
    imgq.to_csv(a.out / "image_quality.csv", index=False)
    mist_cols = ["participant_id", "image_condition", "status"] + [c for c in df if c.startswith("mist_")]
    df[mist_cols].to_csv(a.out / "mist.csv", index=False)

    n_inc = int((df.status != "complete").sum())
    extra = [f"{int((df.quick_mode == 1).sum())} quick-mode"] if a.include_quick else []
    extra += [f"{int((df.debug_mode == 1).sum())} debug-mode"] if a.include_debug else []
    extra += [f"{n_inc} incomplete"] if n_inc else []
    print(f"\nParticipants analysed: {len(df)}" + (f"  (including {', '.join(extra)})" if extra else ""))
    flagged = df[(df.exclusion_reasons != "") | (df.report_flags != "")]
    if len(flagged):
        print(f"Flagged (excluding flags {'applied' if a.exclude else 'kept - use --exclude to drop'}; "
              "[report-only] never excludes):")
        for _, r in flagged.iterrows():
            print(f"  {r.participant_id:<26} {r.exclusion_reasons}"
                  + (f"  [report-only: {r.report_flags}]" if r.report_flags else ""))
    else:
        print("No exclusion flags.")
    if a.exclude:
        df = df[df.exclusion_reasons == ""].reset_index(drop=True)
        if df.empty:
            raise SystemExit("No participants left after exclusions.")
    conds = conditions_in(df)
    cn = _text(df.image_condition).replace({"": "(none)"}).value_counts()
    print("Participants per image condition: " + ", ".join(f"{c} {cn.get(c, 0)}" for c in conds)
          + (f", (none) {cn['(none)']}" if "(none)" in cn else ""))
    if a.export_tables:
        for name, t in tabs.items():
            if len(t):
                t[t.participant_id.isin(df.participant_id)].to_csv(a.out / f"{name}.csv", index=False)

    mcols = {"participant_id": "participant_id", "mist_baseline_n_trials": "base_n",
             "mist_baseline_accuracy": "base_acc", "mist_baseline_mean_rt_correct": "base_rt_correct",
             "mist_initial_time_limit": "initial_limit", "mist_time_limit_source": "source",
             "mist_n_trials": "n", "mist_accuracy": "acc", "mist_n_timeouts": "timeouts",
             "mist_mean_rt_correct": "rt_correct", "mist_time_limit_min": "limit_min",
             "mist_time_limit_max": "limit_max", "mist_final_time_limit": "final_limit"}
    _print_table(df[[c for c in mcols if c in df]].rename(columns=mcols),
                 "MIST per participant (base_ = baseline block; source = default means not calibrated; s):")
    qcols = ["participant_id", "images_condition_rows", "images_n_shown", "images_n_expected",
             "images_n_skipped_hidden", "images_tier", "images_n_replaced", "images_mean_duration_ms",
             "images_max_abs_onset_error_ms", "images_n_focus_lost", "rest_s"]
    _print_table(imgq[[c for c in qcols if c in imgq]].rename(columns=lambda c: c.replace("images_", "")),
                 "Image block per participant (skipped_hidden = not drawn, page hidden; ms; rest_s = blank screen):")
    icols = {"participant_id": "participant_id", "fullscreen_exit_count": "fs_exits",
             "fullscreen_exit_during_tasks": "fs_exits_tasks", "time_outside_fullscreen_s": "outside_fs_s",
             "tab_hidden_count": "hidden", "time_hidden_s": "hidden_s", "window_blur_count": "blurs",
             "time_blurred_s": "blurred_s", "fullscreen_declined": "fs_declined"}
    it = df[[c for c in icols if c in df]].rename(columns=icols)
    nz = it.drop(columns="participant_id").apply(pd.to_numeric, errors="coerce").fillna(0).ne(0).any(axis=1)
    _print_table(it[nz], f"Browser integrity, participants with any full-screen exit / tab switch / blur "
                         f"({int(nz.sum())} of {len(it)}; per step in integrity.csv):")

    n = len(df)
    ind = individual_changes(df)
    ind.to_csv(a.out / "individual_changes.csv", index=False)
    short = {"mean_rt": "mean_rt", "accuracy_all": "acc_all", "stroop_interference_rt": "int_rt",
             "stroop_interference_acc": "int_acc"}
    for name, (lo, hi) in CONTRASTS.items():
        cols = ["participant_id", "image_condition"] + [f"{name}_{m}" for m in PRIMARY] + [f"vas_{name}_change"] \
            + (["vas_image_feeling"] if name == "recovery" else [])
        t = ind[[c for c in cols if c in ind]].rename(
            columns={**{f"{name}_{m}": s for m, s in short.items()}, f"vas_{name}_change": "vas_change",
                     "image_condition": "condition"})
        _print_table(t, f"Each participant, {name} change = {hi} - {lo} (RT in s; VAS in 0-100 points; "
                        f"VAS {VAS_CONTRASTS[name][1]} - {VAS_CONTRASTS[name][0]}):")
    if n < MIN_N_STATS:
        print(f"\nNote: only {n} participant(s). Paired tests need >= {MIN_N_TESTS} and bootstrap CIs >= {MIN_N_STATS};"
              " read the direction and consistency of the individual changes above, not p-values.")

    mc = manipulation_check(df)
    mc.to_csv(a.out / "manipulation_check.csv", index=False)
    if len(mc):
        tp = mc[(mc.section == "vas_timepoint") & (mc.measure == "composite")]
        _print_table(tp[["timepoint", "n", "mean", "sd", "median"]], "Manipulation check - VAS stress composite (0-100):")
        chg = mc[(mc.section == "vas_change") & (mc.measure == "composite")]
        cols = [c for c in ["contrast", "timepoint", "n", "from_mean", "to_mean", "change_mean", "change_ci_low",
                            "change_ci_high", "p_ttest", "p_wilcoxon", "dz", "rho_image_feeling"] if c in chg]
        _print_table(chg[cols].rename(columns={"timepoint": "change"}), "VAS composite changes (positive = more stressed):")
        img = mc[mc.section == "image_feeling"]
        if len(img) and img.iloc[0].n:
            r = img.iloc[0]
            print(f"\nImage feeling (0 = positive, 50 = neutral, 100 = negative): n = {int(r.n)}, mean = {r['mean']:.1f}, "
                  f"median = {r['median']:.1f}; {int(r.n_positive_side)} on the positive side, {int(r.n_neutral)} neutral, "
                  f"{int(r.n_negative_side)} negative" + (f"; vs 50: p = {r.p_ttest:.3g}" if pd.notna(r.get("p_ttest")) else ""))

    eff = effects_table(df)
    eff.to_csv(a.out / "effects.csv", index=False)
    cols = ["contrast", "metric", "n", "from_mean", "to_mean", "change_mean", "change_ci_low", "change_ci_high",
            "p_ttest", "p_wilcoxon", "dz", "dz_ci_low", "dz_ci_high", "rho_vas_change", "rho_image_feeling"]
    _print_table(eff.loc[eff.primary == 1, [c for c in cols if c in eff]],
                 "Main effects pooled over conditions, primary metrics (change = later - earlier; positive dz = "
                 "higher later). All metrics in effects.csv:")

    rm = rm_table(df)
    rm.to_csv(a.out / "rm_tests.csv", index=False)
    cols = ["metric", "n", "mean_baseline", "mean_post_stress", "mean_post_recovery", "friedman_chi2", "friedman_p",
            "kendall_w", "anova_F", "anova_p", "anova_p_gg", "partial_eta_sq"]
    if len(rm):
        _print_table(rm.loc[rm.primary == 1, [c for c in cols if c in rm]],
                     "Across the three phases (Friedman; RM ANOVA with Greenhouse-Geisser p). All metrics in rm_tests.csv:")

    cd = condition_descriptives(df, conds)
    cd.to_csv(a.out / "condition_descriptives.csv", index=False)
    ce = condition_effects(df, conds)
    ce.to_csv(a.out / "condition_effects.csv", index=False)
    if len(cd) and (cd.role == "outcome").any():
        wide = cd[cd.role == "outcome"].assign(
            cell=lambda d: d.apply(lambda r: "-" if not r["n"] else f"{_fmt(r['mean'], 3)} "
                                   + (f"({_fmt(r['sd'], 3)}) " if pd.notna(r["sd"]) else "") + f"n={int(r['n'])}",
                                   axis=1))
        wide = wide.pivot(index="outcome", columns="condition", values="cell")
        wide = wide.reindex(index=[c for c in CONDITION_OUTCOMES if c in wide.index],
                            columns=[c for c in conds + ["all"] if c in wide.columns]).reset_index()
        _print_table(wide, "By image condition: mean (SD) n of the recovery outcomes (image_feeling: 0 = positive, "
                           "100 = negative). Tests vs 0 in condition_descriptives.csv:")
    if len(ce):
        om = ce[ce.test == "omnibus"]
        if len(om):
            cols = ["role", "outcome", "k", "n", "anova_F", "anova_p", "eta_sq", "kruskal_H", "kruskal_p", "note"]
            _print_table(om[[c for c in cols if c in om]],
                         "Between conditions (one-way ANOVA, Kruskal-Wallis; pairwise Welch + Holm + Hedges g in "
                         "condition_effects.csv):")
        else:
            print(f"\nBetween conditions: no tests yet (needs >= 2 conditions with >= {MIN_N_TESTS} people each).")

    fb = feedback_summary(df, conds)
    fb.to_csv(a.out / "feedback_summary.csv", index=False)
    if len(fb):
        show = fb[(fb.condition == "all") & fb.level.str.startswith("all")
                  & fb.item.isin(FEEDBACK_SCALES + FEEDBACK_SCORED)]
        _print_table(show[[c for c in ("item", "level", "n", "mean", "sd", "median") if c in show]],
                     "Feedback (1-5 scales; images_feeling / images_mood_change scored -2..+2). Counts and per "
                     "condition in feedback_summary.csv:")

    if a.plots:
        saved = make_plots(df, a.out, conds)
        if saved:
            print(f"\nPlots saved to {a.out}/: {', '.join(saved)}")
    print(f"\nTables saved to {a.out}/")


if __name__ == "__main__":
    main()
