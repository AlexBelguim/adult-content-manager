#!/usr/bin/env python3
"""
funpipe stage 2.5 (optional): pose labeling.

Runs a lightweight person-pose model on a few sampled frames per tracking
window and stores keypoints + person boxes in <video>.pose.json.
The extract stage then labels each motion cluster (head/torso/arms/hips/
legs/background) and demotes background clusters in the ranking.
The review UI shows the labels in the cluster picker.

Usage:
    pip install ultralytics
    python pose_label.py video.mp4
    python pose_label.py "F:\\videos"            # folder, recursive
    python pose_label.py video.mp4 --model yolo11s-pose.pt --samples 3

Runs AFTER track, BEFORE extract. Re-run extract afterwards to apply labels.
Model weights auto-download on first run (Ultralytics, ~6 MB for n).
"""

import argparse
import json
import sys
from fractions import Fraction
from pathlib import Path

import cv2
import numpy as np

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".ts"}


def load_meta(video: Path):
    npz = video.parent / (video.name + ".tracks.npz")
    if not npz.exists():
        return None, None
    data = np.load(npz, allow_pickle=True)
    meta = json.loads(str(data["meta"]))
    return data, meta


def plan_samples(data, meta, n_samples: int):
    """-> dict frame_idx -> list of (window_key, slot)."""
    plan = {}
    for sc in meta["scenes"]:
        key = sc["scene"]
        for wnd in sc["windows"]:
            wi, ws = wnd["i"], wnd["start"]
            T = data[f"tracks_{key}_w{wi}"].shape[0]
            wkey = f"{key}_w{wi}"
            fracs = [(i + 1) / (n_samples + 1) for i in range(n_samples)]
            for slot, fr in enumerate(fracs):
                idx = ws + int(T * fr)
                plan.setdefault(idx, []).append((wkey, slot))
    return plan


def run_video(video: Path, model, args):
    data, meta = load_meta(video)
    if meta is None:
        print(f"  skip (no .tracks.npz): {video.name}")
        return
    out_path = video.parent / (video.name + ".pose.json")
    if out_path.exists() and not args.force:
        print(f"  skip (pose.json exists): {video.name}")
        return

    W, H = meta["w"], meta["h"]
    plan = plan_samples(data, meta, args.samples)
    targets = sorted(plan)
    print(f"  {video.name}: {len(targets)} frames to inspect "
          f"across {sum(len(v) for v in plan.values()) // args.samples} windows")

    windows = {}
    import imageio.v2 as imageio
    reader = imageio.get_reader(str(video))
    buf_frames, buf_idx = [], []

    def flush():
        if not buf_frames:
            return
        results = model(buf_frames, verbose=False, conf=args.conf)
        for idx, res in zip(buf_idx, results):
            persons = []
            if res.keypoints is not None and len(res.boxes) > 0:
                kdata = res.keypoints.data.cpu().numpy()  # (n,17,3)
                boxes = res.boxes.xyxy.cpu().numpy()
                for b, k in zip(boxes, kdata):
                    persons.append({
                        "bbox": [round(float(x), 1) for x in b],
                        "kpts": [[round(float(x), 1), round(float(y), 1),
                                  round(float(c), 3)] for x, y, c in k],
                    })
            for wkey, slot in plan[idx]:
                windows.setdefault(wkey, {"frames": []})["frames"].append(
                    {"idx": int(idx), "persons": persons})
        buf_frames.clear()
        buf_idx.clear()

    ti = 0
    for i, frame in enumerate(reader):
        if ti >= len(targets):
            break
        if i == targets[ti]:
            f = cv2.resize(frame, (W, H)) if frame.shape[1] != W else frame
            buf_frames.append(f)
            buf_idx.append(i)
            ti += 1
            if len(buf_frames) >= args.batch:
                flush()
    flush()
    reader.close()

    n_det = sum(1 for w in windows.values()
                for fr in w["frames"] if fr["persons"])
    out = {"model": args.model, "w": W, "h": H,
           "samples": args.samples, "windows": windows}
    out_path.write_text(json.dumps(out))
    print(f"  -> {out_path.name}  "
          f"({n_det}/{sum(len(w['frames']) for w in windows.values())} "
          f"frames with person detections)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", type=Path)
    ap.add_argument("--model", default="yolo11n-pose.pt",
                    help="ultralytics pose model (n=fast, s/m=better)")
    ap.add_argument("--samples", type=int, default=3,
                    help="frames sampled per window")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("missing dep: pip install ultralytics")

    model = YOLO(args.model)

    if args.path.is_dir():
        vids = [p for p in sorted(args.path.rglob("*"))
                if p.suffix.lower() in VIDEO_EXTS and ".proxy" not in p.name]
    else:
        vids = [args.path]
    print(f"pose labeling {len(vids)} video(s) with {args.model}")
    for v in vids:
        run_video(v, model, args)


if __name__ == "__main__":
    main()
