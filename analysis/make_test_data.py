"""
Fake participant JSON files (schema 2.0, docs/DATA_FORMAT.md) for testing analyze.py
without running the browser study.

    python make_test_data.py <out folder> [--n 16] [--seed 1] [--conditions positive_prime positive negative neutral]
    python analyze.py <out folder> --plots --out <out folder>/results

Writes, like the receiver does, into <out>/complete/, <out>/progress/ and <out>/quit/:
  - N complete participants (default 16) spread evenly over the image conditions; the
    first two also leave their full series of progress snapshots (the complete file must win);
    the first one also leaves a status "complete" file in quit/ with a higher seq, no events
    and no image_trials (page closed during the final upload; complete/ must still win);
  - one drop-out: 2 progress files + 1 quit file (quit during the MIST baseline; the quit
    file has no events and has dropped image_trials, mist_trials and stroop_trials, as a
    real quit file may);
  - one repeat attempt: the last complete participant first quit early under "<ID>", then
    finished as "<ID>(2)" (attempt 2);
  - one ?quick=1 complete file and one debug-mode complete file;
  - one old-format JSON in <out>/ that is not schema 2 (analyze.py must skip it).
Some people are built to trip flags: low effort, full-screen exits during the tasks, a
hidden tab during the images (images skipped), psychoactive drugs = yes, a MIST baseline
that could not calibrate (source = default), doubt that performance counted, colour vision,
late stimulus frames. Each person's `summary` is computed here with the same rules as
js/summary.js, so analyze.py's check against the browser summary is tested too.

The numbers are fake; only the structure (field names and values) follows the spec.
EDIT HERE: block sizes (STROOP_*, MIST_*, N_IMAGES ...) and the PROFILES list below.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── EDIT HERE ── sizes of the fake blocks (normal, quick) ───────────────────
STROOP_PRACTICE, STROOP_CONGRUENT, STROOP_INCONGRUENT = (8, 4), (24, 4), (24, 4)
MIST_BASELINE_TRIALS, MIST_PRACTICE, MIST_EXP_TRIALS = (10, 3), (3, 2), (35, 5)
N_IMAGES, REST_S = (120, 6), (60, 5)
WORD_TIMEOUT, MIST_SAFETY_CAP = 2.0, 20.0
TIME_LIMIT, MIN_TIME_LIMIT, MAX_TIME_LIMIT, CAL_FACTOR, CAL_MIN_CORRECT = 5.0, 2.5, 7.0, 0.9, 3
CONDITIONS = ["positive_prime", "positive", "negative", "neutral"]
# Per-condition effect of the images (fake): Stroop RT change post_stress -> post_recovery (s),
# VAS stress level at post_recovery, image_feeling (0 positive .. 100 negative).
COND_EFFECT = {"positive_prime": (-0.06, 24, 20), "positive": (-0.045, 27, 26), "neutral": (-0.02, 35, 50),
               "negative": (0.01, 47, 80)}
# Special people among the complete participants (index -> overrides of the default profile).
PROFILES = {
    2: {"effort": "2"},                                                   # low_effort
    3: {"psychoactive_drugs": "yes", "psychoactive_drugs_detail": "ADHD medication (prescribed)"},
    5: {"fs_exits": 5},                                                   # left_fullscreen
    6: {"hidden_s": 45.0},                                                # tab_hidden + images_incomplete
    7: {"default_cal": True},                                             # mist_default_limit
    9: {"believed_performance_counts": "1"},                              # doubted_reward
    10: {"colour_vision": "yes"},                                         # colour_blind
    11: {"late_share": 0.2},                                              # timing_unreliable
}

COLOURS = ["red", "green", "blue", "yellow"]
FLOW = ["consent", "demographics", "setup", "intro", "stroop:baseline", "vas:pre_mist", "mist_baseline", "mist",
        "vas:post_mist", "stroop:post_stress", "vas:pre_images", "images", "blank", "vas:post_recovery",
        "stroop:post_recovery", "feedback"]
TASK_STEPS = {"stroop:baseline", "mist_baseline", "mist", "stroop:post_stress", "images", "blank",
              "stroop:post_recovery"}
TABLES = ["stroop_trials", "mist_trials", "vas", "image_trials", "events"]
STEP_FIELDS = ["fullscreen_exit_count", "tab_hidden_count", "window_blur_count", "time_outside_fullscreen_s",
               "time_hidden_s", "time_blurred_s"]


def r4(x):
    return "" if x is None or x == "" else round(x * 10000) / 10000


def safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", s)


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ── One simulated session ───────────────────────────────────────────────────
class Session:
    def __init__(self, pid: str, cond: str, rng: random.Random, start: datetime, profile: dict,
                 quick: bool = False, debug: bool = False, attempt: int = 1):
        self.pid, self.cond, self.rng, self.start, self.p = pid, cond, rng, start, profile
        self.quick, self.debug, self.attempt = quick, debug, attempt
        self.q = 1 if quick else 0
        self.page_load_id = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
        self.t = 0.0
        self.rows = {t: [] for t in TABLES}
        self.steps_run, self.step_t = [], {}
        self.keys = rng.choice([{"match": "left", "mismatch": "right"}, {"match": "right", "mismatch": "left"}])
        self.frame_ms = profile["frame_ms"]
        self.sections: dict = {}
        self.incidents: list = []

    def wall(self, t: float | None = None) -> str:
        return iso(self.start + timedelta(seconds=self.t if t is None else t))

    def base(self, step: str) -> dict:
        return {"participant_id": self.pid, "session": 1, "step": step}

    def ev(self, step, phase, stream, code, label, detail="", t=None):
        t = self.t if t is None else t
        self.rows["events"].append({**self.base(step), "phase": phase, "stream": stream, "code": code, "label": label,
                                    "time": round(t, 4), "wall_time": self.wall(t), "detail": detail})

    def frame(self) -> float:
        late = self.rng.random() < self.p["late_share"]
        return round(self.frame_ms * (2 if late else 1) + self.rng.gauss(0, 0.2), 2)

    # steps
    def run(self) -> "Session":
        for step in FLOW:
            t0, w0 = self.t, self.wall()
            self.ev(step, "", "Session", 0, "step_start", step)
            if step == "intro":
                self.ev(step, "", "Session", 0, "tasks_start")
            kind, _, arg = step.partition(":")
            getattr(self, "step_" + kind)(arg) if arg else getattr(self, "step_" + kind)()
            self.ev(step, "", "Session", 0, "step_end", step)
            self.steps_run.append({"step": step, "start": w0, "end": self.wall(), "duration_s": round(self.t - t0, 3)})
            self.step_t[step] = (t0, self.t)
            self.t += 0.5
        self.add_incidents()
        self.rows["events"].sort(key=lambda e: e["time"])
        return self

    def step_consent(self):
        self.t += 25
        self.sections["consent"] = {"consent_given": 1, "consent_time": self.wall()}

    def step_demographics(self):
        self.t += 70
        p, rng = self.p, self.rng
        self.sections["demographics"] = {
            "age": str(rng.randint(19, 58)), "gender": rng.choice(["woman", "man", "woman", "man", "non_binary"]),
            "gender_self_describe": "", "handedness": rng.choice(["right"] * 8 + ["left", "ambidextrous"]),
            "english_comfort": str(rng.choice([4, 5, 5])), "colour_vision": p["colour_vision"],
            "vision": rng.choice(["normal", "corrected_wearing"]),
            "education": rng.choice(["ug_student", "bachelors", "masters", "phd", "other"]),
            "sleep_hours": str(rng.choice([5, 6, 6.5, 7, 7.5, 8, 9])), "caffeine_2h": rng.choice(["no", "yes"]),
            "psychoactive_drugs": p["psychoactive_drugs"], "psychoactive_drugs_detail": p["psychoactive_drugs_detail"],
            "prior_participation": rng.choice(["no", "no", "not_sure", "yes"]),
            "keyboard": rng.choice(["laptop", "external"]), "submitted": self.wall(),
        }

    def step_setup(self):
        self.t += 30

    def step_intro(self):
        self.t += 45

    def step_stroop(self, phase: str):
        step, rng, p, q = f"stroop:{phase}", self.rng, self.p, self.q
        shift = {"baseline": 0.0, "post_stress": p["stress_rt"], "post_recovery": p["stress_rt"] + p["recovery_rt"]}[phase]
        err = p["err"] + {"baseline": 0.0, "post_stress": 0.03, "post_recovery": 0.03 + p["recovery_err"]}[phase]
        blocks = ([("practice", STROOP_PRACTICE[q] // 2, STROOP_PRACTICE[q] // 2)] if phase == "baseline" else []) \
            + [("test", STROOP_CONGRUENT[q], STROOP_INCONGRUENT[q])]
        for block_type, n_c, n_i in blocks:
            types = ["congruent"] * n_c + ["incongruent"] * n_i
            rng.shuffle(types)
            prac = block_type == "practice"
            self.ev(step, phase, "Stroop_Markers", 14 if prac else 13, "practice_block_start" if prac else "block_start")
            for i, ty in enumerate(types, 1):
                word = rng.choice(COLOURS)
                ink = word if ty == "congruent" else rng.choice([c for c in COLOURS if c != word])
                answer = "match" if ty == "congruent" else "mismatch"
                self.ev(step, phase, "Stroop_Markers", 1, "fixation")
                self.t += 0.5
                onset, frame = self.t, self.frame()
                self.ev(step, phase, "Stroop_Markers", 74 if ty == "congruent" else 75, f"word_{ty}")
                rt = max(0.3, rng.gauss(p["rt"] + shift + (0.07 if ty == "incongruent" else 0.0), 0.14))
                if rng.random() < 0.01:
                    rt = rng.uniform(0.12, 0.19)   # anticipation
                row = {**self.base(step), "phase": phase, "block_type": block_type, "is_practice": int(prac),
                       "trial": i, "word": word.upper(), "word_colour": word, "ink_color": ink, "congruency": ty,
                       "trial_type": ty, "correct_answer": answer, "correct_response": self.keys[answer]}
                if rt > WORD_TIMEOUT:
                    self.t += WORD_TIMEOUT
                    self.ev(step, phase, "Stroop_Markers", 43, "response_timeout")
                    row.update({"participant_response": "", "response_answer": "", "outcome": "missed",
                                "accuracy": "", "rt": "", "timed_out": 1})
                else:
                    wrong = rng.random() < err + (0.03 if ty == "incongruent" else 0.0)
                    given = ({"match": "mismatch", "mismatch": "match"}[answer]) if wrong else answer
                    self.t += rt
                    self.ev(step, phase, "Stroop_Markers", 42 if wrong else 41,
                            "response_incorrect" if wrong else "response_correct")
                    row.update({"participant_response": self.keys[given], "response_answer": given,
                                "outcome": "incorrect" if wrong else "correct", "accuracy": 0 if wrong else 1,
                                "rt": r4(rt), "timed_out": 0})
                row.update({"trial_onset_time": round(onset, 4), "onset_frame_ms": frame, "focus_lost": 0,
                            "fullscreen": 1})
                self.rows["stroop_trials"].append(row)
                self.t += 1.0   # feedback / post-response fixation + ITI
            self.ev(step, phase, "Stroop_Markers", 9, "block_end")

    def step_vas(self, tp: str):
        step, rng, p = f"vas:{tp}", self.rng, self.p
        level = p["vas"][tp]
        clamp = lambda x: int(min(100, max(0, round(x))))
        for m in ["stressed", "tense", "calm"] + (["image_feeling"] if tp == "post_recovery" else []):
            self.ev(step, tp, "VAS_Markers", 60, "vas_onset", m)
            rating = {"stressed": clamp(level + rng.gauss(0, 8)), "tense": clamp(level + rng.gauss(0, 8)),
                      "calm": clamp(100 - level + rng.gauss(0, 8)),
                      "image_feeling": clamp(p["image_feeling"] + rng.gauss(0, 10))}[m]
            rt = rng.uniform(2, 6)
            self.t += rt
            self.ev(step, tp, "VAS_Markers", 61, "vas_response", m)
            self.rows["vas"].append({**self.base(step), "timepoint": tp, "measure": m,
                                     "reverse_scored": "True" if m == "calm" else "False", "rating": rating,
                                     "rt": r4(rt), "timestamp": self.wall()})

    def _problem(self):
        while True:
            a, b, c = self.rng.randint(1, 9), self.rng.randint(1, 9), self.rng.randint(1, 9)
            if 0 <= a + b - c <= 9:
                return f"{a} + {b} - {c}", a + b - c

    def _mist_row(self, step, phase, block, i, problem, answer, given, correct, timed_out, rt, t0, w0, limit, nxt,
                  cap=""):
        # participant_answer is the digit KEY pressed (a string, "" if none), as in js/mist.js
        return {**self.base(step), "phase": phase, "block": block, "trial": i, "level": 4, "problem": problem,
                "correct_answer": answer, "participant_answer": "" if given == "" else str(given),
                "accuracy": int(correct),
                "answered": int(given != ""), "outcome": "missed" if timed_out else "correct" if correct else "incorrect",
                "timed_out": int(timed_out), "rt": r4(rt), "time_limit": limit, "max_time_s": cap,
                "next_time_limit": nxt, "trial_start_time": w0, "trial_end_time": self.wall(),
                "trial_onset_time": round(t0, 4), "onset_frame_ms": self.frame(), "focus_lost": 0, "fullscreen": 1}

    def step_mist_baseline(self):
        step, rng, p = "mist_baseline", self.rng, self.p
        self.ev(step, "mist_baseline", "MIST_Markers", 21, "block_start_baseline")
        n = MIST_BASELINE_TRIALS[self.q]
        for i in range(1, n + 1):
            problem, answer = self._problem()
            w0, t0 = self.wall(), self.t
            self.ev(step, "mist_baseline", "MIST_Markers", 1, "trial_onset")
            rt = min(MIST_SAFETY_CAP, max(1.0, rng.gauss(p["mist_rt"], 0.8)))
            correct = i <= 2 if p["default_cal"] else rng.random() < 0.85
            given = answer if correct else (answer + rng.randint(1, 9)) % 10
            self.t += rt
            self.ev(step, "mist_baseline", "MIST_Markers", 2, "response")
            self.rows["mist_trials"].append(self._mist_row(step, "mist_baseline", "baseline", i, problem, answer, given,
                                                           correct, False, rt, t0, w0, "", "", MIST_SAFETY_CAP))
            self.ev(step, "mist_baseline", "MIST_Markers", 3, "feedback_onset")
            self.t += 2.0
        self.ev(step, "mist_baseline", "MIST_Markers", 9, "block_end")
        rows = [r for r in self.rows["mist_trials"] if r["block"] == "baseline"]
        rts = [r["rt"] for r in rows if r["accuracy"] == 1]
        ok = len(rts) >= CAL_MIN_CORRECT
        raw = r4(statistics.mean(rts) * CAL_FACTOR) if ok else ""
        init = r4(min(MAX_TIME_LIMIT, max(MIN_TIME_LIMIT, raw))) if ok else TIME_LIMIT
        self.sections["mist_calibration"] = {
            "n_trials": len(rows), "n_answered": sum(r["answered"] for r in rows), "n_correct": len(rts),
            "accuracy": r4(len(rts) / len(rows)), "mean_rt_correct": r4(statistics.mean(rts)) if rts else "",
            "median_rt_correct": r4(statistics.median(rts)) if rts else "", "statistic": "mean",
            "factor": CAL_FACTOR, "raw_time_limit": raw, "initial_time_limit": init,
            "source": "baseline" if ok else "default", "min_correct": CAL_MIN_CORRECT}
        self.ev(step, "mist_baseline", "MIST_Markers", 0, "time_limit_set", str(init))

    def step_mist(self):
        step, rng, p = "mist", self.rng, self.p
        limit = self.sections["mist_calibration"]["initial_time_limit"]
        for i in range(1, MIST_PRACTICE[self.q] + 1):
            problem, answer = self._problem()
            w0, t0 = self.wall(), self.t
            rt = min(limit, max(1.0, rng.gauss(p["mist_rt"], 0.8)))
            self.t += rt
            self.rows["mist_trials"].append(self._mist_row(step, "stressor", "practice", i, problem, answer, answer,
                                                           True, False, rt, t0, w0, limit, limit))
            self.t += 2.0
        self.ev(step, "stressor", "MIST_Markers", 0, "white_noise_start")
        self.ev(step, "stressor", "MIST_Markers", 20, "block_start_exp")
        run_c = run_w = 0
        for i in range(1, MIST_EXP_TRIALS[self.q] + 1):
            problem, answer = self._problem()
            w0, t0 = self.wall(), self.t
            self.ev(step, "stressor", "MIST_Markers", 1, "trial_onset")
            need = max(1.0, rng.gauss(p["mist_rt"] * 0.95, 0.9))
            timed_out = need > limit
            correct = (not timed_out) and rng.random() < 0.7
            given = "" if timed_out else answer if correct else (answer + rng.randint(1, 9)) % 10
            rt = limit if timed_out else need
            self.t += rt
            if not timed_out:
                self.ev(step, "stressor", "MIST_Markers", 2, "response")
            # adaptive limit as js/mist.js: 3 alike answers in a row -> -/+ 10 %, clamped
            if correct:
                run_c, run_w = run_c + 1, 0
            else:
                run_w, run_c = run_w + 1, 0
            nxt = limit
            if run_c >= 3:
                run_c, nxt = 0, max(MIN_TIME_LIMIT, limit * 0.9)
            elif run_w >= 3:
                run_w, nxt = 0, min(MAX_TIME_LIMIT, limit * 1.1)
            self.rows["mist_trials"].append(self._mist_row(step, "stressor", "experimental", i, problem, answer, given,
                                                           correct, timed_out, rt, t0, w0, r4(limit), r4(nxt)))
            self.ev(step, "stressor", "MIST_Markers", 3, "feedback_onset")
            self.t += 2.0
            limit = nxt
        self.ev(step, "stressor", "MIST_Markers", 9, "block_end")
        self.ev(step, "stressor", "MIST_Markers", 0, "white_noise_stop")

    def step_images(self):
        step, rng, cond = "images", self.rng, self.cond
        n = N_IMAGES[self.q]
        self.ev(step, "intervention", "Image_Markers", 0, "preload_start", json.dumps({"n": n}))
        self.t += 3.0
        self.ev(step, "intervention", "Image_Markers", 0, "preload_done")
        self.ev(step, "intervention", "Image_Markers", 50, "phase_start_viewing", cond)
        t0 = self.t
        hidden = set()
        if self.p["hidden_s"]:
            h0 = n // 3
            hidden = set(range(h0, h0 + int(self.p["hidden_s"] // 2.5)))
            self.incidents.append(("tab_hidden", step, t0 + h0 * 2.5 - 0.2, self.p["hidden_s"] + 0.4))
        tier = "1920" if cond == "positive_prime" else ""
        rows = []
        for i in range(n):
            fill = "cover" if rng.random() < 0.9 else "contain_blur"
            folder = f"images/{cond}/1920" if tier else f"images/{cond}"
            row = {**self.base(step), "phase": "intervention", "image_set": cond, "image_condition": cond,
                   "trial": i + 1, "image_file": f"{folder}/{cond}_{rng.randint(1, 900):04d}.jpg",
                   "replaced_file": "", "tier": tier, "fill_mode": fill,
                   "image_w": 1920 if fill == "cover" else 1600, "image_h": 1080 if fill == "cover" else 1200,
                   "screen_aspect": 1.778, "planned_onset_s": round(i * 2.5, 3)}
            if i in hidden:
                row.update({"shown": 0, "onset_s": "", "onset_error_ms": "", "trial_onset_time": "",
                            "onset_frame_ms": "", "offset_time": "", "duration_ms": 0, "focus_lost": 1,
                            "fullscreen": 1})   # as js/images.js writes a skipped image
                self.ev(step, "intervention", "Image_Markers", 0, "image_skipped_hidden", row["image_file"],
                        t=t0 + i * 2.5)
            else:
                err = rng.gauss(0, 2.0)
                onset = t0 + i * 2.5 + err / 1000
                row.update({"shown": 1, "onset_s": round(i * 2.5 + err / 1000, 4), "onset_error_ms": round(err, 2),
                            "trial_onset_time": round(onset, 4), "onset_frame_ms": self.frame(), "focus_lost": 0,
                            "fullscreen": 1})
                self.ev(step, "intervention", "Image_Markers", 51, "image_onset", row["image_file"], t=onset)
            rows.append(row)
        for i, row in enumerate(rows):
            if row["shown"] == 1:
                nxt = t0 + (i + 1) * 2.5 + rng.gauss(0, 2.0) / 1000
                row["offset_time"] = round(nxt, 4)
                row["duration_ms"] = round((nxt - row["trial_onset_time"]) * 1000, 2)
                self.ev(step, "intervention", "Image_Markers", 52, "image_offset", row["image_file"], t=nxt)
        if n > 3 and rng.random() < 0.3:   # an image that failed to load and was replaced by a spare
            rows[2]["replaced_file"] = rows[2]["image_file"].replace(".jpg", "_broken.jpg")
        self.rows["image_trials"] += rows
        self.t = t0 + n * 2.5
        self.ev(step, "intervention", "Image_Markers", 99, "task_end")

    def step_blank(self):
        self.ev("blank", "blank", "Rest_Markers", 80, "rest_start")
        self.t += REST_S[self.q]
        self.ev("blank", "blank", "Rest_Markers", 81, "rest_end")

    def step_feedback(self):
        self.t += 120
        p, rng = self.p, self.rng
        good = self.cond != "negative"
        self.sections["feedback"] = {
            "stroop_difficulty": str(rng.choice([2, 3, 3, 4])),
            "performance_change": rng.choice(["worse_after", "no_change", "not_sure"]),
            "performance_change_detail": rng.choice(["", "", "felt slower after the maths"]),
            "performance_change_images": rng.choice(["better_after", "no_change", "not_sure"]),
            "performance_change_images_detail": "", "instructions_clarity": str(rng.choice([4, 5])),
            "images_feeling": rng.choice(["somewhat_positive", "very_positive"] if good else ["somewhat_negative", "neutral"]),
            "images_pleasant": str(rng.choice([4, 5] if good else [1, 2, 3])),
            "images_relaxing": str(rng.choice([3, 4, 5] if good else [1, 2])),
            "images_attention": str(rng.choice([3, 4, 5])),
            "images_mood_change": rng.choice(["a_bit_better", "much_better"] if good else ["a_bit_worse", "same"]),
            "images_feeling_detail": rng.choice(["", "calming", "some were upsetting"]),
            "images_seen_before": rng.choice(["no", "no", "not_sure"]), "effort": p["effort"],
            "arithmetic_stress": str(rng.choice([3, 4, 5])),
            "believed_performance_counts": p["believed_performance_counts"],
            "heard_noise": "yes", "distracted": rng.choice(["no", "no", "briefly"]), "tech_problems": "no",
            "tech_problems_detail": "", "purpose_guess": rng.choice(["", "stress and attention"]), "comments": "",
            "submitted": self.wall()}

    # browser integrity
    def add_incidents(self):
        rng = self.rng
        for _ in range(self.p["fs_exits"]):
            step = rng.choice(["stroop:post_stress", "mist"])
            a, b = self.step_t[step]
            self.incidents.append(("fullscreen_exit", step, rng.uniform(a, b - 10), rng.uniform(2, 6)))
        if rng.random() < 0.4:   # a short blur outside the tasks
            a, b = self.step_t["demographics"]
            self.incidents.append(("window_blur", "demographics", rng.uniform(a, b - 5), rng.uniform(0.5, 3)))
        if self.p["hidden_s"]:
            _, step, s, d = next(x for x in self.incidents if x[0] == "tab_hidden")
            self.incidents.append(("window_blur", step, s, d))
        labels = {"fullscreen_exit": ("fullscreen_exit", "fullscreen_enter"), "tab_hidden": ("tab_hidden", "tab_visible"),
                  "window_blur": ("window_blur", "window_focus")}
        for typ, step, s, d in self.incidents:
            self.ev(step, "", "Browser", 0, labels[typ][0], t=s)
            if typ == "fullscreen_exit":
                self.ev(step, "", "Browser", 0, "fullscreen_prompt", t=s + 0.3)
            self.ev(step, "", "Browser", 0, labels[typ][1], t=s + d)
            if step in TASK_STEPS:   # trials during an incident lose focus (and full screen)
                for name in ("stroop_trials", "mist_trials", "image_trials"):
                    for r in self.rows[name]:
                        on = r.get("trial_onset_time")
                        if isinstance(on, float) and s - 1.5 <= on <= s + d:
                            r["focus_lost"] = 1
                            if typ == "fullscreen_exit" and on >= s:
                                r["fullscreen"] = 0

    def integrity(self, until: float = float("inf")) -> dict:
        inc = [x for x in self.incidents if x[2] <= until]
        out_inc, by_step = [], {}
        field_of = {"fullscreen_exit": ("fullscreen_exit_count", "time_outside_fullscreen_s"),
                    "tab_hidden": ("tab_hidden_count", "time_hidden_s"),
                    "window_blur": ("window_blur_count", "time_blurred_s")}
        tot = {f: 0 for f in STEP_FIELDS}
        for typ, step, s, d in sorted(inc, key=lambda x: x[2]):
            out_inc.append({"type": typ, "step": step, "phase": step.partition(":")[2] or step,
                            "during_task": int(step in TASK_STEPS), "start": self.wall(s), "end": self.wall(s + d),
                            "start_time_s": round(s, 3), "duration_s": round(d, 3)})
            cnt, dur = field_of[typ]
            st = by_step.setdefault(step, {f: 0 for f in STEP_FIELDS})
            for target in (st, tot):
                target[cnt] += 1
                target[dur] = round(target[dur] + d, 3)
        n_fs = tot["fullscreen_exit_count"]
        return {**{k: tot[k] for k in ("fullscreen_exit_count", "tab_hidden_count", "window_blur_count")},
                "fullscreen_return_prompts": n_fs, "fullscreen_declined": 0,
                **{k: tot[k] for k in ("time_outside_fullscreen_s", "time_hidden_s", "time_blurred_s")},
                "by_step": by_step, "incidents": out_inc}


# ── Browser summary (same rules as js/summary.js) ───────────────────────────
def _mean(a):
    return sum(a) / len(a) if a else None


def summary_of(doc: dict) -> dict:
    d, part = doc["data"], doc["participant"]
    frame = doc["session"].get("device", {}).get("frame_ms_median")
    late = 1.5 * frame if frame else None
    out = {"participant_id": part.get("participant_id", ""), "prolific_pid": part.get("prolific_pid", ""),
           "quick_mode": part.get("quick_mode", 0), "debug_mode": part.get("debug_mode", 0)}
    rts = lambda rows: [r["rt"] for r in rows if r["outcome"] == "correct" and r["rt"] != "" and r["rt"] >= 0.2]

    def acc(rows):
        resp = [r for r in rows if r["outcome"] != "missed"]
        return r4(sum(r["outcome"] == "correct" for r in resp) / len(resp)) if resp else ""

    test = [r for r in d.get("stroop_trials", []) if r["is_practice"] == 0]
    by = {}
    for ph in ["baseline", "post_stress", "post_recovery"]:
        rows = [r for r in test if r["phase"] == ph]
        x = rts(rows)
        m = {"n_trials": len(rows), "n_correct": sum(r["outcome"] == "correct" for r in rows),
             "n_incorrect": sum(r["outcome"] == "incorrect" for r in rows),
             "n_missed": sum(r["outcome"] == "missed" for r in rows), "accuracy": acc(rows),
             "accuracy_all": r4(sum(r["outcome"] == "correct" for r in rows) / len(rows)) if rows else "",
             "mean_rt": r4(_mean(x)), "median_rt": r4(statistics.median(x)) if x else "",
             "sd_rt": r4(statistics.stdev(x)) if len(x) > 1 else "",
             "n_focus_lost": sum(r["focus_lost"] == 1 for r in rows),
             "n_late_onset": sum(r["onset_frame_ms"] > late for r in rows) if late else ""}
        for c in ["congruent", "incongruent"]:
            m[f"rt_{c}"] = r4(_mean(rts([r for r in rows if r["congruency"] == c])))
        for c in ["congruent", "incongruent"]:
            m[f"acc_{c}"] = acc([r for r in rows if r["congruency"] == c])
        diff = lambda a, b: "" if a == "" or b == "" else r4(a - b)
        m["stroop_interference_rt"] = diff(m["rt_incongruent"], m["rt_congruent"])
        m["stroop_interference_acc"] = diff(m["acc_congruent"], m["acc_incongruent"])
        by[ph] = m
        out.update({f"{ph}_{k}": v for k, v in m.items()})
    for name, a, b in [("stress", "baseline", "post_stress"), ("recovery", "post_stress", "post_recovery"),
                       ("net", "baseline", "post_recovery")]:
        for k in by[a]:   # as js/summary.js: "" unless both phases have trials and both values are numbers
            x, y = by[a][k], by[b][k]
            both = by[a]["n_trials"] and by[b]["n_trials"]
            out[f"{name}_{k}"] = r4(y - x) if both and isinstance(x, (int, float)) and isinstance(y, (int, float)) else ""

    mist = d.get("mist_trials", [])
    base = [r for r in mist if r["block"] == "baseline"]
    cal = doc.get("mist_calibration") or {}
    out["mist_baseline_n_trials"] = len(base)
    out["mist_baseline_accuracy"] = r4(sum(r["accuracy"] == 1 for r in base) / len(base)) if base else ""
    out["mist_baseline_mean_rt_correct"] = r4(_mean([r["rt"] for r in base if r["accuracy"] == 1]))
    out["mist_initial_time_limit"] = cal.get("initial_time_limit", "")
    out["mist_time_limit_source"] = cal.get("source", "")
    exp = [r for r in mist if r["block"] == "experimental"]
    out["mist_n_trials"] = len(exp)
    out["mist_accuracy"] = r4(sum(r["accuracy"] == 1 for r in exp) / len(exp)) if exp else ""
    out["mist_n_timeouts"] = sum(r["timed_out"] == 1 for r in exp)
    out["mist_mean_rt_correct"] = r4(_mean([r["rt"] for r in exp if r["accuracy"] == 1]))
    out["mist_final_time_limit"] = exp[-1]["next_time_limit"] if exp else ""

    vas = d.get("vas", [])
    comp = {}
    for tp in ["pre_mist", "post_mist", "pre_images", "post_recovery"]:
        get = lambda m: next((r["rating"] for r in vas if r["timepoint"] == tp and r["measure"] == m), "")
        s, t, c = get("stressed"), get("tense"), get("calm")
        comp[tp] = "" if "" in (s, t, c) else r4((s + t + (100 - c)) / 3)
        out.update({f"vas_{tp}_stressed": s, f"vas_{tp}_tense": t, f"vas_{tp}_calm": c, f"vas_{tp}_composite": comp[tp]})
    dif = lambda b, a: "" if comp[a] == "" or comp[b] == "" else r4(comp[b] - comp[a])
    out["vas_stress_change"] = dif("post_mist", "pre_mist")
    out["vas_task_change"] = dif("pre_images", "post_mist")
    out["vas_recovery_change"] = dif("post_recovery", "pre_images")
    out["vas_net_change"] = dif("post_recovery", "pre_mist")
    out["vas_image_feeling"] = next((r["rating"] for r in vas if r["measure"] == "image_feeling"), "")

    allimg = d.get("image_trials", [])
    imgs = [r for r in allimg if r["shown"] != 0]
    out.update({
        "image_condition": part.get("image_condition", ""), "images_n_planned": len(allimg),
        "images_n_shown": len(imgs), "images_n_skipped_hidden": len(allimg) - len(imgs),
        "images_n_replaced": sum(bool(r["replaced_file"]) for r in allimg),
        "images_tier": allimg[0]["tier"] if allimg else "",
        "images_n_cover": sum(r["fill_mode"] == "cover" for r in imgs),
        "images_n_contain_blur": sum(r["fill_mode"] == "contain_blur" for r in imgs),
        "images_mean_duration_ms": r4(_mean([r["duration_ms"] for r in imgs if r["duration_ms"] != ""])),
        "images_max_abs_onset_error_ms": r4(max(abs(r["onset_error_ms"] or 0) for r in imgs)) if imgs else "",
        "images_n_focus_lost": sum(r["focus_lost"] == 1 for r in allimg),
        "images_total_s": r4(imgs[-1]["offset_time"] - imgs[0]["trial_onset_time"]) if imgs else ""})
    integ = doc.get("integrity") or {}
    for k in ("fullscreen_exit_count", "tab_hidden_count", "window_blur_count", "time_outside_fullscreen_s",
              "time_hidden_s"):
        out[k] = integ.get(k, 0)
    return out


# ── Assemble files ──────────────────────────────────────────────────────────
def document(s: Session, n_done: int, status: str, seq: int, folder: str, file_name: str,
             partial: bool = False, drop: tuple = (), no_events: bool = False) -> dict:
    """A file as the browser would send it after the first n_done steps (+ half of the next one if partial)."""
    done = FLOW[:n_done]
    nxt = FLOW[n_done] if partial and n_done < len(FLOW) else None
    data = {}
    for name in TABLES:
        rows = [r for r in s.rows[name] if r["step"] in done]
        if nxt:
            part = [r for r in s.rows[name] if r["step"] == nxt]
            rows += part[: len(part) // 2]
        data[name] = rows
    until = (s.step_t[nxt][0] + (s.step_t[nxt][1] - s.step_t[nxt][0]) / 2) if nxt else s.step_t[done[-1]][1]
    complete = status == "complete"
    device = {"browser": "Chrome", "browser_version": "131.0.0.0", "os": "Windows 10/11", "screen_w": 1536,
              "screen_h": 864, "screen_w_px": 1920, "screen_h_px": 1080, "device_pixel_ratio": 1.25,
              "window_w": 1536, "window_h": 864, "color_depth": 24, "fullscreen_active": 1,
              "refresh_rate_hz": round(1000 / s.frame_ms), "frame_ms_median": s.frame_ms,
              "frame_ms_mean": round(s.frame_ms + 0.05, 2), "frame_ms_sd": 0.4,
              "frames_dropped_pct": round(100 * s.p["late_share"], 2), "timer_resolution_ms": 0.1,
              "audio_sample_rate_hz": 48000, "audio_base_latency_ms": 10, "audio_output_latency_ms": 20,
              "cpu_cores": 8, "device_memory_gb": 8, "max_touch_points": 0,
              "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0", "timezone": "Europe/London",
              "language": "en-GB"}
    end_wall = s.wall(s.step_t[FLOW[-1]][1])
    doc = {
        "schema_version": "2.0", "app_version": "2.0.0", "study": "stress_recovery_prolific",
        "upload": {"folder": folder, "file_name": file_name, "seq": seq},
        "status": status, "last_step": done[-1] if done else "", "saved_at": s.wall(until),
        "participant": {
            "participant_id": s.pid, "attempt": s.attempt, "page_load_id": s.page_load_id,
            "prolific_pid": "" if s.debug or s.quick else re.sub(r"\(\d+\)$", "", s.pid),
            "prolific_study_id": "" if s.debug else "6650aa0b1c2d3e4f5a6b7c8d",
            "prolific_session_id": "" if s.debug else f"sess{s.page_load_id}",
            "image_condition": s.cond, "image_condition_source": "url" if s.debug else "random",
            "stroop_key_mapping": s.keys, "quick_mode": int(s.quick), "debug_mode": int(s.debug)},
        "session": {
            "start_time": iso(s.start), "end_time": end_wall if complete else "",
            "duration_min": round((s.step_t[FLOW[-1]][1]) / 60, 2) if complete else "",
            # location.search, as js/main.js stores it (a string)
            "url_params": f"?PROLIFIC_PID={re.sub(r'[(][0-9]+[)]$', '', s.pid)}&STUDY_ID=6650aa0b1c2d3e4f5a6b7c8d"
                          f"&SESSION_ID=sess{s.page_load_id}" + ("&quick=1" if s.quick else ""),
            "flow": FLOW, "steps_run": [x for x in s.steps_run if x["step"] in done],
            "sound_check_confirmed": 1 if "setup" in done else "", "fullscreen_at_start": 1 if "setup" in done else "",
            "image_tier": "1920" if s.cond == "positive_prime" else "", "device": device if "setup" in done else {},
            "end_frames": ({"refresh_rate_hz": round(1000 / s.frame_ms), "frame_ms_median": s.frame_ms,
                            "frame_ms_mean": s.frame_ms, "frame_ms_sd": 0.5, "frames_dropped_pct": 0.8}
                           if complete else {})},
        "consent": s.sections["consent"] if "consent" in done else {},
        "demographics": s.sections["demographics"] if "demographics" in done else {},
        "mist_calibration": s.sections["mist_calibration"] if "mist_baseline" in done else {},
        "integrity": s.integrity(until),
        "summary": {},
        "feedback": s.sections["feedback"] if "feedback" in done else {},
        "data": data,
    }
    if folder == "quit" and status == "quit":
        doc["session"]["quit_time"] = doc["saved_at"]
    doc["summary"] = summary_of(doc)   # computed before tables are dropped, as in the browser
    for name in drop:   # js/data.js quitFlush drops image_trials, mist_trials, stroop_trials, vas in that order
        data[name] = []
    if drop:
        doc["dropped_tables"] = list(drop)
        doc["integrity"]["incidents"] = doc["integrity"]["incidents"][-50:]
    if no_events:
        data["events"] = []
    return doc


def progress_name(s: "Session", k: int) -> str:
    """progress/ file name as js/data.js builds it: __p<seq, 2 digits>_<step, "_" -> "-">."""
    return f"{safe(s.pid)}__{s.page_load_id}__p{k:02d}_{safe(FLOW[k - 1]).replace('_', '-')}.json"


def write(root: Path, doc: dict) -> Path:
    p = root / doc["upload"]["folder"] / doc["upload"]["file_name"]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return p


def profile(rng: random.Random, cond: str, overrides: dict | None = None) -> dict:
    rec_rt, post_vas, feel = COND_EFFECT.get(cond, (-0.02, 35, 50))
    pre = rng.uniform(15, 35)
    p = {"rt": rng.uniform(0.62, 0.82), "stress_rt": rng.gauss(0.05, 0.03), "recovery_rt": rng.gauss(rec_rt, 0.025),
         "err": rng.uniform(0.02, 0.06), "recovery_err": -0.02 if rec_rt < -0.03 else 0.0,
         "vas": {"pre_mist": pre, "post_mist": pre + rng.uniform(20, 40), "pre_images": pre + rng.uniform(15, 30),
                 "post_recovery": post_vas + rng.gauss(0, 6)},
         "image_feeling": feel, "mist_rt": rng.uniform(3.0, 4.5), "frame_ms": rng.choice([16.67, 16.67, 6.94, 8.33]),
         "late_share": 0.01, "effort": str(rng.choice([4, 4, 5])), "believed_performance_counts": str(rng.choice([3, 4, 5])),
         "psychoactive_drugs": rng.choice(["no"] * 6 + ["prefer_not"]), "psychoactive_drugs_detail": "",
         "colour_vision": "no", "fs_exits": 0, "hidden_s": 0.0, "default_cal": False}
    p.update(overrides or {})
    return p


def prolific_id(rng: random.Random) -> str:
    return "".join(rng.choice("0123456789abcdef") for _ in range(24))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path, help="folder to write complete/, progress/, quit/ into")
    ap.add_argument("--n", type=int, default=16, help="complete participants (default 16)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--conditions", nargs="+", default=CONDITIONS, help="image conditions to spread people over")
    a = ap.parse_args()
    rng = random.Random(a.seed)
    t0 = datetime(2026, 11, 18, 9, 0, tzinfo=timezone.utc)
    n_steps = len(FLOW)
    written = []

    def full(s: Session, seq_complete: int = n_steps + 1, with_progress: bool = False, late_quit: bool = False):
        if with_progress:
            for k in range(1, n_steps + 1):
                written.append(write(a.out, document(s, k, "in_progress", k, "progress", progress_name(s, k))))
        name = f"{safe(s.pid)}__{s.page_load_id}.json"
        written.append(write(a.out, document(s, n_steps, "complete", seq_complete, "complete", name)))
        if late_quit:   # page closed during the final upload: status "complete" file in quit/, seq + 1
            name = f"{safe(s.pid)}__{s.page_load_id}__quit_{seq_complete + 1}.json"
            written.append(write(a.out, document(s, n_steps, "complete", seq_complete + 1, "quit", name,
                                                 drop=("image_trials",), no_events=True)))

    # Complete participants, conditions spread evenly.
    for i in range(a.n):
        cond = a.conditions[i % len(a.conditions)]
        pid = prolific_id(rng)
        start = t0 + timedelta(minutes=37 * i)
        if i == a.n - 1:   # repeat attempt: quit early as <pid>, then finished as <pid>(2)
            first = Session(pid, cond, rng, start, profile(rng, cond)).run()
            k = FLOW.index("stroop:baseline")
            name = f"{safe(pid)}__{first.page_load_id}__quit_{k + 1}.json"
            written.append(write(a.out, document(first, k, "quit", k + 1, "quit", name, partial=True, no_events=True)))
            s = Session(f"{pid}(2)", cond, rng, start + timedelta(minutes=12), profile(rng, cond), attempt=2).run()
        else:
            s = Session(pid, cond, rng, start, profile(rng, cond, PROFILES.get(i))).run()
        full(s, with_progress=i < 2, late_quit=i == 0)

    # Drop-out: progress after stroop:baseline and vas:pre_mist, quit during the MIST baseline.
    cond = a.conditions[a.n % len(a.conditions)]
    s = Session(prolific_id(rng), cond, rng, t0 + timedelta(minutes=5), profile(rng, cond)).run()
    k = FLOW.index("vas:pre_mist") + 1
    for j in (k - 1, k):
        written.append(write(a.out, document(s, j, "in_progress", j, "progress", progress_name(s, j))))
    name = f"{safe(s.pid)}__{s.page_load_id}__quit_{k + 1}.json"
    written.append(write(a.out, document(s, k, "quit", k + 1, "quit", name, partial=True,
                                         drop=("image_trials", "mist_trials", "stroop_trials"), no_events=True)))

    # Quick-mode pilot and debug-mode run (both complete).
    for pid, kw in (("Pquick001", {"quick": True}), ("Pdebug001", {"debug": True})):
        s = Session(pid, a.conditions[0], rng, t0 + timedelta(minutes=2), profile(rng, a.conditions[0]), **kw).run()
        full(s)

    # An old-format download (no schema_version) - must be skipped.
    old = a.out / "stress_recovery_OLDFORMAT.json"
    old.write_text(json.dumps({"participant_id": "OLD1", "exported": iso(t0),
                               "data": {"stroop_trials": [{"participant_id": "OLD1", "phase": "baseline"}]}}),
                   encoding="utf-8")
    written.append(old)
    by = {}
    for p in written:
        by[p.parent.name] = by.get(p.parent.name, 0) + 1
    print(f"Wrote {len(written)} file(s) to {a.out}: " + ", ".join(f"{k}/ {v}" for k, v in sorted(by.items())))


if __name__ == "__main__":
    main()
