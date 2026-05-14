import os
import io
import json
import base64
import subprocess
import time
import requests
import re
from flask import Blueprint, request, jsonify
from threading import Lock, Event
from pathlib import Path

video_bp = Blueprint('video', __name__)

# ── Global State ──────────────────────────────────────────────────────────────
_analysis_lock = Lock()
_cancel_flag = Event()

def log(msg):
    timestamp = time.strftime('%H:%M:%S')
    print(f"[{timestamp}] [Video] {msg}", flush=True)

# ── Debug Logger ──────────────────────────────────────────────────────────────
class DebugLogger:
    """Saves frames, prompts, and VLM responses to a debug folder + HTML report."""
    def __init__(self, output_dir=None):
        self.enabled = False
        self.entries = []
        self.output_dir = None
        if output_dir:
            self.output_dir = Path(output_dir)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self.enabled = True
            log(f"📝 Debug logging to: {self.output_dir}")

    def log_vlm_call(self, phase, timestamp_sec, prompt, frames_b64, response, parsed_result):
        if not self.enabled:
            return
        idx = len(self.entries)
        entry = {
            "idx": idx, "phase": phase, "time": timestamp_sec,
            "prompt": prompt, "response": response,
            "parsed": parsed_result, "frame_files": []
        }
        # Save frames as images
        for fi, fb64 in enumerate(frames_b64[:4]):  # max 4 frames per entry
            fname = f"{idx:04d}_t{int(timestamp_sec)}s_f{fi}.jpg"
            fpath = self.output_dir / fname
            try:
                fpath.write_bytes(base64.b64decode(fb64))
                entry["frame_files"].append(fname)
            except:
                pass
        self.entries.append(entry)

    def save_report(self, video_path="", result=None):
        if not self.enabled or not self.entries:
            return
        html_path = self.output_dir / "debug_report.html"
        rows = []
        for e in self.entries:
            imgs = "".join(f'<img src="{f}" style="max-width:200px;max-height:150px;margin:2px;border-radius:4px">' for f in e["frame_files"])
            prompt_esc = e["prompt"].replace("<", "&lt;").replace(">", "&gt;")
            resp_esc = e["response"].replace("<", "&lt;").replace(">", "&gt;") if e["response"] else "(empty)"
            parsed = json.dumps(e["parsed"]) if e["parsed"] else ""
            rows.append(f"""<tr>
                <td style="white-space:nowrap">{e['phase']}<br><b>{int(e['time'])}s</b></td>
                <td>{imgs}</td>
                <td><pre style="max-width:400px;white-space:pre-wrap;font-size:11px">{prompt_esc}</pre></td>
                <td><pre style="max-width:400px;white-space:pre-wrap;font-size:11px">{resp_esc}</pre></td>
                <td><code>{parsed}</code></td>
            </tr>""")
        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Debug Report</title>
<style>
body {{ font-family: system-ui; background: #0a0a0f; color: #e0e0e0; padding: 20px; }}
h1 {{ color: #00e5ff; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #333; padding: 8px; vertical-align: top; text-align: left; }}
th {{ background: #1a1a2e; color: #00e5ff; position: sticky; top: 0; }}
tr:hover {{ background: #1a1a2e; }}
pre {{ margin: 0; color: #ccc; }}
code {{ color: #7c4dff; }}
img {{ border: 1px solid #333; }}
</style></head><body>
<h1>🔍 Debug Report</h1>
<p>Video: <code>{video_path}</code> | Model: <code>{OLLAMA_MODEL}</code> | Entries: {len(self.entries)} | Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}</p>
<table><tr><th>Phase/Time</th><th>Frames</th><th>Prompt</th><th>Full Response</th><th>Parsed</th></tr>
{"".join(rows)}
</table></body></html>"""
        html_path.write_text(html, encoding="utf-8")
        log(f"📝 Debug report saved: {html_path}")

_debug = DebugLogger()  # disabled by default, activated per-analysis


# ── Path Mapping ──────────────────────────────────────────────────────────────
def map_path(p):
    if not p: return p
    # Map TrueNAS /media to local Z: drive
    if p.startswith('/media'):
        return 'Z:\\Apps\\adultManager' + p
    return p

# ── Configuration ───────────────────────────────────────────────────────────────
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "minicpm-v")

# Default supported actions
SUPPORTED_ACTIONS = {
    'missionary': 'Missionary',
    'cowgirl': 'Cowgirl / Woman on top',
    'reverse_cowgirl': 'Reverse Cowgirl',
    'doggy': 'Doggy style',
    'anal': 'Anal penetration',
    'anal_doggy': 'Anal doggy style',
    'blowjob': 'Blowjob',
    'cunnilingus': 'Cunnilingus',
    'handjob': 'Handjob',
    'fingering_pussy': 'Fingering Pussy',
    'fingering_anal': 'Fingering Anal',
    'titfuck': 'Titfuck / Titjob',
    'pussy_dildo_play': 'Pussy Dildo Play',
    'anal_dildo_play': 'Anal Dildo Play',
    'dildo_blowjob': 'Dildo Blowjob',
    'dildo_handjob': 'Dildo Handjob',
    'vibrator_play': 'Vibrator Play',
    'boob_teasing': 'Boob Teasing',
    'handbra': 'Handbra',
    'cumshot': 'Cumshot',
    'facial': 'Facial',
    'creampie': 'Creampie',
    'nudity': 'Nudity',
    'idle': 'Idle / No Action'
}

# ── Frame Extraction ────────────────────────────────────────────────────────────
def get_video_duration(video_path):
    try:
        cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video_path]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
        if result.returncode == 0:
            return float(result.stdout.strip())
    except Exception as ex:
        log(f"  ⚠️ ffprobe failed: {ex}")
    return 0

def extract_burst_frames(video_path, center_time, duration_sec=2, count=8):
    """Extract a burst of frames around a center time using a single ffmpeg call."""
    try:
        start = max(0, center_time - (duration_sec / 2))
        fps = count / duration_sec
        cmd = [
            'ffmpeg', '-ss', str(start), '-t', str(duration_sec),
            '-i', video_path,
            '-vf', f'fps={fps}',
            '-vframes', str(count),
            '-f', 'image2pipe', '-c:v', 'mjpeg',
            '-q:v', '3', 'pipe:1'
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode == 0 and result.stdout:
            data = result.stdout
            frames = []
            parts = data.split(b'\xff\xd8')
            for part in parts[1:]:
                frame = b'\xff\xd8' + part
                frames.append(base64.b64encode(frame).decode('utf-8'))
            return frames[:count]
    except Exception as ex:
        log(f"  Burst extraction failed at {center_time}s: {ex}")
    return []

def create_motion_composite(frames_b64):
    """Blend burst frames into a motion composite — static areas sharp, movement = ghosting."""
    if len(frames_b64) < 2:
        return None
    try:
        from PIL import Image
        import numpy as np
        images = []
        for fb64 in frames_b64:
            img = Image.open(io.BytesIO(base64.b64decode(fb64))).convert("RGB")
            images.append(np.array(img, dtype=np.float32))
        # Resize all to match first frame
        h, w = images[0].shape[:2]
        resized = []
        for arr in images:
            if arr.shape[:2] != (h, w):
                img = Image.fromarray(arr.astype(np.uint8)).resize((w, h))
                resized.append(np.array(img, dtype=np.float32))
            else:
                resized.append(arr)
        # Blend with equal weight
        composite = np.mean(resized, axis=0).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(composite).save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as ex:
        log(f"  Motion composite failed: {ex}")
        return None

def extract_single_frame(video_path, time_sec):
    try:
        cmd = [
            'ffmpeg', '-ss', str(time_sec), '-i', video_path,
            '-vframes', '1', '-f', 'image2', '-c:v', 'mjpeg',
            '-q:v', '3', '-y', 'pipe:1'
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15)
        if result.returncode == 0 and result.stdout:
            return base64.b64encode(result.stdout).decode('utf-8')
    except Exception as ex:
        log(f"  ⚠️ Frame extraction failed at {time_sec}s: {ex}")
    return None

def extract_frames(video_path, interval_sec=12, start_time=None, end_time=None):
    duration = get_video_duration(video_path)
    if duration <= 0: return []
    s = start_time if start_time is not None else 0
    e = end_time if end_time is not None else duration
    frames = []
    t = s
    while t < e:
        if _cancel_flag.is_set(): return frames
        frame_data = extract_single_frame(video_path, t)
        if frame_data:
            frames.append({"time": t, "data": frame_data})
        t += interval_sec
    log(f"📸 Identified {len(frames)} analysis points ({s:.0f}s - {e:.0f}s, interval={interval_sec}s)")
    return frames

# ── VLM Classification via Ollama ───────────────────────────────────────────────
def classify_frame_vlm(frame_b64_list, allowed_actions=None):
    if allowed_actions:
        action_list = "\n".join(f"- {a}" for a in allowed_actions)
        prompt = f"""Task: Classify the sexual action in this frame.
Choices:
{action_list}

Rules:
1. Choose the best match from the list.
2. Output ONLY JSON. No talk, no explanations.
3. Use this format: {{"action": "choice", "confidence": 0.9}}"""
    else:
        prompt = """Classification Task: Identify the primary action in these frames.

Visual Cues:
- TOYS: Look for plastic/uniform objects (Magic Wand, dildo, vibrator). If it's not a human hand, it's a TOY.
- MANUAL: Fingers must be in DIRECT CONTACT with or INSERTED into the pussy. If they are just "near" or touching the thigh, use 'nudity' or 'idle'.
- RIDING: If a person is riding an object alone, it is 'pussy dildo play'.

Choices (use these exact labels or with simple modification or in same style, like more poses or positions of the action etc):
- pussy dildo play, anal dildo play, dildo blowjob, vibrator play
- fingering pussy, fingering ass, handjob, boob teasing, handbra
- blowjob, cunnilingus, 69, deepthroat
- missionary, cowgirl, doggy style, anal
- cumshot, facial, creampie
- nudity, idle, transition

if fingering detected make sure fingers are in the pussy not just touching. the same is for ass. otherwise probably dildo pussy play or dildo ass play.
when penis like objects are seen it is probably dildo.
if she is inserting object in pussy or ass or rubbing it against her clit or vagina then it is dildo pussy play or dildo ass play or dildo cunnilingus.
all toys must be considered as dildos.
if she is inserting anything in pussy or ass or rubbing it against her clit or vagina then dont say nudity or idle. use appropriate label.
cowgirls, or reverse cowgirl can both be with dildo or with dick label. correct labels must be used as per the content. 
When toy near face label it as dildo blowjob.





Rule: Output ONLY a JSON object. No other text.
Format: {"action": "label from choices", "confidence": 0.5-1.0}"""

    try:
        # Qwen2.5-VL and newer models require images embedded as content parts.
        # MiniCPM-V / LLaVA accept the legacy top-level "images" key.
        _model_lower = OLLAMA_MODEL.lower()
        if any(m in _model_lower for m in ['qwen', 'internvl', 'llama4']):
            # OpenAI-style multipart content
            content_parts = [{"type": "text", "text": prompt}]
            for img in frame_b64_list:
                content_parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}})
            messages = [{"role": "user", "content": content_parts}]
        else:
            # Legacy Ollama format (MiniCPM-V, LLaVA, BakLLaVA, etc.)
            messages = [{"role": "user", "content": prompt, "images": frame_b64_list}]

        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 150}
        }
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=120)
        if resp.status_code == 200:
            content = resp.json().get("message", {}).get("content", "")
            log(f"  🔍 Raw AI ({OLLAMA_MODEL}): {content[:300] if content else '[EMPTY RESPONSE]'}")
            return parse_vlm_response(content, allowed_actions)
        else:
            log(f"  ⚠️ VLM HTTP {resp.status_code}: {resp.text[:200]}")
        return {"action": "other", "confidence": 0.0}
    except Exception as ex:
        log(f"  ⚠️ VLM failed: {ex}")
        return {"action": "other", "confidence": 0.0}

# Phrases that indicate the model refused to answer
_REFUSAL_PHRASES = [
    "i can't", "i cannot", "i'm not able", "i am not able", "unable to",
    "as an ai", "i don't think", "inappropriate", "i'm sorry", "i apologize",
    "not appropriate", "content policy", "harmful", "explicit content",
    "this image", "cannot assist", "can't assist", "against my",
]

def parse_vlm_response(content, allowed_actions=None):
    if not content:
        return {"action": "other", "confidence": 0.0}

    # Detect refusals early so they don't silently fall through
    content_lower = content.lower()
    if any(phrase in content_lower for phrase in _REFUSAL_PHRASES):
        log(f"  🚫 Model refused: {content[:120]}")
        return {"action": "refused", "confidence": 0.0}

    try:
        content_clean = re.sub(r'```json\s*|\s*```', '', content).strip()
        content_clean = re.sub(r'<\|im_start\|>|<\|im_end\|>|assistant|user|system', '', content_clean).strip()
        json_match = re.search(r'\{[^}]+\}', content_clean)
        if json_match:
            data = json.loads(json_match.group())
            action = str(data.get("action", "other")).lower().strip()
            confidence = float(data.get("confidence", 0.5))
            # Expand abbreviated labels from clinical prompt
            _abbrev = {
                'bj': 'blowjob', 'dt': 'deepthroat', 'hj': 'handjob',
                'oral-f': 'cunnilingus', 'miss': 'missionary', 'cow': 'cowgirl',
                'rcow': 'reverse cowgirl', 'dog': 'doggy style', 'anal-p': 'anal',
                'toy-v': 'vibrator play', 'toy-d': 'pussy dildo play',
                'finger-v': 'fingering pussy', 'facial-c': 'facial',
                'cum': 'cumshot', 'tease': 'boob teasing',
            }
            if action in _abbrev:
                action = _abbrev[action]
            for prefix in ['toys:', 'manual:', 'oral:', 'penetration:', 'finale:', 'other:', 'toys ', 'manual ', 'oral ', 'penetration ', 'finale ', 'other ']:
                if action.startswith(prefix):
                    action = action[len(prefix):].strip()
                    break
            if "based on" in action or "following" in action or "guideline" in action or "openai" in action:
                for common in ['missionary', 'cowgirl', 'doggy', 'blowjob', 'handjob', 'anal', 'cumshot', 'fingering', 'dildo', 'toy', 'boob', 'rimming']:
                    if common in action:
                        action = common
                        break
                if len(action) > 25: action = "other"
            if allowed_actions:
                matched = None
                for a in allowed_actions:
                    if a.lower() == action or a.lower() in action or action in a.lower():
                        matched = a
                        break
                if not matched: matched = "other"
                action = matched
            return {"action": action, "confidence": min(1.0, max(0.0, confidence))}
    except: pass
    # Fallback: scan for known action keywords in full response
    _known_actions = [
        'reverse cowgirl', 'cowgirl', 'doggy style', 'doggy', 'missionary',
        'pussy dildo play', 'anal dildo play', 'dildo blowjob', 'vibrator play',
        'fingering pussy', 'fingering ass', 'fingering',
        'blowjob', 'deepthroat', 'cunnilingus', '69',
        'handjob', 'titfuck', 'boob teasing', 'handbra',
        'anal', 'cumshot', 'facial', 'creampie',
        'nudity', 'idle', 'stripping'
    ]
    for kw in _known_actions:
        if kw in content_lower:
            return {"action": kw, "confidence": 0.5}
    return {"action": "other", "confidence": 0.3}

# ── Florence-2 Pre-Pass Engine ─────────────────────────────────────────────────
class FlorenceEngine:
    """Lazy-loaded Florence-2-Large for object detection and captioning. Runs on CPU."""
    _model = None
    _processor = None
    _available = None

    @classmethod
    def is_available(cls):
        if cls._available is None:
            cls._load()
        return cls._available

    @classmethod
    def _load(cls):
        try:
            import torch
            log("🔬 Loading Florence-2-large on CPU...")
            mid = "microsoft/Florence-2-large"

            # Patch: transformers 5.x removed forced_bos_token_id.
            # Florence-2 remote code reads it during __init__, so we must
            # patch the PretrainedConfig base BEFORE any Florence code loads.
            from transformers import PretrainedConfig
            _orig_init = PretrainedConfig.__init__
            def _patched_init(self, **kwargs):
                _orig_init(self, **kwargs)
                if not hasattr(self, 'forced_bos_token_id'):
                    self.forced_bos_token_id = getattr(self, 'bos_token_id', None)
            PretrainedConfig.__init__ = _patched_init

            from transformers import AutoProcessor, AutoModelForCausalLM
            cls._processor = AutoProcessor.from_pretrained(mid, trust_remote_code=True)
            cls._model = AutoModelForCausalLM.from_pretrained(
                mid, trust_remote_code=True, torch_dtype=torch.float32
            ).eval().to("cpu")
            cls._available = True

            # Restore original init
            PretrainedConfig.__init__ = _orig_init
            log("✅ Florence-2 ready (CPU, ~800MB RAM)")
        except Exception as ex:
            log(f"⚠️ Florence-2 not available: {ex}")
            cls._available = False

    @classmethod
    def detect_objects(cls, frame_b64):
        """Object detection on a base64 JPEG. Returns ([{label, bbox}], (w, h))."""
        if not cls.is_available():
            return [], (0, 0)
        try:
            from PIL import Image
            import torch
            image = Image.open(io.BytesIO(base64.b64decode(frame_b64))).convert("RGB")
            inputs = cls._processor(text="<OD>", images=image, return_tensors="pt")
            with torch.no_grad():
                ids = cls._model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=512, num_beams=3
                )
            text = cls._processor.batch_decode(ids, skip_special_tokens=False)[0]
            parsed = cls._processor.post_process_generation(
                text, task="<OD>", image_size=(image.width, image.height)
            )
            detections = []
            if "<OD>" in parsed:
                od = parsed["<OD>"]
                for lbl, bbox in zip(od.get("labels", []), od.get("bboxes", [])):
                    detections.append({"label": lbl.lower().strip(), "bbox": bbox})
            return detections, (image.width, image.height)
        except Exception as ex:
            log(f"⚠️ Florence OD failed: {ex}")
            return [], (0, 0)

    @classmethod
    def caption(cls, frame_b64):
        """Detailed caption for a base64 JPEG frame."""
        if not cls.is_available():
            return ""
        try:
            from PIL import Image
            import torch
            image = Image.open(io.BytesIO(base64.b64decode(frame_b64))).convert("RGB")
            inputs = cls._processor(text="<MORE_DETAILED_CAPTION>", images=image, return_tensors="pt")
            with torch.no_grad():
                ids = cls._model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=256
                )
            return cls._processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
        except Exception as ex:
            log(f"⚠️ Florence caption failed: {ex}")
            return ""

    @classmethod
    def crop_region(cls, frame_b64, bbox, pad_pct=0.15):
        """Crop a bbox region from a frame, return as base64 JPEG."""
        try:
            from PIL import Image
            image = Image.open(io.BytesIO(base64.b64decode(frame_b64))).convert("RGB")
            w, h = image.size
            x1, y1, x2, y2 = bbox
            pw, ph = (x2 - x1) * pad_pct, (y2 - y1) * pad_pct
            crop = image.crop((
                int(max(0, x1 - pw)), int(max(0, y1 - ph)),
                int(min(w, x2 + pw)), int(min(h, y2 + ph))
            ))
            buf = io.BytesIO()
            crop.save(buf, format="JPEG", quality=85)
            return base64.b64encode(buf.getvalue()).decode("utf-8")
        except Exception as ex:
            log(f"⚠️ Crop failed: {ex}")
            return None


# ── Video State Machine ────────────────────────────────────────────────────────
class VideoState:
    """Persistent state tracked across video analysis frames."""
    def __init__(self):
        self.scene_type = "idle"
        self.clothed_state = "unknown"
        self.insertion_active = False
        self.current_toy = None
        self.people_count = 0
        self.last_action = "idle"
        self.last_confidence = 0.0
        self.last_clean_time = 0.0

    def to_context(self):
        parts = [f"Scene:{self.scene_type}", f"Clothing:{self.clothed_state}",
                 f"People:{self.people_count}"]
        if self.insertion_active:
            parts.append(f"ActiveInsertion:{self.current_toy or 'yes'}")
        parts.append(f"PrevAction:{self.last_action if self.last_action != 'refused' else 'unknown'}")
        return " | ".join(parts)


# ── Detection Helpers ──────────────────────────────────────────────────────────
_TOY_KEYWORDS = {'toy', 'dildo', 'vibrator', 'object', 'device', 'wand', 'cylinder', 'bottle', 'stick'}
_BODY_KEYWORDS = {'person', 'body', 'woman', 'man', 'human', 'torso', 'leg', 'thigh'}
_HAND_KEYWORDS = {'hand', 'finger', 'fingers', 'arm'}

def categorize_detections(detections):
    """Sort Florence detections into semantic categories."""
    cats = {"people": [], "hands": [], "toys": [], "other": []}
    for d in detections:
        lbl = d["label"]
        if any(k in lbl for k in _BODY_KEYWORDS):
            cats["people"].append(d)
        elif any(k in lbl for k in _HAND_KEYWORDS):
            cats["hands"].append(d)
        elif any(k in lbl for k in _TOY_KEYWORDS):
            cats["toys"].append(d)
        else:
            cats["other"].append(d)
    return cats

def bbox_overlap_ratio(box_a, box_b):
    """How much of box_a overlaps with box_b (intersection / area_a)."""
    x1, y1 = max(box_a[0], box_b[0]), max(box_a[1], box_b[1])
    x2, y2 = min(box_a[2], box_b[2]), min(box_a[3], box_b[3])
    if x1 >= x2 or y1 >= y2:
        return 0.0
    intersection = (x2 - x1) * (y2 - y1)
    area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    return intersection / area_a if area_a > 0 else 0.0

def check_insertion_overlap(categorized, threshold=0.15):
    """Check if any toy bbox overlaps with any body bbox above threshold."""
    for toy in categorized["toys"]:
        for body in categorized["people"]:
            if bbox_overlap_ratio(toy["bbox"], body["bbox"]) > threshold:
                return True, toy["label"]
    return False, None

def format_detections_for_prompt(categorized):
    """Format categorized detections as a string hint for VLM prompt."""
    parts = []
    if categorized["people"]:
        parts.append(f"{len(categorized['people'])} person(s)")
    if categorized["hands"]:
        parts.append(f"{len(categorized['hands'])} hand(s)")
    if categorized["toys"]:
        labels = set(d["label"] for d in categorized["toys"])
        parts.append(f"Toys/objects: {', '.join(labels)}")
    return "; ".join(parts) if parts else "no specific objects detected"


def analyze_video(video_path, segment_duration=12, min_segment=10, allowed_actions=None, start_time=None, end_time=None, window_size=None):
    _cancel_flag.clear()
    log(f"🎬 Starting analysis: {video_path}")
    frames = extract_frames(video_path, segment_duration, start_time, end_time)
    if not frames: return {"success": False, "error": "No frames extracted"}
    
    raw_segments = []
    for i, frame in enumerate(frames):
        if _cancel_flag.is_set(): break
        context_frames = extract_burst_frames(video_path, frame["time"], duration_sec=2, count=8)
        if not context_frames: context_frames = [frame["data"]]
        result = classify_frame_vlm(context_frames, allowed_actions)
        raw_segments.append({"time": frame["time"], "action": result["action"], "confidence": result["confidence"]})
        log(f"   {frame['time']}s → {result['action']} ({int(result['confidence']*100)}%)")
    
    # Simple smoothing
    final_segments = []
    if raw_segments:
        current = {"action": raw_segments[0]["action"], "start": raw_segments[0]["time"], "end": raw_segments[0]["time"] + segment_duration}
        for s in raw_segments[1:]:
            if s["action"] == current["action"]:
                current["end"] = s["time"] + segment_duration
            else:
                if (current["end"] - current["start"]) >= min_segment:
                    final_segments.append(current)
                current = {"action": s["action"], "start": s["time"], "end": s["time"] + segment_duration}
        final_segments.append(current)
    
    return {"success": True, "segments": final_segments}

# ── Advanced VLM Helpers ───────────────────────────────────────────────────────
def _build_vlm_messages(prompt, frame_b64_list):
    """Build model-aware message payload for VLM call."""
    _model_lower = OLLAMA_MODEL.lower()
    if any(m in _model_lower for m in ['qwen', 'internvl', 'llama4']):
        parts = [{"type": "text", "text": prompt}]
        for img in frame_b64_list:
            parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}})
        return [{"role": "user", "content": parts}]
    return [{"role": "user", "content": prompt, "images": frame_b64_list}]

def _call_vlm(prompt, frame_b64_list, max_tokens=150, timeout=120):
    """Send a prompt + images to Ollama VLM, return raw text content."""
    _model_lower = OLLAMA_MODEL.lower()
    # Models that support multiple images
    multi_image = any(m in _model_lower for m in ['qwen', 'internvl', 'minicpm'])
    # If model is single-image only, pick the middle frame (most representative)
    if not multi_image and len(frame_b64_list) > 1:
        mid = len(frame_b64_list) // 2
        frame_b64_list = [frame_b64_list[mid]]
    try:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": _build_vlm_messages(prompt, frame_b64_list),
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": max_tokens}
        }
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=timeout)
        if resp.status_code == 200:
            return resp.json().get("message", {}).get("content", "")
        log(f"  ⚠️ VLM HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as ex:
        log(f"  ⚠️ VLM call failed: {ex}")
    return ""

def classify_macro(frame_b64, florence_hint="", time_sec=0):
    """Quick macro scan: people count, scene type, clothing state."""
    ctx = f"\nDetection hint: {florence_hint}" if florence_hint else ""
    prompt = f"""Quick scene check. Analyze this single frame.{ctx}
IMPORTANT: If this is a POV (point-of-view) shot, the camera holder counts as a person even if only their body part (penis, hand) is visible. A blowjob from POV = 2 people, straight_sex.
Report:
1. people: number of people involved (0, 1, 2, 3) — count the camera holder if their body is visible
2. scene: idle, solo, straight_sex, lesbian, threesome
3. clothing: clothed, lingerie, nude, stripping

Output ONLY JSON: {{"people": 1, "scene": "solo", "clothing": "nude"}}"""

    raw = _call_vlm(prompt, [frame_b64], max_tokens=120, timeout=60)
    result = {"people": 0, "scene": "idle", "clothing": "unknown"}
    if raw:
        try:
            cleaned = re.sub(r'```json\s*|\s*```', '', raw).strip()
            m = re.search(r'\{[^}]+\}', cleaned)
            if m:
                data = json.loads(m.group())
                result = {
                    "people": int(data.get("people", 0)),
                    "scene": str(data.get("scene", "idle")).lower().strip(),
                    "clothing": str(data.get("clothing", "unknown")).lower().strip()
                }
                if result["scene"] in ("straight_sex", "threesome") and result["people"] < 2:
                    result["people"] = 2
        except:
            pass
    _debug.log_vlm_call("macro", time_sec, prompt, [frame_b64], raw, result)
    return result

def classify_action_with_context(frame_b64_list, state, florence_caption="",
                                  florence_hint="", crop_b64=None, allowed_actions=None, time_sec=0):
    """Action classification with state context, Florence hints, and optional crop."""
    context = state.to_context()
    extra = ""
    if florence_caption:
        extra += f"\nFlorence-2 caption: {florence_caption}"
    if florence_hint:
        extra += f"\nDetected objects: {florence_hint}"

    if allowed_actions:
        action_list = ", ".join(allowed_actions)
        prompt = f"""Context: {context}{extra}
You are a video annotation tool. Pick ONE from: {action_list}
Output ONLY JSON: {{"action": "cowgirl", "confidence": 0.9, "insertion": false}}"""
    else:
        prompt = f"""Context: {context}{extra}
You are a video annotation tool. Image 1 = current frame. Image 2 = motion composite (blurred areas show movement over 6 seconds).
What specific position or act is shown? Pick ONE:
cowgirl, reverse cowgirl, missionary, doggy style, blowjob, deepthroat, handjob, cunnilingus, anal, fingering pussy, pussy dildo play, vibrator play, boob teasing, cumshot, facial, creampie, nudity, idle
Visual cues: POV looking up at woman on top = cowgirl. Woman on back with legs spread = missionary. Bent over/from behind = doggy style. Face near groin = blowjob.
Output ONLY JSON: {{"action": "cowgirl", "confidence": 0.9, "insertion": false}}"""

    # If we have a crop, add it as the first image for emphasis
    images = list(frame_b64_list)
    if crop_b64:
        images.insert(0, crop_b64)

    raw = _call_vlm(prompt, images)
    if raw:
        log(f"  🔍 Advanced AI: {raw[:300]}")
        result = parse_vlm_response(raw, allowed_actions)
        try:
            m = re.search(r'\{[^}]+\}', re.sub(r'```json\s*|\s*```', '', raw))
            if m:
                result["insertion"] = bool(json.loads(m.group()).get("insertion", False))
        except:
            result["insertion"] = False
        _debug.log_vlm_call("action", time_sec, prompt, images[:2], raw, result)
        return result
    _debug.log_vlm_call("action", time_sec, prompt, images[:2], "(no response)", None)
    return {"action": "other", "confidence": 0.0, "insertion": False}


# ── Back-Search / Refinement ──────────────────────────────────────────────────
def find_insertion_point(video_path, t_start, t_end, max_checks=12):
    """Back-search using Florence-2 bbox overlap to find exact insertion frame."""
    if not FlorenceEngine.is_available():
        log(f"  ⏩ Florence not available, using t_start={t_start:.1f}s")
        return t_start

    log(f"  🔎 Back-searching insertion: {t_start:.1f}s → {t_end:.1f}s")
    step = max(0.5, (t_end - t_start) / max_checks)
    t = t_start

    while t <= t_end:
        if _cancel_flag.is_set():
            break
        frame = extract_single_frame(video_path, t)
        if frame:
            dets, _ = FlorenceEngine.detect_objects(frame)
            cats = categorize_detections(dets)
            has_overlap, toy = check_insertion_overlap(cats)
            if has_overlap:
                log(f"  📍 Insertion detected at {t:.1f}s (toy: {toy})")
                # If step is coarse, recurse with finer step
                if step > 1.0:
                    return find_insertion_point(video_path, max(t_start, t - step), t, max_checks)
                return t
        t += step

    log(f"  📍 No bbox overlap found, using t_end={t_end:.1f}s")
    return t_end

def find_insertion_end(video_path, t_start, t_end, step=2.0):
    """Find when toy bbox moves away from body (insertion ends)."""
    if not FlorenceEngine.is_available():
        return t_end

    t = t_start
    while t <= t_end:
        if _cancel_flag.is_set():
            break
        frame = extract_single_frame(video_path, t)
        if frame:
            dets, _ = FlorenceEngine.detect_objects(frame)
            cats = categorize_detections(dets)
            has_overlap, _ = check_insertion_overlap(cats)
            if not has_overlap:
                log(f"  📍 Insertion ended at {t:.1f}s")
                return t
        t += step
    return t_end


# ── Advanced Pipeline (State Machine) ──────────────────────────────────────────
def analyze_video_advanced(video_path, segment_duration=12, min_segment=10,
                           allowed_actions=None, start_time=None, end_time=None,
                           macro_interval=60, action_interval=5):
    """
    Multi-resolution state machine analysis.
    Phase 1: Macro scan (macro_interval steps) - scene, clothing, people
    Phase 2: Action scan (action_interval steps) - detailed in active windows
    Phase 3: Refinement (1s back-search) - exact insertion/transition times
    """
    _cancel_flag.clear()
    log(f"🎬 [Advanced] Starting analysis: {video_path}")

    duration = get_video_duration(video_path)
    if duration <= 0:
        return {"success": False, "error": "Cannot read video duration"}

    s = start_time if start_time is not None else 0
    e = end_time if end_time is not None else duration
    state = VideoState()
    timeline = []
    raw_segments = []

    # Check Florence availability once
    use_florence = FlorenceEngine.is_available()
    if use_florence:
        log("🔬 Florence-2 pre-pass: ENABLED")
    else:
        log("⚠️ Florence-2 pre-pass: DISABLED (not installed)")

    # ── Phase 1: Macro Scan ────────────────────────────────────────────────
    log(f"📊 Phase 1: Macro scan ({macro_interval}s steps, {s:.0f}s-{e:.0f}s)")
    active_windows = []
    t = s
    while t < e:
        if _cancel_flag.is_set():
            break

        frame = extract_single_frame(video_path, t)
        if not frame:
            t += macro_interval
            continue

        # Florence pre-pass for object hints
        florence_hint = ""
        if use_florence:
            dets, _ = FlorenceEngine.detect_objects(frame)
            cats = categorize_detections(dets)
            florence_hint = format_detections_for_prompt(cats)
            state.people_count = len(cats["people"])
        
        # Quick VLM check
        macro = classify_macro(frame, florence_hint, time_sec=t)
        state.scene_type = macro["scene"]
        state.clothed_state = macro["clothing"]
        if not use_florence:
            state.people_count = macro["people"]

        log(f"  {t:.0f}s → scene={macro['scene']}, clothing={macro['clothing']}, people={macro['people']}")

        # Mark active windows where detailed scanning is needed
        is_active = (
            state.people_count >= 1 or
            state.clothed_state in ('nude', 'lingerie', 'stripping') or
            state.scene_type != 'idle'
        )
        if is_active:
            window_start = max(s, t - macro_interval / 2)
            window_end = min(e, t + macro_interval / 2)
            active_windows.append((window_start, window_end))

        t += macro_interval

    if _cancel_flag.is_set():
        return {"success": False, "error": "Cancelled"}

    # Merge overlapping windows
    if active_windows:
        active_windows.sort()
        merged = [active_windows[0]]
        for ws, we in active_windows[1:]:
            if ws <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], we))
            else:
                merged.append((ws, we))
        active_windows = merged
    else:
        # Nothing active found in macro — fall back to scanning everything
        log("  ⚠️ No active windows found, scanning full range")
        active_windows = [(s, e)]

    total_active = sum(we - ws for ws, we in active_windows)
    log(f"📋 Active windows: {len(active_windows)} regions, {total_active:.0f}s of {e-s:.0f}s total")

    # ── Phase 2: Action Scan ───────────────────────────────────────────────
    log(f"🎯 Phase 2: Action scan ({action_interval}s steps)")
    state.last_clean_time = s

    for w_start, w_end in active_windows:
        t = w_start
        while t < w_end:
            if _cancel_flag.is_set():
                break

            # Get burst frames for temporal context
            context_frames = extract_burst_frames(video_path, t, duration_sec=6, count=4)
            if not context_frames:
                single = extract_single_frame(video_path, t)
                context_frames = [single] if single else []
            if not context_frames:
                t += action_interval
                continue

            # Florence pre-pass on the middle frame
            florence_caption = ""
            florence_hint = ""
            crop_b64 = None
            if use_florence:
                mid_frame = context_frames[len(context_frames) // 2]
                dets, _ = FlorenceEngine.detect_objects(mid_frame)
                cats = categorize_detections(dets)
                florence_hint = format_detections_for_prompt(cats)

                # Get a caption for richer context
                florence_caption = FlorenceEngine.caption(mid_frame)

                # If a toy was detected, crop it for the VLM
                if cats["toys"]:
                    best_toy = cats["toys"][0]
                    crop_b64 = FlorenceEngine.crop_region(mid_frame, best_toy["bbox"])
                    log(f"  🔬 {t:.0f}s Florence: {florence_hint} | crop={crop_b64 is not None}")

                # Check bbox overlap for insertion
                has_overlap, toy_label = check_insertion_overlap(cats)
                if has_overlap and not state.insertion_active:
                    # Insertion just started — back-search for exact frame
                    exact = find_insertion_point(video_path, state.last_clean_time, t)
                    timeline.append({"event": "insertion_start", "time": exact,
                                     "toy": toy_label or "unknown"})
                    state.insertion_active = True
                    state.current_toy = toy_label
                elif not has_overlap and state.insertion_active:
                    # Insertion just ended
                    timeline.append({"event": "insertion_end", "time": t,
                                     "toy": state.current_toy})
                    state.insertion_active = False
                    state.current_toy = None
            # Build VLM input: middle frame + motion composite for oscillation detection
            mid_idx = len(context_frames) // 2
            mid_frame = context_frames[mid_idx]
            motion = create_motion_composite(context_frames)
            # Send [middle_frame, motion_composite] — clear frame + movement overlay
            vlm_frames = [mid_frame]
            if motion:
                vlm_frames.append(motion)

            # Full action classification with all context
            result = classify_action_with_context(
                vlm_frames, state, florence_caption, florence_hint,
                crop_b64, allowed_actions, time_sec=t
            )

            # Update state
            state.last_action = result["action"]
            state.last_confidence = result["confidence"]
            if not state.insertion_active:
                state.last_clean_time = t

            # Handle VLM-reported insertion (if Florence missed it)
            if result.get("insertion") and not state.insertion_active:
                timeline.append({"event": "insertion_start", "time": t,
                                 "toy": "vlm_detected"})
                state.insertion_active = True
            elif not result.get("insertion") and state.insertion_active and not use_florence:
                timeline.append({"event": "insertion_end", "time": t})
                state.insertion_active = False

            raw_segments.append({
                "time": t,
                "action": result["action"],
                "confidence": result["confidence"]
            })
            log(f"  ⏱ {t:.0f}s → {result['action']} ({int(result['confidence']*100)}%)")

            t += action_interval

    if _cancel_flag.is_set():
        return {"success": False, "error": "Cancelled"}

    # ── Phase 3: Build Final Segments ──────────────────────────────────────
    log("📐 Phase 3: Building final segments with smoothing")
    final_segments = []
    if raw_segments:
        current = {
            "action": raw_segments[0]["action"],
            "start": raw_segments[0]["time"],
            "end": raw_segments[0]["time"] + action_interval,
            "confidence": raw_segments[0]["confidence"]
        }
        for seg in raw_segments[1:]:
            if seg["action"] == current["action"]:
                current["end"] = seg["time"] + action_interval
                # Running average confidence
                current["confidence"] = (current["confidence"] + seg["confidence"]) / 2
            else:
                if (current["end"] - current["start"]) >= min_segment:
                    final_segments.append(current)
                current = {
                    "action": seg["action"],
                    "start": seg["time"],
                    "end": seg["time"] + action_interval,
                    "confidence": seg["confidence"]
                }
        final_segments.append(current)

    log(f"✅ [Advanced] Done: {len(final_segments)} segments, {len(timeline)} events")
    return {
        "success": True,
        "segments": final_segments,
        "timeline": timeline,
        "mode": "advanced"
    }

# ── Flask Routes ───────────────────────────────────────────────────────────────
@video_bp.route('/analyze', methods=['POST'])
def video_analyze():
    data = request.json or {}
    video_path = map_path(data.get('video_path'))
    if not video_path or not os.path.exists(video_path): return jsonify({"success": False, "error": "Invalid video path"}), 400
    if not _analysis_lock.acquire(blocking=False): return jsonify({"success": False, "error": "Busy"}), 409
    try:
        raw_actions = data.get('allowed_actions', [])
        allowed = [a.strip() for a in raw_actions if a and a.strip()]
        result = analyze_video(video_path, data.get('segment_duration', 12), data.get('min_segment', 10), allowed if allowed else None, data.get('start_time'), data.get('end_time'))
        return jsonify(result)
    finally: _analysis_lock.release()

@video_bp.route('/analyze-advanced', methods=['POST'])
def video_analyze_advanced():
    """Advanced multi-resolution state machine analysis with Florence-2 pre-pass."""
    global _debug
    data = request.json or {}
    video_path = map_path(data.get('video_path'))
    if not video_path or not os.path.exists(video_path):
        return jsonify({"success": False, "error": "Invalid video path"}), 400
    if not _analysis_lock.acquire(blocking=False):
        return jsonify({"success": False, "error": "Busy"}), 409
    try:
        # Enable debug logging — saves to localscene/debug/<timestamp>/
        debug_dir = Path(__file__).parent / "localscene" / "debug" / time.strftime("%Y%m%d_%H%M%S")
        _debug = DebugLogger(str(debug_dir))

        raw_actions = data.get('allowed_actions', [])
        allowed = [a.strip() for a in raw_actions if a and a.strip()]
        result = analyze_video_advanced(
            video_path,
            segment_duration=data.get('segment_duration', 12),
            min_segment=data.get('min_segment', 10),
            allowed_actions=allowed if allowed else None,
            start_time=data.get('start_time'),
            end_time=data.get('end_time'),
            macro_interval=data.get('macro_interval', 60),
            action_interval=data.get('action_interval', 5)
        )

        # Save debug report
        _debug.save_report(video_path=video_path, result=result)
        _debug = DebugLogger()  # reset to disabled

        return jsonify(result)
    finally:
        _analysis_lock.release()

@video_bp.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "model": OLLAMA_MODEL,
        "florence_available": FlorenceEngine._available,
        "modes": ["basic", "advanced"]
    })

@video_bp.route('/supported-actions', methods=['GET'])
def supported_actions():
    actions = []
    for action_id, name in SUPPORTED_ACTIONS.items():
        actions.append({"id": action_id, "name": name})
    return jsonify({"actions": actions})

