"""
Funscript generation pipeline — runs the funpipe stages in-process.

Ported from the standalone funpipe server so all local GPU work lives in one
app. The pipeline modules themselves are copied verbatim into ./funpipe/ and
called as functions (not subprocesses) so they share this server's GPU lock:
funscript tracking and DINOv2 inference must never fight over VRAM on a 12 GB
card.

Stages, each writing a sidecar next to the video:
    scenes  -> <video>.scenes.json    (CPU only, no GPU lock taken)
    track   -> <video>.tracks.npz     (CoTracker3, GPU)
    pose    -> <video>.pose.json      (YOLO pose, GPU, optional)
    extract -> <video>.signal.json + <video>.funscript   (CPU)

Endpoints (registered at /funpipe):
    GET  /funpipe/health
    GET  /funpipe/queue
    POST /funpipe/queue/add          {videos:[paths], pose=true}
    POST /funpipe/queue/start
    POST /funpipe/queue/stop
    POST /funpipe/queue/remove       {id}
    POST /funpipe/queue/clear_done
"""
import io
import json
import os
import subprocess
import sys
import time
import threading
import itertools
import collections
import contextlib
from pathlib import Path

from flask import Blueprint, request, jsonify

funpipe_bp = Blueprint('funpipe', __name__)

HERE = Path(__file__).parent
PIPELINE_DIR = HERE / 'funpipe'
sys.path.insert(0, str(PIPELINE_DIR))

VIDEO_EXTS = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.ts'}
QUEUE_FILE = HERE / 'funpipe_queue.json'


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] [Funpipe] {msg}", flush=True)


# ── Path Mapping ──────────────────────────────────────────────────────────────
# Same convention as video_analyzer.py — ACM sends its own container paths.
def map_path(p):
    if not p:
        return p
    if str(p).startswith('/media'):
        return 'Z:\\Apps\\adultManager' + str(p)
    return str(p)


# ── GPU contention ────────────────────────────────────────────────────────────
# Deliberately NOT a lock. Blocking on the server's MODEL_LOCK would mean a long
# tracking run stalls image inference for tens of minutes, so instead we look at
# what else is on the card and warn — the user decides whether to let it ride.
# Tracking wants a few GB of headroom; below this we say so.
_VRAM_WARN_FREE_MB = 4000
# On Windows (WDDM) NVML reports 0 MB for nearly every process — every desktop app
# that touches the GPU shows up. Only name processes actually holding real memory,
# otherwise the warning is 25 lines of explorer.exe and Discord.
_PROC_NOTABLE_MB = 400


def gpu_status():
    """
    Who else is using the GPU right now. Returns None if it can't be determined
    (no NVML, no CUDA) — callers treat that as 'no warning available', not an error.
    """
    try:
        import pynvml
    except ImportError:
        try:
            import nvidia_ml_py as pynvml       # ships with ultralytics
        except ImportError:
            return None
    try:
        pynvml.nvmlInit()
        h = pynvml.nvmlDeviceGetHandleByIndex(0)
        mem = pynvml.nvmlDeviceGetMemoryInfo(h)
        me = os.getpid()
        others = []
        for p in pynvml.nvmlDeviceGetComputeRunningProcesses(h):
            if p.pid == me:
                continue
            try:
                name = pynvml.nvmlSystemGetProcessName(p.pid)
                name = name.decode() if isinstance(name, bytes) else name
                name = Path(name).name
            except Exception:
                name = f'pid {p.pid}'
            used = getattr(p, 'usedGpuMemory', None) or 0
            others.append({'pid': p.pid, 'name': name, 'mb': round(used / 1e6)})
        notable = [o for o in others if o['mb'] >= _PROC_NOTABLE_MB]
        return {
            'total_mb': round(mem.total / 1e6),
            'used_mb': round(mem.used / 1e6),
            'free_mb': round(mem.free / 1e6),
            'proc_count': len(others),
            # Only processes holding real memory. See _PROC_NOTABLE_MB — the raw
            # list is mostly desktop apps NVML can't measure on Windows.
            'others': sorted(notable, key=lambda o: -o['mb']),
            'other_mb': sum(o['mb'] for o in notable),
        }
    except Exception:
        return None
    finally:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass


def gpu_warning():
    """A human-readable contention warning, or None when the card looks clear."""
    st = gpu_status()
    if not st:
        return None
    warns = []
    if st['others']:
        who = ', '.join(f"{o['name']} ({o['mb']} MB)" for o in st['others'])
        warns.append(f"other GPU process(es): {who}")
    if st['free_mb'] < _VRAM_WARN_FREE_MB:
        warns.append(f"only {st['free_mb']} MB of {st['total_mb']} MB VRAM free — "
                     f"tracking may run out of memory")
    # Our own server holding a model counts too: same process, so NVML won't list it.
    if _model_loaded_probe and _model_loaded_probe():
        warns.append('an inference model is loaded in this server — '
                     'generation will share VRAM with it')
    return '; '.join(warns) if warns else None


# Optional callback from server.py so we can also warn about in-process models,
# which NVML cannot distinguish (same PID).
_model_loaded_probe = None


def init_funpipe(model_loaded_probe=None):
    """Called by server.py at startup."""
    global _model_loaded_probe
    _model_loaded_probe = model_loaded_probe
    _load_queue()
    st = gpu_status()
    vram = f", {st['free_mb']}/{st['total_mb']} MB VRAM free" if st else ''
    log(f"pipeline ready ({len(_QUEUE)} job(s) restored{vram})")


# ── args shim ─────────────────────────────────────────────────────────────────
class _Args:
    """
    Stand-in for the argparse namespace the pipeline functions expect.
    Defaults mirror funpipe's CLI, which its docs call final: 768px / 20x12 grid.
    """
    def __init__(self, **kw):
        self.threshold = 3.0
        self.min_scene = 1.0
        self.thumbs = False
        self.force = False
        # track
        self.max_side = 768
        self.auto = True          # seedless dense grid; no manual seeding here
        self.window = 8.0
        self.grid = '20x12'
        # extract
        self.invert = False
        self.min_interval = 120
        self.prominence = 0.10
        self.group = None
        self.idle_threshold = 0.08
        # pose
        self.samples = 3
        self.batch = 16
        self.conf = 0.25
        # *.pt is gitignored, so a fresh clone has no local copy. Fall back to the
        # bare name and let ultralytics fetch it into its own cache.
        _pose = PIPELINE_DIR / 'yolo11n-pose.pt'
        self.model = str(_pose) if _pose.exists() else 'yolo11n-pose.pt'
        self.__dict__.update(kw)


def sidecar(video: Path, ext: str) -> Path:
    """funpipe convention: intermediates are <video.ext>.<name>."""
    return video.with_suffix(video.suffix + ext)


def script_path(video: Path) -> Path:
    """The playable funscript is stem-based so players find it."""
    return video.with_suffix('.funscript')


def plan_stages(video: Path, pose: bool = True):
    """Only the stages whose sidecars are missing — resume is free."""
    stages = []
    if not sidecar(video, '.scenes.json').exists():
        stages.append('scenes')
    if not sidecar(video, '.tracks.npz').exists():
        stages.append('track')
    if pose and not sidecar(video, '.pose.json').exists():
        stages.append('pose')
    if not sidecar(video, '.signal.json').exists() or stages:
        stages.append('extract')
    return stages


# ── log capture ───────────────────────────────────────────────────────────────
class _JobLog(io.TextIOBase):
    """
    Tees a stage's stdout into the job's ring buffer AND the server console,
    so progress is visible in both the tray terminal and ACM's queue UI.

    `console` must be the REAL stdout captured before redirect_stdout swaps it —
    writing via print() here would route back into this same object and recurse.
    """
    def __init__(self, job, console):
        self.job = job
        self.console = console
        self._partial = ''

    def write(self, s):
        self._partial += s
        while '\n' in self._partial:
            line, self._partial = self._partial.split('\n', 1)
            line = line.rstrip()
            if line:
                self.job['log'].append(line)
                _note_progress(self.job, line)
                try:
                    self.console.write(f"  | {line}\n")
                    self.console.flush()
                except Exception:
                    pass
        return len(s)

    def flush(self):
        pass


def _note_progress(job, line):
    """track prints one line per window; use it to drive a progress bar."""
    if job.get('stage') == 'track' and job.get('total_windows'):
        if 'scene' in line and '-> ' not in line:
            job['windows_done'] = job.get('windows_done', 0) + 1
            job['progress'] = min(0.99, job['windows_done'] / job['total_windows'])


def _estimate_windows(video: Path):
    try:
        import numpy as np
        sc = json.loads(sidecar(video, '.scenes.json').read_text())
        fps = sc.get('fps', 30) or 30
        return max(1, sum(int(np.ceil((s['end_frame'] - s['start_frame']) / (8 * fps)))
                          for s in sc['scenes']))
    except Exception:
        return None


# ── queue state ───────────────────────────────────────────────────────────────
_QLOCK = threading.Lock()
_QUEUE = []
_QSTATE = {'running': False, 'stop_after': False}
_QID = itertools.count(1)


def _persist():
    try:
        slim = [{k: v for k, v in j.items() if k != 'log'} for j in _QUEUE]
        QUEUE_FILE.write_text(json.dumps(slim, indent=1))
    except Exception as e:
        log(f"could not persist queue: {e}")


def _load_queue():
    """Restore jobs across restarts. Anything mid-flight is re-queued."""
    if not QUEUE_FILE.exists():
        return
    try:
        for j in json.loads(QUEUE_FILE.read_text()):
            j['log'] = collections.deque(maxlen=60)
            if j.get('status') == 'running':
                j['status'] = 'queued'   # it died with the process
                j['stage'] = None
            _QUEUE.append(j)
        if _QUEUE:
            next(itertools.islice(_QID, max(j['id'] for j in _QUEUE), None), None)
    except Exception as e:
        log(f"could not restore queue: {e}")


# ── stage runners (in-process) ────────────────────────────────────────────────
def _run_scenes(video, job):
    import detect_scenes
    return detect_scenes.process_one(video, _Args())


def _run_track(video, job):
    import track_extract
    job['total_windows'] = _estimate_windows(video)
    job['windows_done'] = 0
    track_extract.cmd_track(video, _Args())
    return True


def _run_pose(video, job):
    import pose_label
    from ultralytics import YOLO
    args = _Args()
    model = YOLO(args.model)
    pose_label.run_video(video, model, args)
    return True


def _run_extract(video, job):
    import track_extract
    track_extract.cmd_extract(video, _Args())
    return True


# Which stages actually touch the GPU — used only to decide whether a contention
# warning is worth emitting. `scenes` and `extract` are CPU work.
_STAGES = {
    'scenes':  (_run_scenes,  False),
    'track':   (_run_track,   True),
    'pose':    (_run_pose,    True),
    'extract': (_run_extract, False),
}


def _run_stage(job, stage, video):
    fn, uses_gpu = _STAGES[stage]
    job['stage'] = stage
    job['progress'] = None

    # Warn, don't block: a tracking run can take half an hour and stalling image
    # inference behind it is worse than sharing the card.
    if uses_gpu:
        warning = gpu_warning()
        job['gpu_warning'] = warning
        if warning:
            job['log'].append(f"WARNING: {warning}")
            log(f"{job['name']} {stage}: {warning}")
    _persist()
    log(f"{job['name']} -> {stage}")

    sink = _JobLog(job, sys.stdout)
    try:
        with contextlib.redirect_stdout(sink):
            fn(video, job)
        return True
    except Exception as e:
        import traceback
        job['log'].append(f"{stage} failed: {type(e).__name__}: {e}")
        for line in traceback.format_exc().splitlines()[-6:]:
            job['log'].append(line)
        log(f"{job['name']} {stage} FAILED: {e}")
        return False


def _worker():
    while True:
        with _QLOCK:
            if _QSTATE['stop_after']:
                _QSTATE.update(running=False, stop_after=False)
                _persist()
                return
            job = next((j for j in _QUEUE if j['status'] == 'queued'), None)
            if job is None:
                _QSTATE['running'] = False
                _persist()
                return
            job['status'] = 'running'
            job['started'] = time.time()

        video = Path(job['video'])
        ok = video.exists()
        if not ok:
            job['log'].append(f"video not found: {video}")

        for stage in (job['stages'] if ok else []):
            ok = _run_stage(job, stage, video)
            if not ok:
                # Pose is optional enrichment — losing labels shouldn't kill the job.
                if stage == 'pose':
                    job['log'].append('pose failed - continuing without labels')
                    ok = True
                    continue
                break

        job['status'] = 'done' if ok else 'failed'
        job['stage'] = None
        job['progress'] = 1.0 if ok else None
        job['elapsed'] = round(time.time() - job['started'], 1)
        log(f"{job['name']} {job['status']} in {job['elapsed']}s")
        _persist()


def _start_worker_locked():
    if not _QSTATE['running']:
        _QSTATE.update(running=True, stop_after=False)
        threading.Thread(target=_worker, daemon=True, name='funpipe-worker').start()


# ── endpoints ─────────────────────────────────────────────────────────────────
@funpipe_bp.route('/health', methods=['GET'])
def health():
    import torch
    return jsonify({
        'ok': True,
        'running': _QSTATE['running'],
        'jobs': len(_QUEUE),
        'cuda': torch.cuda.is_available(),
        'pipeline_dir': str(PIPELINE_DIR),
        'gpu': gpu_status(),
        'gpu_warning': gpu_warning(),
        'review_ui': {'running': _ui_alive() and _ui_listening(), 'port': _UI['port'],
                      'url': (f"http://localhost:{_UI['port']}"
                              if _ui_alive() and _ui_listening() else None)},
    })


@funpipe_bp.route('/queue', methods=['GET'])
def queue():
    with _QLOCK:
        return jsonify({
            'ok': True,
            'running': _QSTATE['running'],
            'jobs': [{**{k: v for k, v in j.items() if k != 'log'},
                      'log_tail': list(j['log'])[-6:]} for j in _QUEUE]
        })


@funpipe_bp.route('/queue/add', methods=['POST'])
def queue_add():
    data = request.get_json(force=True) or {}
    pose = data.get('pose', True)
    auto_start = data.get('autoStart', True)

    added, skipped = 0, []
    with _QLOCK:
        queued = {j['video'] for j in _QUEUE if j['status'] in ('queued', 'running')}
        for raw in data.get('videos', []):
            video = Path(map_path(raw))
            if not video.exists():
                skipped.append({'video': raw, 'reason': 'not found on this machine'})
                continue
            if str(video) in queued:
                skipped.append({'video': raw, 'reason': 'already queued'})
                continue
            stages = plan_stages(video, pose)
            if not stages:
                skipped.append({'video': raw, 'reason': 'already processed'})
                continue
            _QUEUE.append({
                # `src` is the caller's own path, echoed back untouched so ACM can
                # join jobs to its library rows without reversing map_path().
                'id': next(_QID), 'video': str(video), 'src': str(raw),
                'name': video.name,
                'stages': stages, 'status': 'queued', 'stage': None,
                'progress': None, 'log': collections.deque(maxlen=60)
            })
            added += 1
        if added and auto_start:
            _start_worker_locked()
        _persist()

    log(f"queued {added} video(s)" + (f", skipped {len(skipped)}" if skipped else ''))
    return jsonify({'added': added, 'skipped': skipped, 'running': _QSTATE['running']})


@funpipe_bp.route('/queue/start', methods=['POST'])
def queue_start():
    with _QLOCK:
        _start_worker_locked()
    return jsonify({'ok': True, 'running': True})


@funpipe_bp.route('/queue/stop', methods=['POST'])
def queue_stop():
    with _QLOCK:
        _QSTATE['stop_after'] = True
    return jsonify({'ok': True, 'stopping': True})


@funpipe_bp.route('/queue/remove', methods=['POST'])
def queue_remove():
    data = request.get_json(force=True) or {}
    with _QLOCK:
        _QUEUE[:] = [j for j in _QUEUE
                     if j['id'] != data.get('id') or j['status'] == 'running']
        _persist()
    return jsonify({'ok': True})


@funpipe_bp.route('/queue/clear_done', methods=['POST'])
def queue_clear_done():
    with _QLOCK:
        _QUEUE[:] = [j for j in _QUEUE if j['status'] in ('queued', 'running')]
        _persist()
    return jsonify({'ok': True})


@funpipe_bp.route('/gpu', methods=['GET'])
def gpu():
    return jsonify({'ok': True, 'status': gpu_status(), 'warning': gpu_warning()})


# ── review UI (funpipe_ui.py) ─────────────────────────────────────────────────
# The review editor is FastAPI/uvicorn, not Flask, so it can't be a blueprint.
# It runs as a child process on THIS venv — same interpreter, same deps — and is
# only spun up when someone actually wants to review something.
_UI = {'proc': None, 'port': 8420, 'root': None, 'log': None}
_UI_LOCK = threading.Lock()


def _ui_alive():
    p = _UI['proc']
    return p is not None and p.poll() is None


def _ui_listening(port=None, timeout=0.4):
    """
    Process-alive is not the same as ready: the editor imports torch on the way
    up, which takes ~20s. Callers need to know which state they're in.
    """
    import socket
    try:
        with socket.create_connection(('127.0.0.1', port or _UI['port']), timeout):
            return True
    except OSError:
        return False


def _ui_log_tail(n=12):
    try:
        p = _UI.get('log')
        if p and Path(p).exists():
            return Path(p).read_text(encoding='utf-8', errors='replace').splitlines()[-n:]
    except Exception:
        pass
    return []


@funpipe_bp.route('/ui/status', methods=['GET'])
def ui_status():
    with _UI_LOCK:
        alive = _ui_alive()
        ready = alive and _ui_listening()
        exit_code = None if alive or _UI['proc'] is None else _UI['proc'].poll()
        out = {
            'ok': True,
            # `running` means usable — the UI should only link to it when ready.
            'running': ready,
            'starting': alive and not ready,
            'port': _UI['port'],
            'root': _UI['root'],
            'url': f"http://localhost:{_UI['port']}" if ready else None,
            'exit_code': exit_code,
        }
        if exit_code is not None:
            out['error'] = f'editor exited with code {exit_code}'
            out['log_tail'] = _ui_log_tail()
        return jsonify(out)


@funpipe_bp.route('/ui/start', methods=['POST'])
def ui_start():
    data = request.get_json(silent=True) or {}
    root = map_path(data.get('root') or '')
    port = int(data.get('port') or _UI['port'])

    if not root:
        return jsonify({'ok': False, 'error': 'root is required '
                                              '(the folder the editor should scan)'}), 400
    if not Path(root).is_dir():
        return jsonify({'ok': False, 'error': f'not a folder on this machine: {root}'}), 400

    with _UI_LOCK:
        if _ui_alive():
            return jsonify({'ok': True, 'running': True, 'already': True,
                            'url': f"http://localhost:{_UI['port']}", 'root': _UI['root']})
        cmd = [sys.executable, str(PIPELINE_DIR / 'funpipe_ui.py'), root,
               '--host', '0.0.0.0', '--port', str(port)]
        try:
            # Keep the output: when the editor dies on startup this file is the
            # only evidence, and it takes ~20s to boot (torch import) so "not
            # listening yet" and "crashed" look identical without it.
            _UI['log'] = HERE / 'funpipe_ui.log'
            _UI['proc'] = subprocess.Popen(
                cmd, cwd=str(PIPELINE_DIR),
                stdout=open(_UI['log'], 'w', encoding='utf-8', errors='replace'),
                stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except Exception as e:
            return jsonify({'ok': False, 'error': f'could not launch editor: {e}'}), 500
        _UI['port'], _UI['root'] = port, root

    log(f"review editor starting on :{port} over {root} (log: {_UI['log'].name})")
    return jsonify({'ok': True, 'running': True, 'starting': True,
                    'url': f'http://localhost:{port}', 'root': root})


@funpipe_bp.route('/ui/stop', methods=['POST'])
def ui_stop():
    with _UI_LOCK:
        if _ui_alive():
            _UI['proc'].terminate()
            try:
                _UI['proc'].wait(timeout=10)
            except Exception:
                _UI['proc'].kill()
            log('review editor stopped')
        _UI['proc'] = None
    return jsonify({'ok': True, 'running': False})
