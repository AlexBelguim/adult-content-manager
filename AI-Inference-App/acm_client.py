"""The AI app's way to the Adult Content Manager (ACM): everything it reads or writes of the library goes over ACM's HTTP API,
never through a mapped drive, so it works on any machine that can reach the app (2026-10-28).

Where ACM is: data/acm_server.json {url, token}, written when ACM pairs with this app (POST /acm/link, which ACM sends
by itself from its Funpipe and Jobs pages), or set by hand; ACM_URL / ACM_WORKER_TOKEN in the environment win. A request
that carries app_base_url (ACM's own address as the browser reached it) also tells this app where ACM is, until it
is paired.

    image(path)              a library picture as a PIL image (GET /api/files/raw)
    media_url(path)          a URL ffmpeg can read a library video from (Range requests: it seeks without downloading)
    list_pictures(folder)    the pictures in a performer's folder (GET /api/files/list-pictures)
    worker(method, path)     the worker API (/api/workers/...) with the token
    download(url, dest)      a file to this app's storage, picking up where a broken download stopped
    CACHE                    data/cache: this app's own storage for what it pulls (funpipe videos, the review editor)
"""
import io
import json
import os
import socket
import threading
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image

HERE = Path(__file__).parent
CONFIG = HERE / "data" / "acm_server.json"
CACHE = HERE / "data" / "cache"
WORKER_NAME = os.environ.get("ACM_WORKER_NAME") or f"ai-app@{socket.gethostname()}"
_LOCK = threading.Lock()
_STATE = {"url": None, "token": None, "loaded": False}
_SESSION = requests.Session()


class NotLinked(RuntimeError):
    """this app does not know where ACM is yet: open ACM's Jobs or Funpipe page once (it pairs), or set
    data/acm_server.json"""


def _load():
    if _STATE["loaded"]:
        return
    try:
        c = json.loads(CONFIG.read_text(encoding="utf-8"))
        _STATE.update(url=c.get("url"), token=c.get("token"))
    except (OSError, ValueError):
        pass
    _STATE["loaded"] = True


def link(url, token=None):
    """remember where ACM is (and the worker token): ACM's POST /acm/link, or a request's app_base_url"""
    if not url:
        return
    url = str(url).rstrip("/")
    with _LOCK:
        _load()
        if _STATE["url"] == url and (token is None or _STATE["token"] == token):
            return
        _STATE["url"] = url
        if token is not None:
            _STATE["token"] = token
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONFIG.with_suffix(".tmp")
        tmp.write_text(json.dumps({"url": _STATE["url"], "token": _STATE["token"]}, indent=1), encoding="utf-8")
        os.replace(tmp, CONFIG)


def remember(url):
    """a request's app_base_url: kept as ACM's address only while this app has none (pairing sets the real one)"""
    with _LOCK:
        _load()
        known = bool(_STATE["url"])
    if url and not known:
        link(url)


def server(override=None):
    """ACM's address: the request's own (app_base_url) when it has one, else the environment, else the paired one"""
    if override:
        return str(override).rstrip("/")
    env = os.environ.get("ACM_URL")
    if env:
        return env.rstrip("/")
    with _LOCK:
        _load()
        if not _STATE["url"]:
            raise NotLinked("this AI app does not know where the Adult Content Manager is yet: open its Jobs page once")
        return _STATE["url"]


def linked():
    """{url, worker: whether there is a token} for /health"""
    with _LOCK:
        _load()
        return {"url": os.environ.get("ACM_URL") or _STATE["url"], "worker": bool(os.environ.get("ACM_WORKER_TOKEN") or _STATE["token"])}


def _token():
    with _LOCK:
        _load()
        t = os.environ.get("ACM_WORKER_TOKEN") or _STATE["token"]
    if not t:
        raise NotLinked("no worker token yet: open the Adult Content Manager's Jobs page once (it pairs with this app)")
    return t


def raw_url(path, base=None):
    """GET /api/files/raw for a library file (the path as ACM stores it, /media/...)"""
    p = str(path).replace("\\", "/")
    return f"{server(base)}/api/files/raw?path={quote(p, safe='/')}"


media_url = raw_url   # ffmpeg reads it like a file: the backend answers Range requests, so seeking downloads nothing else


def fetch(path, base=None, timeout=30):
    """the bytes of a library file, or None when ACM does not have it"""
    r = _SESSION.get(raw_url(path, base), timeout=timeout)
    return r.content if r.status_code == 200 else None


def image(path, base=None):
    """a library picture as an RGB PIL image, or None"""
    try:
        data = fetch(path, base)
        return Image.open(io.BytesIO(data)).convert("RGB") if data else None
    except (requests.RequestException, OSError, NotLinked):
        return None


def list_pictures(folder, base=None):
    """the pictures in a library folder (its pics/ folder when it has one), as library paths; [] when there are none"""
    r = _SESSION.get(f"{server(base)}/api/files/list-pictures", params={"folder": str(folder).replace("\\", "/")}, timeout=30)
    return r.json().get("pictures", []) if r.status_code == 200 else []


def list_folders(folder, base=None):
    r = _SESSION.get(f"{server(base)}/api/files/list-folders", params={"folder": str(folder).replace("\\", "/")}, timeout=30)
    return r.json().get("folders", []) if r.status_code == 200 else []


def api(method, path, base=None, timeout=60, **kw):
    """ACM's own API (no token): GET returns the JSON, None on a 404"""
    r = _SESSION.request(method, f"{server(base)}{path}", timeout=timeout, **kw)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json() if r.content else None


def worker(method, path, timeout=60, **kw):
    """the worker API (/api/workers/<path>) with the token; the response (the caller reads its status)"""
    headers = {"Authorization": f"Bearer {_token()}", "X-Worker": WORKER_NAME, **kw.pop("headers", {})}
    return _SESSION.request(method, f"{server()}/api/workers/{path.lstrip('/')}", headers=headers, timeout=timeout, **kw)


def download(url, dest, headers=None, progress=None, chunk=4 << 20):
    """url to dest, through dest.part: a broken download picks up where it stopped (Range); progress(done, total)"""
    dest = Path(dest)
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    have = part.stat().st_size if part.exists() else 0
    h = dict(headers or {})
    if have:
        h["Range"] = f"bytes={have}-"
    with _SESSION.get(url, headers=h, stream=True, timeout=60) as r:
        if r.status_code == 416:   # the part is already whole
            os.replace(part, dest)
            return dest
        r.raise_for_status()
        if have and r.status_code != 206:   # the server sent it all again
            have = 0
        total = have + int(r.headers.get("Content-Length") or 0)
        with open(part, "ab" if have else "wb") as f:
            for block in r.iter_content(chunk):
                f.write(block)
                have += len(block)
                if progress:
                    progress(have, total)
    os.replace(part, dest)
    return dest


def worker_download(path, dest, progress=None):
    """a library video through the worker API (GET /api/workers/media), resumable"""
    url = f"{server()}/api/workers/media?path={quote(str(path).replace(chr(92), '/'), safe='/')}"
    return download(url, dest, {"Authorization": f"Bearer {_token()}", "X-Worker": WORKER_NAME}, progress)


def get_sidecar(video, ext, dest):
    """one of funpipe's files next to a library video, to dest; False when ACM has none"""
    r = worker("GET", "sidecar", params={"video": video, "ext": ext}, stream=True, timeout=120)
    if r.status_code == 404:
        return False
    r.raise_for_status()
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    with open(tmp, "wb") as f:
        for block in r.iter_content(4 << 20):
            f.write(block)
    os.replace(tmp, dest)
    return True


def get_beside(video, name, dest):
    """a .funscript beside a library video by its file name (og.funscript ...), to dest; False when there is none"""
    r = worker("GET", "beside", params={"video": video, "name": name}, timeout=60)
    if r.status_code != 200:
        return False
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    Path(dest).write_bytes(r.content)
    return True


def put_sidecar(video, ext, src):
    """upload a local file as one of funpipe's files next to a library video"""
    with open(src, "rb") as f:
        r = worker("PUT", "sidecar", params={"video": video, "ext": ext}, data=f,
                   headers={"Content-Type": "application/octet-stream"}, timeout=600)
    if r.status_code != 200:
        raise RuntimeError(f"ACM refused {Path(src).name}: {r.status_code} {r.text[:200]}")
    return r.json()
