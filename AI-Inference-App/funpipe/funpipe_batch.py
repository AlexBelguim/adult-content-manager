#!/usr/bin/env python3
"""
Batch runner for the funscript pipeline.

Walks a folder (recursively), and for every video runs the full chain:
    detect_scenes.py  ->  track_extract.py track --auto  ->  extract

Each stage is skipped if its output already exists, so re-running after
adding new videos (or after a crash) only does the missing work.
Videos that already have a .funscript are skipped entirely unless --force.

Usage:
    python funpipe_batch.py "F:\\videos"                # process everything
    python funpipe_batch.py "F:\\videos" --dry-run      # show planned work
    python funpipe_batch.py "F:\\videos" --force        # redo everything
    python funpipe_batch.py "F:\\videos" --max-side 960 --window 8
"""

import argparse
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".ts"}
HERE = Path(__file__).parent


def sidecar(video: Path, ext: str) -> Path:
    return video.with_suffix(video.suffix + ext)


def plan_stages(v: Path, force: bool):
    stages = []
    if force or not sidecar(v, ".scenes.json").exists():
        stages.append("scenes")
    if force or not sidecar(v, ".tracks.npz").exists():
        stages.append("track")
    if force or not v.with_suffix(".funscript").exists():
        stages.append("extract")
    return stages


def run(cmd, log):
    log.write(f"\n$ {' '.join(str(c) for c in cmd)}\n")
    log.flush()
    r = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT)
    return r.returncode == 0


def main():
    ap = argparse.ArgumentParser(description="funscript pipeline batch runner")
    ap.add_argument("folder", type=Path)
    ap.add_argument("--force", action="store_true",
                    help="re-run all stages even if outputs exist")
    ap.add_argument("--dry-run", action="store_true",
                    help="only show what would be done")
    ap.add_argument("--threshold", type=float, default=3.0,
                    help="scene detection threshold (default 3.0)")
    ap.add_argument("--max-side", type=int, default=768,
                    help="tracking resolution long side (default 768)")
    ap.add_argument("--window", type=float, default=8.0,
                    help="auto tracking window seconds (default 8)")
    ap.add_argument("--grid", type=str, default="20x12",
                    help="auto tracking grid density (default 20x12)")
    args = ap.parse_args()

    if not args.folder.is_dir():
        sys.exit(f"not a folder: {args.folder}")

    vids = sorted(p for p in args.folder.rglob("*")
                  if p.suffix.lower() in VIDEO_EXTS)
    if not vids:
        sys.exit("no videos found")

    todo = [(v, plan_stages(v, args.force)) for v in vids]
    todo = [(v, s) for v, s in todo if s]
    done_already = len(vids) - len(todo)

    print(f"{len(vids)} video(s) found, {done_already} complete, "
          f"{len(todo)} to process")
    for v, stages in todo:
        print(f"  {v.name}: {' + '.join(stages)}")
    if args.dry_run or not todo:
        return

    log_path = args.folder / "funpipe_batch.log"
    ok = fail = 0
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(f"\n===== batch started {datetime.now():%Y-%m-%d %H:%M} "
                  f"({len(todo)} videos) =====\n")
        for i, (v, stages) in enumerate(todo, 1):
            t0 = time.time()
            print(f"\n[{i}/{len(todo)}] {v.name}  ({' + '.join(stages)})")
            log.write(f"\n--- {v} ---\n")
            good = True
            if good and "scenes" in stages:
                good = run([sys.executable, HERE / "detect_scenes.py", v,
                            "--threshold", str(args.threshold),
                            *(["--force"] if args.force else [])], log)
            if good and "track" in stages:
                good = run([sys.executable, HERE / "track_extract.py",
                            "track", v, "--auto",
                            "--max-side", str(args.max_side),
                            "--window", str(args.window),
                            "--grid", args.grid], log)
            if good and "extract" in stages:
                good = run([sys.executable, HERE / "track_extract.py",
                            "extract", v], log)
            mins = (time.time() - t0) / 60
            if good:
                ok += 1
                print(f"    done in {mins:.1f} min")
            else:
                fail += 1
                print(f"    FAILED after {mins:.1f} min - see {log_path.name}")
        log.write(f"===== batch finished: {ok} ok, {fail} failed =====\n")

    print(f"\nbatch complete: {ok} ok, {fail} failed"
          + (f" - details in {log_path}" if fail else ""))


if __name__ == "__main__":
    main()
