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

    def log_vlm_call(self, phase, timestamp_sec, prompt, frames_b64, response, parsed_result, thinking=None):
        if not self.enabled:
            return
        idx = len(self.entries)
        entry = {
            "idx": idx, "phase": phase, "time": timestamp_sec,
            "prompt": prompt, "response": response,
            "thinking": thinking,
            "parsed": parsed_result, "frame_files": []
        }
        # Save frames as images
        for fi, fb64 in enumerate(frames_b64[:8]):  # save all burst frames + composite
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
            thinking_esc = e["thinking"].replace("<", "&lt;").replace(">", "&gt;") if e.get("thinking") else ""
            parsed = json.dumps(e["parsed"]) if e["parsed"] else ""
            
            thinking_html = f'<div class="thinking-box"><b>🤔 Thinking:</b><br>{thinking_esc}</div>' if thinking_esc else ""
            
            rows.append(f"""<tr>
                <td style="white-space:nowrap">{e['phase']}<br><b>{int(e['time'])}s</b></td>
                <td>{imgs}</td>
                <td><pre style="max-width:400px;font-size:11px">{prompt_esc}</pre></td>
                <td>
                    <pre style="max-width:400px;font-size:11px">{resp_esc}</pre>
                    {thinking_html}
                </td>
                <td><code>{parsed}</code></td>
            </tr>""")
        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Debug Report</title>
<style>
body {{ font-family: system-ui; background: #0a0a0f; color: #e0e0e0; padding: 20px; }}
h1 {{ color: #00e5ff; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #333; padding: 12px; vertical-align: top; text-align: left; }}
th {{ background: #1a1a2e; color: #00e5ff; position: sticky; top: 0; z-index: 10; }}
tr:hover {{ background: #161625; }}
pre {{ margin: 0; color: #ccc; white-space: pre-wrap; font-family: 'Consolas', monospace; }}
code {{ color: #7c4dff; font-weight: bold; }}
img {{ border: 1px solid #333; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); }}
.thinking-box {{ 
    margin-top: 10px; 
    padding: 10px; 
    background: #0f172a; 
    border-left: 4px solid #38bdf8; 
    font-size: 11px; 
    color: #94a3b8;
    border-radius: 0 4px 4px 0;
}}
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
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "huihui_ai/qwen3.5-abliterated:35b")

# Default supported actions
SUPPORTED_ACTIONS = {
    'missionary': 'Missionary',
    'standing_missionary': 'Standing Missionary',
    'cowgirl': 'Cowgirl / Woman on top',
    'reverse_cowgirl': 'Reverse Cowgirl',
    'doggy': 'Doggy style',
    'sideways': 'Sideways doggy style',
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
    'ass_teasing': 'Ass Teasing',
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
        action_list = ", ".join(allowed_actions)
    else:
        action_list = "pussy dildo play, anal dildo play, dildo blowjob, vibrator play, fingering pussy, fingering anal, handjob, boob teasing, handbra, blowjob, cunnilingus, 69, deepthroat, missionary, cowgirl, doggy style, anal, cumshot, facial, creampie, nudity, idle, transition"

    prompt = f"""[SYSTEM: YOU ARE A HIGHLY ACCURATE SEXUAL ACTION CLASSIFIER. FIRST THINK, THEN OUTPUT JSON.]
Task: Classify the primary sexual action in the provided frame.
Choose ONLY ONE exact match from this list: {action_list}

Visual Cues:
- TOYS: If a non-human uniform object (wand, dildo) is used, label as a toy play (e.g. pussy dildo play).
- MANUAL: Fingers must be in DIRECT CONTACT or inserted. Otherwise label as nudity/idle.
- POSTURE: Woman on hands/knees or bent over = doggy style. Woman on back = missionary.

Format your response as follows:
<thought>
[Your internal reasoning about what you see in the image and why it matches a specific category]
</thought>
{{"action": "<action>", "confidence": <float>}}"""

    thinking, content = _call_vlm(prompt, frame_b64_list, max_tokens=2048)
    if content:
        log(f"  🔍 Raw AI ({OLLAMA_MODEL}): {content[:300] if content else '[EMPTY RESPONSE]'}")
        result = parse_vlm_response(content, allowed_actions)
        _debug.log_vlm_call("basic", 0, prompt, frame_b64_list, content, result, thinking=thinking)
        return result
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
            if action in ["<action>", "[action]", "pick_one", "pick one", "pick_one_here"]:
                action = "other"

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
        'fingering pussy', 'fingering ass', 'fingering', 'masturbation',
        'blowjob', 'deepthroat', 'cunnilingus', '69', 'footjob',
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
        # Use only the single frame extracted at the interval point
        result = classify_frame_vlm([frame["data"]], allowed_actions)
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
    """Build message payload for VLM call. Using legacy format for maximum Ollama compatibility."""
    return [{"role": "user", "content": prompt, "images": frame_b64_list}]

def _call_vlm(prompt, frame_b64_list, max_tokens=2048, timeout=None):
    """Send a prompt + images to Ollama VLM, return (thinking, content)."""
    # Force single image for thinking models to reduce token overhead and focus attention
    if len(frame_b64_list) > 1:
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
            content = resp.json().get("message", {}).get("content", "")
            return extract_thinking(content)
        log(f"  ⚠️ VLM HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as ex:
        log(f"  ⚠️ VLM call failed: {ex}")
    return "", ""

def extract_thinking(content):
    """Extract thinking part from Ollama response (e.g. <thought>...</thought>)."""
    if not content:
        return "", ""
    
    thinking = ""
    # 1. Look for explicit thinking tags
    think_match = re.search(r'<(?:thought|think|thinking)>(.*?)</(?:thought|think|thinking)>', content, re.DOTALL | re.IGNORECASE)
    if think_match:
        thinking = think_match.group(1).strip()
        # Remove thinking part from content for JSON parsing
        content = re.sub(r'<(?:thought|think|thinking)>.*?</(?:thought|think|thinking)>', '', content, flags=re.DOTALL | re.IGNORECASE).strip()
    elif "[THOUGHT]" in content.upper() and "[/THOUGHT]" in content.upper():
        parts = re.split(r'\[/?THOUGHT\]', content, flags=re.IGNORECASE)
        if len(parts) >= 3:
            thinking = parts[1].strip()
            content = (parts[0] + parts[2]).strip()
    
    # 2. Heuristic: If there's substantial text before the first JSON brace, treat it as thinking/preamble
    if not thinking and '{' in content:
        idx = content.find('{')
        preamble = content[:idx].strip()
        # If preamble looks like reasoning (more than a few words), extract it
        if len(preamble) > 10:
            thinking = preamble
            content = content[idx:].strip()
            
    return thinking, content

def classify_macro(frame_b64, florence_hint="", time_sec=0):
    """Quick macro scan: people count, scene type, clothing state."""
    ctx = f"\nDetection hint: {florence_hint}" if florence_hint else ""
    prompt = f"""[SYSTEM: OUTPUT ONLY VALID JSON. NO PREAMBLE. NO EXPLANATIONS.]
Identify the scene in this frame. FIRST think about who is in the frame and what is happening.
1. people: number of people involved (0, 1, 2, 3). IMPORTANT: If this is POV (Point-Of-View), the camera holder counts as a person!
2. scene: idle, solo, straight_sex, lesbian, threesome. IMPORTANT: Disembodied penis/hand interacting with woman = 'straight_sex' and 2 people.
3. clothing: clothed, lingerie, nude, stripping

Format: 
<thought> [Your reasoning] </thought>
{{"people": <int>, "scene": "<scene>", "clothing": "<clothing>"}}
"""

    thinking, raw_json = _call_vlm(prompt, [frame_b64], max_tokens=2048)
    result = {"people": 0, "scene": "idle", "clothing": "unknown"}
    if raw_json:
        try:
            cleaned = re.sub(r'```json\s*|\s*```', '', raw_json).strip()
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
    _debug.log_vlm_call("macro", time_sec, prompt, [frame_b64], raw_json, result, thinking=thinking)
    return result

def classify_action_with_context(frame_b64_list, state, florence_caption="", florence_hint="", crop_b64=None, allowed_actions=None, time_sec=0):
    """Action classification with state context, Florence hints, and optional crop."""
    context = state.to_context()
    extra = ""
    if florence_caption:
        extra += f"\nFlorence-2 caption: {florence_caption}"
    if florence_hint:
        extra += f"\nDetected objects: {florence_hint}"

    if allowed_actions:
        action_list = ", ".join(allowed_actions)
    else:
        action_list = "cowgirl, reverse cowgirl, missionary, standing_missionary, doggy style, sideways, blowjob, handjob, footjob, cunnilingus, anal, fingering pussy, pussy dildo play, vibrator play, masturbation, dildo blowjob, boob teasing, ass teasing, cumshot, facial, creampie, nudity, idle"

    prompt = f"""[SYSTEM: YOU ARE A HIGHLY ACCURATE SEXUAL ACTION CLASSIFIER. FIRST THINK, THEN OUTPUT JSON.]
Identify the primary sexual action in the frame. Pick ONE exact match from this list:
{action_list}

Visual Cues:
- missionary / standing_missionary: Woman is lying flat on her BACK (even if legs are up).
- doggy style: Woman is on her STOMACH, ALL FOURS (hands and knees), or BENT OVER. Partner is behind.
- sideways: Woman is lying on her SIDE. Partner is behind.
- blowjob: Mouth is on the penis.
- handjob / cumshot: Penis is being stimulated by a hand.
- boob teasing / ass teasing: ONLY use if no actual intercourse posture is present.

Format your response as follows:
<thought>
[Your internal reasoning about what you see in the image, considering the context provided below]
</thought>
{{"action": "<action>", "confidence": <float>, "insertion": <bool>}}

Context: {context}{extra}"""

    # If we have a crop, add it as the first image for emphasis
    images = list(frame_b64_list)
    if crop_b64:
        images.insert(0, crop_b64)

    thinking, raw_json = _call_vlm(prompt, images)
    if raw_json:
        log(f"  🔍 Advanced AI: {raw_json[:300]}")
        result = parse_vlm_response(raw_json, allowed_actions)
        try:
            m = re.search(r'\{[^}]+\}', re.sub(r'```json\s*|\s*```', '', raw_json))
            if m:
                result["insertion"] = bool(json.loads(m.group()).get("insertion", False))
        except:
            result["insertion"] = False
        _debug.log_vlm_call("action", time_sec, prompt, images, raw_json, result, thinking=thinking)
        return result
    _debug.log_vlm_call("action", time_sec, prompt, images, "(no response)", None, thinking=thinking)
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

    # Florence disabled — captions hallucinate and mislead the VLM
    use_florence = False  # FlorenceEngine.is_available()
    log("Florence-2 pre-pass: DISABLED (captions unreliable)")

    # ── Phase 1: Macro Scan ────────────────────────────────────────────────
    log(f"📊 Phase 1: Macro scan ({macro_interval}s steps, {s:.0f}s-{e:.0f}s)")
    active_windows = []
    macro_history = []
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
        macro_history.append({"time": t, "macro": macro, "people_count": state.people_count})

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

            # Use single frame for action classification
            single_frame = extract_single_frame(video_path, t)
            if not single_frame:
                t += action_interval
                continue
            
            # Sync state with the closest macro scan result
            if macro_history:
                closest = min(macro_history, key=lambda x: abs(x["time"] - t))
                state.scene_type = closest["macro"]["scene"]
                state.clothed_state = closest["macro"]["clothing"]
                state.people_count = closest["people_count"]

            # Florence pre-pass on the frame
            florence_caption = ""
            florence_hint = ""
            crop_b64 = None
            if use_florence:
                dets, _ = FlorenceEngine.detect_objects(single_frame)
                cats = categorize_detections(dets)
                florence_hint = format_detections_for_prompt(cats)

                # Get a caption for richer context
                florence_caption = FlorenceEngine.caption(single_frame)

                # If a toy was detected, crop it for the VLM
                if cats["toys"]:
                    best_toy = cats["toys"][0]
                    crop_b64 = FlorenceEngine.crop_region(single_frame, best_toy["bbox"])
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

            vlm_frames = [single_frame]

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
        
        result = {"success": False, "error": "Internal error during analysis"}
        try:
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
        except Exception as ex:
            log(f"❌ Advanced analysis crashed: {ex}")
            import traceback
            traceback.print_exc()
            result = {"success": False, "error": f"Analysis failed: {str(ex)}"}
        
        # ALWAYS save report if enabled, even on crash
        if _debug.enabled:
            _debug.save_report(video_path=video_path, result=result)
        
        _debug = DebugLogger()  # reset to disabled
        return jsonify(result)

    finally:
        _analysis_lock.release()

@video_bp.route('/cancel', methods=['POST'])
def video_cancel():
    _cancel_flag.set()
    log("⏹ Cancel signal received")
    return jsonify({"success": True, "message": "Analysis cancellation requested"})

@video_bp.route('/health', methods=['GET'])
def video_health():
    return jsonify({
        "status": "ok",
        "model": OLLAMA_MODEL,
        "florence_available": FlorenceEngine._available,
        "modes": ["basic", "advanced"]
    })

log("🎬 Video analysis blueprint initialized")

@video_bp.route('/supported-actions', methods=['GET'])
def supported_actions():
    actions = []
    for action_id, name in SUPPORTED_ACTIONS.items():
        actions.append({"id": action_id, "name": name})
    return jsonify({"actions": actions})