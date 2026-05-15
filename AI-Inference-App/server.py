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

# ── Logging Setup ─────────────────────────────────────────────────────────────
def log(msg):
    """Immediate flushing logger to bypass terminal buffering."""
    timestamp = time.strftime('%H:%M:%S')
    print(f"[{timestamp}] {msg}", flush=True)
    sys.stdout.flush()

# ── Flask Setup ───────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app) # Enable CORS for frontend access

# Add current dir to path for model import
sys.path.insert(0, str(Path(__file__).parent))

# Register video analysis blueprint
try:
    log("🎬 Initializing Video analysis module...")
    from video_analyzer import video_bp
    app.register_blueprint(video_bp, url_prefix='/video')
    log("✅ Video analysis module registered at /video")
except Exception as e:
    log(f"⚠️ Video analysis module failed to load: {e}")
    import traceback
    traceback.print_exc()

# ── Module Imports ────────────────────────────────────────────────────────────
from model_dinov2 import (
    DinoV2PreferenceModel, PerformerRankerModel,
    RankedBinaryClassifier, RankedSiameseModel
)


# Initialize Calibration Engine
CALIBRATOR = CalibrationEngine()

# Global model state
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL = None
PROCESSOR = None
MODEL_NAME = None
LOADED_MODEL_ID = None
LOADED_MODEL_TYPE = 'pairwise'
RANK_CONDITIONED = False   # True if loaded model needs rank input
RANKER_MODEL = None        # Optional standalone PerformerRankerModel
RANKER_PROCESSOR = None
RANKER_MODEL_ID = None
CONTEXT_STAR_CACHE = {}    # performer_name → predicted star rating (per inference session)

from threading import Lock
MODEL_LOCK = Lock()
MODELS_DIR = Path(__file__).parent / 'models'
MODEL_METADATA_CACHE = {}  # Cache for model file metadata to prevent heavy I/O

def map_path(path):
    """Maps remote paths (TrueNAS) to local paths (Windows)."""
    if not path:
        return path
    # Normalize slashes to Windows-style for consistency
    p = str(path).replace('/', '\\')
    # If it starts with \media
    if p.startswith('\\media'):
        return 'Z:\\Apps\\adultManager' + p
    return p

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

def load_model(checkpoint_path, model_id=None, quantize=False):
    global MODEL, PROCESSOR, MODEL_NAME, LOADED_MODEL_ID, LOADED_MODEL_TYPE, CONTEXT_STAR_CACHE
    
    # Check if already loaded
    if model_id and LOADED_MODEL_ID == model_id and MODEL is not None:
        log(f"✅ Model {model_id} already loaded. Skipping.")
        return True, "Already loaded"

    with MODEL_LOCK:
        # Re-check inside lock to handle race conditions
        if model_id and LOADED_MODEL_ID == model_id and MODEL is not None:
            log(f"✅ Model {model_id} already loaded (confirmed inside lock).")
            return True, "Already loaded"

        try:
            log(f"📦 Loading checkpoint: {checkpoint_path}")
            
            # Free resources before loading a new model
            if MODEL is not None:
                log("♻️ Unloading previous model to free resources...")
                try:
                    MODEL.to('cpu') # Move to RAM to clear VRAM immediately
                except: pass
                MODEL = None
                PROCESSOR = None
                import gc
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.synchronize()
                    torch.cuda.empty_cache()
                # Breather for the driver/OS to recover from VRAM pressure
                time.sleep(0.5)
                
            # Load to CPU first to avoid VRAM spikes during loading
            checkpoint = torch.load(checkpoint_path, map_location='cpu')
            
            config = checkpoint.get('config', {})
            MODEL_NAME = config.get('model_name') or checkpoint.get('backbone') or "facebook/dinov2-large"
            model_type = checkpoint.get('model_type', 'pairwise')
            
            # Auto-detect from filename if model_type is missing
            if model_id and (model_type == 'unknown' or not model_type):
                if 'context' in model_id.lower(): model_type = 'context_binary'
                elif 'binary' in model_id.lower() or 'filtering' in model_id.lower(): model_type = 'binary'
                elif 'pairwise' in model_id.lower() or 'preference' in model_id.lower(): model_type = 'pairwise'
            
            log(f"🦕 Architecture: {MODEL_NAME} | Type: {model_type} (Device: {DEVICE})")
            
            rank_conditioned = checkpoint.get('rank_conditioned', False)
            
            # Initialize the correct model class based on type + rank flag
            try:
                if model_type == 'performer_ranker':
                    # This is a ranker, not a filtering model — load into RANKER_MODEL
                    global RANKER_MODEL, RANKER_PROCESSOR, RANKER_MODEL_ID
                    ranker = PerformerRankerModel(MODEL_NAME, quantize=quantize)
                    ranker.load_state_dict(checkpoint['model_state_dict'], strict=False)
                    ranker.to(DEVICE)
                    ranker.eval()
                    RANKER_MODEL = ranker
                    RANKER_PROCESSOR = AutoImageProcessor.from_pretrained(MODEL_NAME)
                    RANKER_MODEL_ID = model_id
                    val_mae = checkpoint.get('val_mae')
                    if val_mae: log(f"  Ranker MAE at save: {val_mae:.3f}")
                    del checkpoint
                    import gc; gc.collect()
                    if torch.cuda.is_available(): torch.cuda.empty_cache()
                    log(f"✅ Performer Ranker loaded on {DEVICE}")
                    LOADED_MODEL_ID = model_id  # Track for UI
                    return True, "Ranker loaded"
                elif model_type == 'binary' and rank_conditioned:
                    MODEL = RankedBinaryClassifier(MODEL_NAME, quantize=quantize)
                elif model_type == 'binary':
                    from trainer import BinaryClassifier
                    MODEL = BinaryClassifier(MODEL_NAME, quantize=quantize)
                elif model_type in ('siamese_binary', 'pairwise_siamese_binary') and rank_conditioned:
                    MODEL = RankedSiameseModel(model_name=MODEL_NAME, quantize=quantize)
                elif model_type == 'context_binary':
                    from trainer import ContextBinaryClassifier
                    MODEL = ContextBinaryClassifier(MODEL_NAME, quantize=quantize)
                elif model_type == 'rank_aware_siamese':
                    from model_dinov2 import RankAwareSiameseModel
                    MODEL = RankAwareSiameseModel(MODEL_NAME, quantize=quantize)
                else:
                    MODEL = DinoV2PreferenceModel(model_name=MODEL_NAME, freeze_backbone=True, quantize=quantize)
            except ImportError as ie:
                if 'bitsandbytes' in str(ie).lower():
                    log("❌ ERROR: bitsandbytes not found. Quantization requires bitsandbytes and accelerate.")
                    log("💡 Install with: pip install bitsandbytes accelerate")
                    return False, "bitsandbytes not found. Install it to use quantization."
                raise ie
            
            # Load state dict (strict=False: some checkpoints omit frozen backbone weights)
            MODEL.load_state_dict(checkpoint['model_state_dict'], strict=False)
            MODEL.to(DEVICE)
            MODEL.eval()
            LOADED_MODEL_TYPE = model_type
            RANK_CONDITIONED = rank_conditioned
            CONTEXT_STAR_CACHE.clear()
            if rank_conditioned:
                log(f"  🎯 Rank-conditioned model: will use ranker for context")
            
            # Load processor
            PROCESSOR = AutoImageProcessor.from_pretrained(MODEL_NAME)
            
            val_acc = checkpoint.get('val_acc')
            if val_acc: log(f"  Val accuracy at save: {val_acc*100:.1f}%")
            if model_type == 'context_binary':
                mae = checkpoint.get('val_star_mae')
                if mae: log(f"  Star prediction MAE: {mae:.2f}")
            
            # Explicit cleanup of the checkpoint object
            del checkpoint
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            log(f"✅ Model loaded successfully on {DEVICE}")
            LOADED_MODEL_ID = model_id
            return True, "Success"
        except Exception as e:
            log(f"❌ Error loading model: {e}")
            import traceback; traceback.print_exc()
            # Ensure model is None if load failed
            MODEL = None
            PROCESSOR = None
            return False, str(e)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok', 
        'device': str(DEVICE), 
        'model_loaded': MODEL is not None,
        'model_name': MODEL_NAME,
        'current_model': LOADED_MODEL_ID,
        'model_type': LOADED_MODEL_TYPE,
        'rank_conditioned': RANK_CONDITIONED,
        'ranker_loaded': RANKER_MODEL is not None,
        'ranker_model': RANKER_MODEL_ID,
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
    
    # If exact file doesn't exist, try finding by prefix (to handle timestamped files)
    if not target or not target.exists():
        if model_id:
            # Try finding a file that starts with the same name (minus .pt)
            prefix = model_id.replace('.pt', '')
            models = find_models()
            matches = [m for m in models if m.name.startswith(prefix)]
            if matches:
                # Sort by modification time to get newest
                matches.sort(key=lambda x: x.stat().st_mtime, reverse=True)
                target = matches[0]
                log(f"🔍 Exact match for '{model_id}' not found. Using latest match: {target.name}")
    
    if not target or not target.exists():
        # Fallback to absolute latest of any type
        models = find_models()
        if not models: return jsonify({"success": False, "error": "No models found"}), 404
        models.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        target = models[0]
        log(f"⚠️ No matches for '{model_id}'. Falling back to latest overall: {target.name}")
        
    # Use relative path from models dir as the ID
    rel_id = str(target.relative_to(models_path)).replace('\\', '/')
    success, msg = load_model(str(target), model_id=rel_id, quantize=data.get('quantize', False))
    return jsonify({"success": success, "message": msg, "model": MODEL_NAME})

@app.route('/unload_model', methods=['POST'])
def api_unload_model():
    global MODEL, PROCESSOR, MODEL_NAME, LOADED_MODEL_ID, LOADED_MODEL_TYPE, CONTEXT_STAR_CACHE, RANK_CONDITIONED
    with MODEL_LOCK:
        log("♻️ Unload request received. Acquiring lock...")
        if MODEL is None:
            log("♻️ No model loaded. Nothing to unload.")
            return jsonify({'success': True, 'message': 'No model loaded'})
            
        log(f"♻️ Unloading model {LOADED_MODEL_ID} to free resources...")
        MODEL = None
        PROCESSOR = None
        MODEL_NAME = None
        LOADED_MODEL_ID = None
        LOADED_MODEL_TYPE = 'pairwise'
        RANK_CONDITIONED = False
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
        m_id = str(m)
        mtime = m.stat().st_mtime
        
        # Check cache to avoid heavy torch.load
        if m_id in MODEL_METADATA_CACHE and MODEL_METADATA_CACHE[m_id]['mtime'] == mtime:
            result.append(MODEL_METADATA_CACHE[m_id]['info'])
            continue

        info = {
            'filename': rel_path,
            'size_mb': round(m.stat().st_size / 1024**2, 1),
            'modified': mtime,
            'type': 'unknown',
            'backbone': None,
            'val_acc': None,
        }
        try:
            # Use map_location='cpu' and weights_only=True for safety/speed if possible
            ckpt = torch.load(m, map_location='cpu', weights_only=False)
            m_type = ckpt.get('model_type', 'unknown')
            
            # Auto-detect type if unknown
            if m_type == 'unknown':
                name_low = m.name.lower()
                if 'pairwise' in name_low or 'preference' in name_low: m_type = 'pairwise'
                elif 'context' in name_low: m_type = 'context_binary'
                elif 'ranker' in name_low: m_type = 'performer_ranker'
                elif 'siamese' in name_low: m_type = 'siamese_binary'
                elif 'binary' in name_low or 'filtering' in name_low: m_type = 'binary'
                
                sd = ckpt.get('model_state_dict', {})
                if any('performer_embed' in k for k in sd.keys()): m_type = 'agent_of_taste'
                elif any('head' in k for k in sd.keys()) and m_type == 'unknown': m_type = 'pairwise'
            
            info['type'] = m_type
            info['backbone'] = ckpt.get('backbone') or ckpt.get('config', {}).get('model_name')
            info['val_acc'] = ckpt.get('val_acc')
            info['val_mae'] = ckpt.get('val_mae')  # For performer_ranker
            info['rank_conditioned'] = ckpt.get('rank_conditioned', False)
            info['samples'] = ckpt.get('samples')
            info['created_at'] = ckpt.get('created_at')
            info['epoch_history'] = ckpt.get('epoch_history')
            info['epochs'] = ckpt.get('config', {}).get('epochs')
            del ckpt
            
            # Update cache
            MODEL_METADATA_CACHE[m_id] = {'mtime': mtime, 'info': info}
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
        # Serializing test to avoid VRAM competition with main model if both are large
        with MODEL_LOCK:
            checkpoint_cpu = torch.load(target, map_location='cpu', weights_only=False)
            m_type = checkpoint_cpu.get('model_type', 'unknown')
            if m_type == 'unknown':
                if 'pairwise' in model_id.lower() or 'preference' in model_id.lower(): m_type = 'pairwise'
                elif 'context' in model_id.lower(): m_type = 'context_binary'
                elif 'binary' in model_id.lower() or 'filtering' in model_id.lower(): m_type = 'binary'
                sd = checkpoint_cpu.get('model_state_dict', {})
                if any('performer_embed' in k for k in sd.keys()): m_type = 'agent_of_taste'

            config = checkpoint_cpu.get('config', {})
            model_name = config.get('model_name') or checkpoint_cpu.get('backbone') or 'facebook/dinov2-large'
            model_type = m_type
            
            from model_dinov2 import DinoV2PreferenceModel
            
            if model_type == 'binary':
                from trainer import BinaryClassifier
                test_model = BinaryClassifier(model_name)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
            elif model_type == 'pairwise':
                test_model = DinoV2PreferenceModel(model_name=model_name, freeze_backbone=True)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
            elif model_type == 'context_binary':
                from trainer import ContextBinaryClassifier
                test_model = ContextBinaryClassifier(model_name)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
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
                            
                            # Breathing room
                            if torch.cuda.is_available(): torch.cuda.synchronize()
                            time.sleep(0.005)
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
                            
                            # Breathing room
                            if torch.cuda.is_available(): torch.cuda.synchronize()
                            time.sleep(0.005)
                        except: continue
                
                result = {
                    'accuracy': round(correct / max(total, 1), 4),
                    'total_tested': total,
                    'correct': correct,
                    'model_type': model_type,
                }
            elif model_type == 'context_binary':
                # Context-aware binary: uses performer context embeddings from checkpoint
                saved_contexts = checkpoint_cpu.get('contexts', {})
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
                            
                            # Breathing room
                            if torch.cuda.is_available(): torch.cuda.synchronize()
                            time.sleep(0.005)
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
            try:
                test_model.to('cpu')
            except: pass
            del test_model
            del checkpoint_cpu
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.synchronize()
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
        mapped_p = map_path(p)
        if os.path.exists(mapped_p):
            return Image.open(mapped_p).convert('RGB')
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
    """Binary classification (Keep/Delete) for Smart Filtering."""
    data = request.json
    image_paths = data.get('images', [])
    threshold = data.get('threshold', 50.0)
    app_base_url = data.get('app_base_url')
    
    if not image_paths: return jsonify({'error': 'No images'}), 400

    # 1. PRE-LOAD IMAGES (Outside lock to avoid blocking and system lag)
    # We do this in smaller chunks to avoid memory spikes
    loaded_data = [] # List of (path, PIL_Image)
    log(f"🧠 SMART FILTERING {len(image_paths)} images (Threshold: {threshold})...")
    
    for p in image_paths:
        img = _load_image(p, app_base_url)
        if img:
            loaded_data.append((p, img))
            
    if not loaded_data:
        return jsonify({"success": False, "error": "Could not load any images."}), 500

    results = []
    start_time = time.time()
    import math

    # 2. RUN INFERENCE (Inside lock)
    with MODEL_LOCK:
        if MODEL is None or PROCESSOR is None:
            return jsonify({'error': 'Model not loaded'}), 500
            
        try:
            # ── Context-Aware: Two-pass inference ──────────────────────────
            if LOADED_MODEL_TYPE == 'context_binary':
                # Group loaded images by performer
                performer_data = {} # name -> [(path, img)]
                for p, img in loaded_data:
                    perf = _get_performer_name(p)
                    performer_data.setdefault(perf, []).append((p, img))
                
                # Pass 1: Predict star rating per performer (sample up to 20 images)
                for perf, items in performer_data.items():
                    if perf in CONTEXT_STAR_CACHE: continue
                    
                    sample_items = items[:20] # Reduced from 100 to 20 for speed/stability
                    star_preds = []
                    for i in range(0, len(sample_items), 4):
                        batch = sample_items[i:i+4]
                        imgs = [it[1] for it in batch]
                        with torch.no_grad():
                            inputs = PROCESSOR(images=imgs, return_tensors="pt")
                            pv = inputs['pixel_values'].to(DEVICE)
                            stars = MODEL.predict_stars(pv)
                            star_preds.extend(stars.cpu().tolist())
                        # Breather for the system
                        if torch.cuda.is_available(): torch.cuda.synchronize()
                        time.sleep(0.005)
                    
                    avg_stars = sum(star_preds) / max(len(star_preds), 1) if star_preds else 2.5
                    CONTEXT_STAR_CACHE[perf] = avg_stars
                    log(f"  ⭐ {perf}: predicted {avg_stars:.2f} stars")

                # Pass 2: Keep/Delete classification
                for i in range(0, len(loaded_data), 4):
                    batch = loaded_data[i:i+4]
                    imgs = [it[1] for it in batch]
                    paths = [it[0] for it in batch]
                    stars = [CONTEXT_STAR_CACHE.get(_get_performer_name(p), 2.5) for p in paths]
                    
                    with torch.no_grad():
                        inputs = PROCESSOR(images=imgs, return_tensors="pt")
                        pv = inputs['pixel_values'].to(DEVICE)
                        star_t = torch.tensor(stars, dtype=torch.float32).to(DEVICE)
                        logits = MODEL.classify_with_stars(pv, star_t)
                        logits = torch.nan_to_num(logits, nan=0.0)
                        scores = (torch.sigmoid(logits) * 100).cpu().tolist()
                        for p, s, star in zip(paths, scores, stars):
                            safe_s = float(s) if not (math.isnan(s) or math.isinf(s)) else 50.0
                            results.append({
                                'path': p, 'score': safe_s, 'decision': "keep" if safe_s >= threshold else "delete",
                                'predicted_stars': round(star, 2), 'performer': _get_performer_name(p)
                            })
                    if torch.cuda.is_available(): torch.cuda.synchronize()
                    time.sleep(0.005)

            # ── Rank-Aware Siamese: Two-pass inference ──────────────────────
            elif LOADED_MODEL_TYPE == 'rank_aware_siamese':
                performer_data = {}
                for p, img in loaded_data:
                    perf = _get_performer_name(p)
                    performer_data.setdefault(perf, []).append((p, img))
                
                # Pass 1: Predict rank
                for perf, items in performer_data.items():
                    if perf in CONTEXT_STAR_CACHE: continue
                    sample_items = items[:20]
                    rank_preds = []
                    for i in range(0, len(sample_items), 4):
                        batch = sample_items[i:i+4]
                        imgs = [it[1] for it in batch]
                        with torch.no_grad():
                            inputs = PROCESSOR(images=imgs, return_tensors="pt")
                            pv = inputs['pixel_values'].to(DEVICE)
                            ranks = MODEL.predict_rank(pv)
                            rank_preds.extend(ranks.cpu().tolist())
                        if torch.cuda.is_available(): torch.cuda.synchronize()
                        time.sleep(0.005)
                    avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
                    CONTEXT_STAR_CACHE[perf] = avg_rank
                    log(f"  ⭐ {perf}: estimated rank {avg_rank:.2f}")

                # Pass 2: Preference classification
                for i in range(0, len(loaded_data), 4):
                    batch = loaded_data[i:i+4]
                    imgs = [it[1] for it in batch]
                    paths = [it[0] for it in batch]
                    ranks = [CONTEXT_STAR_CACHE.get(_get_performer_name(p), 2.5) for p in paths]
                    
                    with torch.no_grad():
                        inputs = PROCESSOR(images=imgs, return_tensors="pt")
                        pv = inputs['pixel_values'].to(DEVICE)
                        rank_t = torch.tensor(ranks, dtype=torch.float32).to(DEVICE)
                        logits = MODEL.forward_single(pv, rank_t)
                        logits = torch.nan_to_num(logits, nan=0.0)
                        scores = (torch.sigmoid(logits) * 100).cpu().tolist()
                        for p, s, r in zip(paths, scores, ranks):
                            safe_s = float(s) if not (math.isnan(s) or math.isinf(s)) else 50.0
                            results.append({
                                'path': p, 'score': safe_s, 'decision': "keep" if safe_s >= threshold else "delete",
                                'predicted_rank': round(r, 2), 'performer': _get_performer_name(p)
                            })
                    if torch.cuda.is_available(): torch.cuda.synchronize()
                    time.sleep(0.005)

            # ── Rank-Conditioned Binary: Two-pass (ranker + classifier) ────
            elif RANK_CONDITIONED and isinstance(MODEL, RankedBinaryClassifier):
                # Pass 0: Get performer ranks via RANKER_MODEL or fallback to 2.5
                performer_data = {}
                for p, img in loaded_data:
                    perf = _get_performer_name(p)
                    performer_data.setdefault(perf, []).append((p, img))
                
                for perf, items in performer_data.items():
                    if perf in CONTEXT_STAR_CACHE: continue
                    if RANKER_MODEL is not None:
                        sample_items = items[:20]
                        rank_preds = []
                        for ri in range(0, len(sample_items), 4):
                            batch = sample_items[ri:ri+4]
                            imgs = [it[1] for it in batch]
                            with torch.no_grad():
                                proc = RANKER_PROCESSOR or PROCESSOR
                                inputs = proc(images=imgs, return_tensors="pt")
                                pv = inputs['pixel_values'].to(DEVICE)
                                ranks = RANKER_MODEL.predict_rank(pv)
                                rank_preds.extend(ranks.cpu().tolist())
                            if torch.cuda.is_available(): torch.cuda.synchronize()
                        avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
                    else:
                        avg_rank = 2.5  # No ranker loaded — neutral fallback
                    CONTEXT_STAR_CACHE[perf] = avg_rank
                    log(f"  ⭐ {perf}: rank {avg_rank:.2f}" + (" (ranker)" if RANKER_MODEL else " (fallback)"))
                
                # Pass 1: Classify with rank
                for i in range(0, len(loaded_data), 4):
                    batch = loaded_data[i:i+4]
                    imgs = [it[1] for it in batch]
                    paths = [it[0] for it in batch]
                    ranks = [CONTEXT_STAR_CACHE.get(_get_performer_name(p), 2.5) for p in paths]
                    
                    with torch.no_grad():
                        inputs = PROCESSOR(images=imgs, return_tensors="pt")
                        pv = inputs['pixel_values'].to(DEVICE)
                        rank_t = torch.tensor(ranks, dtype=torch.float32).to(DEVICE)
                        logits = MODEL(pv, rank_t)
                        logits = torch.nan_to_num(logits, nan=0.0)
                        scores = (torch.sigmoid(logits) * 100).cpu().tolist()
                        for p, s, r in zip(paths, scores, ranks):
                            safe_s = float(s) if not (math.isnan(s) or math.isinf(s)) else 50.0
                            results.append({
                                'path': p, 'score': safe_s, 'decision': "keep" if safe_s >= threshold else "delete",
                                'predicted_rank': round(r, 2), 'performer': _get_performer_name(p)
                            })
                    if torch.cuda.is_available(): torch.cuda.synchronize()
                    time.sleep(0.005)

            # ── Rank-Conditioned Siamese: Two-pass ────────────────────────────
            elif RANK_CONDITIONED and isinstance(MODEL, RankedSiameseModel):
                performer_data = {}
                for p, img in loaded_data:
                    perf = _get_performer_name(p)
                    performer_data.setdefault(perf, []).append((p, img))
                
                for perf, items in performer_data.items():
                    if perf in CONTEXT_STAR_CACHE: continue
                    if RANKER_MODEL is not None:
                        sample_items = items[:20]
                        rank_preds = []
                        for ri in range(0, len(sample_items), 4):
                            batch = sample_items[ri:ri+4]
                            imgs = [it[1] for it in batch]
                            with torch.no_grad():
                                proc = RANKER_PROCESSOR or PROCESSOR
                                inputs = proc(images=imgs, return_tensors="pt")
                                pv = inputs['pixel_values'].to(DEVICE)
                                ranks = RANKER_MODEL.predict_rank(pv)
                                rank_preds.extend(ranks.cpu().tolist())
                            if torch.cuda.is_available(): torch.cuda.synchronize()
                        avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
                    else:
                        avg_rank = 2.5
                    CONTEXT_STAR_CACHE[perf] = avg_rank
                    log(f"  ⭐ {perf}: rank {avg_rank:.2f}" + (" (ranker)" if RANKER_MODEL else " (fallback)"))
                
                for i in range(0, len(loaded_data), 4):
                    batch = loaded_data[i:i+4]
                    imgs = [it[1] for it in batch]
                    paths = [it[0] for it in batch]
                    ranks = [CONTEXT_STAR_CACHE.get(_get_performer_name(p), 2.5) for p in paths]
                    
                    with torch.no_grad():
                        inputs = PROCESSOR(images=imgs, return_tensors="pt")
                        pv = inputs['pixel_values'].to(DEVICE)
                        rank_t = torch.tensor(ranks, dtype=torch.float32).to(DEVICE)
                        logits = MODEL.forward_single(pv, rank_t)
                        logits = torch.nan_to_num(logits, nan=0.0)
                        scores = (torch.sigmoid(logits) * 100).cpu().tolist()
                        for p, s, r in zip(paths, scores, ranks):
                            safe_s = float(s) if not (math.isnan(s) or math.isinf(s)) else 50.0
                            results.append({
                                'path': p, 'score': safe_s, 'decision': "keep" if safe_s >= threshold else "delete",
                                'predicted_rank': round(r, 2), 'performer': _get_performer_name(p)
                            })
                    if torch.cuda.is_available(): torch.cuda.synchronize()
                    time.sleep(0.005)

            # ── Binary / Pairwise / Siamese: direct classification ──────────
            else:
                for i in range(0, len(loaded_data), 4):
                    batch = loaded_data[i:i+4]
                    imgs = [it[1] for it in batch]
                    paths = [it[0] for it in batch]
                    
                    with torch.no_grad():
                        inputs = PROCESSOR(images=imgs, return_tensors="pt")
                        pv = inputs['pixel_values'].to(DEVICE)
                        
                        if hasattr(MODEL, 'forward_single'): logits = MODEL.forward_single(pv)
                        else: logits = MODEL(pv)
                        
                        logits = torch.nan_to_num(logits, nan=0.0)
                        scores = (torch.sigmoid(logits) * 100).cpu().numpy().flatten().tolist()
                        
                        for p, s in zip(paths, scores):
                            safe_s = float(s) if not (math.isnan(s) or math.isinf(s)) else 50.0
                            results.append({
                                'path': p, 'score': safe_s, 'decision': "keep" if safe_s >= threshold else "delete",
                                'performer': _get_performer_name(p)
                            })
                    if torch.cuda.is_available(): torch.cuda.synchronize()
                    time.sleep(0.005)
        except torch.cuda.OutOfMemoryError:
            log("❌ OOM in classify_batch")
            torch.cuda.empty_cache()
        except Exception as e:
            log(f"❌ classify_batch error: {e}")
            import traceback; traceback.print_exc()
        finally:
            # Clean up PIL images from RAM
            for _, img in loaded_data: img.close()
            import gc; gc.collect()
            if torch.cuda.is_available(): torch.cuda.empty_cache()

    duration = time.time() - start_time
    log(f"✅ Classification completed in {duration:.2f}s")
    
    if not results:
        return jsonify({"success": False, "error": "Failed to process any images. Check AI server logs."}), 500
        
    return jsonify({'success': True, 'results': results, 'duration': duration})

@app.route('/predict_rank', methods=['POST'])
def predict_rank():
    """Predict rank/rating for a performer based on a batch of images."""
    global RANKER_MODEL, RANKER_PROCESSOR, RANKER_MODEL_ID
    data = request.json
    image_paths = data.get('images', [])
    
    if not image_paths: return jsonify({'error': 'No images'}), 400

    log(f"⭐ RANK PREDICTION for {len(image_paths)} images...")
    
    # 1. LOAD IMAGES
    loaded_imgs = []
    for p in image_paths:
        img = _load_image(p)
        if img: loaded_imgs.append(img)
            
    if not loaded_imgs:
        return jsonify({"success": False, "error": "Could not load any images."}), 500

    # 2. RUN INFERENCE
    with MODEL_LOCK:
        try:
            # Determine which model to use for ranking
            target_model = None
            target_processor = None
            method_name = None
            
            if RANKER_MODEL is not None:
                target_model = RANKER_MODEL
                target_processor = RANKER_PROCESSOR or PROCESSOR
                method_name = 'predict_rank'
            elif hasattr(MODEL, 'predict_stars'):
                target_model = MODEL
                target_processor = PROCESSOR
                method_name = 'predict_stars'
            elif hasattr(MODEL, 'predict_rank'):
                target_model = MODEL
                target_processor = PROCESSOR
                method_name = 'predict_rank'
            
            if not target_model:
                # Try auto-loading a ranker (find latest performer_ranker*.pt)
                try:
                    ranker_files = [f for f in os.listdir(MODELS_DIR) if f.startswith('performer_ranker') and f.endswith('.pt')]
                    if ranker_files:
                        # Sort by modification time to get the newest
                        ranker_files.sort(key=lambda x: os.path.getmtime(os.path.join(MODELS_DIR, x)), reverse=True)
                        ranker_filename = ranker_files[0]
                        ranker_path = os.path.join(MODELS_DIR, ranker_filename)
                        
                        log(f"🔄 No ranker loaded. Auto-loading latest ranker: {ranker_filename}...")
                        checkpoint = torch.load(ranker_path, map_location=DEVICE)
                        config = checkpoint.get('config', {})
                        model_name = config.get('model_name') or checkpoint.get('backbone') or "facebook/dinov2-large"
                        
                        RANKER_MODEL = PerformerRankerModel(model_name).to(DEVICE)
                        RANKER_MODEL.load_state_dict(checkpoint['model_state_dict'], strict=False)
                        RANKER_MODEL.eval()
                        RANKER_PROCESSOR = AutoImageProcessor.from_pretrained(model_name)
                        RANKER_MODEL_ID = ranker_filename
                        
                        target_model = RANKER_MODEL
                        target_processor = RANKER_PROCESSOR
                        method_name = 'predict_rank'
                        log("✅ Auto-loaded ranker successfully.")
                except Exception as le:
                    log(f"❌ Failed to auto-load ranker: {le}")
                
            if not target_model:
                return jsonify({"success": False, "error": "No rank-capable model loaded (load a Ranker first)"}), 400
                
            rank_preds = []
            # Process in batches of 8 for speed
            for i in range(0, len(loaded_imgs), 8):
                batch = loaded_imgs[i:i+8]
                with torch.no_grad():
                    inputs = target_processor(images=batch, return_tensors="pt")
                    pv = inputs['pixel_values'].to(DEVICE)
                    
                    if method_name == 'predict_stars':
                        ranks = target_model.predict_stars(pv)
                    else:
                        ranks = target_model.predict_rank(pv)
                        
                    rank_preds.extend(ranks.cpu().tolist())
                if torch.cuda.is_available(): torch.cuda.synchronize()
            
            avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
            log(f"  ✅ Prediction: {avg_rank:.2f} stars (based on {len(rank_preds)} images)")
            
            return jsonify({
                'success': True,
                'predicted_rank': round(avg_rank, 3),
                'sample_size': len(rank_preds)
            })
            
        except Exception as e:
            log(f"❌ predict_rank error: {e}")
            import traceback; traceback.print_exc()
            return jsonify({"success": False, "error": str(e)}), 500
        finally:
            for img in loaded_imgs: img.close()
            import gc; gc.collect()
            if torch.cuda.is_available(): torch.cuda.empty_cache()

@app.route('/classify', methods=['POST'])
def classify_single():
    """Single image classification (Keep/Delete)."""
    with MODEL_LOCK:
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
                
                # Dispatch based on model type
                if RANK_CONDITIONED and isinstance(MODEL, (RankedBinaryClassifier, RankedSiameseModel)):
                    # Get rank for this performer
                    perf = _get_performer_name(image_path)
                    if perf not in CONTEXT_STAR_CACHE:
                        if RANKER_MODEL is not None:
                            rank_pred = RANKER_MODEL.predict_rank(pixel_values)
                            CONTEXT_STAR_CACHE[perf] = rank_pred.item()
                        else:
                            CONTEXT_STAR_CACHE[perf] = 2.5
                    rank = CONTEXT_STAR_CACHE[perf]
                    rank_t = torch.tensor([rank], dtype=torch.float32).to(DEVICE)
                    if isinstance(MODEL, RankedBinaryClassifier):
                        raw_scores = MODEL(pixel_values, rank_t)
                    else:
                        raw_scores = MODEL.forward_single(pixel_values, rank_t)
                elif hasattr(MODEL, 'forward_single'):
                    raw_scores = MODEL.forward_single(pixel_values)
                else:
                    raw_scores = MODEL(pixel_values)
                
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
    data = request.json
    image_paths = data.get('images', [])
    app_base_url = data.get('app_base_url')
    
    if not image_paths: return jsonify({'error': 'No images'}), 400
    
    # 1. LOAD IMAGES (Outside lock)
    loaded_data = []
    log(f"🖼️  Pre-loading {len(image_paths)} images...")
    for p in image_paths:
        img = _load_image(p, app_base_url)
        if img: loaded_data.append((p, img))

    if not loaded_data:
        return jsonify({"success": False, "error": "No images could be loaded"}), 404

    results = []
    start_time = time.time()
    
    # 2. RUN SCORING (Inside lock)
    with MODEL_LOCK:
        if MODEL is None: return jsonify({'error': 'Model not loaded'}), 500
        
        try:
            # Process in small batches
            batch_size = 4 
            for i in range(0, len(loaded_data), batch_size):
                batch = loaded_data[i:i+batch_size]
                imgs = [it[1] for it in batch]
                paths = [it[0] for it in batch]
                
                with torch.no_grad():
                    inputs = PROCESSOR(images=imgs, return_tensors="pt")
                    pv = inputs['pixel_values'].to(DEVICE)
                    
                    # Get scores — handle all model types
                    if RANK_CONDITIONED and isinstance(MODEL, RankedBinaryClassifier):
                        raw_scores = MODEL.forward_no_rank(pv)
                    elif RANK_CONDITIONED and isinstance(MODEL, RankedSiameseModel):
                        raw_scores = MODEL.forward_no_rank(pv)
                    elif hasattr(MODEL, 'forward_single'):
                        raw_scores = MODEL.forward_single(pv)
                    else:
                        raw_scores = MODEL(pv)
                        
                    normalized = torch.sigmoid(raw_scores) * 100
                    scores = normalized.cpu().numpy().flatten().tolist()
                    
                    for p, s in zip(paths, scores):
                        results.append({'path': p, 'normalized': float(s)})
                
                if torch.cuda.is_available(): torch.cuda.synchronize()
                time.sleep(0.005)
        except Exception as e:
            log(f"  ❌ Scoring Error: {e}")
            import traceback; traceback.print_exc()
        finally:
            for _, img in loaded_data: img.close()
            import gc; gc.collect()
            if torch.cuda.is_available(): torch.cuda.empty_cache()

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
