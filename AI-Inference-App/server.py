try:
    try:
        import os, sys, torch, time, requests, io
    except ImportError:
        import os, sys
        print("📦 Installing missing dependencies (requests)...")
        os.system(f"{sys.executable} -m pip install requests")
        import requests, io

    from pathlib import Path
    from flask import Flask, request, jsonify
    from PIL import Image
    from transformers import AutoImageProcessor
    from flask_cors import CORS
except Exception as e:
    print(f"\n❌ CRITICAL STARTUP ERROR: {e}")
    import traceback
    traceback.print_exc()
    input("\nPress ENTER to close...")
    sys.exit(1)
from calibration import CalibrationEngine

# Add current dir to path for model import
sys.path.insert(0, str(Path(__file__).parent))
from model_dinov2 import DinoV2PreferenceModel

# Initialize Calibration Engine
CALIBRATOR = CalibrationEngine()

app = Flask(__name__)
CORS(app) # Enable CORS for frontend access

# Global model state
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL = None
PROCESSOR = None
MODEL_NAME = None

def log(msg):
    """Immediate flushing logger to bypass terminal buffering."""
    timestamp = time.strftime('%H:%M:%S')
    print(f"[{timestamp}] {msg}", flush=True)
    sys.stdout.flush()

# Enhanced device logging
log(f"🚀 INITIALIZING AI SERVER")
log(f"🐍 Python Version: {sys.version.split(' ')[0]}")
log(f"🔥 Torch Version: {torch.__version__}")
log(f"🔌 CUDA Available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    log(f"🎮 GPU Device: {torch.cuda.get_device_name(0)}")
    log(f"⚙️ CUDA Version: {torch.version.cuda}")
else:
    log("⚠️ CUDA NOT DETECTED - FALLING BACK TO CPU")
    if sys.platform == 'win32':
        log("💡 TIP: On Windows, you may need to install torch with CUDA support: https://pytorch.org/get-started/locally/")

def find_models():
    models_path = Path(__file__).parent / 'models'
    return list(models_path.glob('*.pt')) if models_path.exists() else []

def load_model(checkpoint_path):
    global MODEL, PROCESSOR, MODEL_NAME
    try:
        log(f"📦 Loading checkpoint: {checkpoint_path}")
        checkpoint = torch.load(checkpoint_path, map_location=DEVICE)
        
        config = checkpoint.get('config', {})
        MODEL_NAME = config.get('model_name', "facebook/dinov2-large")
        
        log(f"🦕 Architecture: {MODEL_NAME} (Device: {DEVICE})")
        
        # Initialize model
        MODEL = DinoV2PreferenceModel(model_name=MODEL_NAME, freeze_backbone=True)
        
        # Load state dict
        # We use strict=False because some checkpoints might omit frozen backbone weights
        MODEL.load_state_dict(checkpoint['model_state_dict'], strict=False)
        MODEL.to(DEVICE)
        MODEL.eval()
        
        # Load processor
        PROCESSOR = AutoImageProcessor.from_pretrained(
            MODEL_NAME,
            do_resize=True,
            size={"shortest_edge": 518},
            do_center_crop=True,
            crop_size={"height": 518, "width": 518}
        )
        
        log(f"✅ Model loaded successfully on {DEVICE}")
        return True, "Success"
    except Exception as e:
        log(f"❌ Error loading model: {e}")
        return False, str(e)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok', 
        'device': str(DEVICE), 
        'model_loaded': MODEL is not None,
        'model_name': MODEL_NAME,
        'vram_allocated': f"{torch.cuda.memory_allocated(DEVICE)/1024**2:.2f} MB" if torch.cuda.is_available() else "0 MB"
    })

@app.route('/test', methods=['GET'])
def test():
    log("🏓 Ping received on /test")
    return jsonify({'message': 'Server is alive and reachable!', 'time': time.ctime()})

@app.route('/load_model', methods=['POST'])
def api_load_model():
    data = request.json
    model_id = data.get('model_id') # e.g. 'final_model.pt'
    
    models_path = Path(__file__).parent / 'models'
    target = models_path / model_id if model_id else None
    
    if not target or not target.exists():
        # Fallback to latest
        models = find_models()
        if not models: return jsonify({"success": False, "error": "No models found"}), 404
        models.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        target = models[0]
        
    success, msg = load_model(str(target))
    return jsonify({"success": success, "message": msg, "model": MODEL_NAME})

@app.route('/unload_model', methods=['POST'])
def api_unload_model():
    global MODEL, PROCESSOR, MODEL_NAME
    log("♻️ Unloading model to free resources...")
    MODEL = None
    PROCESSOR = None
    MODEL_NAME = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return jsonify({"success": True, "message": "Model unloaded"})

@app.route('/list_models', methods=['GET'])
def api_list_models():
    models = find_models()
    return jsonify({
        "success": True,
        "models": [m.name for m in models],
        "current": MODEL_NAME
    })

@app.route('/calibrate', methods=['POST'])
def calibrate():
    try:
        data = request.json
        ratings = data.get('ratings', [])
        log(f"📉 CALIBRATING with {len(ratings)} ratings...")
        model = CALIBRATOR.fit_user_curve(ratings)
        return jsonify({"success": True, "model": model})
    except Exception as e:
        log(f"❌ Calibration Error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/predict_batch', methods=['POST'])
def predict_batch():
    try:
        data = request.json
        performers = data.get('performers', [])
        manual_ratings = data.get('manual_ratings', {})
        # Optional: update model if provided in request
        model_data = data.get('model')
        if model_data:
            CALIBRATOR.load_model(model_data)
            
        log(f"🔮 PREDICTING BATCH for {len(performers)} performers...")
        predictions = CALIBRATOR.predict_batch(performers, manual_ratings, ranks=data.get('ranks'))
        return jsonify({"success": True, "predictions": predictions})
    except Exception as e:
        log(f"❌ Prediction Error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/classify_batch', methods=['POST'])
def classify_batch():
    """Binary classification (Keep/Delete) for Smart Filtering."""
    if MODEL is None: return jsonify({'error': 'Model not loaded'}), 500
    
    data = request.json
    image_paths = data.get('images', [])
    threshold = data.get('threshold', 50.0)
    app_base_url = data.get('app_base_url')
    
    if not image_paths: return jsonify({'error': 'No images'}), 400
    
    log(f"🧠 SMART FILTERING {len(image_paths)} images (Threshold: {threshold})...")
    start_time = time.time()
    results = []
    
    batch_size = 4
    for i in range(0, len(image_paths), batch_size):
        batch_paths = image_paths[i:i+batch_size]
        imgs = []
        valid_paths = []
        
        for p in batch_paths:
            try:
                img = None
                # 1. Local
                if os.path.exists(p):
                    img = Image.open(p).convert('RGB')
                # 2. Remote
                elif app_base_url:
                    clean_path = p.replace('\\', '/')
                    if not clean_path.startswith('/'): clean_path = '/' + clean_path
                    url = f"{app_base_url.rstrip('/')}/api/files/raw?path={clean_path}"
                    resp = requests.get(url, timeout=5)
                    if resp.status_code == 200:
                        img = Image.open(io.BytesIO(resp.content)).convert('RGB')
                    else:
                        log(f"  ❌ Failed to fetch remote: {url} (Status: {resp.status_code})")
                
                if img:
                    imgs.append(img)
                    valid_paths.append(p)
                else:
                    log(f"  ❌ Image not found: {p}")
            except Exception as e:
                log(f"  ⚠️ Skipping {p}: {e}")
            
        if imgs:
            try:
                with torch.no_grad():
                    inputs = PROCESSOR(images=imgs, return_tensors="pt")
                    pixel_values = inputs['pixel_values'].to(DEVICE)
                    raw_scores = MODEL.forward_single(pixel_values)
                    normalized = torch.sigmoid(raw_scores) * 100
                    scores = normalized.cpu().numpy().flatten().tolist()
                    
                    for p, s in zip(valid_paths, scores):
                        decision = "keep" if s >= threshold else "delete"
                        results.append({
                            'path': p, 
                            'score': s, 
                            'decision': decision
                        })
            except Exception as e:
                log(f"  ❌ Batch Error: {e}")

    log(f"✅ Classification completed in {time.time() - start_time:.2f}s")
    
    if not results:
        return jsonify({"success": False, "error": "Failed to process any images. Check AI server logs."}), 500
        
    return jsonify({'success': True, 'results': results})

@app.route('/classify', methods=['POST'])
def classify_single():
    """Single image classification (Keep/Delete)."""
    if MODEL is None: return jsonify({'error': 'Model not loaded'}), 500
    
    data = request.json
    image_path = data.get('image')
    threshold = data.get('threshold', 50.0)
    
    if not image_path or not os.path.exists(image_path):
        return jsonify({'error': 'Invalid image path'}), 400
        
    try:
        img = Image.open(image_path).convert('RGB')
        with torch.no_grad():
            inputs = PROCESSOR(images=[img], return_tensors="pt")
            pixel_values = inputs['pixel_values'].to(DEVICE)
            raw_scores = MODEL.forward_single(pixel_values)
            score = (torch.sigmoid(raw_scores) * 100).item()
            decision = "keep" if score >= threshold else "delete"
            
        return jsonify({
            'success': True, 
            'path': image_path, 
            'score': score, 
            'decision': decision,
            'confidence': score if decision == "keep" else (100 - score)
        })
    except Exception as e:
        log(f"❌ Single Classification Error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/score', methods=['POST'])
def score_images():
        batch_paths = image_paths[i:i+batch_size]
        imgs = []
        valid_paths = []
        
        for p in batch_paths:
            try:
                if os.path.exists(p):
                    imgs.append(Image.open(p).convert('RGB'))
                    valid_paths.append(p)
            except Exception as e:
                log(f"  ⚠️ Skipping {p}: {e}")
            
        if imgs:
            log(f"  ⚡ Batch {i//batch_size + 1}: Inferencing {len(imgs)} images...")
            try:
                with torch.no_grad():
                    inputs = PROCESSOR(images=imgs, return_tensors="pt")
                    pixel_values = inputs['pixel_values'].to(DEVICE)
                    
                    # Get scores (returns normalized 0-100 via Sigmoid)
                    raw_scores = MODEL.forward_single(pixel_values)
                    normalized = torch.sigmoid(raw_scores) * 100
                    scores = normalized.cpu().numpy().tolist()
                    
                    if not isinstance(scores, list): scores = [scores]
                    for p, s in zip(valid_paths, scores):
                        results.append({'path': p, 'normalized': s})
            except Exception as e:
                log(f"  ❌ Batch Error: {e}")
    
    log(f"✅ Request completed in {time.time() - start_time:.2f}s")
    return jsonify({'success': True, 'results': results})

if __name__ == '__main__':
    # Models are now loaded dynamically by the frontend on mount
    log("🚀 AI Server starting on http://0.0.0.0:3344 (Idle - Waiting for model load)")
    # Using use_reloader=False to prevent double model loading in debug mode
    app.run(host='0.0.0.0', port=3344, threaded=True, debug=True, use_reloader=False)
