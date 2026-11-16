"""
Stress and recovery: does the stressor change Stroop performance, and does
performance come back after the Positive Prime images?

Design (within-subject, one group):
  VAS (baseline) -> Stroop (baseline) -> VAS (pre_mist) -> MIST stressor ->
  VAS (post_mist) -> Stroop (post_stress) -> 120 images x 2.5 s -> 1 min fixation ->
  VAS (post_recovery) + "How did the images make you feel?" -> Stroop (post_recovery) -> feedback

Run it whenever new data arrive - it works from n = 1 upward. With a few
people it prints each person's changes (read those, not p-values); paired
tests appear from n = 3, bootstrap CIs from n = 5, and the group statistics
only become meaningful with a reasonable sample.

Input, either:
  - straight from the Sheet (no download): --url <web app /exec URL> --key <export key>
    (key: in the Sheet, Study -> Create / show export key), or set the
    STUDY_URL and STUDY_KEY environment variables once;
  - the Sheet downloaded as File -> Download -> Microsoft Excel (.xlsx);
  - participants' own downloads (stress_recovery_<ID>.json; older stress_cog_<ID>.json
    files are read too), one or more files or a folder of them;
  - a folder of CSVs named <tab>.csv.
  Several sources can be given at once and are combined (e.g. the .xlsx plus a
  folder of JSON downloads); anyone found twice is taken from the first source.

    python analyze.py --url https://script.google.com/macros/s/.../exec --key abc123 --plots
    python analyze.py stress_recovery.xlsx --exclude          # apply exclusion flags
    python analyze.py ../Data                                 # every .json in the folder
    python analyze.py stress_recovery.xlsx ../Data            # Sheet + JSON downloads together
    python analyze.py stress_recovery_<ID>.json --include-quick   # a ?quick=1 pilot run
    python analyze.py stress_recovery.xlsx --include-incomplete   # analyse quitters too
    python analyze.py stress_recovery.xlsx --first-attempt-only   # ignore reopened attempts

What the data look like (app v1.1; v1.0 data are read too)
  - Data are saved wherever a participant stops. Trial rows are uploaded while each
    task runs, a new `summary` row (status "in_progress", last_step = the section just
    finished) is saved after every section, closing the page early sends a summary row
    and a sessions row with status "quit", and a finished session ends with a summary
    row with status "complete" (complete = 1). The newest summary row per participant
    (by saved_at, else the last one) is the one used.
  - Reopening the Prolific link in the same browser after consenting gives a new code
    with "(2)", "(3)", ... appended (e.g. 5f01...345(2)). Each attempt is analysed as a
    separate participant (columns base_pid = the code without the suffix, attempt), is
    flagged repeat_attempt when attempt > 1, and --first-attempt-only keeps attempt 1
    only. Every row carries page_load_id; if one code has rows from several page loads
    (reopened in another browser, so no suffix) only one page load is kept (the one
    that finished, else the one with the most trial rows) and the person is flagged
    multiple_page_loads.
  - Image rows have shown = 0 when the page was hidden for the whole 2.5 s slot (the
    image was not drawn); older data without the column count as shown.

Steps
  1. Status of everyone found (participants seen only in the event log - opened the
     link but never consented - are ignored): complete if the sessions tab has a
     "completed" row, the newest summary row has complete = 1, or the server's
     completions log lists them; otherwise "quit" or "in_progress" (newest summary;
     in_progress = no quit row arrived: still running, or the page closed before it
     could be sent). Completed sessions are analysed; incomplete ones always get their
     metrics for whatever phases they did in incomplete_participants.csv and join the
     main analysis with --include-incomplete. ?quick=1 pilots are dropped unless
     --include-quick. Duplicate trial rows (same page_load_id, participant, phase,
     block and trial) are dropped, keeping the first.
  2. Per participant x Stroop phase (baseline / post_stress / post_recovery), from
     measured (non-practice) trials: n, accuracy (correct / responded), accuracy_all
     (misses count as errors), n correct / incorrect / missed, mean / median / SD RT
     (correct trials, rt >= 0.2 s), RT and accuracy per trial type (congruent,
     incongruent, negative, positive, neutral) and
       stroop_interference_rt   = RT incongruent - RT congruent
       stroop_interference_acc  = acc congruent - acc incongruent
       emotional_interference_* = RT negative - neutral, positive - neutral, negative - positive
     These follow the same rules as js/summary.js; where the summary tab is present the
     script checks that both agree (newest summary row of complete and quit sessions;
     for a quit session a difference usually means rows sent at page close were lost).
  3. Manipulation check: VAS stress composite = mean(stressed, tense, 100 - calm) at
     baseline, pre_mist, post_mist, post_recovery; paired tests for the stressor
     (post_mist - pre_mist), recovery (post_recovery - post_mist) and net change
     (post_recovery - baseline); image_feeling (0 = positive, 50 = neutral,
     100 = negative) and the feedback questions about the images.
  4. Main effects, for every Stroop metric (change = later - earlier):
       stress   = post_stress   - baseline
       recovery = post_recovery - post_stress
       net      = post_recovery - baseline
     mean change with 95 % CI, paired t, Wilcoxon, Cohen's dz (mean change / SD of
     change) with a bootstrap 95 % CI; Spearman correlations of each change with the
     matching VAS change, and of the recovery / net changes with image_feeling.
     Across the three phases: Friedman test (+ Kendall's W) and a one-way
     repeated-measures ANOVA (partial eta squared, Greenhouse-Geisser correction).
  5. MIST per participant: trials, accuracy, timeouts, mean RT of correct answers and
     the adaptive time limit (start, min, max, number of changes, final limit).
  6. Image block quality per participant: images planned (= image rows, or 120 / 6
     for older data without the shown column), shown (shown = 1), skipped while the
     page was hidden (shown = 0), share shown (of the planned images, or of the images
     picked at preload when the events tab says more were picked), resolution tier,
     fill mode (cover / contain_blur), durations, onset error, focus lost, replaced
     images; length of the fixation rest when the events tab is in the data (JSON
     downloads and the .xlsx, not the --url export).
  7. Exclusion flags (always reported, applied with --exclude):
       low_accuracy        baseline accuracy_all < 0.60
       unfocused           > 10 % of measured Stroop trials with focus lost (in any phase)
       timing_unreliable   > 10 % of measured Stroop trials whose stimulus frame took
                           > 1.5 x the normal frame (in any phase)
       low_effort          feedback effort < 3 (1-5)
       colour_blind        demographics colour_vision == yes
       images_incomplete   < 90 % of the planned images shown (shown = 1)
       images_unfocused    > 10 % of the shown images with focus lost
       repeat_attempt      attempt > 1 (the link was reopened after consenting once)
       multiple_page_loads rows from more than one page load under one code
       missing_phase       a Stroop phase has no measured trials (incomplete sessions)

Outputs (./results/ or --out):
  participant_metrics.csv  one row per person: status, base_pid, attempt, every phase
                           metric, change columns (stress_*, recovery_*, net_*), VAS,
                           MIST, images, demographics, feedback, flag_* columns and
                           exclusion_reasons
  incomplete_participants.csv  everyone who did not finish (always written): status,
                           last_step (last section finished, from the summary row),
                           last_step_with_data (furthest section with any rows),
                           Stroop phases done, minutes since start, and the same
                           metrics for whatever they did
  individual_changes.csv   the main changes per person (read these while n is small)
  manipulation_check.csv   VAS by timepoint, VAS changes, image_feeling
  effects.csv              stress / recovery / net change statistics for every metric
  rm_tests.csv             Friedman + repeated-measures ANOVA across the three phases
                           (and the VAS composite across its four timepoints)
  image_quality.csv        image block per person (analysed participants)
  feedback_summary.csv     counts / means for the feedback questions
  --plots: vas_trajectory.png, stroop_phases.png

Needs pandas, numpy, scipy (openpyxl for .xlsx, matplotlib for --plots):
    pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

MIN_RT = 0.2
RNG = np.random.default_rng(2026)
N_BOOT = 5000
MIN_N_TESTS = 3   # paired / repeated-measures tests from this many complete cases
MIN_N_STATS = 5   # bootstrap CIs (and "findings") from this many
MIN_N_CORR = 4    # correlations from this many

# Exclusion flags (applied with --exclude; always reported).
MIN_ACCURACY_ALL = 0.60      # baseline accuracy incl. misses - below = not doing the task
MAX_FOCUS_LOST = 0.10        # share of measured trials with a tab switch / blur
MAX_LATE_ONSET = 0.10        # share of measured trials whose stimulus frame was late
LATE_FACTOR = 1.5            # "late" = onset frame > 1.5 x the participant's normal frame
MIN_EFFORT = 3               # feedback "effort" 1-5
MIN_IMAGES_SHOWN = 0.90      # share of the planned images actually shown
MAX_IMAGES_FOCUS_LOST = 0.10
N_IMAGES_PLANNED = 120       # CONFIG.IMAGES.N_IMAGES in js/config.js
N_IMAGES_QUICK = 6           # the same under ?quick=1

PHASES = ["baseline", "post_stress", "post_recovery"]
CONTRASTS = {  # name: (earlier, later); change = later - earlier
    "stress": ("baseline", "post_stress"),
    "recovery": ("post_stress", "post_recovery"),
    "net": ("baseline", "post_recovery"),
}
VAS_TIMEPOINTS = ["baseline", "pre_mist", "post_mist", "post_recovery"]
VAS_ITEMS = ["stressed", "tense", "calm"]
VAS_CONTRASTS = {
    "stress": ("pre_mist", "post_mist"),
    "recovery": ("post_mist", "post_recovery"),
    "net": ("baseline", "post_recovery"),
}
TRIAL_TYPES = ["congruent", "incongruent", "negative", "positive", "neutral"]

METRICS = (["mean_rt", "median_rt", "sd_rt", "accuracy", "accuracy_all", "n_missed"]
           + [f"rt_{t}" for t in TRIAL_TYPES] + [f"acc_{t}" for t in TRIAL_TYPES]
           + ["stroop_interference_rt", "stroop_interference_acc",
              "emotional_interference_neg_neu", "emotional_interference_pos_neu",
              "emotional_interference_neg_pos"])
PRIMARY = ["mean_rt", "accuracy_all", "stroop_interference_rt", "emotional_interference_neg_neu"]
PLOT_METRICS = ["mean_rt", "stroop_interference_rt", "emotional_interference_neg_neu"]

DEMOGRAPHICS = ["age", "gender", "handedness", "colour_vision", "vision", "english_comfort",
                "education", "sleep_hours", "caffeine_2h", "prior_participation", "keyboard"]
FEEDBACK_SCALES = ["images_pleasant", "images_relaxing", "images_attention", "instructions_clarity",
                   "effort", "arithmetic_stress"]   # 1-5
FEEDBACK_CHOICES = {  # option order as in js/forms.js
    "images_feeling": ["very_negative", "somewhat_negative", "neutral", "somewhat_positive", "very_positive"],
    "images_mood_change": ["much_worse", "a_bit_worse", "same", "a_bit_better", "much_better"],
    "images_seen_before": ["no", "some", "not_sure"],
    "performance_change": ["worse_after", "no_change", "better_after", "not_sure"],
    "performance_change_images": ["worse_after", "no_change", "better_after", "not_sure"],
    "stroop_thrown_off": ["no", "yes", "not_sure"],
    "heard_noise": ["yes", "no", "sound_off"],
    "distracted": ["no", "briefly", "a_lot"],
    "tech_problems": ["no", "yes"],
}
FEEDBACK_SCORED = ["images_feeling", "images_mood_change"]   # options scored -2 .. +2
FEEDBACK_TEXT = ["stroop_thrown_off_words", "performance_change_detail", "performance_change_images_detail",
                 "images_feeling_detail", "tech_problems_detail", "purpose_guess", "comments"]
SESSION_INFO = ["prolific_pid", "prolific_study_id", "prolific_session_id", "quick_mode", "app_version",
                "duration_min", "start_time", "end_time", "quit_time", "browser", "os", "refresh_rate_hz",
                "frame_ms_median", "screen_w_px", "screen_h_px", "device_pixel_ratio", "image_tier",
                "window_blur_count", "tab_hidden_count", "fullscreen_exit_count"]

# Tabs whose rows belong to a participant who consented (the event log is also
# sent by people who open the link and leave at the consent page).
PARTICIPANT_TABS = ["sessions", "summary", "demographics", "vas", "stroop_trials", "mist_trials",
                    "image_trials", "feedback"]
TRIAL_TABS = ["vas", "stroop_trials", "mist_trials", "image_trials"]
# Sections in the order of the session (summary last_step values).
FLOW = ["consent", "demographics", "setup", "vas_baseline", "stroop_baseline", "vas_pre_mist", "mist",
        "vas_post_mist", "stroop_post_stress", "images", "rest", "vas_post_recovery", "stroop_post_recovery",
        "feedback"]
STATUSES = ["complete", "quit", "in_progress"]
ATTEMPT_RE = re.compile(r"^(.*?)\s*\((\d+)\)$")   # "5f01...345(2)" -> ("5f01...345", 2)


# ── Small helpers ───────────────────────────────────────────────────────────
def _col(df: pd.DataFrame, name: str) -> pd.Series:
    return df[name] if name in df else pd.Series(np.nan, index=df.index, dtype=float)


def _num(s: pd.Series) -> pd.Series:
    """Numbers from Sheet / xlsx / JSON values ("" -> NaN, TRUE/FALSE -> 1/0)."""
    if s.dtype == bool:
        return s.astype(float)
    out = pd.to_numeric(s, errors="coerce")
    if s.dtype == object:
        words = s.astype(str).str.strip().str.lower().map({"true": 1.0, "false": 0.0})
        out = out.where(out.notna(), words)
    return out.astype(float)


def _text(s: pd.Series) -> pd.Series:
    return s.fillna("").astype(str).str.strip().replace({"nan": "", "None": ""})


def _pid(s: pd.Series) -> pd.Series:
    return s.map(lambda v: str(int(v)) if isinstance(v, float) and v.is_integer() else str(v).strip())


def _quiet(fn, *args, **kw):
    """Run a scipy test, returning None instead of raising on degenerate input."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return fn(*args, **kw)
        except (ValueError, ZeroDivisionError, FloatingPointError):
            return None


def _time(s: pd.Series) -> pd.Series:
    """ISO times from the app (or dates Excel / Sheets converted) as UTC timestamps; bad -> NaT."""
    s = s.map(lambda v: v.isoformat() if hasattr(v, "isoformat") else ("" if pd.isna(v) else str(v)))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return pd.to_datetime(s, errors="coerce", utc=True, format="ISO8601")
        except (TypeError, ValueError):   # pandas < 2.0
            return pd.to_datetime(s, errors="coerce", utc=True)


def split_attempt(pid: str) -> tuple[str, int]:
    """Participant code -> (code without a "(n)" reopen suffix, attempt number)."""
    m = ATTEMPT_RE.match(pid)
    return (m.group(1), int(m.group(2))) if m and m.group(1) else (pid, 1)


def _dedupe(t: pd.DataFrame, keys: list[str], label: str) -> pd.DataFrame:
    """Drop repeated rows of the same trial from the same page load, keeping the first."""
    key = [c for c in keys if c in t]
    if "page_load_id" in t:
        t = t.assign(page_load_id=_text(t.page_load_id))
        key.append("page_load_id")
    if not key or t.empty:
        return t
    n0 = len(t)
    t = t.drop_duplicates(key, keep="first")
    if len(t) < n0:
        print(f"Note: dropped {n0 - len(t)} duplicate {label} row(s)")
    return t


# ── Loading ─────────────────────────────────────────────────────────────────
def _read_json(p: Path) -> dict[str, pd.DataFrame]:
    """A participant's own download: {"participant_id", "exported", "data": {tab: [rows]}}."""
    try:
        with open(p, encoding="utf-8") as f:
            j = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"Note: {p.name}: not readable as JSON ({e}) - skipped")
        return {}
    tabs = j.get("data", j) if isinstance(j, dict) else None
    if not isinstance(tabs, dict):
        print(f"Note: {p.name}: not a participant download - skipped")
        return {}
    out = {k: pd.DataFrame(v) for k, v in tabs.items()
           if isinstance(v, list) and v and all(isinstance(r, dict) for r in v)}
    if not any("participant_id" in t for t in out.values()):
        print(f"Note: {p.name}: not a participant download - skipped")
        return {}
    return out


def _read_one(src: Path) -> list[tuple[str, dict[str, pd.DataFrame]]]:
    if src.is_dir():
        parts = [(p.name, _read_json(p)) for p in sorted(src.glob("*.json"))]
        csvs = sorted(src.glob("*.csv"))
        if csvs:
            parts.append((src.name, {p.stem: pd.read_csv(p) for p in csvs}))
        return [x for x in parts if x[1]]
    if src.suffix.lower() == ".json":
        t = _read_json(src)
        return [(src.name, t)] if t else []
    if src.suffix.lower() == ".csv":
        return [(src.name, {src.stem: pd.read_csv(src)})]
    return [(src.name, pd.read_excel(src, sheet_name=None))]


def load(srcs: list[Path], url: str | None = None, key: str | None = None) -> dict[str, pd.DataFrame]:
    parts: list[tuple[str, dict[str, pd.DataFrame]]] = []
    if url:
        if not key:
            raise SystemExit("--url needs --key (or set STUDY_KEY)")
        q = urllib.parse.urlencode({"action": "export", "key": key})
        with urllib.request.urlopen(f"{url}?{q}", timeout=180) as r:
            j = json.load(r)
        if not j.get("ok"):
            raise SystemExit(f"Export refused: {j.get('error')} (check --key)")
        print(f"Downloaded from the Sheet at {j['exported_at']}")
        parts.append(("Sheet", {k: pd.DataFrame(v) for k, v in j["sheets"].items() if v}))
    for src in srcs:
        if not src.exists():
            raise SystemExit(f"Not found: {src}")
        parts += _read_one(src)
    if not parts:
        raise SystemExit("No data files found.")

    # Merge all sources tab by tab. A participant found in more than one source
    # (e.g. in the Sheet and in their own JSON download) is taken from the first only.
    merged: dict[str, list[pd.DataFrame]] = {}
    seen: set[str] = set()
    for name, tabs in parts:
        pids: set[str] = set()
        for k, t in tabs.items():
            if "participant_id" in t:
                t = t[t.participant_id.notna()].copy()
                t["participant_id"] = _pid(t.participant_id)
                tabs[k] = t
                pids |= set(t.participant_id)
        dup = pids & seen
        if dup:
            print(f"Note: {name}: skipping {', '.join(sorted(dup))} (already loaded from an earlier source)")
        for k, t in tabs.items():
            if "participant_id" in t and dup:
                t = t[~t.participant_id.isin(dup)]
            merged.setdefault(k, []).append(t)
        seen |= pids
    print(f"Loaded {len(seen)} participant code(s) from {len(parts)} source(s)")
    return {k: pd.concat(v, ignore_index=True) for k, v in merged.items()}


def restrict_page_loads(sheets: dict[str, pd.DataFrame]) -> dict[str, int]:
    """One page load per participant code.

    A code normally has one page load (reopening in the same browser gives a new "(2)"
    code). Rows from several page loads under one code mean the link was reopened in
    another browser; mixing them would count trials twice, so only one page load is kept:
    the one that finished, else the one with the most trial rows, else the latest.
    Returns the number of page loads with participant data per code (only codes with > 1).
    """
    parts = []
    for name in PARTICIPANT_TABS:
        t = sheets.get(name)
        if t is None or t.empty or "participant_id" not in t or "page_load_id" not in t:
            continue
        d = pd.DataFrame({"pid": t.participant_id.to_numpy(), "load": _text(t.page_load_id).to_numpy()})
        d["trial_rows"] = int(name in TRIAL_TABS)
        d["finished"] = False
        d["saved"] = ""
        if name == "sessions" and "status" in t:
            d["finished"] = (_text(t.status).str.lower() == "completed").to_numpy()
        if name == "summary":
            if "complete" in t:
                d["finished"] = (_num(t.complete) == 1).to_numpy()
            if "saved_at" in t:
                d["saved"] = _time(t.saved_at).astype(str).replace("NaT", "").to_numpy()
        parts.append(d)
    if not parts:
        return {}
    d = pd.concat(parts, ignore_index=True)
    d = d[d.load != ""]
    g = d.groupby(["pid", "load"], sort=False).agg(finished=("finished", "max"), trial_rows=("trial_rows", "sum"),
                                                 saved=("saved", "max")).reset_index()
    n_loads = g.groupby("pid").size()
    multi = n_loads[n_loads > 1]
    if multi.empty:
        return {}
    keep = (g[g.pid.isin(multi.index)].sort_values(["finished", "trial_rows", "saved"], kind="stable")
            .drop_duplicates("pid", keep="last").set_index("pid").load)
    for name, t in sheets.items():
        if "participant_id" not in t or "page_load_id" not in t:
            continue
        load = _text(t.page_load_id)
        want = t.participant_id.map(keep)
        drop = want.notna() & (load != "") & (load != want)
        sheets[name] = t[~drop]
    print(f"Note: {len(multi)} code(s) have rows from more than one page load (link reopened in another "
          f"browser): {', '.join(multi.index)} - kept one page load each (flag multiple_page_loads)")
    return multi.to_dict()


def newest_summary(summ: pd.DataFrame | None) -> pd.DataFrame:
    """The newest summary row per participant (by saved_at, else the last row), indexed by participant_id."""
    if summ is None or summ.empty or "participant_id" not in summ:
        return pd.DataFrame()
    s = summ.assign(_order=np.arange(len(summ)))
    if "saved_at" in s:
        s = s.assign(_t=_time(s.saved_at)).sort_values(["_t", "_order"], na_position="first", kind="stable")
    s = s.drop_duplicates("participant_id", keep="last").set_index("participant_id")
    return s.drop(columns=[c for c in ("_order", "_t") if c in s])


# ── Per-phase Stroop metrics (same rules as js/summary.js) ─────────────────
def _rts(df: pd.DataFrame) -> pd.Series:
    rt = _num(df.rt)
    return rt[(df.outcome == "correct") & (rt >= MIN_RT)]


def _acc(df: pd.DataFrame) -> float:
    resp = df[df.outcome != "missed"]
    return (resp.outcome == "correct").mean() if len(resp) else np.nan


def phase_metrics(df: pd.DataFrame, late_limit: float) -> dict:
    rt = _rts(df)
    n = len(df)
    focus = (_num(_col(df, "focus_lost")) == 1).sum()
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
        "n_focus_lost": int(focus),
        "focus_lost_share": focus / n if n else np.nan,
    }
    if np.isfinite(late_limit):
        late = int((_num(_col(df, "onset_frame_ms")) > late_limit).sum())
        m["n_late_onset"], m["late_onset_share"] = late, (late / n if n else np.nan)
    else:
        m["n_late_onset"] = m["late_onset_share"] = np.nan
    rt_t, acc_t = {}, {}
    for t in TRIAL_TYPES:
        sub = df[df.trial_type == t]
        rt_t[t], acc_t[t] = _rts(sub).mean(), _acc(sub)
    m.update({f"rt_{t}": v for t, v in rt_t.items()})
    m.update({f"acc_{t}": v for t, v in acc_t.items()})
    m["stroop_interference_rt"] = rt_t["incongruent"] - rt_t["congruent"]
    m["stroop_interference_acc"] = acc_t["congruent"] - acc_t["incongruent"]
    m["emotional_interference_neg_neu"] = rt_t["negative"] - rt_t["neutral"]
    m["emotional_interference_pos_neu"] = rt_t["positive"] - rt_t["neutral"]
    m["emotional_interference_neg_pos"] = rt_t["negative"] - rt_t["positive"]
    return m


def _stroop_trials(sheets: dict[str, pd.DataFrame]) -> pd.DataFrame:
    if "stroop_trials" not in sheets or sheets["stroop_trials"].empty:
        print("Note: no stroop_trials data found")
        return pd.DataFrame(columns=["participant_id", "phase", "block_type", "trial", "trial_type", "outcome", "rt"])
    t = sheets["stroop_trials"].copy()
    if "trial_type" not in t:   # derive it if an older export lacks the column
        t["trial_type"] = np.where(t.word_category == "colour", _col(t, "congruency"), t.word_category)
    if "outcome" not in t:
        acc = _num(_col(t, "accuracy"))
        t["outcome"] = np.where(acc == 1, "correct", np.where(acc == 0, "incorrect", "missed"))
    for c in ("outcome", "trial_type", "phase", "block_type"):
        if c in t:
            t[c] = _text(t[c])
    practice = _num(_col(t, "is_practice"))
    measured = practice == 0 if practice.notna().any() else _col(t, "block_type") != "practice"
    t = t[measured]
    return _dedupe(t, ["participant_id", "session", "phase", "block_type", "trial"], "Stroop trial")


# ── Other per-participant tables ───────────────────────────────────────────
def vas_table(vas: pd.DataFrame | None) -> pd.DataFrame:
    if vas is None or vas.empty:
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


def mist_table(mist: pd.DataFrame | None) -> pd.DataFrame:
    if mist is None or mist.empty:
        return pd.DataFrame()
    e = _dedupe(mist[_text(mist.block) == "experimental"], ["participant_id", "session", "block", "trial"], "MIST trial")
    rows = {}
    for pid, g in e.groupby("participant_id"):
        g = g.assign(_trial=_num(g.trial)).sort_values("_trial", kind="stable") if "trial" in g else g
        acc, rt = _num(g.accuracy), _num(_col(g, "rt"))
        # Adaptive limit (js/mist.js): time_limit = limit in force on the trial,
        # next_time_limit = limit after it (changes only after 3 alike answers in a row).
        lim, nxt = _num(_col(g, "time_limit")), _num(_col(g, "next_time_limit"))
        rows[pid] = {
            "mist_n_trials": len(g),
            "mist_accuracy": (acc == 1).mean() if len(g) else np.nan,
            "mist_n_timeouts": int((_num(_col(g, "timed_out")) == 1).sum()),
            "mist_mean_rt_correct": rt[acc == 1].mean(),
            "mist_time_limit_start": lim.iloc[0] if len(g) else np.nan,
            "mist_time_limit_min": lim.min(),
            "mist_time_limit_max": lim.max(),
            "mist_n_limit_changes": int((nxt.notna() & lim.notna() & ((nxt - lim).abs() > 1e-6)).sum()),
            "mist_final_time_limit": nxt.iloc[-1] if len(g) else np.nan,
        }
    return pd.DataFrame.from_dict(rows, orient="index")


def _preload_counts(ev: pd.DataFrame | None) -> dict[str, float]:
    """Images picked at preload per participant (events: Image_Markers preload_start, detail {"n": ...})."""
    if ev is None or ev.empty or "label" not in ev or "detail" not in ev:
        return {}
    e = ev[_text(ev.label) == "preload_start"]
    out = {}
    for pid, detail in zip(e.participant_id, e.detail):
        try:
            n = json.loads(str(detail)).get("n")
        except (json.JSONDecodeError, AttributeError):
            continue
        if isinstance(n, (int, float)) and n > 0:
            out[pid] = float(n)   # the last preload of the (one kept) page load
    return out


def image_quality(sheets: dict[str, pd.DataFrame], pids: list[str], quick: dict[str, bool]) -> pd.DataFrame:
    img = sheets.get("image_trials")
    if img is None or img.empty:
        img = pd.DataFrame(columns=["participant_id"])
    img = _dedupe(img, ["participant_id", "session", "phase", "trial"], "image trial")
    ev = sheets.get("events")
    picked = _preload_counts(ev)
    rows = []
    for pid in pids:
        g = img[img.participant_id == pid]
        if "trial" in g:
            g = g.assign(_trial=_num(g.trial)).sort_values("_trial", kind="stable")
        shown_col = _num(_col(g, "shown"))
        has_shown = bool(shown_col.notna().any())   # v1.1 rows; older rows: every row was a shown image
        is_shown = shown_col.fillna(1) == 1
        s = g[is_shown]
        n_rows, n = len(g), len(s)
        constant = N_IMAGES_QUICK if quick.get(pid) else N_IMAGES_PLANNED
        planned = n_rows if (has_shown and n_rows) else constant
        denom = max(planned, picked.get(pid, 0))   # images that never loaded leave no row
        dur, err = _num(_col(s, "duration_ms")), _num(_col(s, "onset_error_ms")).abs()
        focus_shown = int((_num(_col(s, "focus_lost")) == 1).sum())
        fill = _text(_col(s, "fill_mode"))
        tier = _text(_col(g, "tier")).str.replace(r"\.0$", "", regex=True)   # 1280.0 from a spreadsheet
        tier = tier[tier != ""]
        r = {
            "participant_id": pid,
            "images_n_planned": planned,
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
            # all rows, as js/summary.js (skipped images count as focus lost)
            "images_n_focus_lost": int((_num(_col(g, "focus_lost")) == 1).sum()),
            "images_focus_lost_share": focus_shown / n if n else np.nan,   # of the shown images
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


def _last_per_pid(t: pd.DataFrame) -> pd.DataFrame:
    return t.drop_duplicates("participant_id", keep="last").set_index("participant_id")


def _steps_with_data(sheets: dict[str, pd.DataFrame]) -> dict[str, str]:
    """Furthest section of the session each participant has any rows for (in FLOW order)."""
    pairs: list[pd.DataFrame] = []

    def add(t: pd.DataFrame | None, step, mask=None) -> None:
        if t is None or t.empty or "participant_id" not in t:
            return
        t = t if mask is None else t[mask]
        steps = step(t) if callable(step) else pd.Series(step, index=t.index)
        pairs.append(pd.DataFrame({"pid": t.participant_id.to_numpy(), "step": steps.to_numpy()}))

    sess, ev = sheets.get("sessions"), sheets.get("events")
    add(sheets.get("demographics"), "demographics")
    if sess is not None and "status" in sess:
        add(sess, "setup", _text(sess.status).str.lower().isin(["started", "completed"]))
    if "vas" in sheets and "timepoint" in sheets["vas"]:
        add(sheets["vas"], lambda t: "vas_" + _text(t.timepoint))
    if "stroop_trials" in sheets and "phase" in sheets["stroop_trials"]:
        add(sheets["stroop_trials"], lambda t: "stroop_" + _text(t.phase))
    add(sheets.get("mist_trials"), "mist")
    add(sheets.get("image_trials"), "images")
    if ev is not None and "stream" in ev and "code" in ev:
        add(ev, "rest", (_text(ev.stream) == "Rest_Markers") & (_num(ev.code) == 80))
    add(sheets.get("feedback"), "feedback")
    if not pairs:
        return {}
    d = pd.concat(pairs, ignore_index=True).drop_duplicates()
    d["i"] = d.step.map({s: i for i, s in enumerate(FLOW)})
    d = d.dropna(subset=["i"]).sort_values("i", kind="stable").drop_duplicates("pid", keep="last")
    return dict(zip(d.pid, d.step))


def participant_table(sheets: dict[str, pd.DataFrame], include_incomplete: bool, include_quick: bool,
                      first_attempt_only: bool = False) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(analysed participants, their image block quality, everyone who did not finish)."""
    n_loads = restrict_page_loads(sheets)
    trials = _stroop_trials(sheets)
    summ = newest_summary(sheets.get("summary"))

    # Everyone who consented: found in any participant tab (not only the event log).
    found: set[str] = set()
    for name in PARTICIPANT_TABS:
        t = sheets.get(name)
        if t is not None and "participant_id" in t:
            found |= set(t.participant_id)
    ev = sheets.get("events")
    if ev is not None and "participant_id" in ev:
        only_ev = set(ev.participant_id) - found
        if only_ev:
            print(f"Note: ignored {len(only_ev)} code(s) found only in the event log "
                  "(opened the link but never consented)")
    if not found:
        raise SystemExit("No participant data found.")
    pids = sorted(found)

    # Completion: a 'completed' sessions row, the newest summary row complete (status
    # "complete" / complete = 1), or the server's completions log.
    sess = sheets.get("sessions")
    has_sess = sess is not None and not sess.empty and "status" in sess
    if not has_sess:
        sess = pd.DataFrame(columns=["participant_id", "status"])
    s_status = _text(sess.status).str.lower()
    completed = set(sess.loc[s_status == "completed", "participant_id"])
    summ_status = _text(_col(summ, "status")).str.lower()
    completed |= set(summ.index[((_num(_col(summ, "complete")) == 1) | (summ_status == "complete")).to_numpy()])
    comp = sheets.get("completions")
    if comp is not None and "participant_id" in comp:
        completed |= set(comp.participant_id) & found
    if not has_sess and not ("status" in summ or "complete" in summ):
        print("Note: no sessions or summary status - completion unknown; treating everyone as complete")
        completed = set(pids)
    quit_sess = set(sess.loc[s_status == "quit", "participant_id"])
    quick = set(sess.loc[_num(_col(sess, "quick_mode")) == 1, "participant_id"])
    quick |= set(summ.index[(_num(_col(summ, "quick_mode")) == 1).to_numpy()])
    # One info row per person: the 'completed' row, else the 'quit' row, else 'started'.
    rank = s_status.map({"completed": 2, "quit": 1}).fillna(0)
    info = _last_per_pid(sess.assign(_rank=rank).sort_values("_rank", kind="stable"))
    info = info[[c for c in SESSION_INFO + ["last_step"] if c in info]]

    # Attempt: the 'attempt' column (sessions / summary / demographics), else the "(n)" suffix.
    base = {p: split_attempt(p) for p in pids}
    att_rows = [pd.DataFrame({"pid": t.participant_id.to_numpy(), "a": _num(t.attempt).to_numpy()})
                for t in (sheets.get(n) for n in ("sessions", "summary", "demographics"))
                if t is not None and "participant_id" in t and "attempt" in t]
    att_col = pd.concat(att_rows).dropna().groupby("pid").a.max() if att_rows else pd.Series(dtype=float)
    attempt = {p: int(att_col[p]) if p in att_col.index and att_col[p] >= 1 else base[p][1] for p in pids}

    def status_of(p: str) -> str:
        if p in completed:
            return "complete"
        st = summ_status.get(p, "")
        if st in ("quit", "in_progress"):
            return st
        return "quit" if p in quit_sess else "in_progress"

    status = {p: status_of(p) for p in pids}

    dropped_quick = [p for p in pids if p in quick and not include_quick]
    if dropped_quick:
        print(f"Skipped {len(dropped_quick)} ?quick=1 pilot session(s) (use --include-quick to keep them)")
    pids = [p for p in pids if p not in dropped_quick]

    by_base: dict[str, list[str]] = {}
    for p in pids:
        by_base.setdefault(base[p][0], []).append(p)
    multi = {b: sorted(ps, key=lambda p: attempt[p]) for b, ps in by_base.items()
             if len(ps) > 1 or any(attempt[p] > 1 for p in ps)}
    if multi:
        print(f"Note: {len(multi)} participant(s) reopened the study (kept as separate participants, "
              "later attempts flagged repeat_attempt):")
        for b, ps in sorted(multi.items()):
            print(f"  {b:<26} " + ", ".join(f"attempt {attempt[p]} ({status[p]})" for p in ps)
                  + ("" if any(attempt[p] == 1 for p in ps) else "  - no data from attempt 1"))
    if first_attempt_only:
        later = [p for p in pids if attempt[p] > 1]
        if later:
            print(f"--first-attempt-only: dropped {len(later)} later attempt(s): {', '.join(later)}")
        pids = [p for p in pids if attempt[p] == 1]
    if not pids:
        raise SystemExit("No usable participants found.")

    counts = pd.Series([status[p] for p in pids]).value_counts()
    print("Status: " + ", ".join(f"{counts.get(s, 0)} {s}" for s in STATUSES)
          + f"  (newest summary row; {len(pids)} participant(s))")

    # Order of finishing (incomplete: of their last save) and each person's normal frame duration.
    when = pd.Series(pd.NaT, index=pd.Index(pids), dtype="datetime64[ns, UTC]")
    for src, col in ((info, "end_time"), (summ, "saved_at"), (info, "quit_time"), (info, "start_time")):
        if col in src:
            t = _time(src[col]).reindex(when.index)
            when = when.where(when.notna(), t)
    order = {p: i + 1 for i, p in enumerate(sorted(pids, key=lambda p: (pd.isna(when[p]), when[p] if pd.notna(when[p]) else 0, p)))}
    frame = _num(info["frame_ms_median"]) if "frame_ms_median" in info else pd.Series(dtype=float)
    last_data = _steps_with_data(sheets)
    get = lambda t, p, c: t.at[p, c] if c in t and p in t.index else np.nan

    rows = []
    for pid in pids:
        g = trials[trials.participant_id == pid]
        step = _text(pd.Series([get(summ, pid, "last_step"), get(info, pid, "last_step")]))
        step = step[step != ""]
        minutes = _num(pd.Series([get(summ, pid, "minutes_since_start")])).iloc[0]
        if status[pid] == "complete" or pd.isna(minutes):
            dur = _num(pd.Series([get(info, pid, "duration_min")])).iloc[0]
            minutes = dur if pd.notna(dur) else minutes
        row: dict = {
            "participant_id": pid, "base_pid": base[pid][0], "attempt": attempt[pid], "status": status[pid],
            "complete": int(status[pid] == "complete"), "completion_order": order[pid],
            "last_step": step.iloc[0] if len(step) else "", "last_step_with_data": last_data.get(pid, "consent"),
            "stroop_phases": ";".join(p for p in PHASES if (g.phase == p).any()),
            "minutes_since_start": minutes, "saved_at": get(summ, pid, "saved_at"),
            "n_page_loads": n_loads.get(pid, 1),
        }
        for c in SESSION_INFO:
            if c in info or c in summ:
                v = get(info, pid, c)
                if _text(pd.Series([v], dtype=object)).iloc[0] == "":
                    v = get(summ, pid, c)   # quit before the sessions row had it (summary rows have the ids)
                row[c] = v
        late_limit = LATE_FACTOR * frame.get(pid, np.nan)
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
    df = pd.DataFrame(rows).set_index("participant_id")

    for extra in (vas_table(sheets.get("vas")), mist_table(sheets.get("mist_trials"))):
        if len(extra):
            df = df.join(extra, how="left")
    quick_mode = _num(_col(df, "quick_mode"))
    imgq = image_quality(sheets, pids, {p: quick_mode.get(p) == 1 or p in quick for p in pids})
    df = df.join(imgq.set_index("participant_id"), how="left")
    if "image_tier" in df:   # images_tier from the image rows; else the tier chosen at setup
        df["images_tier"] = df.images_tier.where(_text(df.images_tier) != "",
                                                _text(df.image_tier).str.replace(r"\.0$", "", regex=True))

    if "demographics" in sheets:
        d = _last_per_pid(sheets["demographics"])
        for c in ("prolific_pid", "prolific_study_id", "prolific_session_id"):   # fill gaps from demographics
            if c in d:
                fill = d[c].reindex(df.index)
                df[c] = df[c].where(_text(df[c]) != "", fill) if c in df else fill
        df = df.join(d[[c for c in DEMOGRAPHICS if c in d]], how="left")
    if "feedback" in sheets:
        f = _last_per_pid(sheets["feedback"])
        keep = [c for c in f.columns if c not in ("submitted", "received_at", "session", "page_load_id") and c not in df]
        df = df.join(f[keep], how="left")
    df = df.reset_index()

    # Exclusion flags (NaN = unknown = not flagged, except a missing phase).
    flags = pd.DataFrame(index=df.index)
    any_phase = lambda m, lim: pd.concat([_num(_col(df, f"{p}_{m}")) > lim for p in PHASES], axis=1).any(axis=1)
    flags["low_accuracy"] = _num(_col(df, "baseline_accuracy_all")) < MIN_ACCURACY_ALL
    flags["unfocused"] = any_phase("focus_lost_share", MAX_FOCUS_LOST)
    flags["timing_unreliable"] = any_phase("late_onset_share", MAX_LATE_ONSET)
    flags["low_effort"] = _num(_col(df, "effort")) < MIN_EFFORT
    flags["colour_blind"] = _text(_col(df, "colour_vision")).str.lower() == "yes"
    if "image_trials" in sheets:
        flags["images_incomplete"] = _num(df.images_share_shown) < MIN_IMAGES_SHOWN
        flags["images_unfocused"] = _num(df.images_focus_lost_share) > MAX_IMAGES_FOCUS_LOST
    else:
        print("Note: no image_trials tab - image block flags not checked")
    flags["repeat_attempt"] = df.attempt > 1
    flags["multiple_page_loads"] = df.n_page_loads > 1
    flags["missing_phase"] = pd.concat([_num(_col(df, f"{p}_n_trials")).fillna(0) == 0 for p in PHASES], axis=1).any(axis=1)
    for c in flags:
        df[f"flag_{c}"] = flags[c].astype(int)
    df["exclusion_reasons"] = flags.apply(lambda r: ";".join(k for k, v in r.items() if v), axis=1)
    df = df.sort_values("completion_order").reset_index(drop=True)

    done = df.status == "complete"
    lead = ["participant_id", "base_pid", "attempt", "status", "last_step", "last_step_with_data", "stroop_phases",
            "minutes_since_start", "saved_at", "quick_mode", "exclusion_reasons"]
    incomplete = df[~done]
    incomplete = incomplete[[c for c in lead if c in df] + [c for c in df if c not in lead]].reset_index(drop=True)
    main = (df if include_incomplete else df[done]).reset_index(drop=True)
    if len(incomplete):
        n = incomplete.status.value_counts()
        print(f"Incomplete: {len(incomplete)} participant(s) ({n.get('quit', 0)} quit, {n.get('in_progress', 0)} in progress) "
              + ("- analysed with the rest (--include-incomplete)" if include_incomplete
                 else "- not analysed (use --include-incomplete); their metrics are in incomplete_participants.csv"))
        for _, r in incomplete.iterrows():
            print(f"  {r.participant_id:<28} {r.status:<12} last step {r.last_step or '?':<22} "
                  f"data up to {r.last_step_with_data or '-':<22} Stroop: {r.stroop_phases or 'none'}")
    imgq = imgq.merge(df[["participant_id", "status", "exclusion_reasons"]], on="participant_id", how="left")
    imgq = imgq[imgq.participant_id.isin(main.participant_id)].reset_index(drop=True)
    return main, imgq, incomplete


def check_against_summary(df: pd.DataFrame, summ: pd.DataFrame | None) -> None:
    """Compare the recomputed metrics with the newest in-browser summary row (js/summary.js).

    Only summary rows saved at the end ("complete") or at page close ("quit") are compared:
    an "in_progress" row predates the rows of the section that was running.
    """
    s = newest_summary(summ)
    if s.empty:
        return
    if "status" in s:
        s = s[_text(s.status).str.lower().isin(["", "complete", "quit"])]
    prefixes = tuple(f"{p}_" for p in PHASES + list(CONTRASTS)) + ("vas_", "mist_", "images_")
    cols = [c for c in df.columns if c in s.columns and c.startswith(prefixes)]
    checked, bad = 0, []
    for _, r in df[df.participant_id.isin(s.index)].iterrows():
        checked += 1
        for c in cols:
            x = pd.to_numeric(pd.Series([r[c]]), errors="coerce").iloc[0]
            y = pd.to_numeric(pd.Series([s.at[r.participant_id, c]]), errors="coerce").iloc[0]
            if pd.notna(x) and pd.notna(y) and abs(x - y) > max(2e-3, 1e-4 * abs(y)):
                bad.append(f"{r.participant_id}:{c} ({x:.4g} vs {y:.4g})")
    if not checked:
        return
    if bad:
        print(f"Check vs the in-browser summary: {len(bad)} value(s) differ - "
              + ", ".join(bad[:8]) + (" ..." if len(bad) > 8 else ""))
    else:
        print(f"Check vs the in-browser summary: {len(cols)} columns agree for {checked} participant(s)")


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
            if m == "composite" and name != "stress" and "vas_image_feeling" in df:
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


def feedback_summary(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for item in FEEDBACK_SCALES:
        if item not in df:
            continue
        x = _num(df[item])
        rows.append({"item": item, "kind": "scale 1-5", "level": "all", **describe(x)})
        n = int(x.notna().sum())
        for lv in range(1, 6):
            k = int((x == lv).sum())
            rows.append({"item": item, "kind": "scale 1-5", "level": str(lv), "count": k,
                         "percent": 100 * k / n if n else np.nan})
    for item, levels in FEEDBACK_CHOICES.items():
        if item not in df:
            continue
        x = _text(df[item])
        x = x[x != ""]
        n = len(x)
        if item in FEEDBACK_SCORED:
            score = x.map({lv: i - 2 for i, lv in enumerate(levels)})
            rows.append({"item": item, "kind": "choice", "level": "all (scored -2..+2)", **describe(score)})
        for lv in levels + sorted(set(x) - set(levels)):
            k = int((x == lv).sum())
            rows.append({"item": item, "kind": "choice", "level": lv, "count": k,
                         "percent": 100 * k / n if n else np.nan})
    for item in FEEDBACK_TEXT:
        if item in df:
            rows.append({"item": item, "kind": "text", "level": "answered",
                         "count": int((_text(df[item]) != "").sum()), "n": len(df)})
    return pd.DataFrame(rows)


def individual_changes(df: pd.DataFrame) -> pd.DataFrame:
    cols = ["participant_id", "completion_order", "status", "attempt"]
    for name in CONTRASTS:
        cols += [f"{name}_{m}" for m in PRIMARY] + [f"vas_{name}_change"]
    cols += ["vas_image_feeling", "images_feeling", "images_relaxing", "exclusion_reasons"]
    return df[[c for c in cols if c in df]]


# ── Plots ──────────────────────────────────────────────────────────────────
INK, INK2, GRID, SERIES, INDIV, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#2a78d6", "#b9b8b2", "#fcfcfb"


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


def make_plots(df: pd.DataFrame, out: Path) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    saved = []

    cols = [f"vas_{tp}_composite" for tp in VAS_TIMEPOINTS]
    if all(c in df for c in cols) and df[cols].notna().any().any():
        y = df[cols].apply(pd.to_numeric, errors="coerce")
        fig, ax = plt.subplots(figsize=(6.4, 4.0), facecolor=SURFACE)
        _style(ax)
        _trajectories(ax, y, ["Baseline", "Pre-MIST", "Post-MIST", "Post-recovery"])
        for xm, txt in ((0.5, "Stroop"), (1.5, "MIST"), (2.5, "Stroop + images\n+ 1 min rest")):
            ax.text(xm, 1.0, txt, transform=ax.get_xaxis_transform(), ha="center", va="bottom",
                    fontsize=8, color=INK2)
        ax.set_ylim(0, 100)
        ax.set_ylabel("Stress composite (0-100)", color=INK, fontsize=10)
        ax.set_title(f"VAS stress composite, mean and 95 % CI (n = {int(y.notna().all(axis=1).sum())} complete)",
                     color=INK, fontsize=10, pad=26, loc="left")
        fig.tight_layout()
        fig.savefig(out / "vas_trajectory.png", dpi=150, facecolor=SURFACE)
        plt.close(fig)
        saved.append("vas_trajectory.png")

    metrics = [m for m in PLOT_METRICS if all(f"{p}_{m}" in df for p in PHASES)]
    if metrics:
        titles = {"mean_rt": "Mean RT (s, correct)", "stroop_interference_rt": "Stroop interference (s)\nincongruent - congruent",
                  "emotional_interference_neg_neu": "Emotional interference (s)\nnegative - neutral"}
        fig, axes = plt.subplots(1, len(metrics), figsize=(3.6 * len(metrics), 3.8), facecolor=SURFACE, squeeze=False)
        for ax, m in zip(axes[0], metrics):
            _style(ax)
            y = df[[f"{p}_{m}" for p in PHASES]].apply(pd.to_numeric, errors="coerce")
            if m != "mean_rt":
                ax.axhline(0, color=INK2, lw=0.8, zorder=0)
            _trajectories(ax, y, ["Baseline", "Post-stress", "Post-recovery"])
            ax.set_title(titles.get(m, m), color=INK, fontsize=10, loc="left")
            ax.tick_params(axis="x", labelsize=8)
        fig.suptitle(f"Stroop by phase: individuals (grey) and mean with 95 % CI (n = {len(df)})",
                     color=INK, fontsize=10, x=0.01, ha="left")
        fig.tight_layout()
        fig.savefig(out / "stroop_phases.png", dpi=150, facecolor=SURFACE)
        plt.close(fig)
        saved.append("stroop_phases.png")
    return saved


# ── Main ───────────────────────────────────────────────────────────────────
def _print_table(t: pd.DataFrame, title: str) -> None:
    print(f"\n{title}")
    print(t.round(3).to_string(index=False) if len(t) else "  (nothing to show)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, nargs="*",
                    help=".xlsx export of the Sheet, participant .json downloads, or a folder of .json / <tab>.csv files "
                         "(several allowed; they are combined)")
    ap.add_argument("--url", default=os.environ.get("STUDY_URL"), help="Apps Script web-app URL (or env STUDY_URL)")
    ap.add_argument("--key", default=os.environ.get("STUDY_KEY"), help="export key (or env STUDY_KEY)")
    ap.add_argument("--out", type=Path, default=Path("results"))
    ap.add_argument("--exclude", action="store_true", help="drop participants with any exclusion flag")
    ap.add_argument("--include-incomplete", action="store_true",
                    help="analyse sessions that did not finish (quit / in progress) with the rest, for whatever "
                         "phases they did (they are always listed in incomplete_participants.csv)")
    ap.add_argument("--include-quick", action="store_true", help="keep ?quick=1 pilot sessions (quick_mode = 1)")
    ap.add_argument("--first-attempt-only", action="store_true",
                    help="drop reopened attempts (codes ending in (2), (3), ...; attempt > 1)")
    ap.add_argument("--plots", action="store_true", help="save VAS and Stroop phase plots (needs matplotlib)")
    a = ap.parse_args()
    if not a.source and not a.url:
        ap.error("give a .xlsx / .json / folder, or --url and --key")

    sheets = load(a.source, a.url if not a.source else None, a.key)
    df, imgq, incomplete = participant_table(sheets, a.include_incomplete, a.include_quick, a.first_attempt_only)
    a.out.mkdir(parents=True, exist_ok=True)
    incomplete.to_csv(a.out / "incomplete_participants.csv", index=False)
    check_against_summary(pd.concat([df, incomplete]).drop_duplicates("participant_id"), sheets.get("summary"))
    if df.empty:
        raise SystemExit(f"No completed sessions to analyse ({len(incomplete)} incomplete: see "
                         f"{a.out / 'incomplete_participants.csv'}, or use --include-incomplete).")
    df.to_csv(a.out / "participant_metrics.csv", index=False)
    imgq.to_csv(a.out / "image_quality.csv", index=False)

    n_inc = int((df.status != "complete").sum())
    extra = [f"{int((_num(_col(df, 'quick_mode')) == 1).sum())} quick-mode"] if a.include_quick else []
    extra += [f"{n_inc} incomplete"] if n_inc else []
    print(f"\nParticipants analysed: {len(df)}" + (f"  (including {', '.join(extra)})" if extra else ""))
    flagged = df[df.exclusion_reasons != ""]
    if len(flagged):
        print(f"Flagged ({'excluded' if a.exclude else 'kept - use --exclude to drop'}):")
        for _, r in flagged.iterrows():
            print(f"  {r.participant_id:<26} {r.exclusion_reasons}")
    else:
        print("No exclusion flags.")
    if a.exclude:
        df = df[df.exclusion_reasons == ""].reset_index(drop=True)
        if df.empty:
            raise SystemExit("No participants left after exclusions.")

    mcols = ["participant_id", "mist_n_trials", "mist_accuracy", "mist_n_timeouts", "mist_mean_rt_correct",
             "mist_time_limit_start", "mist_time_limit_min", "mist_time_limit_max", "mist_n_limit_changes",
             "mist_final_time_limit"]
    if "mist_n_trials" in df:
        _print_table(df[[c for c in mcols if c in df]].rename(columns=lambda c: c.replace("mist_", "").replace("time_limit", "limit")),
                     "MIST per participant (experimental trials; time limits in s):")
    qcols = ["participant_id", "images_n_shown", "images_n_planned", "images_n_skipped_hidden", "images_tier",
             "images_n_cover", "images_n_contain_blur", "images_n_replaced", "images_mean_duration_ms",
             "images_max_duration_ms", "images_max_abs_onset_error_ms", "images_n_focus_lost", "rest_s"]
    _print_table(imgq[[c for c in qcols if c in imgq]].rename(columns=lambda c: c.replace("images_", "")),
                 "Image block per participant (skipped_hidden = not drawn, page hidden; durations / onset error "
                 "in ms; rest_s = fixation rest):")

    n = len(df)
    ind = individual_changes(df)
    ind.to_csv(a.out / "individual_changes.csv", index=False)
    short = {"mean_rt": "mean_rt", "accuracy_all": "acc_all", "stroop_interference_rt": "stroop_int",
             "emotional_interference_neg_neu": "emo_neg_neu"}
    for name, (lo, hi) in CONTRASTS.items():
        cols = ["participant_id"] + [f"{name}_{m}" for m in PRIMARY] + [f"vas_{name}_change"] \
            + (["vas_image_feeling"] if name == "recovery" else [])
        t = ind[[c for c in cols if c in ind]].rename(
            columns={**{f"{name}_{m}": s for m, s in short.items()}, f"vas_{name}_change": "vas_change"})
        _print_table(t, f"Each participant, {name} change = {hi} - {lo} (RT in s; VAS in 0-100 points):")
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
        if len(img):
            r = img.iloc[0]
            print(f"\nImage feeling (0 = positive, 50 = neutral, 100 = negative): n = {int(r.n)}, mean = {r['mean']:.1f}, "
                  f"median = {r['median']:.1f}; {int(r.n_positive_side)} on the positive side, {int(r.n_neutral)} neutral, "
                  f"{int(r.n_negative_side)} negative" + (f"; vs 50: p = {r.p_ttest:.3g}" if pd.notna(r.get("p_ttest")) else ""))

    eff = effects_table(df)
    eff.to_csv(a.out / "effects.csv", index=False)
    cols = ["contrast", "metric", "n", "from_mean", "to_mean", "change_mean", "change_ci_low", "change_ci_high",
            "p_ttest", "p_wilcoxon", "dz", "dz_ci_low", "dz_ci_high", "rho_vas_change", "rho_image_feeling"]
    _print_table(eff.loc[eff.primary == 1, [c for c in cols if c in eff]],
                 "Main effects, primary metrics (change = later - earlier; positive dz = higher later). "
                 "All metrics in effects.csv:")

    rm = rm_table(df)
    rm.to_csv(a.out / "rm_tests.csv", index=False)
    cols = ["metric", "n", "mean_baseline", "mean_post_stress", "mean_post_recovery", "friedman_chi2", "friedman_p",
            "kendall_w", "anova_F", "anova_p", "anova_p_gg", "partial_eta_sq"]
    if len(rm):
        _print_table(rm.loc[rm.primary == 1, [c for c in cols if c in rm]],
                     "Across the three phases (Friedman; RM ANOVA with Greenhouse-Geisser p). All metrics in rm_tests.csv:")

    fb = feedback_summary(df)
    fb.to_csv(a.out / "feedback_summary.csv", index=False)
    if len(fb):
        show = fb[(fb.level.str.startswith("all")) & fb.item.isin(FEEDBACK_SCALES + FEEDBACK_SCORED)]
        _print_table(show[["item", "level", "n", "mean", "sd", "median"]].astype({"n": "Int64"}),
                     "Feedback (1-5 scales; images_feeling / images_mood_change scored -2..+2). Counts in feedback_summary.csv:")

    if a.plots:
        saved = make_plots(df, a.out)
        if saved:
            print(f"\nPlots saved to {a.out}/: {', '.join(saved)}")
    print(f"\nTables saved to {a.out}/")


if __name__ == "__main__":
    main()
