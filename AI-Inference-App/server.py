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

# Register video analysis blueprint
try:
    from video_analyzer import video_bp
    app.register_blueprint(video_bp, url_prefix='/video')
    print("🎬 Video analysis module loaded")
except Exception as e:
    print(f"⚠️ Video analysis module not available: {e}")

# Global model state
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL = None
PROCESSOR = None
MODEL_NAME = None
LOADED_MODEL_ID = None
LOADED_MODEL_TYPE = 'pairwise'
CONTEXT_STAR_CACHE = {}  # performer_name → predicted star rating

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
    return list(models_path.rglob('*.pt')) if models_path.exists() else []

def load_model(checkpoint_path, model_id=None):
    global MODEL, PROCESSOR, MODEL_NAME, LOADED_MODEL_ID, LOADED_MODEL_TYPE, CONTEXT_STAR_CACHE
    try:
        log(f"📦 Loading checkpoint: {checkpoint_path}")
        
        # Free resources before loading a new model
        if MODEL is not None:
            log("♻️ Unloading previous model to free resources...")
            MODEL = None
            PROCESSOR = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            import gc
            gc.collect()
            
        checkpoint = torch.load(checkpoint_path, map_location=DEVICE)
        
        config = checkpoint.get('config', {})
        MODEL_NAME = config.get('model_name') or checkpoint.get('backbone') or "facebook/dinov2-large"
        model_type = checkpoint.get('model_type', 'pairwise')
        
        # Auto-detect from filename if model_type is missing
        if model_type == 'unknown' and model_id:
            if 'context' in model_id.lower(): model_type = 'context_binary'
            elif 'binary' in model_id.lower() or 'filtering' in model_id.lower(): model_type = 'binary'
            elif 'pairwise' in model_id.lower() or 'preference' in model_id.lower(): model_type = 'pairwise'
        
        log(f"🦕 Architecture: {MODEL_NAME} | Type: {model_type} (Device: {DEVICE})")
        
        # Initialize the correct model class based on type
        if model_type == 'binary':
            from trainer import BinaryClassifier
            MODEL = BinaryClassifier(MODEL_NAME)
        elif model_type == 'context_binary':
            from trainer import ContextBinaryClassifier
            MODEL = ContextBinaryClassifier(MODEL_NAME)
        else:
            MODEL = DinoV2PreferenceModel(model_name=MODEL_NAME, freeze_backbone=True)
        
        # Load state dict (strict=False: some checkpoints omit frozen backbone weights)
        MODEL.load_state_dict(checkpoint['model_state_dict'], strict=False)
        MODEL.to(DEVICE)
        MODEL.eval()
        LOADED_MODEL_TYPE = model_type
        CONTEXT_STAR_CACHE.clear()
        
        # Load processor
        PROCESSOR = AutoImageProcessor.from_pretrained(MODEL_NAME)
        
        val_acc = checkpoint.get('val_acc')
        if val_acc: log(f"  Val accuracy at save: {val_acc*100:.1f}%")
        if model_type == 'context_binary':
            mae = checkpoint.get('val_star_mae')
            if mae: log(f"  Star prediction MAE: {mae:.2f}")
        
        log(f"✅ Model loaded successfully on {DEVICE}")
        LOADED_MODEL_ID = model_id
        return True, "Success"
    except Exception as e:
        log(f"❌ Error loading model: {e}")
        import traceback; traceback.print_exc()
        return False, str(e)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok', 
        'device': str(DEVICE), 
        'model_loaded': MODEL is not None,
        'model_name': MODEL_NAME,
        'current_model': LOADED_MODEL_ID,
        'vram_allocated': f"{torch.cuda.memory_allocated(DEVICE)/1024**2:.2f} MB" if torch.cuda.is_available() else "0 MB"
    })

@app.route('/test', methods=['GET'])
def test():
    log("🏓 Ping received on /test")
    return jsonify({'message': 'Server is alive and reachable!', 'time': time.ctime()})

@app.route('/load_model', methods=['POST'])
def api_load_model():
    data = request.json
    model_id = data.get('model_id') # e.g. 'binary/binary_filtering.pt' or 'final_model.pt'
    
    models_path = Path(__file__).parent / 'models'
    target = models_path / model_id if model_id else None
    
    if not target or not target.exists():
        # Fallback to latest
        models = find_models()
        if not models: return jsonify({"success": False, "error": "No models found"}), 404
        models.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        target = models[0]
        
    # Use relative path from models dir as the ID
    rel_id = str(target.relative_to(models_path)).replace('\\', '/')
    success, msg = load_model(str(target), model_id=rel_id)
    return jsonify({"success": success, "message": msg, "model": MODEL_NAME})

@app.route('/unload_model', methods=['POST'])
def api_unload_model():
    global MODEL, PROCESSOR, MODEL_NAME, LOADED_MODEL_ID, LOADED_MODEL_TYPE, CONTEXT_STAR_CACHE
    log("♻️ Unloading model to free resources...")
    MODEL = None
    PROCESSOR = None
    MODEL_NAME = None
    LOADED_MODEL_ID = None
    LOADED_MODEL_TYPE = 'pairwise'
    CONTEXT_STAR_CACHE.clear()
    import gc
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        vram = f"{torch.cuda.memory_allocated(DEVICE)/1024**2:.0f} MB"
        log(f"♻️ VRAM after unload: {vram}")
    return jsonify({"success": True, "message": "Model unloaded"})

@app.route('/list_models', methods=['GET'])
def api_list_models():
    models = find_models()
    models_path = Path(__file__).parent / 'models'
    result = []
    for m in models:
        rel_path = str(m.relative_to(models_path)).replace('\\', '/')
        info = {
            'filename': rel_path,
            'size_mb': round(m.stat().st_size / 1024**2, 1),
            'modified': m.stat().st_mtime,
            'type': 'unknown',
            'backbone': None,
            'val_acc': None,
        }
        try:
            ckpt = torch.load(m, map_location='cpu', weights_only=False)
            m_type = ckpt.get('model_type', 'unknown')
            
            # Auto-detect type if unknown
            if m_type == 'unknown':
                if 'pairwise' in m.name.lower() or 'preference' in m.name.lower():
                    m_type = 'pairwise'
                elif 'context' in m.name.lower():
                    m_type = 'context_binary'
                elif 'siamese' in m.name.lower():
                    m_type = 'siamese_binary'
                elif 'binary' in m.name.lower() or 'filtering' in m.name.lower():
                    m_type = 'binary'
                # Check state dict keys as fallback
                sd = ckpt.get('model_state_dict', {})
                if any('performer_embed' in k for k in sd.keys()): m_type = 'agent_of_taste'
                elif any('head' in k for k in sd.keys()) and m_type == 'unknown': m_type = 'pairwise'
            
            info['type'] = m_type
            info['backbone'] = ckpt.get('backbone') or ckpt.get('config', {}).get('model_name')
            info['val_acc'] = ckpt.get('val_acc')
            info['samples'] = ckpt.get('samples')
            info['created_at'] = ckpt.get('created_at')
            info['epoch_history'] = ckpt.get('epoch_history')
            config = ckpt.get('config', {})
            info['epochs'] = config.get('epochs')
            del ckpt  # free memory
            import gc; gc.collect()
        except Exception as e:
            info['error'] = str(e)
        result.append(info)
    result.sort(key=lambda x: x['modified'], reverse=True)
    return jsonify({
        "success": True,
        "models": result,
        "current_loaded": MODEL_NAME,
        "active_model_file": LOADED_MODEL_ID
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
    
    import random, base64, io
    from PIL import Image
    IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}
    
    # Check if images were provided in the request (Remote Testing)
    provided_images = data.get('images') # Expected: [{'data': 'base64...', 'label': 1/0}, ...]
    
    k_sample = []
    d_sample = []

    if provided_images:
        log(f"📦 Received {len(provided_images)} images via API for testing")
        for img_obj in provided_images:
            if img_obj.get('label') == 1: k_sample.append(img_obj)
            else: d_sample.append(img_obj)
    else:
        # Fallback to local disk scan (Legacy/Local mode)
        def scan_images(directory):
            imgs = []
            p = Path(directory)
            if not p.exists(): return imgs
            for f in p.rglob('*'):
                if f.suffix.lower() in IMAGE_EXTS:
                    imgs.append(str(f))
            return imgs

        # Resolve paths - try local, then parent if relative
        def resolve_path(p_str, folder):
            p = Path(p_str) / folder
            if p.exists(): return p
            p = Path(__file__).parent.parent / folder
            if p.exists(): return p
            return Path(p_str) / folder

        keep_dir = resolve_path(base_path, 'after filter performer')
        delete_dir = resolve_path(base_path, 'deleted keep for training')
        
        keep_imgs = scan_images(keep_dir)
        delete_imgs = scan_images(delete_dir)
        
        if not keep_imgs or not delete_imgs:
            return jsonify({'success': False, 'error': 'No local images found and no remote images provided.'}), 400
        
        # Sample local paths
        k_paths = random.sample(keep_imgs, min(sample_size, len(keep_imgs)))
        d_paths = random.sample(delete_imgs, min(sample_size, len(delete_imgs)))
        k_sample = [{'path': p, 'label': 1} for p in k_paths]
        d_sample = [{'path': p, 'label': 0} for p in d_paths]

    # Combine for testing
    test_samples = k_sample + d_sample
    random.shuffle(test_samples)
    
    # Load model temporarily
    try:
        ckpt = torch.load(target, map_location=DEVICE, weights_only=False)
        m_type = ckpt.get('model_type', 'unknown')
        if m_type == 'unknown':
            if 'pairwise' in model_id.lower() or 'preference' in model_id.lower(): m_type = 'pairwise'
            elif 'context' in model_id.lower(): m_type = 'context_binary'
            elif 'binary' in model_id.lower() or 'filtering' in model_id.lower(): m_type = 'binary'
            sd = ckpt.get('model_state_dict', {})
            if any('performer_embed' in k for k in sd.keys()): m_type = 'agent_of_taste'

        config = ckpt.get('config', {})
        model_name = config.get('model_name') or ckpt.get('backbone') or 'facebook/dinov2-large'
        model_type = m_type
        
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
        
        # Helper to load image from sample object
        def load_img(sample_obj):
            if 'data' in sample_obj:
                # Base64 data
                img_data = base64.b64decode(sample_obj['data'].split(',')[-1])
                return Image.open(io.BytesIO(img_data)).convert('RGB')
            else:
                # Local path
                return Image.open(sample_obj['path']).convert('RGB')

        # Test binary models
        if model_type == 'binary':
            correct = 0
            total = 0
            keep_scores = []
            delete_scores = []
            
            with torch.no_grad():
                for sample in test_samples:
                    try:
                        img = load_img(sample)
                        label = sample['label']
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
            # Split samples back to pairs
            ks = [s for s in test_samples if s['label'] == 1]
            ds = [s for s in test_samples if s['label'] == 0]
            pairs_tested = min(len(ks), len(ds))
            
            with torch.no_grad():
                for i in range(pairs_tested):
                    try:
                        keep_img = load_img(ks[i])
                        del_img = load_img(ds[i])
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
            def get_performer(sample):
                if 'performer' in sample: return sample['performer']
                if 'path' in sample:
                    parts = Path(sample['path']).parts
                    for i, p in enumerate(parts):
                        if p in ('pics',):
                            if i > 0: return parts[i-1]
                return None
            
            with torch.no_grad():
                for sample in test_samples:
                    try:
                        perf = get_performer(sample)
                        ctx = saved_contexts.get(perf, zero_ctx.squeeze(0)).unsqueeze(0).to(DEVICE) if perf else zero_ctx
                        
                        img = load_img(sample)
                        label = sample['label']
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

def _load_image(p, app_base_url=None):
    """Load an image from local path or remote URL. Returns PIL Image or None."""
    try:
        if os.path.exists(p):
            return Image.open(p).convert('RGB')
        elif app_base_url:
            clean_path = p.replace('\\', '/')
            if not clean_path.startswith('/'): clean_path = '/' + clean_path
            encoded_path = quote(clean_path, safe='/')
            url = f"{app_base_url.rstrip('/')}/api/files/raw?path={encoded_path}"
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                return Image.open(io.BytesIO(resp.content)).convert('RGB')
    except Exception:
        pass
    return None

def _get_performer_name(image_path):
    """Extract performer name from folder structure."""
    p = Path(image_path)
    name = p.parent.name
    if name in ('pics', 'vids'):
        name = p.parent.parent.name
    return name

@app.route('/classify_batch', methods=['POST'])
def classify_batch():
    """Binary classification (Keep/Delete) for Smart Filtering.
    Supports pairwise, binary, and context_binary model types."""
    if MODEL is None or PROCESSOR is None:
        return jsonify({'error': 'Model not loaded (MODEL or PROCESSOR is None)'}), 500
    
    data = request.json
    image_paths = data.get('images', [])
    threshold = data.get('threshold', 50.0)
    app_base_url = data.get('app_base_url')
    
    if not image_paths: return jsonify({'error': 'No images'}), 400
    
    log(f"🧠 SMART FILTERING {len(image_paths)} images (Type: {LOADED_MODEL_TYPE}, Threshold: {threshold})...")
    start_time = time.time()
    results = []
    import math
    
    # ── Context-Aware: Two-pass inference ──────────────────────────
    if LOADED_MODEL_TYPE == 'context_binary':
        # Group images by performer
        performer_images = {}  # performer_name → [paths]
        for p in image_paths:
            perf = _get_performer_name(p)
            performer_images.setdefault(perf, []).append(p)
        
        log(f"  Context-aware mode: {len(performer_images)} performers detected")
        
        # Pass 1: Predict star rating per performer (sample up to 100 images)
        for perf, paths in performer_images.items():
            if perf in CONTEXT_STAR_CACHE:
                continue
            sample_paths = paths[:100]
            star_preds = []
            for i in range(0, len(sample_paths), 4):
                batch_p = sample_paths[i:i+4]
                imgs = [_load_image(p, app_base_url) for p in batch_p]
                imgs = [im for im in imgs if im is not None]
                if not imgs: continue
                try:
                    with torch.no_grad():
                        inputs = PROCESSOR(images=imgs, return_tensors="pt")
                        pv = inputs['pixel_values'].to(DEVICE)
                        stars = MODEL.predict_stars(pv)
                        star_preds.extend(stars.cpu().tolist())
                except: continue
            
            avg_stars = sum(star_preds) / max(len(star_preds), 1) if star_preds else 2.5
            CONTEXT_STAR_CACHE[perf] = avg_stars
            log(f"  ⭐ {perf}: predicted {avg_stars:.2f} stars ({len(star_preds)} images sampled)")
        
        # Pass 2: Keep/Delete classification with star context
        for i in range(0, len(image_paths), 4):
            batch_paths = image_paths[i:i+4]
            imgs = []
            valid_paths = []
            batch_stars = []
            for p in batch_paths:
                img = _load_image(p, app_base_url)
                if img:
                    imgs.append(img)
                    valid_paths.append(p)
                    perf = _get_performer_name(p)
                    batch_stars.append(CONTEXT_STAR_CACHE.get(perf, 2.5))
            if not imgs: continue
            try:
                with torch.no_grad():
                    inputs = PROCESSOR(images=imgs, return_tensors="pt")
                    pv = inputs['pixel_values'].to(DEVICE)
                    star_tensor = torch.tensor(batch_stars, dtype=torch.float32).to(DEVICE)
                    logits = MODEL.classify_with_stars(pv, star_tensor)
                    logits = torch.nan_to_num(logits, nan=0.0, posinf=10.0, neginf=-10.0)
                    scores = (torch.sigmoid(logits) * 100).cpu().tolist()
                    for p, s, star in zip(valid_paths, scores, batch_stars):
                        safe_score = s if not (math.isnan(s) or math.isinf(s)) else 50.0
                        decision = "keep" if safe_score >= threshold else "delete"
                        results.append({
                            'path': p, 'score': float(safe_score), 'decision': decision,
                            'predicted_stars': round(star, 2),
                            'performer': _get_performer_name(p)
                        })
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache(); continue
            except Exception as e:
                log(f"  ❌ Batch Error: {e}"); continue
    
    # ── Binary model: direct classification ───────────────────────
    elif LOADED_MODEL_TYPE == 'binary':
        for i in range(0, len(image_paths), 4):
            batch_paths = image_paths[i:i+4]
            imgs = []
            valid_paths = []
            for p in batch_paths:
                img = _load_image(p, app_base_url)
                if img: imgs.append(img); valid_paths.append(p)
            if not imgs: continue
            try:
                with torch.no_grad():
                    inputs = PROCESSOR(images=imgs, return_tensors="pt")
                    pv = inputs['pixel_values'].to(DEVICE)
                    # Compatibility: use forward_single if present (e.g. for pairwise models loaded as binary type)
                    if hasattr(MODEL, 'forward_single'):
                        logits = MODEL.forward_single(pv)
                    else:
                        logits = MODEL(pv)
                    logits = torch.nan_to_num(logits, nan=0.0, posinf=10.0, neginf=-10.0)
                    scores = (torch.sigmoid(logits) * 100).cpu().tolist()
                    if not isinstance(scores, list): scores = [scores]
                    for p, s in zip(valid_paths, scores):
                        safe_score = s if not (math.isnan(s) or math.isinf(s)) else 50.0
                        decision = "keep" if safe_score >= threshold else "delete"
                        results.append({'path': p, 'score': float(safe_score), 'decision': decision})
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache(); continue
            except Exception as e:
                log(f"  ❌ Batch Error: {e}"); continue
    
    # ── Pairwise / Siamese model (default): single-score path ───────────────
    else:
        for i in range(0, len(image_paths), 4):
            batch_paths = image_paths[i:i+4]
            imgs = []
            valid_paths = []
            for p in batch_paths:
                img = _load_image(p, app_base_url)
                if img: imgs.append(img); valid_paths.append(p)
            if not imgs: continue
            try:
                with torch.no_grad():
                    inputs = PROCESSOR(images=imgs, return_tensors="pt")
                    pixel_values = inputs['pixel_values'].to(DEVICE)
                    MODEL.eval()
                    raw_scores = MODEL.forward_single(pixel_values)
                    raw_scores = torch.nan_to_num(raw_scores, nan=0.0, posinf=10.0, neginf=-10.0)
                    normalized = torch.sigmoid(raw_scores) * 100
                    scores = normalized.cpu().numpy().flatten().tolist()
                    for p, s in zip(valid_paths, scores):
                        safe_score = s if not (math.isnan(s) or math.isinf(s)) else 50.0
                        decision = "keep" if safe_score >= threshold else "delete"
                        results.append({'path': p, 'score': float(safe_score), 'decision': decision})
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache(); continue
            except Exception as e:
                log(f"  ❌ Batch Error: {e}"); continue

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
import zipfile, shutil, json as json_module

TRAINING_DATA_DIR = Path(__file__).parent / 'training_data'

@app.route('/upload_training', methods=['POST'])
def api_upload_training():
    """Receive a ZIP of training images from the backend."""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file in request'}), 400

        f = request.files['file']
        train_type = request.form.get('type', 'binary')

        log(f"📦 Receiving training data ZIP ({train_type})...")

        # Save to temp file
        tmp_path = TRAINING_DATA_DIR / '_upload.zip'
        TRAINING_DATA_DIR.mkdir(exist_ok=True)
        f.save(str(tmp_path))

        zip_size = tmp_path.stat().st_size
        log(f"  📥 Received {zip_size / 1024 / 1024:.1f} MB")

        with zipfile.ZipFile(str(tmp_path), 'r') as zf:
            # Check if ZIP contains any images (keep/ or delete/ folders)
            has_images = any(name.startswith(('keep/', 'delete/')) for name in zf.namelist())
            
            if has_images:
                log("  🖼️ ZIP contains images, clearing existing data folders...")
                for sub in ['keep', 'delete']:
                    sub_path = TRAINING_DATA_DIR / sub
                    if sub_path.exists():
                        shutil.rmtree(str(sub_path))
            else:
                log("  🏷️ ZIP contains only metadata/manifest, preserving existing images.")

            zf.extractall(str(TRAINING_DATA_DIR))

        tmp_path.unlink(missing_ok=True)

        # Count extracted images
        keep_count = sum(1 for _ in (TRAINING_DATA_DIR / 'keep').rglob('*') if _.is_file()) if (TRAINING_DATA_DIR / 'keep').exists() else 0
        delete_count = sum(1 for _ in (TRAINING_DATA_DIR / 'delete').rglob('*') if _.is_file()) if (TRAINING_DATA_DIR / 'delete').exists() else 0

        log(f"  ✅ Extracted: {keep_count} keep + {delete_count} delete images")

        return jsonify({
            'success': True,
            'message': f'Received {keep_count + delete_count} images',
            'keep': keep_count,
            'delete': delete_count
        })
    except Exception as e:
        log(f"❌ Upload error: {e}")
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/training_data_status', methods=['GET'])
def api_training_data_status():
    """Check what training data is cached locally."""
    keep_dir = TRAINING_DATA_DIR / 'keep'
    delete_dir = TRAINING_DATA_DIR / 'delete'
    manifest_path = TRAINING_DATA_DIR / 'manifest.json'

    keep_count = sum(1 for _ in keep_dir.rglob('*') if _.is_file()) if keep_dir.exists() else 0
    delete_count = sum(1 for _ in delete_dir.rglob('*') if _.is_file()) if delete_dir.exists() else 0

    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json_module.loads(manifest_path.read_text())
        except: pass

    # List performers
    keep_performers = sorted([d.name for d in keep_dir.iterdir() if d.is_dir()]) if keep_dir.exists() else []
    delete_performers = sorted([d.name for d in delete_dir.iterdir() if d.is_dir()]) if delete_dir.exists() else []

    return jsonify({
        'has_data': keep_count > 0 or delete_count > 0,
        'keep': keep_count,
        'delete': delete_count,
        'keep_performers': keep_performers,
        'delete_performers': delete_performers,
        'manifest': manifest
    })


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

    # If base_path is provided but doesn't exist locally, use cached training data
    base_path = data.get('base_path', '')
    if base_path and not Path(base_path).exists():
        cached_keep = TRAINING_DATA_DIR / 'keep'
        cached_delete = TRAINING_DATA_DIR / 'delete'
        if cached_keep.exists() and cached_delete.exists():
            log(f"📂 base_path '{base_path}' not local — using cached training data")
            # Override: point to training_data dir which has keep/ and delete/ subdirs
            data['base_path'] = str(TRAINING_DATA_DIR)
            data['use_cached'] = True
        else:
            return jsonify({'success': False, 'message': 'base_path not accessible and no cached training data. Push data first.'}), 400

    ok, msg = start_training(data)
    status_code = 200 if ok else 409
    return jsonify({'success': ok, 'message': msg}), status_code

@app.route('/training_status', methods=['GET'])
def api_training_status():
    """Poll current training status."""
    return jsonify(training_state)

@app.route('/training_history', methods=['GET'])
def api_training_history():
    """Return saved training run history."""
    from trainer import HISTORY_PATH
    if HISTORY_PATH.exists():
        try:
            return jsonify(json_module.loads(HISTORY_PATH.read_text()))
        except:
            return jsonify([])
    return jsonify([])

if __name__ == '__main__':
    # Models are now loaded dynamically by the frontend on mount
    log("🚀 AI Server starting on http://0.0.0.0:3344 (Idle - Waiting for model load)")
    log("🎬 Video analysis available at /video/*")
    # Using use_reloader=False to prevent double model loading in debug mode
    app.run(host='0.0.0.0', port=3344, threaded=True, debug=True, use_reloader=False)
