"""
Funscript generation pipeline — runs the funpipe stages in-process.

Ported from the standalone funpipe server so all local GPU work lives in one
app. The pipeline modules themselves are copied verbatim into ./funpipe/ and
called as functions (not subprocesses) so they share this server's GPU lock:
funscript tracking and DINOv2 inference must never fight over VRAM on a 12 GB
card.

This app is a worker of ACM (2026-10-28): the queue is ACM's, and this app claims a job, downloads the video into its own
storage, runs the stages there and uploads the files (see the worker section below). It never reads or writes the library.

Stages, each writing a sidecar next to (this app's copy of) the video, uploaded to ACM next to the real one:
    scenes  -> <video>.scenes.json    (CPU only, no GPU lock taken)
    track   -> <video>.tracks.npz     (CoTracker3, GPU)
    pose    -> <video>.pose.json      (YOLO pose, GPU, optional)
    extract -> <video>.signal.json + <video>.funscript   (CPU)

Endpoints (registered at /funpipe):
    GET  /funpipe/health             the worker (paired with ACM? claiming? the job it runs) and the GPU
    GET  /funpipe/gpu
    GET  /funpipe/ui/status, POST /funpipe/ui/start {root?}, POST /funpipe/ui/stop   the review editor
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time
import threading
import collections
import contextlib
from pathlib import Path

from flask import Blueprint, request, jsonify

import acm_client

funpipe_bp = Blueprint('funpipe', __name__)

HERE = Path(__file__).parent
PIPELINE_DIR = HERE / 'funpipe'
sys.path.insert(0, str(PIPELINE_DIR))

QUEUE_FILE = HERE / 'funpipe_queue.json'   # the old queue of this app's own: moved to ACM once (_migrate_old_queue)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] [Funpipe] {msg}", flush=True)


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
    _start_claiming()
    st = gpu_status()
    vram = f" ({st['free_mb']}/{st['total_mb']} MB VRAM free)" if st else ''
    log(f"pipeline ready: claiming jobs from the app's queue{vram}")


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
        self.prefer = None        # --prefer <body part> (d88be7f): none here, as on the CLI by default
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
        if self.job.get('cancel'):   # cancelled in ACM: every stage prints, so this stops it at its next line
            raise _Cancelled('cancelled in the app')
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


# ── the worker: claims jobs from ACM's queue ─────────────────────────────────
# The queue is ACM's (backend/services/funpipeQueue.js, 2026-10-28). This app claims the next job, downloads the video
# into its own storage (data/cache/funpipe/<job>), fetches the sidecars ACM already has (so an interrupted job resumes),
# runs the stages there, uploads each stage's files as soon as it is done, and deletes its copy. It never reads or
# writes the library. Start / Stop is ACM's: a stopped queue answers the claim with nothing.
CLAIM_EVERY = 10            # seconds between claims while the queue is empty
REPORT_EVERY = 5            # seconds between progress reports while a job runs
STAGE_FILES = {'scenes': ['.scenes.json'], 'track': ['.tracks.npz'], 'pose': ['.pose.json'],
               'extract': ['.signal.json', '.funscript']}
_W = {'running': False, 'job': None, 'error': None, 'claimed': 0}


class _Cancelled(Exception):
    """ACM cancelled the running job (removed in the Jobs page): raised from the job's log, which every stage prints to"""


def _local_file(video: Path, ext: str) -> Path:
    return script_path(video) if ext == '.funscript' else sidecar(video, ext)


def _report(job, final=False):
    """send the job's state and its new log lines; ACM answers cancel when the job was removed"""
    lines = list(job['log'])
    new = lines[job['sent']:] if job['sent'] <= len(lines) else lines
    job['sent'] = len(lines)
    try:
        r = acm_client.worker('POST', f"funpipe/jobs/{job['id']}/progress", timeout=30, json={
            'stage': job.get('stage'), 'phase': job.get('phase'), 'progress': job.get('progress'),
            'windows_done': job.get('windows_done'), 'total_windows': job.get('total_windows'),
            'gpu_warning': job.get('gpu_warning'), 'log': new})
        if r.ok and r.json().get('action') == 'cancel' and not final:
            job['cancel'] = True
    except Exception as e:   # ACM unreachable for a moment: the job goes on, the next report catches up
        log(f"progress report failed: {e}")


def _reporter(job, done):
    while not done.wait(REPORT_EVERY):
        _report(job)


def _upload(job, video_src, local, exts):
    for ext in exts:
        f = _local_file(local, ext)
        if f.exists():
            acm_client.put_sidecar(video_src, ext, f)
            job['log'].append(f"uploaded {f.name}")


def _run_claimed(c):
    """one claimed job, start to end: download, stages (each uploaded when done), complete or fail"""
    work = acm_client.CACHE / 'funpipe' / str(c['id'])
    local = work / c['name']
    job = {'id': c['id'], 'name': c['name'], 'video': c['video'], 'stages': c['stages'], 'stage': None,
           'phase': 'downloading', 'progress': 0.0, 'log': collections.deque(maxlen=200), 'sent': 0, 'cancel': False,
           'started': time.time()}
    _W['job'] = job
    done = threading.Event()
    threading.Thread(target=_reporter, args=(job, done), daemon=True, name='funpipe-report').start()
    ok, error = False, None
    try:
        size = c.get('size') or 0

        def got(have, total):
            job['progress'] = min(0.99, have / (total or size or 1))
            if job['cancel']:
                raise _Cancelled('cancelled in the app')
        acm_client.worker_download(c['video'], local, progress=got)
        for ext in c.get('sidecars', []):
            acm_client.get_sidecar(c['video'], ext, _local_file(local, ext))
        job['log'].append(f"downloaded {c['name']} ({local.stat().st_size / 1e6:.0f} MB) and {len(c.get('sidecars', []))} sidecar(s)")
        job['phase'] = 'running'
        ok = True
        for stage in c['stages']:
            if job['cancel']:
                raise _Cancelled('cancelled in the app')
            ok = _run_stage(job, stage, local)
            if ok:
                job['phase'] = 'uploading'
                _upload(job, c['video'], local, STAGE_FILES[stage])
                job['phase'] = 'running'
            elif stage == 'pose':   # pose is optional enrichment: losing labels shouldn't kill the job
                job['log'].append('pose failed - continuing without labels')
                ok = True
            else:
                break
        if job['cancel']:
            raise _Cancelled('cancelled in the app')
        if not ok:
            error = next((line for line in reversed(job['log']) if 'failed' in line), 'a stage failed')
    except _Cancelled:
        ok, error = False, 'cancelled'
        job['log'].append('cancelled in the app')
    except Exception as e:
        ok, error = False, f"{type(e).__name__}: {e}"
        job['log'].append(error)
    finally:
        done.set()
        job['stage'], job['phase'] = None, None
        _report(job, final=True)
        try:
            if ok:
                acm_client.worker('POST', f"funpipe/jobs/{c['id']}/complete", timeout=30)
            else:
                acm_client.worker('POST', f"funpipe/jobs/{c['id']}/fail", json={'error': error}, timeout=30)
        except Exception as e:
            log(f"could not tell the app how {c['name']} ended: {e} (it puts the job back after 10 minutes)")
        shutil.rmtree(work, ignore_errors=True)
        _W['job'] = None
    log(f"{c['name']} {'done' if ok else 'failed: ' + str(error)} in {time.time() - job['started']:.0f}s")


def _migrate_old_queue():
    """jobs still queued in this app's own old queue file (before the queue moved to ACM) are queued in ACM once"""
    if not QUEUE_FILE.exists():
        return
    try:
        old = [j.get('src') or j.get('video') for j in json.loads(QUEUE_FILE.read_text())
               if j.get('status') in ('queued', 'running')]
        if old:
            acm_client.api('POST', '/api/funpipe/queue/add', json={'videos': old, 'autoStart': False})
            log(f"moved {len(old)} queued job(s) to the app's queue")
        QUEUE_FILE.rename(QUEUE_FILE.with_suffix('.json.moved'))
    except acm_client.NotLinked:
        pass
    except Exception as e:
        log(f"could not move the old queue to the app: {e}")


def _claim_loop():
    _W['running'] = True
    info = {'app': 'AI-Inference-App', 'host': acm_client.WORKER_NAME}
    while True:
        try:
            _migrate_old_queue()
            r = acm_client.worker('POST', 'funpipe/claim', json={'info': info}, timeout=30)
            if r.status_code == 200:
                _W['claimed'] += 1
                _W['error'] = None
                _run_claimed(r.json())
                continue
            _W['error'] = None if r.status_code == 204 else f"claim: HTTP {r.status_code} {r.text[:200]}"
        except acm_client.NotLinked as e:
            _W['error'] = str(e)
        except Exception as e:   # the app is restarting or the NAS is off
            _W['error'] = f"{type(e).__name__}: {e}"
        time.sleep(CLAIM_EVERY)


def _start_claiming():
    threading.Thread(target=_claim_loop, daemon=True, name='funpipe-worker').start()


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


# ── endpoints ─────────────────────────────────────────────────────────────────
@funpipe_bp.route('/health', methods=['GET'])
def health():
    import torch
    job = _W['job']
    return jsonify({
        'ok': True,
        # the worker: claiming from ACM's queue (linked: it knows where ACM is and has the worker token)
        'worker': {'claiming': _W['running'], 'linked': acm_client.linked(), 'error': _W['error'], 'claimed': _W['claimed'],
                   'job': {'id': job['id'], 'name': job['name'], 'stage': job['stage'], 'phase': job['phase']} if job else None},
        'cuda': torch.cuda.is_available(),
        'pipeline_dir': str(PIPELINE_DIR),
        'gpu': gpu_status(),
        'gpu_warning': gpu_warning(),
        'review_ui': {'running': _ui_alive() and _ui_listening(), 'port': _UI['port'],
                      'url': (f"http://localhost:{_UI['port']}"
                              if _ui_alive() and _ui_listening() else None)},
    })


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
    # The editor works on copies (2026-10-28): it lists the videos with a signal from ACM, pulls a video and its sidecars
    # into this app's storage (data/cache/editor) when it is opened, and uploads .edits.json and the .funscript when they
    # are saved. root (a library folder, optional) narrows its list.
    data = request.get_json(silent=True) or {}
    root = data.get('root') or None
    port = int(data.get('port') or _UI['port'])
    try:
        acm_client.server()
    except acm_client.NotLinked as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    work = acm_client.CACHE / 'editor'
    work.mkdir(parents=True, exist_ok=True)

    with _UI_LOCK:
        if _ui_alive():
            return jsonify({'ok': True, 'running': True, 'already': True,
                            'url': f"http://localhost:{_UI['port']}", 'root': _UI['root']})
        cmd = [sys.executable, str(PIPELINE_DIR / 'funpipe_ui.py'), str(work), '--acm',
               '--host', '0.0.0.0', '--port', str(port)] + (['--acm-root', root] if root else [])
        try:
            # Keep the output: when the editor dies on startup this file is the
            # only evidence, and it takes ~20s to boot (torch import) so "not
            # listening yet" and "crashed" look identical without it.
            _UI['log'] = HERE / 'funpipe_ui.log'
            _UI['proc'] = subprocess.Popen(
                cmd, cwd=str(PIPELINE_DIR),
                env={**os.environ, 'PYTHONPATH': os.pathsep.join(filter(None, [str(HERE), os.environ.get('PYTHONPATH')]))},
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
