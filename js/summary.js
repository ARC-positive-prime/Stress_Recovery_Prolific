/*
 * Per-participant summary (the "summary" section of the data file), so
 * results can be eyeballed without analysis code. analysis/analyze.py
 * recomputes everything from the trial tables with the same rules: the trial
 * tables are the source of truth.
 *
 * Stroop phases: baseline, post_stress, post_recovery (columns prefixed with
 * the phase). Changes:
 *   stress_*    = post_stress   − baseline       (effect of the stressor)
 *   recovery_*  = post_recovery − post_stress    (change after the images)
 *   net_*       = post_recovery − baseline       (back to baseline?)
 * Rules: test (non-practice) trials only. RT measures use correct trials with
 * rt ≥ 0.2 s. accuracy = correct / responded; accuracy_all = correct / all.
 *
 * VAS timepoints: pre_mist, post_mist, pre_images, post_recovery.
 *   vas_stress_change   = post_mist     − pre_mist     (stressor)
 *   vas_task_change     = pre_images    − post_mist    (second Stroop run)
 *   vas_recovery_change = post_recovery − pre_images   (images + rest)
 *   vas_net_change      = post_recovery − pre_mist
 */
(function () {
  "use strict";
  const MIN_RT = 0.2;
  const PHASES = ["baseline", "post_stress", "post_recovery"];
  const CHANGES = [["stress", "post_stress", "baseline"], ["recovery", "post_recovery", "post_stress"], ["net", "post_recovery", "baseline"]];
  const VAS_TIMEPOINTS = ["pre_mist", "post_mist", "pre_images", "post_recovery"];
  const VAS_CHANGES = [
    ["vas_stress_change", "post_mist", "pre_mist"],
    ["vas_task_change", "pre_images", "post_mist"],
    ["vas_recovery_change", "post_recovery", "pre_images"],
    ["vas_net_change", "post_recovery", "pre_mist"],
  ];
  const TYPES = ["congruent", "incongruent"];

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const sd = (a) => {
    if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  };
  const r4 = (x) => (x == null || Number.isNaN(x) ? "" : Math.round(x * 10000) / 10000);
  const diff = (a, b) => (a === "" || b === "" || a == null || b == null ? "" : r4(a - b));

  const rtsOf = (rows) => rows.filter((r) => r.outcome === "correct" && r.rt !== "" && r.rt >= MIN_RT).map((r) => r.rt);
  const meanRt = (rows) => r4(mean(rtsOf(rows)));
  const acc = (rows) => {
    const responded = rows.filter((r) => r.outcome !== "missed");
    return responded.length ? r4(responded.filter((r) => r.outcome === "correct").length / responded.length) : "";
  };

  function basic(rows, lateLimit) {
    const rts = rtsOf(rows);
    return {
      n_trials: rows.length,
      n_correct: rows.filter((r) => r.outcome === "correct").length,
      n_incorrect: rows.filter((r) => r.outcome === "incorrect").length,
      n_missed: rows.filter((r) => r.outcome === "missed").length,
      accuracy: acc(rows),
      accuracy_all: rows.length ? r4(rows.filter((r) => r.outcome === "correct").length / rows.length) : "",
      mean_rt: r4(mean(rts)),
      median_rt: r4(median(rts)),
      sd_rt: r4(sd(rts)),
      n_focus_lost: rows.filter((r) => r.focus_lost === 1).length,
      n_late_onset: lateLimit ? rows.filter((r) => r.onset_frame_ms > lateLimit).length : "",
    };
  }

  function stroopMeasures(rows, lateLimit) {
    const by = (t) => rows.filter((r) => r.congruency === t);
    const rt = {}, ac = {};
    for (const t of TYPES) { rt[t] = meanRt(by(t)); ac[t] = acc(by(t)); }
    const out = { ...basic(rows, lateLimit) };
    for (const t of TYPES) out["rt_" + t] = rt[t];
    for (const t of TYPES) out["acc_" + t] = ac[t];
    out.stroop_interference_rt = diff(rt.incongruent, rt.congruent);
    out.stroop_interference_acc = diff(ac.congruent, ac.incongruent);
    return out;
  }

  function vasMeasures(rows, timepoint) {
    const get = (m) => { const r = rows.find((x) => x.timepoint === timepoint && x.measure === m); return r ? r.rating : ""; };
    const s = get("stressed"), t = get("tense"), c = get("calm");
    return { stressed: s, tense: t, calm: c, composite: s === "" || t === "" || c === "" ? "" : r4((s + t + (100 - c)) / 3) };
  }

  function build({ tables, sections, frameMs }) {
    const T = tables || {};
    const S = sections || {};
    const P = S.participant || {};
    const out = {
      participant_id: Core.Data.pid,
      prolific_pid: P.prolific_pid || "",
      image_condition: P.image_condition || "",
      quick_mode: P.quick_mode || 0,
      debug_mode: P.debug_mode || 0,
    };
    // Trials whose stimulus frame took > 1.5× the normal frame (onset delayed by a dropped frame).
    const lateLimit = frameMs ? 1.5 * frameMs : null;

    // Stroop, per phase + changes
    const measured = (T.stroop_trials || []).filter((r) => r.is_practice === 0);
    const byPhase = {};
    for (const p of PHASES) byPhase[p] = stroopMeasures(measured.filter((r) => r.phase === p), lateLimit);
    for (const p of PHASES) for (const [k, v] of Object.entries(byPhase[p])) out[`${p}_${k}`] = v;
    for (const [name, a, b] of CHANGES) {
      for (const k of Object.keys(byPhase[a])) {
        const x = byPhase[a][k], y = byPhase[b][k];
        if (typeof x === "number" && typeof y === "number" && byPhase[a].n_trials && byPhase[b].n_trials) out[`${name}_${k}`] = r4(x - y);
        else out[`${name}_${k}`] = "";
      }
    }

    // MIST baseline (calibration) and stressor
    const mist = T.mist_trials || [];
    const base = mist.filter((r) => r.block === "baseline");
    const cal = S.mist_calibration || {};
    out.mist_baseline_n_trials = base.length;
    out.mist_baseline_accuracy = base.length ? r4(base.filter((r) => r.accuracy === 1).length / base.length) : "";
    out.mist_baseline_mean_rt_correct = r4(mean(base.filter((r) => r.accuracy === 1).map((r) => r.rt)));
    out.mist_initial_time_limit = cal.initial_time_limit != null ? cal.initial_time_limit : "";
    out.mist_time_limit_source = cal.source || "";
    const exp = mist.filter((r) => r.block === "experimental");
    out.mist_n_trials = exp.length;
    out.mist_accuracy = exp.length ? r4(exp.filter((r) => r.accuracy === 1).length / exp.length) : "";
    out.mist_n_timeouts = exp.filter((r) => r.timed_out === 1).length;
    out.mist_mean_rt_correct = r4(mean(exp.filter((r) => r.accuracy === 1).map((r) => r.rt)));
    out.mist_final_time_limit = exp.length ? exp[exp.length - 1].next_time_limit : "";

    // VAS
    const vas = T.vas || [];
    for (const tp of VAS_TIMEPOINTS) {
      const v = vasMeasures(vas, tp);
      for (const k of Object.keys(v)) out[`vas_${tp}_${k}`] = v[k];
    }
    for (const [name, a, b] of VAS_CHANGES) out[name] = diff(out[`vas_${a}_composite`], out[`vas_${b}_composite`]);
    const imgQ = vas.find((r) => r.measure === "image_feeling");
    out.vas_image_feeling = imgQ ? imgQ.rating : "";   // 0 = positive, 50 = neutral, 100 = negative

    // Images (rows with shown = 0 were skipped because the page was hidden)
    const all = T.image_trials || [];
    const imgs = all.filter((r) => r.shown !== 0);
    const durs = imgs.map((r) => r.duration_ms).filter((x) => typeof x === "number");
    out.images_n_planned = all.length;
    out.images_n_shown = imgs.length;
    out.images_n_skipped_hidden = all.length - imgs.length;
    out.images_n_replaced = all.filter((r) => r.replaced_file).length;
    out.images_tier = all.length ? all[0].tier : "";
    out.images_n_cover = imgs.filter((r) => r.fill_mode === "cover").length;
    out.images_n_contain_blur = imgs.filter((r) => r.fill_mode === "contain_blur").length;
    out.images_mean_duration_ms = r4(mean(durs));
    out.images_max_abs_onset_error_ms = imgs.length ? r4(Math.max(...imgs.map((r) => Math.abs(Number(r.onset_error_ms) || 0)))) : "";
    out.images_n_focus_lost = all.filter((r) => r.focus_lost === 1).length;
    const lastShown = imgs.filter((r) => typeof r.offset_time === "number").pop();
    out.images_total_s = imgs.length && lastShown ? r4(lastShown.offset_time - imgs[0].trial_onset_time) : "";

    // Browser integrity (whole session)
    const I = Core.Integrity.report();
    out.fullscreen_exit_count = I.fullscreen_exit_count;
    out.tab_hidden_count = I.tab_hidden_count;
    out.window_blur_count = I.window_blur_count;
    out.time_outside_fullscreen_s = I.time_outside_fullscreen_s;
    out.time_hidden_s = I.time_hidden_s;
    return out;
  }

  window.Summary = { build, stroopMeasures, MIN_RT, PHASES, VAS_TIMEPOINTS };
})();
