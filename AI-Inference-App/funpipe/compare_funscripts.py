#!/usr/bin/env python3
"""
funscript evaluator: compare a pipeline/exported funscript against a human
ground-truth funscript.

Both are {actions:[{at_ms, pos_0_100}, ...]}. Keyframes never line up 1:1, so
the meaningful comparison is DIRECTION-CHANGE matching, not keyframe overlap:
a stroke is an up-then-down, and what matters is whether the pipeline's
direction changes land near the human's direction changes (timing), and
whether both agree on how many strokes happen per unit time (tempo).

Metrics (the ones CLAUDE.md already cites, now computed instead of asserted):
  - precision/recall of direction changes within +/-tol ms (default 150)
  - mean signed timing offset (median of pipe - human, matched pairs)
  - per-bucket tempo correlation (Pearson of strokes/sec across N-second bins)
  - counts and span for sanity

Usage (CLI):
    python compare_funscripts.py pipe.funscript human.funscript
    python compare_funscripts.py pipe.funscript human.funscript --tol 150 --bin 30 --plot out.png

Library:
    from compare_funscripts import compare, load_funscript
    m = compare(pipe_actions, human_actions, fps=30)
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np


# --------------------------------------------------------------- parsing

def load_funscript(path):
    """Read a .funscript file -> sorted ndarray of (at_ms, pos)."""
    d = json.loads(Path(path).read_text())
    acts = d.get("actions") or []
    if not acts:
        return np.empty((0, 2))
    arr = np.array([(a["at"], a["pos"]) for a in acts], dtype=float)
    order = np.argsort(arr[:, 0])          # ensure time-sorted
    return arr[order]


def direction_changes(actions, min_step_ms=40):
    """Timestamps where position direction flips (stroke reversals).

    Drops plateaus and tiny jitter (<min_step_ms apart or zero delta) so a
    noisy flat segment doesn't manufacture spurious reversals. Returns an
    ndarray of at_ms where a genuine up<->down reversal occurs.
    """
    if len(actions) < 3:
        return np.empty(0)
    at, pos = actions[:, 0], actions[:, 1]
    keep = np.concatenate(([True], np.diff(at) >= min_step_ms))
    at, pos = at[keep], pos[keep]
    d = np.diff(pos)
    sign = np.sign(d)
    # ignore zero deltas (plateaus) by carrying the last real sign forward
    nz = sign != 0
    real = np.where(nz, sign, np.nan)
    real = pd_pad(real) if nz.any() else real
    flips = np.where(np.diff(real) != 0)[0] + 1   # index into pos/at
    return at[flips]


def pd_pad(arr):
    """Forward-fill NaNs (carry last real value) so plateaus don't read as flips."""
    out = arr.copy()
    last = 0.0
    for i, v in enumerate(out):
        if np.isnan(v):
            out[i] = last
        else:
            last = v
    return out


# --------------------------------------------------------------- matching

def match_changes(t_human, t_pipe, tol_ms):
    """For each human change, nearest pipe change within tol.

    Returns (matched_pipe_times, offsets_ms, n_unmatched_human, n_pipe_unused).
    A pipe change can match at most one human change (greedy nearest-first).
    """
    used = np.zeros(len(t_pipe), dtype=bool)
    matched_t, offsets = [], []
    # walk human changes in time order, snap to nearest unused pipe change
    for th in t_human:
        if len(t_pipe) == 0:
            break
        d = np.abs(t_pipe - th)
        j = int(np.argmin(d))
        if d[j] <= tol_ms and not used[j]:
            used[j] = True
            matched_t.append(t_pipe[j])
            offsets.append(t_pipe[j] - th)
    n_recall_hits = len(matched_t)
    n_prec_hits = n_recall_hits           # matched set is symmetric
    return (np.array(matched_t), np.array(offsets),
            len(t_human) - n_recall_hits, int((~used).sum()))


# --------------------------------------------------------------- the eval

def compare(pipe_actions, human_actions, fps=None, tol_ms=150, bin_s=30):
    """Compute all metrics. actions = ndarray (n,2) [at_ms, pos].

    Returns a dict; safe to json.dumps.
    """
    t_h = direction_changes(human_actions)
    t_p = direction_changes(pipe_actions)

    matched, offsets, miss_h, extra_p = match_changes(t_h, t_p, tol_ms)
    n_h, n_p = len(t_h), len(t_p)
    # recall: of human changes, how many did pipe match? (timing accuracy)
    recall = (len(matched) / n_h) if n_h else 0.0
    # precision: of pipe changes, how many matched a human change?
    # (over-generation: pipe firing reversals the human didn't)
    precision = (len(matched) / n_p) if n_p else 0.0

    # tempo correlation: strokes/sec per bin
    span = max(human_actions[-1, 0] if len(human_actions) else 0,
               pipe_actions[-1, 0] if len(pipe_actions) else 0, 1) / 1000.0
    bins = np.arange(0, span + bin_s, bin_s)
    h_counts = np.histogram(t_h / 1000.0, bins=bins)[0]
    p_counts = np.histogram(t_p / 1000.0, bins=bins)[0]
    if len(bins) > 2 and h_counts.std() > 0 and p_counts.std() > 0:
        corr = float(np.corrcoef(h_counts, p_counts)[0, 1])
    else:
        corr = 0.0

    mean_off = float(np.median(offsets)) if len(offsets) else 0.0
    # signed offset stats for diagnosis (positive = pipe lags human)
    abs_off = float(np.mean(np.abs(offsets))) if len(offsets) else 0.0

    return {
        "tol_ms": tol_ms,
        "direction_changes": {"human": n_h, "pipe": n_p},
        "matched": len(matched),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "timing_offset_ms": {         # signed: + = pipe lags (fires later)
            "median": round(mean_off, 1),
            "mean_abs": round(abs_off, 1),
        },
        "tempo": {
            "bin_s": bin_s,
            "correlation": round(corr, 3),
            "human_strokes_per_bin": [int(x) for x in h_counts],
            "pipe_strokes_per_bin": [int(x) for x in p_counts],
        },
        "span_s": round(span, 1),
    }


def shift_actions(actions, ms):
    """Return a copy of actions with every timestamp moved by `ms`.

    Timestamps are clamped at 0 so a negative shift can't produce actions
    before the start of the video.
    """
    if not len(actions) or not ms:
        return actions
    out = actions.copy()
    out[:, 0] = np.maximum(out[:, 0] + ms, 0)
    return out


def best_shift(pipe_actions, human_actions, tol_ms=150,
               lo=-100, hi=250, step=5):
    """Sweep a global timing shift and return the one that matches best.

    The pipeline can carry a systematic lead/lag against a human script
    (savgol smoothing is zero-phase, so this is mostly scripter convention:
    where a human places the point relative to the visual extreme). That is
    one constant per video, not a per-window error, so it is worth measuring
    separately from precision/recall rather than folding it in.

    Returns {shift_ms, precision, recall, base_precision, base_recall} where
    the base_* values are the unshifted scores, so the caller can show the
    gain.

    The sweep is SCORED AT A TIGHT TOLERANCE (tol_ms/3, floor 50ms), not at
    the reporting tolerance. Matched-count at +/-150ms has a wide flat top: a
    large shift can keep winning by dragging loosely-related reversals inside
    the window while genuine alignment gets worse (on pinkloving, +105ms wins
    at tol=150 but halves the tol=50 score vs +50ms). Scoring tight finds the
    shift that actually aligns the two scripts. Ties break toward the smaller
    |shift| so a flat optimum doesn't wander.
    """
    tight = max(50, tol_ms // 3)
    base = compare(pipe_actions, human_actions, tol_ms=tol_ms)
    base_tight = compare(pipe_actions, human_actions, tol_ms=tight)
    best_n, best_s = base_tight["matched"], 0
    for s in range(int(lo), int(hi) + 1, int(step)):
        if s == 0:
            continue
        n = compare(shift_actions(pipe_actions, s), human_actions,
                    tol_ms=tight)["matched"]
        if n > best_n or (n == best_n and abs(s) < abs(best_s)):
            best_n, best_s = n, s
    scored = compare(shift_actions(pipe_actions, best_s), human_actions,
                     tol_ms=tol_ms)
    return {
        "shift_ms": best_s,
        "scored_at_tol_ms": tight,
        "matched": scored["matched"],
        "precision": scored["precision"],
        "recall": scored["recall"],
        "base_precision": base["precision"],
        "base_recall": base["recall"],
    }


def format_report(m, pipe_name, human_name):
    """Human-readable single-screen summary."""
    to = m["timing_offset_ms"]
    lag = ""
    if to["median"] != 0:
        lag = f"  (pipe {'lags' if to['median'] > 0 else 'leads'} by {abs(to['median']):.0f}ms)"
    lines = [
        f"{'='*52}",
        f"  pipe : {pipe_name}",
        f"  human: {human_name}",
        f"{'-'*52}",
        f"  direction changes   human={m['direction_changes']['human']:4d}   "
        f"pipe={m['direction_changes']['pipe']:4d}",
        f"  matched within {m['tol_ms']}ms : {m['matched']:4d}",
        f"  precision {m['precision']*100:5.1f}%   recall {m['recall']*100:5.1f}%",
        f"  timing offset  median={to['median']:+.0f}ms  mean|.|={to['mean_abs']:.0f}ms{lag}",
        f"  tempo corr (per {m['tempo']['bin_s']}s) : {m['tempo']['correlation']:+.3f}",
        f"  span {m['span_s']:.0f}s",
    ]
    if m.get("applied_shift_ms"):
        lines.append(f"  applied shift  {m['applied_shift_ms']:+d}ms")
    bs = m.get("best_shift")
    if bs:
        lines += [
            f"{'-'*52}",
            f"  best global shift {bs['shift_ms']:+4d}ms  ->  "
            f"prec {bs['precision']*100:5.1f}%  rec {bs['recall']*100:5.1f}%",
            f"    (from {bs['base_precision']*100:5.1f}% / "
            f"{bs['base_recall']*100:5.1f}%  =  "
            f"{(bs['precision']-bs['base_precision'])*100:+.1f} / "
            f"{(bs['recall']-bs['base_recall'])*100:+.1f} pts)",
        ]
    lines.append(f"{'='*52}")
    return "\n".join(lines)


# --------------------------------------------------------------- optional plot

def plot_overlay(pipe_actions, human_actions, out_path, fps=None):
    """Save a position-over-time overlay + direction-change markers."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 5), sharex=True,
                                   gridspec_kw={"height_ratios": [3, 1]})
    if len(human_actions):
        ax1.plot(human_actions[:, 0] / 1000, human_actions[:, 1],
                 color="#59d18c", lw=1, label="human")
    if len(pipe_actions):
        ax1.plot(pipe_actions[:, 0] / 1000, pipe_actions[:, 1],
                 color="#4da3ff", lw=1, alpha=0.85, label="pipe")
    ax1.set_ylabel("position (0-100)")
    ax1.legend(loc="upper right", fontsize=9)
    ax1.grid(alpha=0.2)
    th = direction_changes(human_actions) / 1000
    tp = direction_changes(pipe_actions) / 1000
    ax2.eventplot([th, tp], colors=["#59d18c", "#4da3ff"],
                  lineoffsets=[0.5, 1.5], linelengths=0.8)
    ax2.set_yticks([0.5, 1.5])
    ax2.set_yticklabels(["human", "pipe"])
    ax2.set_xlabel("time (s)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=110)
    plt.close(fig)
    return True


# --------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser(description="compare two funscripts")
    ap.add_argument("pipe", help="pipeline/exported .funscript")
    ap.add_argument("human", help="ground-truth/human .funscript")
    ap.add_argument("--tol", type=int, default=150,
                    help="direction-change match tolerance ms (default 150)")
    ap.add_argument("--bin", type=int, default=30,
                    help="tempo bin size seconds (default 30)")
    ap.add_argument("--plot", type=Path, default=None,
                    help="optional overlay plot output path")
    ap.add_argument("--json", action="store_true",
                    help="also dump metrics json next to the pipe file")
    ap.add_argument("--shift", default=None,
                    help="global ms to shift the pipe side before scoring; "
                         "'auto' picks the best (default: report it only)")
    ap.add_argument("--no-best-shift", action="store_true",
                    help="skip the global-shift sweep")
    args = ap.parse_args()

    pipe = load_funscript(args.pipe)
    human = load_funscript(args.human)
    if len(pipe) == 0:
        sys.exit(f"no actions in {args.pipe}")
    if len(human) == 0:
        sys.exit(f"no actions in {args.human}")

    bs = None
    if not args.no_best_shift or args.shift == "auto":
        bs = best_shift(pipe, human, tol_ms=args.tol)

    applied = 0
    if args.shift == "auto":
        applied = bs["shift_ms"]
    elif args.shift is not None:
        applied = int(args.shift)
    if applied:
        pipe = shift_actions(pipe, applied)

    m = compare(pipe, human, tol_ms=args.tol, bin_s=args.bin)
    m["applied_shift_ms"] = applied
    if bs and not applied:
        m["best_shift"] = bs
    print(format_report(m, Path(args.pipe).name, Path(args.human).name))

    if args.json:
        out = Path(args.pipe).with_suffix(".compare.json")
        out.write_text(json.dumps(m, indent=2))
        print(f"metrics -> {out.name}")

    if args.plot:
        ok = plot_overlay(pipe, human, args.plot)
        if ok:
            print(f"plot -> {args.plot}")
        else:
            print("plot skipped (matplotlib missing)")


if __name__ == "__main__":
    main()
