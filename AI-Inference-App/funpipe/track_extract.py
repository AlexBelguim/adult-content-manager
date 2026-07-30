#!/usr/bin/env python3
"""
Stage 2 of the funscript pipeline: seeding, tracking, signal extraction.

Consumes the <video>.scenes.json produced by detect_scenes.py (stage 1).
Produces, next to the video:
    <video>.seeds.json    - clicked seed point per scene        (seed)
    <video>.tracks.npz    - raw CoTracker3 trajectories         (track)
    <video>.signal.json   - continuous 0-100 motion signal      (extract)
    <video>.funscript     - final keyframed funscript           (extract)

All intermediates are cached: tracking (the expensive step) runs once,
extraction re-runs in milliseconds when you tweak parameters.

Usage:
    python track_extract.py seed    video.mp4
    python track_extract.py track   video.mp4 [--max-side 768]
    python track_extract.py extract video.mp4 [--invert]
    python track_extract.py all     video.mp4
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------- paths

def sidecar(video: Path, ext: str) -> Path:
    return video.with_suffix(video.suffix + ext)


def load_scenes(video: Path) -> dict:
    p = sidecar(video, ".scenes.json")
    if not p.exists():
        sys.exit(f"missing {p.name} - run detect_scenes.py first")
    return json.loads(p.read_text())


# ---------------------------------------------------------------- seed

GROUP_COLORS = [  # BGR
    (0, 0, 255), (0, 255, 0), (255, 128, 0), (0, 255, 255),
    (255, 0, 255), (255, 255, 0), (128, 0, 255), (0, 128, 255), (255, 255, 255),
]


def cmd_seed(video: Path, args):
    """Show the first usable frame of each scene; click 1+ points to track.

    Points belong to the active GROUP (keys 1-9, default 1). Each group is
    tracked separately and produces its own signal - e.g. group 1 = hand,
    group 2 = mouth - so you can pick per segment afterwards which group
    drives the funscript.

    Keys:  1-9 = select active group      click = add point to active group
           d / f = scrub +1s / +10s       a = scrub -1s
           n / SPACE = next scene         u = undo last click
           s = skip scene                 q = abort
    """
    import cv2

    scenes = load_scenes(video)["scenes"]
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        sys.exit(f"cannot open {video}")

    seeds = {}
    clicks = []          # list of (x, y, group)
    active_group = [1]

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            clicks.append((x, y, active_group[0]))

    win = "seed | 1-9=group  click=mark  d/f/a=scrub  n=next  u=undo  s=skip  q=quit"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)

    for s in scenes:
        # a few frames past the cut, in case of transition blur
        frame_idx = min(s["start_frame"] + 5, s["end_frame"] - 1)

        def grab(i):
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, f = cap.read()
            return f if ok else None

        frame = grab(frame_idx)
        if frame is None:
            print(f"scene {s['index']}: cannot read frame, skipping")
            continue

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        clicks.clear()
        skip = False
        while True:
            disp = frame.copy()
            for (x, y, g) in clicks:
                cv2.drawMarker(disp, (x, y), GROUP_COLORS[(g - 1) % 9],
                               cv2.MARKER_CROSS, 24, 3)
                cv2.putText(disp, str(g), (x + 10, y - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                            GROUP_COLORS[(g - 1) % 9], 2)
            tsec = frame_idx / fps
            cv2.putText(disp,
                        f"scene {s['index']}  @{tsec:.1f}s "
                        f"({s['start_time']:.0f}s-{s['end_time']:.0f}s)"
                        f"  pts:{len(clicks)}  GROUP:{active_group[0]}",
                        (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                        GROUP_COLORS[(active_group[0] - 1) % 9], 2)
            cv2.putText(disp,
                        "1-9=group  click=mark  d/f=+1s/+10s  a=-1s  "
                        "n=next  u=undo  s=skip  q=quit",
                        (12, 64), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                        (0, 255, 255), 1)
            cv2.imshow(win, disp)
            k = cv2.waitKey(30) & 0xFF
            if ord("1") <= k <= ord("9"):
                active_group[0] = k - ord("0")
            if k in (ord("n"), ord(" ")) and clicks:
                break
            if k == ord("u") and clicks:
                clicks.pop()
            if k == ord("s"):
                skip = True
                break
            if k in (ord("d"), ord("f"), ord("a")):
                delta = {"d": 1, "f": 10, "a": -1}[chr(k)]
                new_idx = int(np.clip(frame_idx + delta * fps,
                                      s["start_frame"],
                                      s["end_frame"] - 1))
                nf = grab(new_idx)
                if nf is not None:
                    frame_idx, frame = new_idx, nf
                    clicks.clear()  # clicks belong to a specific frame
            if k == ord("q"):
                cap.release()
                cv2.destroyAllWindows()
                sys.exit("aborted")

        if not skip:
            groups = {}
            for (x, y, g) in clicks:
                groups.setdefault(str(g), []).append([x, y])
            seeds[str(s["index"])] = {
                "frame": frame_idx,
                "groups": groups,
            }

    cap.release()
    cv2.destroyAllWindows()

    out = sidecar(video, ".seeds.json")
    out.write_text(json.dumps({"seeds": seeds}, indent=2))
    print(f"seeded {len(seeds)}/{len(scenes)} scene(s) -> {out.name}")


# ---------------------------------------------------------------- track

def make_support_grid(cx, cy, w, h, radius_frac=0.08, n=5):
    """A small n x n grid of points around the clicked point. Tracking a
    patch instead of one pixel is far more robust to occlusion/drift."""
    r = radius_frac * min(w, h)
    xs = np.linspace(cx - r, cx + r, n)
    ys = np.linspace(cy - r, cy + r, n)
    pts = [(x, y) for y in ys for x in xs
           if 0 <= x < w and 0 <= y < h]
    return pts


def make_dense_grid(w, h, nx=20, ny=12, margin=0.05):
    xs = np.linspace(w * margin, w * (1 - margin), nx)
    ys = np.linspace(h * margin, h * (1 - margin), ny)
    return [(x, y) for y in ys for x in xs]


def cmd_track(video: Path, args):
    import cv2
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("WARNING: no CUDA - this will be very slow", file=sys.stderr)

    scenes = load_scenes(video)["scenes"]
    auto = getattr(args, "auto", False)
    seeds = None
    if not auto:
        seeds_p = sidecar(video, ".seeds.json")
        if not seeds_p.exists():
            sys.exit(f"missing {seeds_p.name} - run 'seed' first, "
                     f"or use --auto for seedless dense tracking")
        seeds = json.loads(seeds_p.read_text())["seeds"]

    print("loading CoTracker3 (weights auto-download on first run)...")
    model = torch.hub.load("facebookresearch/co-tracker",
                           "cotracker3_online").to(device).eval()

    cap = cv2.VideoCapture(str(video))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    scale = min(1.0, args.max_side / max(W, H))
    w, h = int(W * scale), int(H * scale)
    mode = "AUTO dense-grid" if auto else "seeded"
    print(f"{W}x{H} @ {fps:.2f}fps  ->  {mode} tracking at {w}x{h} on {device}")

    arrays = {}
    scene_keys = []

    if auto:
        win_frames = max(int(args.window * fps), 50)
        try:
            nx, ny = (int(v) for v in args.grid.lower().split("x"))
        except Exception:
            sys.exit(f"bad --grid value '{args.grid}', expected e.g. 20x12")
        grid = make_dense_grid(w, h, nx=nx, ny=ny)
        for s in scenes:
            key = str(s["index"])
            start, end = s["start_frame"], s["end_frame"]
            if end - start < 25:
                continue
            windows = []
            ws = start
            wi = 0
            while ws < end:
                we = min(ws + win_frames, end)
                if we - ws < 25:
                    break
                queries = torch.tensor(
                    [[0.0, x, y] for (x, y) in grid],
                    dtype=torch.float32, device=device)[None]
                print(f"scene {key:>02s} window {wi:04d}: frames {ws:07d}-{we:07d} "
                      f"({len(grid)} grid pts)...")
                tracks, vis = _track_scene_chunked(
                    model, cap, ws, we, w, h, queries, device, model.step)
                arrays[f"tracks_{key}_w{wi}"] = tracks
                arrays[f"vis_{key}_w{wi}"] = vis
                windows.append({"i": wi, "start": ws, "end": we})
                ws = we
                wi += 1
            if windows:
                scene_keys.append({"scene": key, "windows": windows})
    else:
        for s in scenes:
            key = str(s["index"])
            if key not in seeds:
                print(f"scene {s['index']}: no seed, skipping")
                continue
            seed = seeds[key]
            pts, gids = [], []
            for g, gpts in sorted(seed["groups"].items(),
                                  key=lambda kv: int(kv[0])):
                for (cx, cy) in gpts:
                    grid = make_support_grid(cx * scale, cy * scale, w, h)
                    pts += grid
                    gids += [int(g)] * len(grid)
            if not pts:
                print(f"scene {s['index']}: seed has no points, skipping")
                continue
            queries = torch.tensor(
                [[0.0, x, y] for (x, y) in pts],
                dtype=torch.float32, device=device
            )[None]  # (1, N, 3): frame 0 of the chunk, x, y

            start, end = seed["frame"], s["end_frame"]
            n_frames = end - start
            print(f"scene {s['index']}: tracking {len(pts)} pts "
                  f"({len(seed['groups'])} group(s)) over {n_frames} frames...")

            tracks, vis = _track_scene_chunked(
                model, cap, start, end, w, h, queries, device, model.step)

            arrays[f"tracks_{key}"] = tracks
            arrays[f"vis_{key}"] = vis
            arrays[f"groups_{key}"] = np.array(gids, dtype=np.int16)
            arrays[f"start_{key}"] = np.array(start)
            scene_keys.append({"scene": key})

    cap.release()

    out = sidecar(video, ".tracks.npz")
    np.savez_compressed(
        out,
        meta=json.dumps({
            "fps": fps, "scale": scale, "w": w, "h": h,
            "mode": "auto" if auto else "seeded",
            "scenes": scene_keys,
        }),
        **arrays,
    )
    print(f"tracks -> {out.name}")


def _track_scene_chunked(model, cap, start, end, w, h, queries, device, step):
    """Stream the scene through CoTracker3's online API in step-sized chunks."""
    import cv2
    import torch

    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    n_frames = end - start
    window = step * 2

    buf = []
    is_first = True
    pred_tracks = pred_vis = None
    processed = 0

    def run(buffer, first):
        nonlocal pred_tracks, pred_vis
        chunk = (torch.from_numpy(np.stack(buffer))
                 .permute(0, 3, 1, 2)[None].float().to(device))
        with torch.no_grad():
            pred_tracks, pred_vis = model(
                video_chunk=chunk, is_first_step=first, queries=queries)

    while processed < n_frames:
        ok, frame = cap.read()
        if not ok:
            break
        buf.append(cv2.cvtColor(cv2.resize(frame, (w, h)), cv2.COLOR_BGR2RGB))
        processed += 1
        if is_first and len(buf) == window:
            run(buf, True)
            is_first = False
            run(buf, False)
            buf = buf[step:]
        elif not is_first and len(buf) == window:
            run(buf, False)
            buf = buf[step:]
        if processed % 500 == 0:
            print(f"  {processed:07d}/{n_frames:07d} frames", flush=True)

    if buf and not is_first:
        run(buf, False)
    elif buf and is_first:
        # scene shorter than one window: pad by repeating last frame
        while len(buf) < window:
            buf.append(buf[-1])
        run(buf, True)
        run(buf, False)

    tracks = pred_tracks[0].cpu().numpy()                    # (T, N, 2)
    vis = pred_vis[0].cpu().numpy().astype(bool)             # (T, N)
    return tracks[:n_frames].astype(np.float32), vis[:n_frames]


# ------------------------------------------------------- auto clustering

def periodicity_score(sig: np.ndarray, fps: float):
    """Fraction of signal power in the 0.5-4.5 Hz stroke band, times
    amplitude. High = strong rhythmic motion; low = drift/jitter/idle."""
    x = sig - sig.mean()
    amp = np.percentile(np.abs(x), 90)
    if amp < 1e-6 or len(x) < int(fps):
        return 0.0
    spec = np.abs(np.fft.rfft(x)) ** 2
    freqs = np.fft.rfftfreq(len(x), 1.0 / fps)
    band = spec[(freqs >= 0.5) & (freqs <= 4.5)].sum()
    total = spec[freqs > 0.05].sum()
    if total < 1e-9:
        return 0.0
    return float(band / total * amp)



def dominant_freq(sig: np.ndarray, fps: float):
    """Strongest frequency in the 0.5-5.0 Hz stroke band, or None."""
    x = sig - sig.mean()
    if len(x) < int(fps) or np.std(x) < 1e-6:
        return None
    spec = np.abs(np.fft.rfft(x)) ** 2
    freqs = np.fft.rfftfreq(len(x), 1.0 / fps)
    m = (freqs >= 0.5) & (freqs <= 5.0)
    if not m.any() or spec[m].max() < 1e-9:
        return None
    return float(freqs[m][np.argmax(spec[m])])


def cluster_by_motion(tracks: np.ndarray, vis: np.ndarray, fps: float,
                      min_cluster: int = 8, max_clusters: int = 6):
    """Group grid points whose motion is correlated.

    Returns list of clusters, each: dict(indices, sig, axis, score, centroid).
    Static/low-motion points are dropped before clustering.
    """
    from scipy.cluster.hierarchy import linkage, fcluster
    from scipy.ndimage import median_filter

    T, N, _ = tracks.shape
    pos = tracks.astype(np.float64).copy()
    pos[~vis] = np.nan

    # per-point vertical+horizontal velocity, drift-removed, gap-filled.
    # build_unit_feats optionally subtracts the per-frame global mean across
    # points before normalizing. That removes common motion (camera move,
    # whole-body sway) that otherwise dominates every point's direction after
    # unit normalization and fuses hundreds of points into one mega-cluster
    # (the "4:30 collapse": head/hand groups get absorbed into a body blob).
    # It is applied as a retry below only when the first pass produces such a
    # blob, since forcing it on clean sources removes a separating signal and
    # *creates* blobs.
    vx_list, vy_list = [], []
    valid_idx = []
    for i in range(N):
        p = pos[:, i]
        good = ~np.isnan(p[:, 0])
        if good.mean() < 0.5:
            continue
        idx = np.arange(T)
        px = np.interp(idx, idx[good], p[good, 0])
        py = np.interp(idx, idx[good], p[good, 1])
        win = max(3, int(fps * 3) | 1)
        px = px - median_filter(px, win, mode="nearest")
        py = py - median_filter(py, win, mode="nearest")
        motion = np.std(px) + np.std(py)
        if motion < 1.0:      # essentially static -> ignore
            continue
        vx_list.append(px)
        vy_list.append(py)
        valid_idx.append(i)

    if len(valid_idx) < min_cluster:
        return []

    vx = np.array(vx_list)                      # (M, T)
    vy = np.array(vy_list)

    def build_unit_feats(decommon):
        if decommon:
            vx2 = vx - vx.mean(axis=0, keepdims=True)
            vy2 = vy - vy.mean(axis=0, keepdims=True)
        else:
            vx2, vy2 = vx, vy
        feats = []
        for i in range(len(valid_idx)):
            v = np.concatenate([np.diff(vx2[i]), np.diff(vy2[i])])
            n = np.linalg.norm(v)
            if n < 1e-9:
                continue
            feats.append(v / n)
        return np.array(feats)

    F = build_unit_feats(decommon=False)        # (M', 2(T-1)) unit vectors
    corr = np.clip(F @ F.T, -1, 1)              # cosine similarity of motion
    dist = 1 - corr
    Z = linkage(dist[np.triu_indices(len(F), 1)], method="average")
    labels = fcluster(Z, t=0.65, criterion="distance")
    # mega-blob retry: if the largest cluster holds most of the points, the
    # common-motion artifact is likely fusing real groups. Re-cluster with
    # global-mean removal and keep whichever split is less blob-dominated.
    counts = np.array([np.sum(labels == lab) for lab in np.unique(labels)])
    if len(counts) and counts.max() > 0.6 * len(F) and len(F) >= 4 * min_cluster:
        F2 = build_unit_feats(decommon=True)
        corr2 = np.clip(F2 @ F2.T, -1, 1)
        Z2 = linkage((1 - corr2)[np.triu_indices(len(F2), 1)], method="average")
        labels2 = fcluster(Z2, t=0.65, criterion="distance")
        c2 = np.array([np.sum(labels2 == lab) for lab in np.unique(labels2)])
        # prefer the pass whose top cluster is a smaller share of the total
        if len(c2) and c2.max() / len(F2) < counts.max() / len(F):
            F, labels = F2, labels2

    clusters = []
    for lab in np.unique(labels):
        members = np.array(valid_idx)[labels == lab]
        if len(members) < min_cluster:
            continue
        sig, axis = extract_signal(
            tracks[:, members].astype(np.float32), vis[:, members], fps)
        score = periodicity_score(sig, fps)
        cx = np.nanmean(pos[:, members, 0])
        cy = np.nanmean(pos[:, members, 1])
        clusters.append({
            "indices": members, "sig": sig, "axis": axis,
            "score": score, "centroid": (float(cx), float(cy)),
            "n": int(len(members)),
        })
    clusters.sort(key=lambda c: -c["score"])
    return clusters[:max_clusters]



def raw_projection(tracks, vis, indices, axis):
    """Median projected signal in raw pixels (drift kept, gaps filled)."""
    pos = tracks[:, indices].astype(np.float64)
    pos[~vis[:, indices]] = np.nan
    dev = pos - np.nanmean(pos, axis=0, keepdims=True)
    with np.errstate(all="ignore"):
        raw = np.nanmedian(dev @ axis, axis=1)
    bad = np.isnan(raw)
    if bad.all():
        return None
    idx = np.arange(len(raw))
    raw[bad] = np.interp(idx[bad], idx[~bad], raw[~bad])
    return raw


def band_analysis(raw, fps):
    """Slow-sway vs stroke-band decomposition of a raw pixel signal."""
    from scipy.signal import butter, filtfilt, welch
    out = {"slow_amp": 0.0, "stroke_amp": 0.0, "stroke_hz": 0.0,
           "stroke_sig": None}
    if raw is None or len(raw) < int(fps):
        return out
    nyq = fps / 2
    for name, lo, hi in (("slow", 0.2, 1.1), ("stroke", 1.1, 5.0)):
        b, a = butter(2, [lo / nyq, min(hi / nyq, 0.99)], "band")
        f = filtfilt(b, a, raw)
        out[f"{name}_amp"] = float(np.percentile(f, 98) - np.percentile(f, 2))
        if name == "stroke":
            out["stroke_sig"] = f
    fr, psd = welch(raw, fps, nperseg=min(len(raw), 256))
    m = (fr >= 1.1) & (fr <= 5.0)
    if m.any() and psd[m].max() > 1e-12:
        out["stroke_hz"] = float(fr[m][np.argmax(psd[m])])
    return out


def normalize_signal(raw, fps, smooth_s=0.12):
    """Raw px signal -> smoothed 0..1 (same post-steps as extract_signal)."""
    from scipy.signal import savgol_filter
    from scipy.ndimage import median_filter
    win = max(3, int(fps * 4) | 1)
    raw = raw - median_filter(raw, size=win, mode="nearest")
    sg = max(5, int(fps * smooth_s) | 1)
    if len(raw) <= sg:
        return np.full(len(raw), 0.5)
    s = savgol_filter(raw, sg, 2)
    lo, hi = np.percentile(s, [2, 98])
    if hi - lo < 1e-6:
        return np.full(len(raw), 0.5)
    return np.clip((s - lo) / (hi - lo), 0.0, 1.0)



# ---------------------------------------------------------------- pose labels

KPT_GROUPS = {"head": [0, 1, 2, 3, 4], "torso": [5, 6],
              "arms": [7, 8, 9, 10], "hips": [11, 12],
              "legs": [13, 14, 15, 16]}
BG_DEMOTE = 0.4          # score multiplier for off-person clusters


def load_pose(video: Path):
    p = video.parent / (video.name + ".pose.json")
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def label_cluster(centroid, frames):
    """Label a cluster centroid against pose detections of its window.
    Returns None when pose saw no person at all (pose-blind: no verdict)."""
    any_person = any(fr["persons"] for fr in frames)
    if not any_person:
        return None
    cx, cy = centroid
    best_d, best_g = 1e18, None
    inside = False
    for fr in frames:
        for person in fr["persons"]:
            x1, y1, x2, y2 = person["bbox"]
            mx, my = 0.12 * (x2 - x1), 0.12 * (y2 - y1)
            if x1 - mx <= cx <= x2 + mx and y1 - my <= cy <= y2 + my:
                inside = True
                for gname, idxs in KPT_GROUPS.items():
                    for i in idxs:
                        x, y, c = person["kpts"][i]
                        if c < 0.3:
                            continue
                        d = (x - cx) ** 2 + (y - cy) ** 2
                        if d < best_d:
                            best_d, best_g = d, gname
    if not inside:
        return "background"
    return best_g or "body"


def cmd_extract_auto(video: Path, data, meta, args):
    fps = meta["fps"]
    all_actions = []
    signal_dump = []
    idle_thresh = args.idle_threshold
    pose_data = load_pose(video)
    if pose_data:
        print(f"pose labels loaded ({len(pose_data.get('windows', {}))} "
              f"windows) - background clusters demoted x{BG_DEMOTE}")

    for sc in meta["scenes"]:
        key = sc["scene"]
        for wnd in sc["windows"]:
            wi, ws = wnd["i"], wnd["start"]
            tracks = data[f"tracks_{key}_w{wi}"]
            vis = data[f"vis_{key}_w{wi}"]
            t0_ms = int(ws / fps * 1000)
            clusters = cluster_by_motion(tracks, vis, fps)

            if pose_data:
                wframes = pose_data.get("windows", {}).get(f"{key}_w{wi}")
                if wframes:
                    for c in clusters:
                        c["label"] = label_cluster(c["centroid"],
                                                   wframes["frames"])
                        if c["label"] == "background":
                            c["score"] *= BG_DEMOTE
                    clusters.sort(key=lambda c: -c["score"])

            entry = {"scene": int(key), "window": wi,
                     "start_frame": ws, "t0_ms": t0_ms, "clusters": []}
            for ci, c in enumerate(clusters):
                entry["clusters"].append({
                    "id": ci,
                    "score": round(c["score"], 4),
                    "n_points": c["n"],
                    "centroid": [round(v, 1) for v in c["centroid"]],
                    "axis": [round(float(a), 4) for a in c["axis"]],
                    "label": c.get("label"),
                    "indices": [int(i) for i in c["indices"]],
                    "values": [round(float(x), 4) for x in c["sig"]],
                })

            if clusters and clusters[0]["score"] >= idle_thresh:
                best = clusters[0]
                raw = raw_projection(tracks, vis, best["indices"], best["axis"])
                ba = band_analysis(raw, fps)
                f0 = ba["stroke_hz"]
                sway_dominated = (ba["slow_amp"] > 2.2 * ba["stroke_amp"]
                                  and ba["stroke_amp"] >= 4.0
                                  and f0 >= 1.5
                                  and ba["stroke_sig"] is not None)
                if sway_dominated:
                    # strokes buried under slow body/camera sway: script
                    # the stroke band, at stroke-band smoothing
                    sig = normalize_signal(
                        ba["stroke_sig"], fps,
                        smooth_s=max(0.04, 0.2 / max(f0, 1.1)))
                elif f0 > 2.0:
                    sig = normalize_signal(
                        raw, fps, smooth_s=max(0.04, 0.25 / f0))
                else:
                    sig = best["sig"]
                min_int = args.min_interval
                if f0 > 1.0:
                    min_int = int(np.clip(1000 * 0.35 / f0,
                                          60, args.min_interval))
                if args.invert:
                    sig = 1.0 - sig
                actions = signal_to_actions(
                    sig, fps, t0_ms,
                    min_interval_ms=min_int,
                    min_prominence=args.prominence)
                entry["chosen_cluster"] = 0
                entry["dominant_hz"] = round(f0, 2) if f0 else None
                entry["final_values"] = [round(float(x), 4) for x in sig]
                entry["band"] = {
                    "slow_amp_px": round(ba["slow_amp"], 1),
                    "stroke_amp_px": round(ba["stroke_amp"], 1),
                    "sway_dominated": bool(sway_dominated),
                }
                print(f"scene {key:>02s} w{wi:04d}: {len(clusters)} cluster(s), "
                      f"best score {clusters[0]['score']:.3f} "
                      f"@({best['centroid'][0]:.0f},{best['centroid'][1]:.0f}) "
                      f"{f'{f0:.1f}Hz ' if f0 else ''}"
                      f"{'[stroke-band] ' if sway_dominated else ''}"
                      f"-> {len(actions)} keyframes")
            else:
                # idle window: hold position
                actions = [{"at": t0_ms, "pos": 50}]
                entry["chosen_cluster"] = None
                sc_best = clusters[0]["score"] if clusters else 0.0
                print(f"scene {key:>02s} w{wi:04d}: idle "
                      f"(best score {sc_best:.3f} < {idle_thresh})")

            all_actions += actions
            signal_dump.append(entry)

    return all_actions, signal_dump

def extract_signal(tracks: np.ndarray, vis: np.ndarray, fps: float,
                   smooth_s: float = 0.12):
    """(T, N, 2) trajectories -> single 0..1 motion signal of length T.

    Steps: visibility masking, per-track centering, PCA for the dominant
    motion axis, projection, median across tracks, drift removal, smoothing.
    """
    from scipy.signal import savgol_filter
    from scipy.ndimage import median_filter

    T, N, _ = tracks.shape
    pos = tracks.astype(np.float64).copy()
    pos[~vis] = np.nan

    # center each track on its own mean so PCA sees motion, not layout
    mean = np.nanmean(pos, axis=0, keepdims=True)          # (1, N, 2)
    dev = pos - mean                                        # (T, N, 2)

    # PCA over all valid deviations -> dominant motion axis
    flat = dev.reshape(-1, 2)
    flat = flat[~np.isnan(flat).any(axis=1)]
    if len(flat) < 10:
        return np.full(T, 0.5), np.array([0.0, 1.0])
    cov = np.cov(flat.T)
    eigval, eigvec = np.linalg.eigh(cov)
    axis = eigvec[:, np.argmax(eigval)]                     # (2,)
    # sign convention: image-up (negative y) => higher signal value
    if axis[1] > 0:
        axis = -axis

    proj = dev @ axis                                       # (T, N)
    with np.errstate(all="ignore"):
        sig = np.nanmedian(proj, axis=1)                    # (T,)

    # fill gaps (all points invisible) by interpolation
    bad = np.isnan(sig)
    if bad.all():
        return np.full(T, 0.5), axis
    if bad.any():
        idx = np.arange(T)
        sig[bad] = np.interp(idx[bad], idx[~bad], sig[~bad])

    # remove slow drift (camera/framing changes): subtract rolling median
    win = max(3, int(fps * 4) | 1)
    sig = sig - median_filter(sig, size=win, mode="nearest")

    # light smoothing to kill pixel jitter without eating peaks
    sg = max(5, int(fps * smooth_s) | 1)
    sig = savgol_filter(sig, sg, 2)

    # robust normalize to 0..1
    lo, hi = np.percentile(sig, [2, 98])
    if hi - lo < 1e-6:
        return np.full(T, 0.5), axis
    sig = np.clip((sig - lo) / (hi - lo), 0.0, 1.0)
    return sig, axis


def signal_to_actions(sig: np.ndarray, fps: float, t0_ms: int,
                      min_interval_ms: int = 120,
                      min_prominence: float = 0.10):
    """Continuous signal -> funscript keyframes at local peaks/valleys."""
    from scipy.signal import find_peaks

    dist = max(1, int(min_interval_ms / 1000 * fps))
    peaks, _ = find_peaks(sig, distance=dist, prominence=min_prominence)
    valleys, _ = find_peaks(-sig, distance=dist, prominence=min_prominence)

    idx = np.sort(np.concatenate([peaks, valleys, [0, len(sig) - 1]]))
    idx = np.unique(idx)

    actions = []
    for i in idx:
        actions.append({
            "at": int(t0_ms + i / fps * 1000),
            "pos": int(round(float(sig[i]) * 100)),
        })
    return actions


def cmd_extract(video: Path, args):
    p = sidecar(video, ".tracks.npz")
    if not p.exists():
        sys.exit(f"missing {p.name} - run 'track' first")
    data = np.load(p, allow_pickle=False)
    meta = json.loads(str(data["meta"]))
    fps = meta["fps"]

    if meta.get("mode") == "auto":
        all_actions, signal_dump = cmd_extract_auto(video, data, meta, args)
        _write_outputs(video, fps, all_actions, signal_dump,
                       (meta.get("w"), meta.get("h")))
        return

    # legacy metas stored scenes as a plain list of keys
    scene_keys = [s["scene"] if isinstance(s, dict) else s
                  for s in meta["scenes"]]

    all_actions = []
    signal_dump = []

    for key in scene_keys:
        tracks = data[f"tracks_{key}"]
        vis = data[f"vis_{key}"]
        has_groups = f"groups_{key}" in data
        # legacy files (pre group support) were saved transposed (N, T, 2)
        if not has_groups and tracks.shape[0] < tracks.shape[1]:
            tracks = tracks.transpose(1, 0, 2)
            vis = vis.transpose(1, 0)
        gids = data[f"groups_{key}"] if has_groups \
            else np.ones(tracks.shape[1], dtype=np.int16)
        start = int(data[f"start_{key}"])
        t0_ms = int(start / fps * 1000)

        # ---- tracking health: flag stretches where the signal is fiction
        vis_frac = vis.mean(axis=1)
        from scipy.ndimage import uniform_filter1d
        smooth_vis = uniform_filter1d(vis_frac, size=max(3, int(fps)))
        degraded = smooth_vis < 0.25
        deg_ranges = []
        in_run = False
        for i, bad in enumerate(np.append(degraded, False)):
            if bad and not in_run:
                run_start, in_run = i, True
            elif not bad and in_run:
                in_run = False
                if (i - run_start) / fps >= 2.0:  # only flag >=2s stretches
                    deg_ranges.append([round(run_start / fps, 1),
                                       round(i / fps, 1)])
        if deg_ranges:
            total_bad = sum(b - a for a, b in deg_ranges)
            print(f"scene {key}: WARNING - tracking degraded for "
                  f"{total_bad:.0f}s: {deg_ranges} (scene-relative seconds). "
                  f"Signal there is unreliable; consider re-seeding.")

        # one signal per group
        group_signals = {}
        for g in sorted(set(int(x) for x in gids)):
            m = gids == g
            sig, axis = extract_signal(tracks[:, m], vis[:, m], fps)
            if args.invert:
                sig = 1.0 - sig
            # motion energy: how much this group actually oscillates
            energy = float(np.std(np.diff(sig))) if len(sig) > 1 else 0.0
            group_signals[g] = {"sig": sig, "axis": axis, "energy": energy}

        # pick the driving group for the funscript
        if args.group and args.group in group_signals:
            chosen = args.group
        else:
            chosen = max(group_signals, key=lambda g: group_signals[g]["energy"])

        sig = group_signals[chosen]["sig"]
        actions = signal_to_actions(
            sig, fps, t0_ms,
            min_interval_ms=args.min_interval,
            min_prominence=args.prominence)
        all_actions += actions

        signal_dump.append({
            "scene": int(key),
            "start_frame": start,
            "chosen_group": chosen,
            "degraded_ranges_s": deg_ranges,
            "groups": {
                str(g): {
                    "axis": [round(float(a), 4) for a in v["axis"]],
                    "energy": round(v["energy"], 5),
                    "values": [round(float(x), 4) for x in v["sig"]],
                } for g, v in group_signals.items()
            },
        })
        print(f"scene {key}: groups {sorted(group_signals)} "
              f"energies {[round(group_signals[g]['energy'], 3) for g in sorted(group_signals)]} "
              f"-> using group {chosen}, {len(actions)} keyframes")

    _write_outputs(video, fps, all_actions, signal_dump)


def _write_outputs(video: Path, fps, all_actions, signal_dump, wh=(None, None)):
    all_actions.sort(key=lambda a: a["at"])
    # drop duplicates at identical timestamps (scene joins)
    dedup = []
    for a in all_actions:
        if dedup and a["at"] <= dedup[-1]["at"]:
            continue
        dedup.append(a)

    fs = {
        "version": "1.0",
        "inverted": False,
        "range": 100,
        "author": "funpipe",
        "actions": dedup,
    }
    fs_path = video.with_suffix(".funscript")
    fs_path.write_text(json.dumps(fs))
    sig_path = sidecar(video, ".signal.json")
    sig_path.write_text(json.dumps(
        {"fps": fps, "w": wh[0], "h": wh[1],
         "scenes": signal_dump}))
    print(f"{len(dedup)} total actions -> {fs_path.name}")
    print(f"continuous signal -> {sig_path.name} (for the review UI later)")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="funscript pipeline stage 2")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_seed = sub.add_parser("seed", help="click track targets per scene")
    p_track = sub.add_parser("track", help="run CoTracker3")
    p_track.add_argument("--max-side", type=int, default=768,
                         help="downscale so the longest side is this (default 768)")
    p_track.add_argument("--auto", action="store_true",
                         help="seedless: dense grid re-seeded per window, "
                              "motion clustering at extract time")
    p_track.add_argument("--window", type=float, default=8.0,
                         help="auto mode window length in seconds (default 8)")
    p_track.add_argument("--grid", type=str, default="20x12",
                         help="auto mode grid density NXxNY (default 20x12)")
    p_ext = sub.add_parser("extract", help="signal -> funscript")
    p_all = sub.add_parser("all", help="seed + track + extract")
    p_all.add_argument("--max-side", type=int, default=768)

    for p in (p_ext, p_all):
        p.add_argument("--invert", action="store_true",
                       help="flip the up/down direction")
        p.add_argument("--min-interval", type=int, default=120,
                       help="min ms between keyframes (default 120)")
        p.add_argument("--prominence", type=float, default=0.10,
                       help="min peak prominence 0-1 (default 0.10)")
        p.add_argument("--group", type=int, default=None,
                       help="force this group to drive the funscript "
                            "(default: most active group per scene)")
        p.add_argument("--idle-threshold", type=float, default=0.08,
                       help="auto mode: periodicity score below this = idle "
                            "window, flat line (default 0.08)")

    for p in (p_seed, p_track, p_ext, p_all):
        p.add_argument("video", type=Path)

    args = ap.parse_args()
    if not args.video.is_file():
        sys.exit(f"not found: {args.video}")

    if args.cmd == "seed":
        cmd_seed(args.video, args)
    elif args.cmd == "track":
        cmd_track(args.video, args)
    elif args.cmd == "extract":
        cmd_extract(args.video, args)
    elif args.cmd == "all":
        cmd_seed(args.video, args)
        cmd_track(args.video, args)
        cmd_extract(args.video, args)


if __name__ == "__main__":
    main()
