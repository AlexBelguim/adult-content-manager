#!/usr/bin/env python3
"""
Stage 1 of the funscript pipeline: scene/shot detection.

Detects hard cuts in a video and writes <video>.scenes.json next to it.
Later stages (tracking, signal extraction) consume this file so tracking
resets cleanly at every cut.

Usage:
    python detect_scenes.py video.mp4
    python detect_scenes.py /path/to/folder            # batch, recursive
    python detect_scenes.py video.mp4 --thumbs         # dump a mid-scene jpg per scene
    python detect_scenes.py video.mp4 --threshold 2.5  # more sensitive
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
from scenedetect import open_video, SceneManager
from scenedetect.detectors import AdaptiveDetector

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".ts"}


def detect(video_path: Path, threshold: float, min_scene_sec: float,
           downscale: bool = True):
    video = open_video(str(video_path))
    fps = float(video.frame_rate)

    sm = SceneManager()
    # AdaptiveDetector compares each frame's change against a rolling window,
    # so fast in-scene motion doesn't trigger false cuts the way a fixed
    # ContentDetector threshold does. Good fit for high-motion content.
    sm.add_detector(AdaptiveDetector(
        adaptive_threshold=threshold,
        min_scene_len=int(min_scene_sec * fps),
    ))
    if downscale:
        sm.auto_downscale = True  # big speedup, negligible accuracy cost

    sm.detect_scenes(video, show_progress=True)
    scene_list = sm.get_scene_list()

    # If no cuts were found, treat the whole video as one scene.
    if not scene_list:
        total = video.duration
        scene_list = [(video.base_timecode, total)]

    scenes = []
    for i, (start, end) in enumerate(scene_list):
        scenes.append({
            "index": i,
            "start_frame": start.frame_num,
            "end_frame": end.frame_num,          # exclusive
            "start_time": round(start.seconds, 3),
            "end_time": round(end.seconds, 3),
            "duration": round(end.seconds - start.seconds, 3),
        })

    return {
        "video": video_path.name,
        "fps": round(fps, 3),
        "total_frames": scenes[-1]["end_frame"],
        "detector": "adaptive",
        "threshold": threshold,
        "min_scene_sec": min_scene_sec,
        "scene_count": len(scenes),
        "scenes": scenes,
    }


def dump_thumbs(video_path: Path, result: dict, out_dir: Path):
    """One jpg per scene, grabbed from the scene midpoint, for quick review."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    for s in result["scenes"]:
        mid = (s["start_frame"] + s["end_frame"]) // 2
        cap.set(cv2.CAP_PROP_POS_FRAMES, mid)
        ok, frame = cap.read()
        if not ok:
            continue
        h, w = frame.shape[:2]
        if w > 640:
            frame = cv2.resize(frame, (640, int(h * 640 / w)))
        name = f"scene_{s['index']:03d}_{s['start_time']:.1f}s.jpg"
        cv2.imwrite(str(out_dir / name), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    cap.release()


def process_one(video_path: Path, args) -> bool:
    out_path = video_path.with_suffix(video_path.suffix + ".scenes.json")
    if out_path.exists() and not args.force:
        print(f"skip (exists): {out_path.name}")
        return True

    print(f"\n=== {video_path.name} ===")
    try:
        result = detect(video_path, args.threshold, args.min_scene)
    except Exception as e:
        print(f"ERROR on {video_path.name}: {e}", file=sys.stderr)
        return False

    out_path.write_text(json.dumps(result, indent=2))
    print(f"{result['scene_count']} scene(s) -> {out_path.name}")

    if args.thumbs:
        thumb_dir = video_path.parent / (video_path.stem + "_scenes")
        dump_thumbs(video_path, result, thumb_dir)
        print(f"thumbnails -> {thumb_dir.name}/")
    return True


def main():
    ap = argparse.ArgumentParser(description="Scene detection for the funscript pipeline")
    ap.add_argument("input", type=Path, help="video file or folder")
    ap.add_argument("--threshold", type=float, default=3.0,
                    help="adaptive threshold; lower = more sensitive (default 3.0)")
    ap.add_argument("--min-scene", type=float, default=1.0,
                    help="minimum scene length in seconds (default 1.0)")
    ap.add_argument("--thumbs", action="store_true",
                    help="save a mid-scene thumbnail per scene for review")
    ap.add_argument("--force", action="store_true",
                    help="re-process even if .scenes.json already exists")
    args = ap.parse_args()

    if args.input.is_dir():
        vids = sorted(p for p in args.input.rglob("*")
                      if p.suffix.lower() in VIDEO_EXTS)
        if not vids:
            sys.exit("no video files found")
        print(f"batch: {len(vids)} video(s)")
        ok = sum(process_one(v, args) for v in vids)
        print(f"\ndone: {ok}/{len(vids)} succeeded")
    elif args.input.is_file():
        if not process_one(args.input, args):
            sys.exit(1)
    else:
        sys.exit(f"not found: {args.input}")


if __name__ == "__main__":
    main()
