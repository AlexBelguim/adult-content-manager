"""
Video Analysis Module for NSFW Scene Segmentation
Integrates into AI Inference App (server.py) at :3344

Two modes:
  - Free mode: VLM auto-labels actions with open vocabulary
  - Labels mode: VLM picks from user-specified action list

Pipeline: Frame Extraction → CLIP Scene Detection → VLM Classification → Temporal Smoothing
"""

import os, sys, time, json, subprocess, tempfile, threading, base64, io, re
from pathlib import Path
from flask import Blueprint, request, jsonify

video_bp = Blueprint('video_analysis', __name__)

# ── Global State ────────────────────────────────────────────────────────────────
_cancel_flag = threading.Event()
_analysis_lock = threading.Lock()
_current_progress = {"status": "idle", "message": "", "progress": 0}

def map_path(path):
    """Maps remote paths (TrueNAS) to local paths (Windows)."""
    if not path:
        return path
    # Normalize slashes to Windows-style for consistency
    p = path.replace('/', '\\')
    # If it starts with \media
    if p.startswith('\\media'):
        return 'Z:\\Apps\\adultManager' + p
    return p

# ── Configuration ───────────────────────────────────────────────────────────────
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "minicpm-v:latest")

# Default supported actions (used when user provides specific labels)
SUPPORTED_ACTIONS = {
    'missionary': 'Missionary',
    'cowgirl': 'Cowgirl / Woman on top',
    'reverse_cowgirl': 'Reverse Cowgirl',
    'doggy': 'Doggy style',
    'anal': 'Anal penetration',
    'anal_doggy': 'Anal doggy style',
    'blowjob': 'Blowjob / Oral',
    'cunnilingus': 'Cunnilingus / Oral',
    'fingering_pussy': 'Fingering (pussy)',
    'fingering_anal': 'Fingering (anal)',
    'dildo_pussy': 'Pussy dildo play',
    'dildo_anal': 'Anal dildo play',
    'dildo_blowjob': 'Dildo blowjob',
    'dildo_handjob': 'Dildo handjob',
    'handjob': 'Handjob',
    'titfuck': 'Titjob',
    'boob_teasing': 'Boob teasing',
    'handbra': 'Handbra',
    '69': 'Sixty-nine (69)',
    'rimming': 'Rimming / Analingus',
    'tribadism': 'Tribadism / Scissoring',
    'cumshot': 'Cumshot / Climax',
    'foreplay': 'Foreplay / Kissing',
    'masturbation_solo': 'Solo masturbation',
    'nudity': 'Nudity / Posing',
    'idle': 'Idle / Transition',
    'other': 'Other'
}

def log(msg):
    timestamp = time.strftime('%H:%M:%S')
    print(f"[{timestamp}] [Video] {msg}", flush=True)

# ── Frame Extraction ────────────────────────────────────────────────────────────
def extract_frames(video_path, interval_sec=12, start_time=None, end_time=None):
    """Extract frames from video at given interval using ffmpeg."""
    duration = get_video_duration(video_path)
    if duration <= 0:
        log(f"⚠️ Could not determine video duration for {video_path}")
        return []

    s = start_time if start_time is not None else 0
    e = end_time if end_time is not None else duration
    
    frames = []
    t = s
    while t < e:
        if _cancel_flag.is_set():
            log("🛑 Frame extraction cancelled")
            return frames
        
        frame_data = extract_single_frame(video_path, t)
        if frame_data:
            frames.append({"time": t, "data": frame_data})
        t += interval_sec
    
    log(f"📸 Identified {len(frames)} analysis points ({s:.0f}s - {e:.0f}s, interval={interval_sec}s)")
    return frames

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
            # Split concatenated JPEGs (JPEG starts with \xFF\xD8)
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
    """Extract a single frame at given timestamp, return as base64 JPEG."""
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

def extract_multi_frames(video_path, center_time, count=3, span_sec=2):
    """Extract multiple frames around a center time for context."""
    half = span_sec / 2
    times = []
    for i in range(count):
        t = center_time - half + (span_sec / max(count - 1, 1)) * i
        times.append(max(0, t))
    
    frames = []
    for t in times:
        data = extract_single_frame(video_path, t)
        if data:
            frames.append(data)
    return frames

def get_video_duration(video_path):
    """Get video duration in seconds using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_format', video_path
        ]
        # Use encoding='utf-8' and errors='replace' to safely handle special characters on Windows
        result = subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', timeout=10)
        
        if result.returncode == 0 and result.stdout:
            info = json.loads(result.stdout)
            return float(info.get('format', {}).get('duration', 0))
        elif result.returncode != 0:
            log(f"  ⚠️ ffprobe returned code {result.returncode}")
            if result.stderr:
                log(f"  ⚠️ ffprobe stderr: {result.stderr[:200]}")
    except Exception as ex:
        log(f"  ⚠️ ffprobe failed: {ex}")
    return 0

# ── VLM Classification via Ollama ───────────────────────────────────────────────
def classify_frame_vlm(frame_b64_list, allowed_actions=None, window_size=None):
    """
    Classify action in frame(s) using Ollama VLM.
    
    Two modes:
      - Free mode (allowed_actions empty): VLM freely describes the action
      - Labels mode (allowed_actions provided): VLM picks from the list
    """
    import requests
    
    if allowed_actions and len(allowed_actions) > 0:
        # ── Labels Mode: constrained classification ──
        action_list = "\n".join(f"- {a}" for a in allowed_actions)
        prompt = f"""Task: Classify the sexual action in this frame.
Choices:
{action_list}

Rules:
1. Choose the best match from the list.
2. Output ONLY JSON. No talk, no explanations, no mention of 'guidelines'.
3. Use this format: {{"action": "choice", "confidence": 0.9}}"""
    else:
        # ── Free Mode: open vocabulary ──
        prompt = """Task: Analyze the motion in these frames and describe the primary sexual action.

Focus: Watch the movement carefully. Distinguish between human fingers and synthetic toys (dildos, vibrators). 
Note: Toys can be flesh-colored; look for their shape and mechanical motion.

Taxonomy Guide (Target these specific detail levels):
- TOYS: pussy dildo play, anal dildo play, dildo blowjob, dildo handjob, vibrator play
- MANUAL: fingering pussy, fingering ass, handjob, handbra, boob teasing, titjob
- ORAL: blowjob, cunnilingus, rimming, 69, deepthroat
- PENETRATION: missionary, cowgirl, reverse cowgirl, doggy style, anal, anal doggy
- FINALE: cumshot, facial, creampie
- OTHER: idle, transition (Only use 'nudity' if NO specific action is happening)

Rules:
1. Output ONLY the specific action label. Do NOT include category names.
2. If any toy is visible, prioritize 'toy' labels (e.g. 'pussy dildo play').
3. Output ONLY JSON. No talk, no explanations.
4. Format: {"action": "fingering pussy", "confidence": 0.9}"""

    try:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": [{
                "role": "user",
                "content": prompt,
                "images": frame_b64_list[:3]  # Max 3 frames for context
            }],
            "stream": False,
            "options": {
                "temperature": 0.1,
                "num_predict": 100
            }
        }
        
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json=payload,
            timeout=120
        )
        
        if resp.status_code == 200:
            content = resp.json().get("message", {}).get("content", "")
            return parse_vlm_response(content, allowed_actions)
        else:
            hint = ""
            if resp.status_code == 404:
                hint = f" (Is the model '{OLLAMA_MODEL}' downloaded? Run 'ollama pull {OLLAMA_MODEL}')"
            log(f"  ⚠️ Ollama returned status {resp.status_code}{hint}")
            return {"action": "other", "confidence": 0.0}
            
    except Exception as ex:
        log(f"  ⚠️ VLM classification failed: {ex}")
        return {"action": "other", "confidence": 0.0}

def parse_vlm_response(content, allowed_actions=None):
    """Parse VLM JSON response, with fallback for malformed output."""
    try:
        # Clean the content a bit (remove markdown code blocks)
        content = re.sub(r'```json\s*|\s*```', '', content).strip()
        
        # Try to extract JSON from response
        json_match = re.search(r'\{[^}]+\}', content)
        if json_match:
            data = json.loads(json_match.group())
            action = str(data.get("action", "other")).lower().strip()
            confidence = float(data.get("confidence", 0.5))
            
            # Strip category prefixes (e.g. "manual: fingering" -> "fingering")
            for prefix in ['toys:', 'manual:', 'oral:', 'penetration:', 'finale:', 'other:', 'toys ', 'manual ', 'oral ', 'penetration ', 'finale ', 'other ']:
                if action.startswith(prefix):
                    action = action[len(prefix):].strip()
                    break
            
            # Additional cleanup for disclaimers
            if "based on" in action or "following" in action or "guideline" in action or "openai" in action:
                # Try to find a valid action word in the mess
                for common in ['missionary', 'cowgirl', 'doggy', 'blowjob', 'handjob', 'anal', 'cumshot', 'fingering', 'dildo', 'toy', 'boob', 'rimming']:
                    if common in action:
                        action = common
                        break
                if len(action) > 25: # Still too long?
                    action = "other"
            
            # In labels mode, validate action is in the allowed list
            if allowed_actions and len(allowed_actions) > 0:
                # Try fuzzy match
                matched = None
                for a in allowed_actions:
                    if a.lower() == action or a.lower() in action or action in a.lower():
                        matched = a
                        break
                if not matched:
                    matched = "other" if "other" in [x.lower() for x in allowed_actions] else allowed_actions[0]
                    confidence = max(0.1, confidence * 0.5)
                action = matched
            
            return {"action": action, "confidence": min(1.0, max(0.0, confidence))}
    except (json.JSONDecodeError, ValueError):
        pass
    
    # Fallback: try to extract action from plain text
    action = content.strip().lower().split('\n')[0][:50]
    if allowed_actions:
        for a in allowed_actions:
            if a.lower() in action:
                return {"action": a, "confidence": 0.3}
        return {"action": allowed_actions[0] if allowed_actions else "other", "confidence": 0.1}
    return {"action": action if action else "other", "confidence": 0.3}

# ── Temporal Smoothing ──────────────────────────────────────────────────────────
def smooth_segments(raw_segments, min_segment_duration=10):
    """
    Post-process raw frame-level labels into clean segments.
    1. Merge consecutive frames with same label
    2. Absorb short segments into neighbors
    3. Remove flickering (A-B-A where B < 3s → A-A-A)
    """
    if not raw_segments:
        return []
    
    # Step 1: Merge consecutive same-label frames into segments
    merged = []
    current = {
        "action": raw_segments[0]["action"],
        "start": raw_segments[0]["time"],
        "end": raw_segments[0]["time"],
        "confidence": raw_segments[0].get("confidence", 0.5),
        "count": 1
    }
    
    for seg in raw_segments[1:]:
        if seg["action"] == current["action"]:
            current["end"] = seg["time"]
            current["confidence"] = (current["confidence"] * current["count"] + seg.get("confidence", 0.5)) / (current["count"] + 1)
            current["count"] += 1
        else:
            merged.append(current)
            current = {
                "action": seg["action"],
                "start": seg["time"],
                "end": seg["time"],
                "confidence": seg.get("confidence", 0.5),
                "count": 1
            }
    merged.append(current)
    
    # Step 2: Remove flickering — if A-B-A and B is single frame, collapse to A
    if len(merged) >= 3:
        cleaned = [merged[0]]
        i = 1
        while i < len(merged) - 1:
            prev = cleaned[-1]
            curr = merged[i]
            nxt = merged[i + 1]
            
            if prev["action"] == nxt["action"] and curr["count"] <= 1:
                # Absorb the flicker into prev
                prev["end"] = nxt["end"]
                prev["count"] += curr["count"] + nxt["count"]
                i += 2  # Skip both curr and nxt
            else:
                cleaned.append(curr)
                i += 1
        
        if i < len(merged):
            cleaned.append(merged[-1])
        merged = cleaned
    
    # Step 3: Absorb short segments into neighbors
    final = []
    for seg in merged:
        duration = seg["end"] - seg["start"]
        if duration < min_segment_duration and final:
            # Absorb into previous segment
            final[-1]["end"] = seg["end"]
        else:
            final.append(seg)
    
    return final

def segments_to_response(segments, interval_sec, video_duration):
    """Convert internal segments to API response format."""
    result = []
    for i, seg in enumerate(segments):
        # Extend end time to cover the gap to next segment
        if i < len(segments) - 1:
            end = segments[i + 1]["start"]
        else:
            end = min(seg["end"] + interval_sec, video_duration) if video_duration > 0 else seg["end"] + interval_sec
        
        start = seg["start"]
        duration = end - start
        
        if duration <= 0:
            continue
            
        action = seg["action"]
        action_name = SUPPORTED_ACTIONS.get(action, action.replace('_', ' ').title())
        
        result.append({
            "start": round(start, 1),
            "end": round(end, 1),
            "duration": round(duration, 1),
            "action": action,
            "action_name": action_name,
            "confidence": round(seg.get("confidence", 0.5), 2)
        })
    
    return result

# ── Main Analysis Pipeline ──────────────────────────────────────────────────────
def analyze_video(video_path, segment_duration=12, min_segment=10,
                  allowed_actions=None, start_time=None, end_time=None,
                  window_size=None):
    """
    Full video analysis pipeline.
    
    Args:
        video_path: Path to video file
        segment_duration: Seconds between frame samples
        min_segment: Minimum segment duration to keep
        allowed_actions: List of action labels (empty = free mode)
        start_time: Optional start time for partial analysis
        end_time: Optional end time for partial analysis
        window_size: Optional override for segment_duration
    """
    global _current_progress
    _cancel_flag.clear()
    
    interval = int(window_size) if window_size else segment_duration
    
    _current_progress = {"status": "extracting", "message": "Extracting frames...", "progress": 0}
    log(f"🎬 Starting analysis: {video_path}")
    log(f"   Mode: {'Labels (' + ','.join(allowed_actions) + ')' if allowed_actions else 'Free'}")
    log(f"   Interval: {interval}s, Min segment: {min_segment}s")
    
    video_duration = get_video_duration(video_path)
    if video_duration <= 0:
        return {"success": False, "error": "Could not determine video duration"}
    
    log(f"   Duration: {video_duration:.0f}s")
    
    # Step 1: Extract frames
    frames = extract_frames(video_path, interval, start_time, end_time)
    if not frames:
        return {"success": False, "error": "No frames extracted"}
    
    if _cancel_flag.is_set():
        return {"success": False, "cancelled": True}
    
    # Step 2: Classify each frame with VLM
    _current_progress = {"status": "classifying", "message": "Classifying actions...", "progress": 0}
    raw_segments = []
    
    for i, frame in enumerate(frames):
        if _cancel_flag.is_set():
            return {"success": False, "cancelled": True}
        
        progress = int((i / len(frames)) * 100)
        _current_progress = {
            "status": "classifying",
            "message": f"Classifying frame {i+1}/{len(frames)} ({frame['time']:.0f}s)...",
            "progress": progress
        }
        
        # Use a burst of 12 frames over 3 seconds (4 FPS) for more temporal detail
        context_frames = extract_burst_frames(video_path, frame["time"], duration_sec=3, count=12)
        
        # Fallback to single frame if burst fails
        if not context_frames:
             log(f"   ⚠️ Burst failed at {frame['time']}s, using single frame")
             context_frames = [frame["data"]]
        else:
             # Success! Log that we are using the burst
             pass # We log the result anyway, no need to spam 'Using 8 frames'
        
        result = classify_frame_vlm(context_frames, allowed_actions)
        raw_segments.append({
            "time": frame["time"],
            "action": result["action"],
            "confidence": result.get("confidence", 0.5)
        })
        
        log(f"   {frame['time']:.0f}s → {result['action']} ({result.get('confidence', 0):.0%})")
    
    if _cancel_flag.is_set():
        return {"success": False, "cancelled": True}
    
    # Step 3: Temporal smoothing
    _current_progress = {"status": "smoothing", "message": "Smoothing segments...", "progress": 90}
    segments = smooth_segments(raw_segments, min_segment)
    
    # Convert to response format
    response_segments = segments_to_response(segments, interval, video_duration)
    
    _current_progress = {"status": "done", "message": "Analysis complete!", "progress": 100}
    log(f"✅ Analysis complete: {len(response_segments)} segments found")
    
    return {
        "success": True,
        "segments": response_segments,
        "segment_count": len(response_segments),
        "duration": video_duration,
        "processing_time": 0,  # TODO: track
        "mode": "labels" if allowed_actions else "free"
    }

# ── Binary Search Transition Finding ────────────────────────────────────────────
def find_transition_point(video_path, start_time, end_time, label_1, label_2,
                          original_window_size=0, max_iterations=8):
    """Binary search for exact transition between two actions."""
    log(f"🔍 Finding transition: {label_1} → {label_2} ({start_time:.1f}s - {end_time:.1f}s)")
    
    low = start_time
    high = end_time
    
    for iteration in range(max_iterations):
        if _cancel_flag.is_set():
            return {"success": False, "cancelled": True}
        
        mid = (low + high) / 2
        frame_data = extract_single_frame(video_path, mid)
        
        if not frame_data:
            break
        
        result = classify_frame_vlm([frame_data], [label_1, label_2])
        action = result["action"]
        
        log(f"   Iteration {iteration+1}: {mid:.1f}s → {action}")
        
        if action.lower() == label_1.lower() or label_1.lower() in action.lower():
            low = mid
        else:
            high = mid
        
        if high - low < 0.5:
            break
    
    transition_point = round((low + high) / 2, 1)
    log(f"   ✅ Transition at {transition_point}s")
    
    return {
        "success": True,
        "transition_point": transition_point,
        "iterations": iteration + 1,
        "final_range": [round(low, 1), round(high, 1)]
    }

# ── Flask Routes ────────────────────────────────────────────────────────────────

@video_bp.route('/health', methods=['GET'])
def video_health():
    """Health check for video analysis capability."""
    import requests as req
    ollama_ok = False
    try:
        r = req.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
    except:
        pass
    
    return jsonify({
        "status": "ok",
        "ollama_connected": ollama_ok,
        "ollama_url": OLLAMA_URL,
        "ollama_model": OLLAMA_MODEL,
        "mode": "integrated"
    })

@video_bp.route('/supported-actions', methods=['GET'])
def video_supported_actions():
    """Return list of supported action categories."""
    actions = []
    for action_id, name in SUPPORTED_ACTIONS.items():
        actions.append({
            "id": action_id,
            "name": name,
            "category": "position" if action_id in ['missionary','cowgirl','reverse_cowgirl','doggy','anal_doggy','anal'] 
                        else "oral" if action_id in ['blowjob','cunnilingus','69','rimming','dildo_blowjob']
                        else "manual" if action_id in ['handjob','fingering_pussy','fingering_anal','titfuck','boob_teasing','handbra','dildo_handjob']
                        else "toys" if 'dildo' in action_id or 'vibrator' in action_id
                        else "other"
        })
    return jsonify({"actions": actions})

@video_bp.route('/categories', methods=['GET'])
def video_categories():
    """Legacy endpoint for action categories."""
    return jsonify({"categories": list(SUPPORTED_ACTIONS.keys())})

@video_bp.route('/analyze', methods=['POST'])
def video_analyze():
    """Analyze a video to detect action timeline."""
    data = request.json or {}
    video_path = map_path(data.get('video_path'))
    
    if not video_path:
        return jsonify({"success": False, "error": "video_path is required"}), 400
    
    if not os.path.exists(video_path):
        return jsonify({"success": False, "error": f"Video not found: {video_path}"}), 404
    
    if not _analysis_lock.acquire(blocking=False):
        return jsonify({"success": False, "error": "Analysis already in progress"}), 409
    
    try:
        # Clean allowed_actions: filter empty strings, treat empty list as free mode
        raw_actions = data.get('allowed_actions', [])
        allowed = [a.strip() for a in raw_actions if a and a.strip()] if raw_actions else []
        
        result = analyze_video(
            video_path=video_path,
            segment_duration=data.get('segment_duration', 12),
            min_segment=data.get('min_segment', 10),
            allowed_actions=allowed if allowed else None,
            start_time=data.get('start_time'),
            end_time=data.get('end_time'),
            window_size=data.get('window_size')
        )
        return jsonify(result)
    finally:
        _analysis_lock.release()

@video_bp.route('/analyze-frame', methods=['POST'])
def video_analyze_frame():
    """Analyze a single frame from a video."""
    data = request.json or {}
    video_path = map_path(data.get('video_path'))
    time_sec = data.get('time')
    
    if not video_path or time_sec is None:
        return jsonify({"success": False, "error": "video_path and time required"}), 400
    
    frame_data = extract_single_frame(video_path, time_sec)
    if not frame_data:
        return jsonify({"success": False, "error": "Failed to extract frame"}), 500
    
    result = classify_frame_vlm([frame_data], data.get('allowed_actions', []))
    return jsonify({"success": True, "time": time_sec, **result})

@video_bp.route('/find-action', methods=['POST'])
def video_find_action():
    """Find segments containing a specific action."""
    data = request.json or {}
    video_path = map_path(data.get('video_path'))
    action = data.get('action')
    
    if not video_path or not action:
        return jsonify({"success": False, "error": "video_path and action required"}), 400
    
    if not _analysis_lock.acquire(blocking=False):
        return jsonify({"success": False, "error": "Analysis already in progress"}), 409
    
    existing = data.get('existing_segments', [])
    min_duration = data.get('min_duration', 5)
    
    # Get nice name
    action_name = SUPPORTED_ACTIONS.get(action, action.replace('_', ' ').title())
    
    try:
        # Run analysis with only this action + other as options
        result = analyze_video(
            video_path=video_path,
            segment_duration=8,  # Finer sampling for targeted search
            min_segment=min_duration,
            allowed_actions=[action, 'other']
        )
    
        if not result.get("success"):
            return jsonify(result)
    
        # Filter to only the requested action segments
        matching = [s for s in result.get("segments", []) if s["action"] == action]
    
        # Remove segments that overlap with existing
        if existing:
            filtered = []
            for seg in matching:
                overlaps = False
                for ex in existing:
                    ex_start = ex.get('start', 0)
                    ex_end = ex.get('end', 0)
                    if seg['start'] < ex_end and seg['end'] > ex_start:
                        overlaps = True
                        break
                if not overlaps:
                    filtered.append(seg)
            matching = filtered
    
        return jsonify({
            "success": True,
            "action": action,
            "action_name": action_name,
            "segments": matching,
            "segment_count": len(matching)
        })
    finally:
        _analysis_lock.release()

@video_bp.route('/find-transition-point', methods=['POST'])
def video_find_transition():
    """Find exact transition point between two actions using binary search."""
    data = request.json or {}
    video_path = map_path(data.get('video_path'))
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    label_1 = data.get('label_1')
    label_2 = data.get('label_2')
    
    if not all([video_path, start_time is not None, end_time is not None, label_1, label_2]):
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    
    result = find_transition_point(
        video_path, start_time, end_time, label_1, label_2,
        data.get('original_window_size', 0)
    )
    return jsonify(result)

@video_bp.route('/cancel', methods=['POST'])
def video_cancel():
    """Cancel running analysis."""
    _cancel_flag.set()
    log("🛑 Analysis cancellation requested")
    return jsonify({"success": True, "message": "Cancellation requested"})

@video_bp.route('/progress', methods=['GET'])
def video_progress():
    """Get current analysis progress."""
    return jsonify(_current_progress)
