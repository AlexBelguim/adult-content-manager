import os
import json
import base64
import subprocess
import time
import requests
import re
from flask import Blueprint, request, jsonify
from threading import Lock, Event

video_bp = Blueprint('video', __name__)

# ── Global State ──────────────────────────────────────────────────────────────
_analysis_lock = Lock()
_cancel_flag = Event()

def log(msg):
    timestamp = time.strftime('%H:%M:%S')
    print(f"[{timestamp}] [Video] {msg}", flush=True)

# ── Path Mapping ──────────────────────────────────────────────────────────────
def map_path(p):
    if not p: return p
    # Map TrueNAS /media to local Z: drive
    if p.startswith('/media'):
        return 'Z:\\Apps\\adultManager' + p
    return p

# ── Configuration ───────────────────────────────────────────────────────────────
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "minicpm-v:latest")

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
        log(f"  ⚠️ Burst extraction failed at {center_time}s: {ex}")
    return []

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
        payload = {
            "model": OLLAMA_MODEL,
            "messages": [{
                "role": "user",
                "content": prompt,
                "images": frame_b64_list
            }],
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 100}
        }
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=120)
        if resp.status_code == 200:
            content = resp.json().get("message", {}).get("content", "")
            log(f"  🔍 Raw AI: {content[:150] if content else '[EMPTY RESPONSE]'}")
            return parse_vlm_response(content, allowed_actions)
        return {"action": "other", "confidence": 0.0}
    except Exception as ex:
        log(f"  ⚠️ VLM failed: {ex}")
        return {"action": "other", "confidence": 0.0}

def parse_vlm_response(content, allowed_actions=None):
    try:
        content = re.sub(r'```json\s*|\s*```', '', content).strip()
        content = re.sub(r'<\|im_start\|>|<\|im_end\|>|assistant|user|system', '', content).strip()
        json_match = re.search(r'\{[^}]+\}', content)
        if json_match:
            data = json.loads(json_match.group())
            action = str(data.get("action", "other")).lower().strip()
            confidence = float(data.get("confidence", 0.5))
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
    lines = [l.strip().lower() for l in content.split('\n') if l.strip() and not any(t in l.lower() for t in ['<|im', 'assistant', 'user', 'system'])]
    action = lines[0][:50] if lines else "other"
    return {"action": action, "confidence": 0.3}

# ── Pipeline ──────────────────────────────────────────────────────────────────
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

@video_bp.route('/health', methods=['GET'])
def health(): return jsonify({"status": "ok", "model": OLLAMA_MODEL})

@video_bp.route('/supported-actions', methods=['GET'])
def supported_actions():
    actions = []
    for action_id, name in SUPPORTED_ACTIONS.items():
        actions.append({"id": action_id, "name": name})
    return jsonify({"actions": actions})
