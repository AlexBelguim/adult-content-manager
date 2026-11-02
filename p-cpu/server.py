"""
P on the NAS's CPU, for Discover while the GPU PC is off (backend/services/discover/judge.js). The same contract as acm-gpu's
/performer_keep, with P's numbers in the request, since this holds no model of its own:

  POST /performer_keep  { "images": ["<base64>", ...], "names": [...], "weights": { "coef": [...], "intercept": n, "backbone": "...", "model": "..." } }
  -> { "score": 0-100, "model": "...", "used": n, "failed": [names], "device": "cpu" }
  GET  /health          -> { "status": "ok", "loaded": bool }

A performer is the normalized mean of her pictures' L2-normalized CLIP ViT-L/14-336 embeddings, as acm-gpu trains and judges it.

Idle it is a small process: torch and CLIP load on the first request (CLIP is downloaded once, into HF_HOME) and leave memory
after P_CPU_IDLE seconds. It runs at low priority on P_CPU_THREADS threads, so the NAS's other work comes first, and listens on
this machine only (P_CPU_HOST), for the app next to it.
"""
import base64
import gc
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("P_CPU_HOST", "127.0.0.1")
PORT = int(os.environ.get("P_CPU_PORT", "3345"))
THREADS = int(os.environ.get("P_CPU_THREADS", "4"))
IDLE_S = int(os.environ.get("P_CPU_IDLE", "300"))
MAX_BODY = 300 * 1024 * 1024

lock = threading.Lock()
state = {"model": None, "processor": None, "backbone": None, "torch": None, "last": 0.0}


def load(backbone):
    if state["model"] is None or state["backbone"] != backbone:
        import torch
        from transformers import AutoImageProcessor, CLIPVisionModelWithProjection
        torch.set_num_threads(THREADS)
        state.update(torch=torch, backbone=backbone, model=CLIPVisionModelWithProjection.from_pretrained(backbone).eval(),
                     processor=AutoImageProcessor.from_pretrained(backbone, backend="pil"))   # PIL pixels, as acm-gpu trains on
    state["last"] = time.time()
    return state["torch"], state["model"], state["processor"]


def judge(images, names, weights):
    from PIL import Image
    pictures, failed = [], []
    for data, name in zip(images, names):
        try:
            pictures.append(Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB"))
        except Exception:
            failed.append(name)
    if not pictures:
        return 422, {"error": "no picture could be opened", "failed": failed}
    try:
        with lock:
            torch, model, processor = load(weights.get("backbone") or "openai/clip-vit-large-patch14-336")
            embeds = []
            for i in range(0, len(pictures), 16):
                pixels = processor(images=pictures[i:i + 16], return_tensors="pt")["pixel_values"]
                with torch.no_grad():
                    embeds.append(torch.nn.functional.normalize(model(pixel_values=pixels).image_embeds.float(), dim=-1))
            performer = torch.nn.functional.normalize(torch.cat(embeds).mean(0), dim=0)
            score = torch.sigmoid(performer @ torch.tensor(weights["coef"], dtype=torch.float32) + float(weights["intercept"])).item() * 100
            state["last"] = time.time()
    finally:
        for p in pictures:
            p.close()
    return 200, {"score": score, "model": weights.get("model"), "used": len(pictures), "failed": failed, "device": "cpu"}


def unload_when_idle():
    while True:
        time.sleep(30)
        with lock:
            if state["model"] is not None and time.time() - state["last"] > IDLE_S:
                state.update(model=None, processor=None, backbone=None)
                gc.collect()


class Handler(BaseHTTPRequestHandler):
    def answer(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.answer(200, {"status": "ok", "loaded": state["model"] is not None, "threads": THREADS})
        self.answer(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/performer_keep":
            return self.answer(404, {"error": "not found"})
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_BODY:
            return self.answer(413, {"error": "too much at once"})
        try:
            req = json.loads(self.rfile.read(size))
            weights, images = req.get("weights"), req.get("images") or []
            if not images:
                return self.answer(400, {"error": "No images"})
            if not weights or not weights.get("coef"):
                return self.answer(503, {"error": "no weights: P's numbers come with the request"})
            self.answer(*judge(images, req.get("names") or [str(i) for i in range(len(images))], weights))
        except Exception as e:
            self.answer(500, {"error": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    if hasattr(os, "nice"):
        os.nice(10)
    threading.Thread(target=unload_when_idle, daemon=True).start()
    print(f"p-cpu on http://{HOST}:{PORT}, {THREADS} threads", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
