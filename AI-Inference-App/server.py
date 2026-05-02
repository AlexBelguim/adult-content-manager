try:
    try:
        import os, sys, torch, time, requests, io
    except ImportError:
        import os, sys
        print("📦 Installing missing dependencies (requests)...")
        os.system(f"{sys.executable} -m pip install requests")
        import requests, io

    from pathlib import Path
    from urllib.parse import quote
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
    result = []
    for m in models:
        info = {
            'filename': m.name,
            'size_mb': round(m.stat().st_size / 1024**2, 1),
            'modified': m.stat().st_mtime,
            'type': 'unknown',
            'backbone': None,
            'val_acc': None,
        }
        try:
            ckpt = torch.load(m, map_location='cpu', weights_only=False)
            info['type'] = ckpt.get('model_type', 'unknown')
            info['backbone'] = ckpt.get('backbone') or ckpt.get('config', {}).get('model_name')
            info['val_acc'] = ckpt.get('val_acc')
            config = ckpt.get('config', {})
            info['epochs'] = config.get('epochs')
            del ckpt  # free memory
        except Exception as e:
            info['error'] = str(e)
        result.append(info)
    result.sort(key=lambda x: x['modified'], reverse=True)
    return jsonify({
        "success": True,
        "models": result,
        "current_loaded": MODEL_NAME,
        "active_model_file": None  # frontend can track this
    })

@app.route('/test_model', methods=['POST'])
def api_test_model():
    """Test a model on a random sample of keep/delete images and return accuracy."""
    data = request.json or {}
    model_id = data.get('model_id')
    base_path = data.get('base_path', '')
    sample_size = min(data.get('sample_size', 50), 200)
    
    if not model_id:
        return jsonify({'success': False, 'error': 'model_id required'}), 400
    
    models_path = Path(__file__).parent / 'models'
    target = models_path / model_id
    if not target.exists():
        return jsonify({'success': False, 'error': f'Model not found: {model_id}'}), 404
    
    log(f"🧪 Testing model: {model_id} (sample={sample_size})")
    
    import random, glob
    IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}
    
    def scan_images(directory):
        imgs = []
        p = Path(directory)
        if not p.exists(): return imgs
        for f in p.rglob('*'):
            if f.suffix.lower() in IMAGE_EXTS:
                imgs.append(str(f))
        return imgs
    
    keep_dir = Path(base_path) / 'after filter performer'
    delete_dir = Path(base_path) / 'deleted keep for training'
    
    keep_imgs = scan_images(keep_dir)
    delete_imgs = scan_images(delete_dir)
    
    if not keep_imgs or not delete_imgs:
        return jsonify({'success': False, 'error': 'Need both keep and delete images for testing'}), 400
    
    # Sample
    k_sample = random.sample(keep_imgs, min(sample_size, len(keep_imgs)))
    d_sample = random.sample(delete_imgs, min(sample_size, len(delete_imgs)))
    
    # Load model temporarily
    try:
        ckpt = torch.load(target, map_location=DEVICE, weights_only=False)
        config = ckpt.get('config', {})
        model_name = config.get('model_name', 'facebook/dinov2-large')
        model_type = ckpt.get('model_type', 'binary')
        
        from model_dinov2 import DinoV2PreferenceModel
        
        if model_type == 'binary':
            from trainer import BinaryClassifier
            test_model = BinaryClassifier(model_name)
            test_model.load_state_dict(ckpt['model_state_dict'], strict=False)
        elif model_type == 'pairwise':
            test_model = DinoV2PreferenceModel(model_name=model_name, freeze_backbone=True)
            test_model.load_state_dict(ckpt['model_state_dict'], strict=False)
        elif model_type == 'context_binary':
            from trainer import ContextBinaryClassifier
            test_model = ContextBinaryClassifier(model_name)
            test_model.load_state_dict(ckpt['model_state_dict'], strict=False)
        else:
            return jsonify({'success': False, 'error': f'Testing not supported for type: {model_type}'}), 400
        
        test_model.to(DEVICE)
        test_model.eval()
        
        processor = AutoImageProcessor.from_pretrained(model_name)
        
        # Test binary models
        if model_type == 'binary':
            correct = 0
            total = 0
            keep_scores = []
            delete_scores = []
            
            with torch.no_grad():
                for img_path, label in [(p, 1) for p in k_sample] + [(p, 0) for p in d_sample]:
                    try:
                        img = Image.open(img_path).convert('RGB')
                        inp = processor(images=img, return_tensors='pt').to(DEVICE)
                        logit = test_model(inp['pixel_values'])
                        prob = torch.sigmoid(logit).item()
                        pred = 1 if prob > 0.5 else 0
                        if pred == label: correct += 1
                        total += 1
                        if label == 1: keep_scores.append(prob)
                        else: delete_scores.append(prob)
                    except: continue
            
            accuracy = correct / max(total, 1)
            avg_keep = sum(keep_scores) / max(len(keep_scores), 1)
            avg_delete = sum(delete_scores) / max(len(delete_scores), 1)
            separation = avg_keep - avg_delete
            
            result = {
                'accuracy': round(accuracy, 4),
                'total_tested': total,
                'correct': correct,
                'avg_keep_score': round(avg_keep, 4),
                'avg_delete_score': round(avg_delete, 4),
                'separation': round(separation, 4),
                'model_type': model_type,
            }
        elif model_type == 'pairwise':
            # Pairwise: test by scoring keep vs delete pairs
            correct = 0
            total = 0
            pairs_tested = min(sample_size, len(k_sample), len(d_sample))
            
            with torch.no_grad():
                for i in range(pairs_tested):
                    try:
                        keep_img = Image.open(k_sample[i]).convert('RGB')
                        del_img = Image.open(d_sample[i]).convert('RGB')
                        k_inp = processor(images=keep_img, return_tensors='pt').to(DEVICE)
                        d_inp = processor(images=del_img, return_tensors='pt').to(DEVICE)
                        k_score, d_score = test_model(k_inp['pixel_values'], d_inp['pixel_values'])
                        if k_score.item() > d_score.item(): correct += 1
                        total += 1
                    except: continue
            
            result = {
                'accuracy': round(correct / max(total, 1), 4),
                'total_tested': total,
                'correct': correct,
                'model_type': model_type,
            }
        elif model_type == 'context_binary':
            # Context-aware binary: uses performer context embeddings from checkpoint
            saved_contexts = ckpt.get('contexts', {})
            hs = test_model.backbone.config.hidden_size
            zero_ctx = torch.zeros(1, hs).to(DEVICE)
            
            correct = 0
            total = 0
            keep_scores = []
            delete_scores = []
            
            # Build mapping: image path -> performer name (from directory structure)
            def get_performer(path):
                parts = Path(path).parts
                for i, p in enumerate(parts):
                    if p in ('pics',):
                        if i > 0: return parts[i-1]
                return None
            
            with torch.no_grad():
                for img_path, label in [(p, 1) for p in k_sample] + [(p, 0) for p in d_sample]:
                    try:
                        perf = get_performer(img_path)
                        ctx = saved_contexts.get(perf, zero_ctx.squeeze(0)).unsqueeze(0).to(DEVICE) if perf else zero_ctx
                        
                        img = Image.open(img_path).convert('RGB')
                        inp = processor(images=img, return_tensors='pt').to(DEVICE)
                        logit = test_model(inp['pixel_values'], ctx)
                        prob = torch.sigmoid(logit).item()
                        pred = 1 if prob > 0.5 else 0
                        if pred == label: correct += 1
                        total += 1
                        if label == 1: keep_scores.append(prob)
                        else: delete_scores.append(prob)
                    except: continue
            
            accuracy = correct / max(total, 1)
            avg_keep = sum(keep_scores) / max(len(keep_scores), 1)
            avg_delete = sum(delete_scores) / max(len(delete_scores), 1)
            separation = avg_keep - avg_delete
            
            result = {
                'accuracy': round(accuracy, 4),
                'total_tested': total,
                'correct': correct,
                'avg_keep_score': round(avg_keep, 4),
                'avg_delete_score': round(avg_delete, 4),
                'separation': round(separation, 4),
                'model_type': model_type,
                'contexts_used': len(saved_contexts),
            }
        
        # Cleanup
        del test_model
        del ckpt
        torch.cuda.empty_cache()
        
        log(f"🧪 Test complete: {result['accuracy']:.1%} accuracy ({result['correct']}/{result['total_tested']})")
        return jsonify({'success': True, 'results': result})
        
    except Exception as e:
        log(f"❌ Test error: {e}")
        import traceback; traceback.print_exc()
        torch.cuda.empty_cache()
        return jsonify({'success': False, 'error': str(e)}), 500

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
                    encoded_path = quote(clean_path, safe='/')
                    url = f"{app_base_url.rstrip('/')}/api/files/raw?path={encoded_path}"
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
    log("📥 RECEIVED SCORING REQUEST")
    if MODEL is None: return jsonify({'error': 'Model not loaded'}), 500
    
    data = request.json
    image_paths = data.get('images', [])
    app_base_url = data.get('app_base_url')
    
    if not image_paths: return jsonify({'error': 'No images'}), 400
    
    log(f"🖼️  Processing {len(image_paths)} images...")
    start_time = time.time()
    results = []
    
    # Process in small batches
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
                    encoded_path = quote(clean_path, safe='/')
                    url = f"{app_base_url.rstrip('/')}/api/files/raw?path={encoded_path}"
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
                    
                    # Get scores (returns normalized 0-100 via Sigmoid)
                    raw_scores = MODEL.forward_single(pixel_values)
                    normalized = torch.sigmoid(raw_scores) * 100
                    scores = normalized.cpu().numpy().tolist()
                    
                    if not isinstance(scores, list): scores = [scores]
                    for p, s in zip(valid_paths, scores):
                        results.append({'path': p, 'normalized': s})
            except Exception as e:
                log(f"  ❌ Batch Error: {e}")

    duration = time.time() - start_time
    log(f"✅ Request completed in {duration:.2f}s")
    return jsonify({'success': True, 'results': results, 'duration': duration})

# ── Training Endpoints ────────────────────────────────────────────────────────
from trainer import training_state, start_training

@app.route('/train', methods=['POST'])
def api_train():
    """Start a training job in the background."""
    data = request.json or {}
    # Unload current inference model to free VRAM for training
    global MODEL, PROCESSOR, MODEL_NAME
    if MODEL is not None:
        log("♻️ Unloading inference model to free VRAM for training...")
        MODEL = None
        PROCESSOR = None
        MODEL_NAME = None
        torch.cuda.empty_cache()

    ok, msg = start_training(data)
    status_code = 200 if ok else 409
    return jsonify({'success': ok, 'message': msg}), status_code

@app.route('/training_status', methods=['GET'])
def api_training_status():
    """Poll current training status."""
    return jsonify(training_state)

if __name__ == '__main__':
    # Models are now loaded dynamically by the frontend on mount
    log("🚀 AI Server starting on http://0.0.0.0:3344 (Idle - Waiting for model load)")
    # Using use_reloader=False to prevent double model loading in debug mode
    app.run(host='0.0.0.0', port=3344, threaded=True, debug=True, use_reloader=False)
