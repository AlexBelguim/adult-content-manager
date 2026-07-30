#!/usr/bin/env python3
"""
funpipe review UI - local web server.

Serves a browser UI to review pipeline output: per-window cluster choice,
idle flattening, per-segment range mapping, instant funscript re-export.

Usage:
    pip install fastapi uvicorn
    python funpipe_ui.py "F:\\videos"          # then open http://localhost:8420
    python funpipe_ui.py "F:\\videos" --host 0.0.0.0   # reachable from phone/LAN

Data model (all files live next to the video):
    <video>.signal.json   pipeline output (read-only here)
    <video>.edits.json    your review decisions (written by this UI)
    <video>.funscript     regenerated on every export
If <name>.proxy.mp4 exists it is served instead of the original
(useful when the original codec doesn't play in the browser):
    ffmpeg -i original.mp4 -vf scale=-2:720 -c:v libx264 -crf 23 -c:a aac name.proxy.mp4
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import functools

try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import (HTMLResponse, JSONResponse, Response,
                                   StreamingResponse)
    import uvicorn
except ImportError:
    sys.exit("missing deps: pip install fastapi uvicorn")

sys.path.insert(0, str(Path(__file__).parent))
from track_extract import (signal_to_actions, extract_signal,  # noqa: E402
                           raw_projection, band_analysis, normalize_signal,
                           make_support_grid)
from compare_funscripts import (compare, load_funscript,  # noqa: E402
                                best_shift)

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".ts"}
ROOT = Path(".")

app = FastAPI()

# ------------------------------------------------------------------ anchor
# Lazy CoTracker3 loader. Anchors re-track user-placed points on demand (GPU);
# the model is heavy (~GB VRAM) so it only loads the first time an anchor is
# placed, then stays resident for the server's lifetime. Single global model
# + lock since cotracker3_online is stateful per instance.
_COTRACKER = {"model": None, "device": None}
_COTRACKER_LOCK = None  # created lazily (needs running event loop on import-safe path)


def sidecar(video: Path, ext: str) -> Path:
    return video.with_suffix(video.suffix + ext)


# --- video discovery -------------------------------------------------------
# ACM change: the original walked ROOT on EVERY call, and main() blocked on one
# before binding the port. Rooted at a real media library on a network share
# that is >164k entries and minutes per walk, so the server never came up.
# Now: scan for the .signal.json sidecars directly (no per-video exists() probe),
# cache the result, and let the caller refresh in the background.
_VID_CACHE = {"vids": None, "time": 0.0, "scanning": False}
_VID_TTL = 120.0
_SIG_EXT = ".signal.json"


def _scan_videos():
    vids = []
    for sig in ROOT.rglob("*" + _SIG_EXT):
        v = sig.with_name(sig.name[:-len(_SIG_EXT)])
        if v.suffix.lower() in VIDEO_EXTS and ".proxy" not in v.name and v.exists():
            vids.append(v)
    return sorted(vids)


def find_videos(refresh: bool = False):
    import time as _t
    now = _t.time()
    # Never block behind an in-flight background scan — serve what we have.
    if _VID_CACHE["scanning"] and _VID_CACHE["vids"] is not None:
        return _VID_CACHE["vids"]
    if (not refresh and _VID_CACHE["vids"] is not None
            and now - _VID_CACHE["time"] < _VID_TTL):
        return _VID_CACHE["vids"]
    vids = _scan_videos()
    _VID_CACHE.update(vids=vids, time=now)
    return vids


def warm_videos_async():
    """Populate the cache off the request path so startup is instant."""
    import threading

    def run():
        _VID_CACHE["scanning"] = True
        try:
            vids = _scan_videos()
            _VID_CACHE.update(vids=vids, time=__import__("time").time())
            print(f"scan complete: {len(vids)} processed video(s)", flush=True)
        except Exception as e:
            print(f"scan failed: {e}", flush=True)
            _VID_CACHE.setdefault("vids", [])
        finally:
            _VID_CACHE["scanning"] = False

    # Prime with an empty-but-FRESH entry: without the timestamp the first
    # request sees a stale cache and pays for a blocking rescan, which is the
    # very thing this exists to avoid.
    _VID_CACHE.update(vids=_VID_CACHE["vids"] or [],
                      time=__import__("time").time(), scanning=True)
    threading.Thread(target=run, daemon=True, name="funpipe-scan").start()


def vid_by_id(vid_id: str) -> Path:
    # Try the cache first, then pay for a rescan before giving up — a video
    # generated since the last scan would otherwise 404 for up to _VID_TTL.
    for refresh in (False, True):
        for v in find_videos(refresh=refresh):
            if v.stem == vid_id or v.name == vid_id:
                return v
        if _VID_CACHE["scanning"]:
            break
    raise HTTPException(404, f"no processed video named {vid_id!r} "
                             f"(need <video> + <video>{_SIG_EXT})")


# ------------------------------------------------------------------ api

@app.get("/api/videos")
def api_videos():
    out = []
    for v in find_videos():
        out.append({
            "id": v.stem,
            "name": v.name,
            "has_edits": sidecar(v, ".edits.json").exists(),
            "has_funscript": v.with_suffix(".funscript").exists(),
        })
    return out


@app.get("/api/signal/{vid_id}")
def api_signal(vid_id: str):
    v = vid_by_id(vid_id)
    return JSONResponse(json.loads(sidecar(v, ".signal.json").read_text()))


@app.get("/api/edits/{vid_id}")
def api_get_edits(vid_id: str):
    v = vid_by_id(vid_id)
    p = sidecar(v, ".edits.json")
    if p.exists():
        return JSONResponse(json.loads(p.read_text()))
    return {"windows": {}, "segments": []}


@app.post("/api/edits/{vid_id}")
async def api_save_edits(vid_id: str, request: Request):
    v = vid_by_id(vid_id)
    edits = await request.json()
    sidecar(v, ".edits.json").write_text(json.dumps(edits, indent=1))
    return {"ok": True}


@app.post("/api/export/{vid_id}")
async def api_export(vid_id: str, request: Request):
    v = vid_by_id(vid_id)
    edits = await request.json()
    sidecar(v, ".edits.json").write_text(json.dumps(edits, indent=1))
    fs_path = v.with_suffix(".funscript")
    _export_to_path(v, edits, fs_path)
    dedup = json.loads(fs_path.read_text())["actions"]
    return {"ok": True, "actions": len(dedup), "funscript": fs_path.name}


@app.post("/api/compare/{vid_id}")
async def api_compare(vid_id: str, request: Request):
    """Compare the video's exported .funscript against a human ground-truth.

    Looks for a human funscript in this priority order:
      1. explicit {human_path} in the POST body (resolved under ROOT)
      2. a sibling <video>.human.funscript sidecar
      3. a sibling og.funscript / human.funscript (common ground-truth names)
    The pipe side is the video's own <video>.funscript (re-exported first if
    the body includes edits, so the comparison reflects current review state).
    Returns the metrics dict from compare_funscripts.compare().
    """
    v = vid_by_id(vid_id)
    body = await request.json()

    # resolve the human ground-truth path
    human = None
    hp = body.get("human_path")
    if hp:
        cand = (ROOT / hp).resolve()
        # never escape ROOT
        try:
            cand.relative_to(ROOT.resolve())
            if cand.is_file():
                human = cand
        except ValueError:
            pass
    if human is None:
        for name in (v.name + ".human.funscript",
                     v.stem + ".human.funscript", "og.funscript",
                     "human.funscript"):
            cand = v.parent / name
            if cand.is_file():
                human = cand
                break
    if human is None:
        raise HTTPException(404, "no human funscript found "
                                 "(drop og.funscript or <video>.human.funscript "
                                 "next to the video, or POST human_path)")

    # re-export the pipe side if edits were sent, else use the existing file
    pipe_path = v.with_suffix(".funscript")
    if body.get("edits"):
        # reuse the export pipeline by calling it directly with the edits
        _export_to_path(v, body["edits"], pipe_path)

    if not pipe_path.exists():
        raise HTTPException(404, f"no pipeline funscript at {pipe_path.name} "
                                 "- export first (E)")
    pipe = load_funscript(str(pipe_path))
    human_acts = load_funscript(str(human))
    if len(pipe) == 0 or len(human_acts) == 0:
        raise HTTPException(422, "one of the funscripts has no actions")
    tol = int(body.get("tol", 150))
    m = compare(pipe, human_acts, tol_ms=tol, bin_s=int(body.get("bin", 30)))
    m["pipe"] = pipe_path.name
    m["human"] = human.name
    # global timing offset: the exported funscript already has edits.offset_ms
    # baked in, so best_shift here is the DELTA on top of it. Report the
    # absolute value the UI should store.
    cur = int((body.get("edits") or {}).get("offset_ms", 0) or 0)
    bs = best_shift(pipe, human_acts, tol_ms=tol)
    bs["suggested_offset_ms"] = cur + bs["shift_ms"]
    bs["current_offset_ms"] = cur
    m["best_shift"] = bs
    return m


def _export_to_path(v, edits, fs_path):
    """Shared export core used by /api/export and /api/compare."""
    sig = json.loads(sidecar(v, ".signal.json").read_text())
    fps = sig["fps"]
    if edits.get("picks"):
        dedup = _export_picks(sig, fps, edits)
    else:
        dedup = _export_legacy(sig, fps, edits)
    dedup = _apply_offset(dedup, edits.get("offset_ms", 0))
    fs = {"version": "1.0", "inverted": False, "range": 100,
          "author": "funpipe", "actions": dedup}
    fs_path.write_text(json.dumps(fs))


def _apply_offset(actions, offset_ms):
    """Shift every action by a global ms offset (one constant per video).

    CV timing is per-window accurate, but the whole export can sit at a
    constant lead/lag against how a human places points relative to the
    visual extreme. That is one number, not a per-window error, so it lives
    here rather than in the extractor. /api/compare reports the measured
    optimum (best_shift) when a ground truth exists; the UI writes it into
    edits.offset_ms.
    """
    off = int(offset_ms or 0)
    if not off or not actions:
        return actions
    out = []
    for a in actions:
        at = a["at"] + off
        if at < 0:
            at = 0
        out.append({"at": at, "pos": a["pos"]})
    out.sort(key=lambda a: a["at"])
    dedup = []
    for a in out:                      # clamping at 0 can collide
        if dedup and a["at"] <= dedup[-1]["at"]:
            continue
        dedup.append(a)
    return dedup


def _window_span(w, fps):
    n = len(w.get("final_values") or
            (w["clusters"][0]["values"] if w.get("clusters") else []))
    t0 = w["t0_ms"] / 1000.0
    return t0, t0 + n / fps



def _stretch_actions(ch, min_amp=0):
    """Amplify every stroke to full range: local maxima -> 100, local
    minima -> 0, linear rescale between consecutive extrema. Extrema whose
    local amplitude is below min_amp keep their original value (tiny
    wiggles stay tiny). Boundary points scale by the global min/max."""
    if len(ch) < 3:
        return ch
    ch = sorted(ch, key=lambda a: a["at"])
    pos = [a["pos"] for a in ch]
    ex = [0]
    for i in range(1, len(pos) - 1):
        if (pos[i] - pos[i - 1]) * (pos[i + 1] - pos[i]) < 0:
            ex.append(i)
    ex.append(len(pos) - 1)
    lo_g, hi_g = min(pos), max(pos)
    tgt = {}
    for j in range(1, len(ex) - 1):
        i = ex[j]
        amp = min(abs(pos[i] - pos[ex[j - 1]]),
                  abs(pos[i] - pos[ex[j + 1]]))
        if amp < min_amp:
            tgt[i] = float(pos[i])
            continue
        tgt[i] = 100.0 if pos[i] > pos[ex[j - 1]] else 0.0
    for i in (ex[0], ex[-1]):
        tgt[i] = (0.0 if hi_g == lo_g
                  else (pos[i] - lo_g) / (hi_g - lo_g) * 100.0)
    for j in range(len(ex) - 1):
        a_i, b_i = ex[j], ex[j + 1]
        va, vb = pos[a_i], pos[b_i]
        ta_, tb_ = tgt[a_i], tgt[b_i]
        for i in range(a_i, b_i + 1):
            if vb == va:
                ch[i]["pos"] = int(round(tb_))
            else:
                ch[i]["pos"] = int(round(
                    ta_ + (pos[i] - va) * (tb_ - ta_) / (vb - va)))
    return ch


def _export_picks(sig, fps, edits):
    """Chapter model: edits.picks = [{t, type: idle|group|auto|lasso,
    cluster?, min?, max?, invert?}], each running until the next pick.
    Group picks read the per-window cluster map the client compiled into
    edits.windows; lasso picks read edits.regions; auto uses chosen_cluster.
    Range (min/max) and invert are per-chapter. Timeline starts idle."""
    picks = sorted(edits.get("picks", []), key=lambda p: p["t"])
    if not picks or picks[0]["t"] > 0.01:
        picks = [{"t": 0.0, "type": "idle"}] + picks
    wedits = edits.get("windows", {})
    region_by_key = {f"{r['scene']}_{r['window']}": r
                     for r in edits.get("regions", [])}
    t_end = max((_window_span(w, fps)[1] for w in sig["scenes"]), default=0.0)

    actions = []
    last_pos = 50
    for i, p in enumerate(picks):
        ta = p["t"]
        tb = picks[i + 1]["t"] if i + 1 < len(picks) else t_end
        if tb <= ta:
            continue
        a_ms, b_ms = int(ta * 1000), int(tb * 1000)
        lo, hi = p.get("min", 0), p.get("max", 100)
        if p.get("type") == "idle":
            actions.append({"at": a_ms, "pos": last_pos})
            actions.append({"at": max(a_ms, b_ms - 1), "pos": last_pos})
            continue
        ch = []
        for w in sig["scenes"]:
            w_t0, w_t1 = _window_span(w, fps)
            if w_t1 <= ta or w_t0 >= tb:
                continue
            key = f"{w['scene']}_{w['window']}"
            vals = None
            if p["type"] in ("lasso", "anchor"):
                r = region_by_key.get(key)
                if r and r.get("values"):
                    vals = np.array(r["values"])
            elif p["type"] == "auto":
                ci = w.get("chosen_cluster")
                if ci is not None:
                    vals = (np.array(w["final_values"])
                            if "final_values" in w else
                            np.array(w["clusters"][ci]["values"]))
            else:                                   # group
                ci = wedits.get(key, {}).get("cluster")
                clusters = w.get("clusters", [])
                if ci is not None and ci < len(clusters):
                    vals = (np.array(w["final_values"])
                            if ci == w.get("chosen_cluster")
                            and "final_values" in w else
                            np.array(clusters[ci]["values"]))
            if vals is None:
                continue                            # lost/uncovered: silent
            if p.get("invert"):
                vals = 1.0 - vals
            ch += signal_to_actions(vals, fps, w["t0_ms"])
        if p.get("stretch"):
            ch = _stretch_actions(ch, p.get("stretch_min", 0))
        for a in ch:
            if a_ms <= a["at"] < b_ms:
                a["pos"] = int(round(lo + a["pos"] / 100 * (hi - lo)))
                actions.append(a)
        if actions:
            last_pos = actions[-1]["pos"]

    actions.sort(key=lambda a: a["at"])
    dedup = []
    for a in actions:
        if dedup and a["at"] <= dedup[-1]["at"]:
            continue
        dedup.append(a)
    return dedup


def _export_legacy(sig, fps, edits):
    wedits = edits.get("windows", {})
    actions = []
    # region segments (lasso): keyed by scene_window, override cluster signal
    # for the windows they cover. A region stores a pre-derived 0-1 signal for
    # a user-selected point set, so it bypasses the cluster lookup entirely.
    region_by_key = {}
    for r in edits.get("regions", []):
        wk = f"{r['scene']}_{r['window']}"
        region_by_key[wk] = r
    for w in sig["scenes"]:
        key = f"{w['scene']}_{w['window']}"
        we = wedits.get(key, {})
        if we.get("idle"):
            actions.append({"at": w["t0_ms"], "pos": 50})
            continue
        # a lasso region for this window wins over everything (it's a
        # user-derived signal) — checked BEFORE the idle-default guard so a
        # region-followed window exports motion even without a cluster pick.
        if key in region_by_key:
            vals = np.array(region_by_key[key]["values"])
            if we.get("invert"):
                vals = 1.0 - vals
            actions += signal_to_actions(vals, fps, w["t0_ms"])
            continue
        # IDLE-DEFAULT: a window is silent unless a follow pick covered it
        # ("cluster" in we) or the user opted into the auto pick (we.auto).
        # This is the "start with idle, follow on click" model.
        if "cluster" not in we and not we.get("auto"):
            actions.append({"at": w["t0_ms"], "pos": 50})
            continue
        ci = we.get("cluster", w.get("chosen_cluster", 0))
        clusters = w.get("clusters", [])
        if ci is None or ci >= len(clusters):
            actions.append({"at": w["t0_ms"], "pos": 50})
            continue
        if ci == w.get("chosen_cluster") and "final_values" in w:
            vals = np.array(w["final_values"])
        else:
            vals = np.array(clusters[ci]["values"])
        if we.get("invert"):
            vals = 1.0 - vals
        actions += signal_to_actions(vals, fps, w["t0_ms"])
    marks = sorted(edits.get("range_marks", []), key=lambda m: m["t"])
    if marks:
        mt = [m["t"] * 1000 for m in marks]
        for a in actions:
            mi = -1
            for i, t in enumerate(mt):
                if a["at"] >= t:
                    mi = i
                else:
                    break
            if mi >= 0:
                lo = marks[mi].get("min", 0)
                hi = marks[mi].get("max", 100)
                a["pos"] = int(round(lo + a["pos"] / 100 * (hi - lo)))
    for seg in edits.get("segments", []):
        if seg.get("idle"):
            continue
        a_ms, b_ms = seg["start_s"] * 1000, seg["end_s"] * 1000
        lo, hi = seg.get("out_min", 0), seg.get("out_max", 100)
        for a in actions:
            if a_ms <= a["at"] < b_ms:
                a["pos"] = int(round(lo + a["pos"] / 100 * (hi - lo)))
    for seg in edits.get("segments", []):
        if not seg.get("idle"):
            continue
        a_ms, b_ms = int(seg["start_s"] * 1000), int(seg["end_s"] * 1000)
        before = [a for a in actions if a["at"] < a_ms]
        hold = before[-1]["pos"] if before else 50
        actions = [a for a in actions if not (a_ms <= a["at"] < b_ms)]
        actions += [{"at": a_ms, "pos": hold}, {"at": b_ms - 1, "pos": hold}]
    actions.sort(key=lambda a: a["at"])
    dedup = []
    for a in actions:
        if dedup and a["at"] <= dedup[-1]["at"]:
            continue
        dedup.append(a)
    return dedup



@functools.lru_cache(maxsize=4)
def _npz(path_str: str):
    return np.load(path_str, allow_pickle=True)


@app.get("/api/points/{vid_id}/{scene}/{window}")
def api_points(vid_id: str, scene: int, window: int):
    """Downsampled tracked-point positions per cluster, for video overlay."""
    v = vid_by_id(vid_id)
    sig = json.loads(sidecar(v, ".signal.json").read_text())
    entry = next((w for w in sig["scenes"]
                  if w["scene"] == scene and w["window"] == window), None)
    if entry is None:
        raise HTTPException(404, "window not found")
    if not entry["clusters"] or "indices" not in entry["clusters"][0]:
        raise HTTPException(409, "signal.json predates point overlay - "
                                 "re-run track_extract extract")
    npz_path = v.parent / (v.name + ".tracks.npz")
    if not npz_path.exists():
        raise HTTPException(404, "tracks.npz missing")
    data = _npz(str(npz_path))
    meta = json.loads(str(data["meta"]))
    skey = next((s["scene"] for s in meta["scenes"]
                 if int(s["scene"]) == scene), None)
    if skey is None:
        raise HTTPException(404, "scene not in npz")
    tracks = data[f"tracks_{skey}_w{window}"]          # (T, N, 2)
    fps = sig["fps"]
    step = max(1, round(fps / 8))                      # ~8 samples/s
    out_cl = []
    for c in entry["clusters"]:
        idx = np.array(c["indices"], dtype=int)
        if len(idx) > 50:
            idx = idx[np.linspace(0, len(idx) - 1, 50).astype(int)]
        pts = tracks[::step][:, idx, :]                # (t, n, 2)
        out_cl.append({"id": c["id"], "centroid": c["centroid"],
                       "pts": np.round(pts, 1).tolist()})
    return {"t0_ms": entry["t0_ms"], "fps_s": fps / step,
            "w": sig.get("w") or meta["w"], "h": sig.get("h") or meta["h"],
            "clusters": out_cl}


@app.post("/api/region_signal/{vid_id}")
async def api_region_signal(vid_id: str, request: Request):
    """Derive a 0-1 motion signal from an arbitrary user-selected set of
    tracked points (a lasso region). Reuses the exact pipeline chain that
    extract runs on a chosen cluster: extract_signal (PCA axis + project) ->
    raw_projection -> band_analysis (sway gate) -> normalize_signal. This is
    the "draw around the hand group the clusterer lost" escape hatch.

    Body: {scene, window, indices:[int], invert?:bool}.
    Returns: {values:[0..1], dominant_hz, sway_dominated, t0_ms, n}.
    """
    v = vid_by_id(vid_id)
    body = await request.json()
    scene = int(body["scene"])
    window = int(body["window"])
    indices = np.array(body.get("indices") or [], dtype=int)
    invert = bool(body.get("invert", False))
    if len(indices) < 3:
        raise HTTPException(400, "need at least 3 point indices to derive a "
                                 "signal (lasso missed the tracked points?)")

    sig = json.loads(sidecar(v, ".signal.json").read_text())
    fps = sig["fps"]
    entry = next((w for w in sig["scenes"]
                  if w["scene"] == scene and w["window"] == window), None)
    if entry is None:
        raise HTTPException(404, "window not found")
    npz_path = v.parent / (v.name + ".tracks.npz")
    if not npz_path.exists():
        raise HTTPException(404, "tracks.npz missing")
    data = _npz(str(npz_path))
    meta = json.loads(str(data["meta"]))
    skey = next((s["scene"] for s in meta["scenes"]
                 if int(s["scene"]) == scene), None)
    if skey is None:
        raise HTTPException(404, "scene not in npz")
    # bounds-check indices against the actual point count
    tracks = data[f"tracks_{skey}_w{window}"]          # (T, N, 2)
    vis = data[f"vis_{skey}_w{window}"]                # (T, N)
    if (indices >= tracks.shape[1]).any() or (indices < 0).any():
        raise HTTPException(400, f"indices out of range "
                                 f"(0..{tracks.shape[1] - 1})")

    values, f0, sway = _derive_region_signal(tracks, vis, indices, fps, invert)
    return {"values": values,
            "dominant_hz": f0,
            "sway_dominated": sway, "t0_ms": entry["t0_ms"],
            "indices": [int(i) for i in indices],
            "n": int(len(indices))}


def _derive_region_signal(tracks, vis, indices, fps, invert):
    """Shared core: derive a 0-1 signal from a point subset using the full
    extract chain (PCA axis -> band-analysis sway-gate -> normalize). Returns
    (values_list, dominant_hz, sway) or (None, 0, False) if degenerate."""
    if len(indices) < 3:
        return None, 0.0, False
    sig_base, axis = extract_signal(tracks[:, indices].astype(np.float32),
                                    vis[:, indices], fps)
    raw = raw_projection(tracks, vis, indices, axis)
    ba = band_analysis(raw, fps)
    f0 = ba["stroke_hz"]
    sway = (ba["slow_amp"] > 2.2 * ba["stroke_amp"]
            and ba["stroke_amp"] >= 4.0 and f0 >= 1.5
            and ba["stroke_sig"] is not None)
    if sway:
        out = normalize_signal(ba["stroke_sig"], fps,
                               smooth_s=max(0.04, 0.2 / max(f0, 1.1)))
    elif f0 > 2.0:
        out = normalize_signal(raw, fps, smooth_s=max(0.04, 0.25 / f0))
    else:
        out = sig_base
    if invert:
        out = 1.0 - out
    out = np.clip(np.nan_to_num(out), 0, 1)
    return ([round(float(x), 4) for x in out],
            round(f0, 2) if f0 else None, bool(sway))


# ------------------------------------------------------------ anchor tracking
# Anchors re-track user-placed points on demand with CoTracker3, streaming
# window-by-window until the points leave the ROI or a stop is requested.
# Results cache in <video>.anchors.npz (same key scheme as the main npz) so
# re-deriving a signal for an already-tracked window is instant.

def _get_cotracker():
    """Lazy-load CoTracker3 online once, keep it resident. Thread-safe."""
    import threading
    global _COTRACKER_LOCK
    if _COTRACKER_LOCK is None:
        _COTRACKER_LOCK = threading.Lock()
    with _COTRACKER_LOCK:
        if _COTRACKER["model"] is None:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = torch.hub.load("facebookresearch/co-tracker",
                                   "cotracker3_online").to(device).eval()
            _COTRACKER["model"] = model
            _COTRACKER["device"] = device
        return _COTRACKER["model"], _COTRACKER["device"]


def _anchors_npz_path(v):
    return v.parent / (v.name + ".anchors.npz")


def _load_anchors(v):
    p = _anchors_npz_path(v)
    if not p.exists():
        return {}
    d = np.load(p, allow_pickle=True)
    return {k: d[k] for k in d.files if k != "meta"}


def _save_anchors(v, anchors):
    p = _anchors_npz_path(v)
    if anchors:
        np.savez_compressed(p, **anchors)
    elif p.exists():
        p.unlink()


def _point_distance_signal(tracks, vis, fps, invert, run_stats=None):
    """OF-style: signal = euclidean distance between the two anchor point
    groups, per frame, normalized 0-1. tracks is (T, N, 2) of the tracked
    anchor points; we assume the first half are anchor 1, second half anchor 2
    (how _track_anchors seeds them). Returns (values, hz, sway) like
    _derive_region_signal."""
    n = tracks.shape[1]
    half = n // 2
    a = tracks[:, :half].astype(np.float64)
    b = tracks[:, half:half * 2].astype(np.float64)
    a[~vis[:, :half]] = np.nan
    b[~vis[:, half:half * 2]] = np.nan
    # mean position of each anchor per frame (robust to a few lost patch pts)
    am = np.nanmean(a, axis=1)           # (T, 2)
    bm = np.nanmean(b, axis=1)           # (T, 2)
    raw = np.hypot(am[:, 0] - bm[:, 0], am[:, 1] - bm[:, 1])
    bad = np.isnan(raw)
    if bad.all():
        return None, 0.0, False
    idx = np.arange(len(raw))
    raw[bad] = np.interp(idx[bad], idx[~bad], raw[~bad])
    if run_stats is not None:
        # run-global normalization: accumulate raw distances across the whole
        # anchor run so 0-100 means the same physical depth in every window
        # (per-window min/max would recalibrate at each boundary -> jumps).
        run_stats.setdefault("raw", []).extend(raw.tolist())
        allr = np.array(run_stats["raw"])
        lo, hi = np.percentile(allr, 3), np.percentile(allr, 97)
        if hi - lo < 1e-6:
            return None, 0.0, False
        sm = max(1, int(0.12 * fps))
        k = np.ones(sm) / sm
        padded = np.pad(raw, sm, mode="edge")
        smooth = np.convolve(padded, k, mode="same")[sm:-sm]
        out = np.clip((smooth - lo) / (hi - lo), 0, 1)
    else:
        out = normalize_signal(raw, fps, smooth_s=0.12)
    if invert:
        out = 1.0 - out
    out = np.clip(np.nan_to_num(out), 0, 1)
    ba = band_analysis(raw, fps)
    return ([round(float(x), 4) for x in out],
            round(ba["stroke_hz"], 2) if ba["stroke_hz"] else None, False)


def _track_anchors(model, device, cap, start, end, w, h, queries, win_frames,
                   roi, stop_flag, lead=0):
    """Stream CoTracker over [start, end) emitting per-window (tracks, vis).
    Stops early when all anchor points leave the ROI for a full window or the
    stop_flag is set. yields (wi, tracks_TxNx2, vis_TxN)."""
    import cv2
    import torch
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    step = model.step
    window = step * 2
    buf, is_first = [], True
    pred_tracks = pred_vis = None
    processed = 0
    n_frames = end - start
    wi = 0
    prev_bound = 0
    next_bound = (win_frames - lead) if lead else win_frames

    def run(buffer, first):
        nonlocal pred_tracks, pred_vis
        chunk = (torch.from_numpy(np.stack(buffer))
                 .permute(0, 3, 1, 2)[None].float().to(device))
        with torch.no_grad():
            pred_tracks, pred_vis = model(
                video_chunk=chunk, is_first_step=first, queries=queries)

    # We need the latest pred after processing each window's worth of frames.
    # CoTracker online updates pred incrementally; slice per win_frames.
    acc_tracks = []
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
        # emit every window the model has FULLY predicted so far.
        # CoTracker online runs a chunk behind the frames we've read; gating
        # on the prediction length (not frames read) prevents emitting
        # partial windows whose tail hasn't been predicted yet.
        if pred_tracks is not None:
            avail = min(pred_tracks.shape[1], processed)
            while avail >= next_bound:
                t = pred_tracks[0].cpu().numpy().astype(np.float32)
                v = pred_vis[0].cpu().numpy().astype(bool)
                seg_t = t[prev_bound:next_bound]
                seg_v = v[prev_bound:next_bound]
                yield wi, seg_t, seg_v
                wi += 1
                prev_bound = next_bound
                next_bound += win_frames
                if _anchor_lost(seg_t, seg_v, roi):
                    return
                if stop_flag["stop"]:
                    return
    # tail
    if buf and not is_first:
        run(buf, False)
    elif buf and is_first:
        while len(buf) < window:
            buf.append(buf[-1])
        run(buf, True)
        run(buf, False)
    if pred_tracks is not None:
        full_t = pred_tracks[0].cpu().numpy()[:processed].astype(np.float32)
        full_v = pred_vis[0].cpu().numpy()[:processed].astype(bool)
        while prev_bound < full_t.shape[0]:
            seg_t = full_t[prev_bound:next_bound]
            seg_v = full_v[prev_bound:next_bound]
            prev_bound = next_bound
            next_bound += win_frames
            if seg_t.shape[0] == 0:
                break
            yield wi, seg_t, seg_v
            wi += 1
            if _anchor_lost(seg_t, seg_v, roi):
                return
            if stop_flag["stop"]:
                return


def _anchor_lost(seg_t, seg_v, roi):
    """All anchor points left the ROI (with grace: >80% invisible or out)."""
    if seg_t.shape[0] == 0:
        return True
    x, y, rw, rh = roi
    last = seg_t[-1]
    vis_last = seg_v[-1]
    pts = last[vis_last]
    if len(pts) == 0:
        return True
    inside = ((pts[:, 0] >= x) & (pts[:, 0] <= x + rw) &
              (pts[:, 1] >= y) & (pts[:, 1] <= y + rh))
    return inside.mean() < 0.2


@app.post("/api/region_follow/{vid_id}")
async def api_region_follow(vid_id: str, request: Request):
    """Follow a lasso region forward into a target window. Given a reference
    centroid (the lasso's mean point position) + radius, select the tracked
    points in the target window nearest that centroid and derive a signal.
    This is how a lasso "keeps using that group until it falls out": the
    caller walks windows forward, calling this per window; an empty/lost
    result (n < min, or no points in radius) means the group was lost.

    Body: {scene, window, ref:[x,y], radius, min_pts:8, invert?:bool}.
    Returns: {values, dominant_hz, sway_dominated, t0_ms, n, lost:bool}.
    """
    v = vid_by_id(vid_id)
    body = await request.json()
    scene = int(body["scene"])
    window = int(body["window"])
    ref = np.array(body["ref"], dtype=float)
    radius = float(body.get("radius", 90))     # px in scaled frame
    min_pts = int(body.get("min_pts", 8))
    invert = bool(body.get("invert", False))

    sig = json.loads(sidecar(v, ".signal.json").read_text())
    fps = sig["fps"]
    entry = next((w for w in sig["scenes"]
                  if w["scene"] == scene and w["window"] == window), None)
    if entry is None:
        raise HTTPException(404, "window not found")
    npz_path = v.parent / (v.name + ".tracks.npz")
    if not npz_path.exists():
        raise HTTPException(404, "tracks.npz missing")
    data = _npz(str(npz_path))
    meta = json.loads(str(data["meta"]))
    skey = next((s["scene"] for s in meta["scenes"]
                 if int(s["scene"]) == scene), None)
    if skey is None:
        raise HTTPException(404, "scene not in npz")
    tracks = data[f"tracks_{skey}_w{window}"]          # (T, N, 2)
    vis = data[f"vis_{skey}_w{window}"]                # (T, N)

    # per-point mean position over visible frames -> distance to ref centroid.
    # nanmean needs a visibility guard; points never visible get +inf distance.
    T, N, _ = tracks.shape
    with np.errstate(all="ignore"):
        mean_pos = np.nanmean(np.where(vis[..., None], tracks, np.nan), axis=0)
    dist = np.hypot(mean_pos[:, 0] - ref[0], mean_pos[:, 1] - ref[1])
    dist = np.where(np.isfinite(dist), dist, np.inf)
    near = np.where(dist < radius)[0]
    if len(near) < min_pts:
        # LOST: too few tracked points remain near the reference centroid.
        return {"values": None, "dominant_hz": None, "sway_dominated": False,
                "t0_ms": entry["t0_ms"], "n": int(len(near)), "lost": True}
    values, f0, sway = _derive_region_signal(tracks, vis, near, fps, invert)
    if values is None:
        return {"values": None, "dominant_hz": None, "sway_dominated": False,
                "t0_ms": entry["t0_ms"], "n": int(len(near)), "lost": True}
    return {"values": values, "dominant_hz": f0, "sway_dominated": sway,
            "t0_ms": entry["t0_ms"], "n": int(len(near)),
            "indices": [int(i) for i in near], "lost": False}


# stop-token registry for in-flight anchor tracks: {vid_id: {"stop": bool}}
_ANCHOR_STOP = {}


@app.post("/api/anchor_stop/{vid_id}")
def api_anchor_stop(vid_id: str):
    """Request an in-flight /api/anchor_track for this video to stop at the
    next window boundary (the user's stop shortcut)."""
    _ANCHOR_STOP.setdefault(vid_id, {})["stop"] = True
    return {"ok": True}


@app.post("/api/anchor_track/{vid_id}")
async def api_anchor_track(vid_id: str, request: Request):
    """Stream-track user-placed anchor points from a start frame until they
    leave the ROI or stop is requested. Emits one JSON result per covered
    window (chunked newline-delimited JSON) so the UI can show live progress.

    Body: { start_s, scene, queries:[[x,y] in SCALED px], roi:[x,y,w,h],
            mode: "oscillation"|"distance"|"auto", pts_per_anchor:int,
            invert?:bool }.
    Each line: {scene, window, t0_ms, values?, dominant_hz?, lost:bool, n}.
    Final line has lost:true.
    """
    v = vid_by_id(vid_id)
    body = await request.json()
    mode = body.get("mode", "oscillation")
    pts_n = int(body.get("pts_per_anchor", 5))
    invert = bool(body.get("invert", False))
    scene = int(body["scene"])
    roi = [float(c) for c in body["roi"]]

    sig = json.loads(sidecar(v, ".signal.json").read_text())
    fps = sig["fps"]
    data = _npz(str(v.parent / (v.name + ".tracks.npz")))
    meta = json.loads(str(data["meta"]))
    skey = next((s["scene"] for s in meta["scenes"]
                 if int(s["scene"]) == scene), None)
    if skey is None:
        raise HTTPException(404, "scene not in npz")
    scene_meta = next(s for s in meta["scenes"] if s["scene"] == skey)
    w, h = meta["w"], meta["h"]
    scale = meta["scale"]

    # resolve start: seed CoTracker at the EXACT clicked frame. The user's
    # anchor coords describe the object at the playhead; seeding at a later
    # window boundary (old behavior) meant tracking whatever pixels happened
    # to be there seconds later. Output stays aligned to the window grid by
    # emitting a shortened first window (front-padded downstream).
    start_s = float(body["start_s"])
    start_frame = int(start_s * fps)
    windows = scene_meta["windows"]
    if "end" in windows[0]:
        win_frames = windows[0]["end"] - windows[0]["start"]
        scene_end = windows[-1]["end"]
    else:                          # legacy npz: derive from window spacing
        win_frames = (windows[1]["start"] - windows[0]["start"]
                      if len(windows) > 1 else int(8 * fps))
        scene_end = windows[-1]["start"] + win_frames
    win0 = None
    for wd in windows:
        if wd["start"] <= start_frame < wd["start"] + win_frames:
            win0 = wd
            break
    if win0 is None:
        win0 = windows[0] if start_frame < windows[0]["start"] else windows[-1]
    start = max(win0["start"], min(start_frame, scene_end - 2))
    lead = start - win0["start"]   # frames of win0 already past the seed

    # build queries: each [x,y] anchor center -> an n x n support patch in
    # scaled px. Distance mode needs exactly 2 anchors; others 1+.
    raw_q = body["queries"]
    if mode == "distance" and len(raw_q) != 2:
        raise HTTPException(400, "distance mode needs exactly 2 anchor points")
    pts = []
    for (cx, cy) in raw_q:
        pts += make_support_grid(cx, cy, w, h, n=pts_n)
    if len(pts) < 3:
        raise HTTPException(400, "anchor patch produced too few points "
                                 "(increase pts_per_anchor?)")

    model, device = _get_cotracker()
    import cv2
    cap = cv2.VideoCapture(str(v))

    queries = (np.array([[0.0, x, y] for (x, y) in pts], dtype=np.float32))
    import torch
    queries_t = torch.tensor(queries, device=device)[None]   # (1, N, 3)

    _ANCHOR_STOP[vid_id] = {"stop": False}
    stop_flag = _ANCHOR_STOP[vid_id]
    anchors = _load_anchors(v)

    async def stream():
        try:
            covered = 0
            run_stats = {}
            step_p = max(1, round(fps / 8))
            for wi, seg_t, seg_v in _track_anchors(
                    model, device, cap, start, scene_end, w, h, queries_t,
                    win_frames, roi, stop_flag, lead=lead):
                region_window = wi + win0["i"]
                # cache raw tracks keyed by ABSOLUTE window index so
                # anchor_signal re-derives hit the right window
                anchors[f"tracks_{skey}_w{region_window}"] = seg_t
                anchors[f"vis_{skey}_w{region_window}"] = seg_v
                # grid-aligned window start; first (short) window pads front
                grid_f = win0["start"] + wi * win_frames
                t0_ms = int(grid_f / fps * 1000)
                values, hz, sway = _derive_anchor_values(
                    mode, seg_t, seg_v, fps, invert, run_stats)
                if values is not None and wi == 0 and lead > 0:
                    values = [values[0]] * lead + list(values)
                pts_t0 = grid_f + (lead if wi == 0 else 0)
                pts = np.round(seg_t[::step_p][:, :30], 1).tolist()
                if values is not None:
                    yield json.dumps({
                        "scene": scene, "window": region_window, "t0_ms": t0_ms,
                        "values": values, "dominant_hz": hz,
                        "sway_dominated": sway, "n": int(seg_t.shape[1]),
                        "pts": pts, "fps_s": fps / step_p,
                        "pts_t0_ms": int(pts_t0 / fps * 1000),
                        "lost": False}) + "\n"
                else:
                    yield json.dumps({
                        "scene": scene, "window": region_window, "t0_ms": t0_ms,
                        "n": int(seg_t.shape[1]), "lost": True}) + "\n"
                    break
                covered += 1
            # persist the cache
            _save_anchors(v, anchors)
            yield json.dumps({"scene": scene, "covered": covered,
                              "lost": True, "done": True}) + "\n"
        finally:
            cap.release()
            _ANCHOR_STOP.pop(vid_id, None)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


def _derive_anchor_values(mode, seg_t, seg_v, fps, invert,
                          run_stats=None):
    """Dispatch signal derivation for one anchor-tracked window."""
    n = seg_t.shape[1]
    if n < 3:
        return None, 0.0, False
    if mode == "distance":
        return _point_distance_signal(seg_t, seg_v, fps, invert, run_stats)
    # oscillation + auto both use the full point set through the region chain
    return _derive_region_signal(seg_t, seg_v, np.arange(n), fps, invert)


@app.post("/api/anchor_signal/{vid_id}")
async def api_anchor_signal(vid_id: str, request: Request):
    """Re-derive a signal for one already-tracked anchor window from the
    anchors.npz cache (instant; no CoTracker). Mirrors /api/region_signal.
    Body: {scene, window, mode, invert?}. Returns {values, dominant_hz, ...}."""
    v = vid_by_id(vid_id)
    body = await request.json()
    scene = int(body["scene"])
    window = int(body["window"])
    mode = body.get("mode", "oscillation")
    invert = bool(body.get("invert", False))
    sig = json.loads(sidecar(v, ".signal.json").read_text())
    fps = sig["fps"]
    data = _npz(str(v.parent / (v.name + ".tracks.npz")))
    meta = json.loads(str(data["meta"]))
    skey = next((s["scene"] for s in meta["scenes"]
                 if int(s["scene"]) == scene), None)
    if skey is None:
        skey = str(scene)
    anchors = _load_anchors(v)
    tk = f"tracks_{skey}_w{window}"
    if tk not in anchors:
        raise HTTPException(404, "anchor window not tracked yet")
    seg_t = anchors[tk]
    seg_v = anchors[f"vis_{skey}_w{window}"]
    values, hz, sway = _derive_anchor_values(mode, seg_t, seg_v, fps, invert)
    if values is None:
        raise HTTPException(422, "could not derive anchor signal "
                                 "(too few visible points)")
    return {"values": values, "dominant_hz": hz, "sway_dominated": sway,
            "n": int(seg_t.shape[1])}



@app.post("/api/window_points/{vid_id}")
async def api_window_points(vid_id: str, request: Request):
    """Downsampled positions for an arbitrary point subset of one window,
    from the main tracks.npz or the anchors.npz cache. Powers the overlay
    for lasso regions (explicit indices) and anchor runs (all points).
    Body: {scene, window, indices?:[int]|null, source:"tracks"|"anchors"}."""
    v = vid_by_id(vid_id)
    body = await request.json()
    scene = int(body["scene"])
    window = int(body["window"])
    source = body.get("source", "tracks")
    sig = json.loads(sidecar(v, ".signal.json").read_text())
    fps = sig["fps"]
    data = _npz(str(v.parent / (v.name + ".tracks.npz")))
    meta = json.loads(str(data["meta"]))
    skey = next((s["scene"] for s in meta["scenes"]
                 if int(s["scene"]) == scene), None)
    if skey is None:
        raise HTTPException(404, "scene not in npz")
    key = f"tracks_{skey}_w{window}"
    if source == "anchors":
        anchors = _load_anchors(v)
        if key not in anchors:
            raise HTTPException(404, "anchor window not tracked")
        tracks = anchors[key]
    else:
        tracks = data[key]
    idx = body.get("indices")
    idx = (np.array(idx, dtype=int) if idx
           else np.arange(tracks.shape[1]))
    idx = idx[(idx >= 0) & (idx < tracks.shape[1])]
    if len(idx) > 60:
        idx = idx[np.linspace(0, len(idx) - 1, 60).astype(int)]
    step = max(1, round(fps / 8))
    pts = tracks[::step][:, idx, :]
    return {"pts": np.round(pts, 1).tolist(), "fps_s": fps / step,
            "w": sig.get("w") or meta["w"], "h": sig.get("h") or meta["h"]}



# ------------------------------------------------------------ batch queue

import threading
import subprocess
import collections
import itertools
import time as _time

_QLOCK = threading.Lock()
_QUEUE = []                      # job dicts
_QSTATE = {"running": False, "stop_after": False}
_QID = itertools.count(1)
_HERE = Path(__file__).parent


def _qpersist():
    try:
        slim = [{k: v for k, v in j.items() if k != "log"} for j in _QUEUE]
        (ROOT / "funpipe_queue.json").write_text(json.dumps(slim, indent=1))
    except Exception:
        pass


def _plan_stages(v: Path, pose: bool):
    stages = []
    if not sidecar(v, ".scenes.json").exists():
        stages.append("scenes")
    if not sidecar(v, ".tracks.npz").exists():
        stages.append("track")
    if pose and not sidecar(v, ".pose.json").exists():
        stages.append("pose")
    if not sidecar(v, ".signal.json").exists() or stages:
        stages.append("extract")
    return stages


def _estimate_windows(v: Path):
    try:
        sc = json.loads(sidecar(v, ".scenes.json").read_text())
        fps = sc.get("fps", 30) or 30
        return max(1, sum(int(np.ceil(
            (s["end_frame"] - s["start_frame"]) / (8 * fps)))
            for s in sc["scenes"]))
    except Exception:
        return None


def _run_stage(job, cmd):
    job["log"].append("$ " + " ".join(str(c) for c in cmd))
    p = subprocess.Popen([str(c) for c in cmd], stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True,
                         encoding="utf-8", errors="replace")
    job["proc_pid"] = p.pid
    for line in p.stdout:
        line = line.rstrip()
        if not line:
            continue
        job["log"].append(line)
        if job["stage"] == "track" and " w" in line and job.get("total_windows"):
            job["windows_done"] = job.get("windows_done", 0) + (
                1 if "-> " not in line and "scene" in line else 0)
            job["progress"] = min(0.99,
                job["windows_done"] / job["total_windows"])
    p.wait()
    job.pop("proc_pid", None)
    return p.returncode == 0


def _qworker():
    while True:
        with _QLOCK:
            if _QSTATE["stop_after"]:
                _QSTATE.update(running=False, stop_after=False)
                _qpersist()
                return
            job = next((j for j in _QUEUE if j["status"] == "queued"), None)
            if job is None:
                _QSTATE["running"] = False
                _qpersist()
                return
            job["status"] = "running"
            job["started"] = _time.time()
        v = Path(job["video"])
        ok = True
        for stage in job["stages"]:
            job["stage"] = stage
            job["progress"] = None
            _qpersist()
            if stage == "scenes":
                ok = _run_stage(job, [sys.executable,
                    _HERE / "detect_scenes.py", v])
            elif stage == "track":
                job["total_windows"] = _estimate_windows(v)
                job["windows_done"] = 0
                ok = _run_stage(job, [sys.executable,
                    _HERE / "track_extract.py", "track", v, "--auto"])
            elif stage == "pose":
                ok = _run_stage(job, [sys.executable,
                    _HERE / "pose_label.py", v])
                if not ok:
                    job["log"].append("pose failed - continuing without labels")
                    ok = True
            elif stage == "extract":
                ok = _run_stage(job, [sys.executable,
                    _HERE / "track_extract.py", "extract", v])
            if not ok:
                break
        job["status"] = "done" if ok else "failed"
        job["stage"] = None
        job["progress"] = 1.0 if ok else None
        job["elapsed"] = round(_time.time() - job["started"], 1)
        _qpersist()


@app.get("/api/queue")
def api_queue():
    with _QLOCK:
        return {"running": _QSTATE["running"],
                "jobs": [{**{k: v for k, v in j.items() if k != "log"},
                          "log_tail": list(j["log"])[-6:]} for j in _QUEUE]}


@app.get("/api/queue/candidates")
def api_queue_candidates():
    queued = {j["video"] for j in _QUEUE
              if j["status"] in ("queued", "running")}
    out = []
    for p in sorted(ROOT.rglob("*")):
        if (p.suffix.lower() not in VIDEO_EXTS or ".proxy" in p.name
                or p.name.endswith(".d.ts")
                or "node_modules" in p.parts):
            continue
        stages = _plan_stages(p, pose=True)
        if stages and str(p) not in queued:
            out.append({"video": str(p), "name": p.name,
                        "stages": stages})
    return out


@app.post("/api/queue/add")
async def api_queue_add(request: Request):
    body = await request.json()
    pose = body.get("pose", True)
    added = 0
    with _QLOCK:
        for path in body.get("videos", []):
            v = Path(path)
            if not v.exists():
                continue
            stages = _plan_stages(v, pose)
            if not stages:
                continue
            _QUEUE.append({"id": next(_QID), "video": str(v),
                           "name": v.name, "stages": stages,
                           "status": "queued", "stage": None,
                           "progress": None,
                           "log": collections.deque(maxlen=60)})
            added += 1
        _qpersist()
    return {"added": added}


@app.post("/api/queue/start")
def api_queue_start():
    with _QLOCK:
        if not _QSTATE["running"]:
            _QSTATE.update(running=True, stop_after=False)
            threading.Thread(target=_qworker, daemon=True).start()
    return {"running": True}


@app.post("/api/queue/stop")
def api_queue_stop():
    with _QLOCK:
        _QSTATE["stop_after"] = True
    return {"stopping": True}


@app.post("/api/queue/remove")
async def api_queue_remove(request: Request):
    body = await request.json()
    with _QLOCK:
        _QUEUE[:] = [j for j in _QUEUE
                     if j["id"] != body.get("id")
                     or j["status"] == "running"]
        _qpersist()
    return {"ok": True}


@app.post("/api/queue/clear_done")
def api_queue_clear_done():
    with _QLOCK:
        _QUEUE[:] = [j for j in _QUEUE
                     if j["status"] in ("queued", "running")]
        _qpersist()
    return {"ok": True}



@app.get("/queue")
def queue_page():
    html = (Path(__file__).parent / "funpipe_queue.html").read_text(
        encoding="utf-8")
    return HTMLResponse(html)


@app.post("/api/upload")
async def api_upload(request: Request, name: str, pose: bool = True,
                     overwrite: bool = False):
    """Raw-body streaming upload (no multipart dep): the dropped File is the
    request body. Saves to ROOT/incoming/ and queues the pipeline for it."""
    safe = Path(name).name
    if Path(safe).suffix.lower() not in VIDEO_EXTS:
        raise HTTPException(400, f"not a video extension: {safe}")
    dest_dir = ROOT / "incoming"
    dest_dir.mkdir(exist_ok=True)
    dest = dest_dir / safe
    if dest.exists() and not overwrite:
        raise HTTPException(409, f"{safe} already exists in incoming/ "
                                 f"(retry with overwrite)")
    tmp = dest.with_suffix(dest.suffix + ".part")
    written = 0
    try:
        with open(tmp, "wb") as f:
            async for chunk in request.stream():
                f.write(chunk)
                written += len(chunk)
        if written == 0:
            tmp.unlink(missing_ok=True)
            raise HTTPException(400, "empty upload")
        tmp.replace(dest)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    stages = _plan_stages(dest, pose)
    with _QLOCK:
        _QUEUE.append({"id": next(_QID), "video": str(dest),
                       "name": dest.name, "stages": stages,
                       "status": "queued", "stage": None, "progress": None,
                       "log": collections.deque(maxlen=60)})
        _qpersist()
    return {"ok": True, "saved": str(dest), "bytes": written,
            "stages": stages}


# ------------------------------------------------------- video streaming

CHUNK = 1024 * 1024


@app.get("/api/video/{vid_id}")
def api_video(vid_id: str, request: Request):
    v = vid_by_id(vid_id)
    proxy = v.parent / (v.stem + ".proxy.mp4")
    path = proxy if proxy.exists() else v
    size = path.stat().st_size
    range_h = request.headers.get("range")

    def stream(start, end):
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                data = f.read(min(CHUNK, left))
                if not data:
                    break
                left -= len(data)
                yield data

    if range_h:
        m = re.match(r"bytes=(\d+)-(\d*)", range_h)
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        return StreamingResponse(
            stream(start, end), status_code=206,
            headers={
                "Content-Range": f"bytes {start}-{end}/{size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(end - start + 1),
                "Content-Type": "video/mp4",
            })
    return StreamingResponse(stream(0, size - 1), headers={
        "Accept-Ranges": "bytes",
        "Content-Length": str(size),
        "Content-Type": "video/mp4",
    })


@app.get("/")
def index():
    html = (Path(__file__).parent / "funpipe_ui.html").read_text(
        encoding="utf-8")
    return HTMLResponse(html)


def main():
    global ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8420)
    args = ap.parse_args()
    if not args.folder.is_dir():
        sys.exit(f"not a folder: {args.folder}")
    # resolve BEFORE chdir: ROOT is used with rglob for the rest of the
    # process, so a relative folder would re-resolve against the new cwd
    # ("test4" -> "test4/test4") and find zero videos.
    ROOT = args.folder.resolve()
    os.chdir(ROOT)
    # ACM change: scan in the background and bind the port immediately. The old
    # code scanned before serving (and rescanned the whole tree just to build a
    # warning message), which meant a large library on a share never came up.
    print(f"funpipe UI on http://{args.host}:{args.port}  "
          f"(folder: {args.folder})", flush=True)
    print("scanning for processed videos in the background...", flush=True)
    warm_videos_async()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
