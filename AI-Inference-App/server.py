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
from model_dinov2 import DinoV2PreferenceModel, PerformerRankerModel, RankedBinaryClassifier, ClipPreferenceModel, KeepDeleteModel, image_processor
import performer_model


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
KEEP_SEEN = {'performer': None, 'features': {}, 'sorted': None, 'head': None}   # K: the performer being filtered, her picture file names → CLIP embeddings, and the head refit on her sorted pictures

from threading import Lock
from concurrent.futures import ThreadPoolExecutor
MODEL_LOCK = Lock()
IMAGE_POOL = ThreadPoolExecutor(8)   # classify_batch opens its pictures from the share in parallel
MODELS_DIR = Path(__file__).parent / 'models'
MODEL_METADATA_CACHE = {}  # Cache for model file metadata to prevent heavy I/O

# Register funscript generation pipeline. Deliberately does NOT serialise against
# MODEL_LOCK: a tracking run can take half an hour and blocking image inference
# behind it is worse than sharing the card. It warns about contention instead, so
# it needs a way to ask whether we currently hold a model.
try:
    log("🌊 Initializing Funpipe funscript pipeline...")
    from funpipe_worker import funpipe_bp, init_funpipe
    app.register_blueprint(funpipe_bp, url_prefix='/funpipe')
    init_funpipe(model_loaded_probe=lambda: MODEL is not None or RANKER_MODEL is not None)
    log("✅ Funpipe registered at /funpipe")
except Exception as e:
    log(f"⚠️ Funpipe module failed to load: {e}")
    import traceback
    traceback.print_exc()

# The library is read over the Adult Content Manager's HTTP API only (acm_client.py), never through a mapped drive.
import acm_client
from pathlib import PurePosixPath
HERE = Path(__file__).resolve().parent   # this app's own storage: the only files it opens itself


@app.before_request
def _learn_acm_address():
    """a request that says where ACM is (app_base_url) tells this app, until ACM pairs with it (POST /acm/link)"""
    if request.is_json:
        acm_client.remember((request.get_json(silent=True) or {}).get('app_base_url'))


@app.route('/acm/link', methods=['POST'])
def acm_link():
    """ACM pairs with this app: its address and the worker token (its Jobs and Funpipe pages send this by themselves)"""
    data = request.get_json(silent=True) or {}
    if not data.get('url'):
        return jsonify({'ok': False, 'error': 'url is required'}), 400
    acm_client.link(data['url'], data.get('token'))
    return jsonify({'ok': True, **acm_client.linked()})

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
                if 'binary' in model_id.lower() or 'filtering' in model_id.lower(): model_type = 'binary'
                elif 'pairwise' in model_id.lower() or 'preference' in model_id.lower(): model_type = 'pairwise'
            
            log(f"🦕 Architecture: {MODEL_NAME} | Type: {model_type} (Device: {DEVICE})")
            
            rank_conditioned = checkpoint.get('rank_conditioned', False)
            
            # Initialize the correct model class based on type + rank flag
            try:
                if model_type == 'performer_ranker':
                    # The ranker loads into the RANKER_MODEL slot, next to the keep/delete model.
                    global RANKER_MODEL, RANKER_PROCESSOR, RANKER_MODEL_ID
                    ranker = PerformerRankerModel(MODEL_NAME, quantize=quantize)
                    ranker.load_state_dict(checkpoint['model_state_dict'], strict=False)
                    ranker.to(DEVICE)
                    ranker.eval()
                    RANKER_MODEL = ranker
                    RANKER_PROCESSOR = image_processor(MODEL_NAME)
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
                elif model_type in ('clip_siamese', 'clip_taste'):
                    MODEL = ClipPreferenceModel(MODEL_NAME)
                elif model_type == 'clip_keepdelete':
                    MODEL = KeepDeleteModel()
                    MODEL.load_state_dict(checkpoint['model_state_dict'])   # its whole fine-tuned tower: every key must be there
                    MODEL.train_X, MODEL.train_y = checkpoint['features'].float().numpy(), checkpoint['labels'].numpy()
                    KEEP_SEEN.update(performer=None, features={}, sorted=None, head=None)
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
            PROCESSOR = MODEL.processor if isinstance(MODEL, KeepDeleteModel) else image_processor(MODEL_NAME)
            
            val_acc = checkpoint.get('val_acc')
            if val_acc: log(f"  Val accuracy at save: {val_acc*100:.1f}%")

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
        'performer_model': performer_model.STATE,
        'acm': acm_client.linked(),
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

@app.route('/unload_ranker', methods=['POST'])
def api_unload_ranker():
    """Unload only RANKER_MODEL (frees VRAM) — preserves CONTEXT_STAR_CACHE so
    pre-computed performer ranks survive into the classifier-only phase."""
    global RANKER_MODEL, RANKER_PROCESSOR, RANKER_MODEL_ID
    with MODEL_LOCK:
        if RANKER_MODEL is None:
            return jsonify({'success': True, 'message': 'No ranker loaded'})
        log(f"♻️ Unloading ranker {RANKER_MODEL_ID} to free VRAM...")
        try: RANKER_MODEL.to('cpu')
        except Exception: pass
        RANKER_MODEL = None
        RANKER_PROCESSOR = None
        RANKER_MODEL_ID = None
        import gc; gc.collect()
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
            log(f"♻️ VRAM after ranker unload: {torch.cuda.memory_allocated(DEVICE)/1024**2:.0f} MB")
    return jsonify({'success': True, 'message': 'Ranker unloaded'})


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
            
            # Auto-detect type if unknown ('ranker' before 'pairwise').
            if m_type == 'unknown':
                name_low = m.name.lower()
                if 'ranker' in name_low: m_type = 'performer_ranker'
                elif 'pairwise' in name_low or 'preference' in name_low: m_type = 'pairwise'
                elif 'binary' in name_low or 'filtering' in name_low: m_type = 'binary'

                sd = ckpt.get('model_state_dict', {})
                if any('head' in k for k in sd.keys()) and m_type == 'unknown': m_type = 'pairwise'

            rank_conditioned = ckpt.get('rank_conditioned', False)
            # Normalise type so rank-conditioned models have distinct identifiers
            if rank_conditioned and m_type == 'binary': m_type = 'ranked_binary'
            info['type'] = m_type
            info['backbone'] = ckpt.get('backbone') or ckpt.get('config', {}).get('model_name')
            info['val_acc'] = ckpt.get('val_acc')
            info['val_mae'] = ckpt.get('val_mae')  # For performer_ranker (regression)
            info['rank_conditioned'] = rank_conditioned
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
                elif 'binary' in model_id.lower() or 'filtering' in model_id.lower(): m_type = 'binary'

            config = checkpoint_cpu.get('config', {})
            model_name = config.get('model_name') or checkpoint_cpu.get('backbone') or 'facebook/dinov2-large'
            model_type = m_type
            rank_conditioned = bool(checkpoint_cpu.get('rank_conditioned', False))
            holdout_performers = checkpoint_cpu.get('holdout_performers') or []
            holdout_set = set(p.lower().strip() for p in holdout_performers)
            performer_ratings = checkpoint_cpu.get('performer_ratings', {})
            perf_ratings_norm = {k.lower().strip(): float(v) for k, v in performer_ratings.items()}

            from model_dinov2 import DinoV2PreferenceModel

            if model_type == 'binary' and not rank_conditioned:
                from trainer import BinaryClassifier
                test_model = BinaryClassifier(model_name)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
            elif model_type == 'binary' and rank_conditioned:
                from model_dinov2 import RankedBinaryClassifier
                test_model = RankedBinaryClassifier(model_name)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
            elif model_type == 'pairwise':
                test_model = DinoV2PreferenceModel(model_name=model_name, freeze_backbone=True)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
            elif model_type in ('clip_siamese', 'clip_taste'):
                test_model = ClipPreferenceModel(model_name)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
            elif model_type == 'performer_ranker':
                test_model = PerformerRankerModel(model_name, freeze_backbone=True)
                test_model.load_state_dict(checkpoint_cpu['model_state_dict'], strict=False)
            else:
                return jsonify({'success': False, 'error': f'Testing not supported for type: {model_type}'}), 400

            test_model.to(DEVICE)
            test_model.eval()

            processor = image_processor(model_name)

            # Helper to load image from sample object
            def load_img(sample_obj):
                if 'data' in sample_obj:
                    img_data = base64.b64decode(sample_obj['data'].split(',')[-1])
                    return Image.open(io.BytesIO(img_data)).convert('RGB')
                else:
                    return _load_image(sample_obj['path'], data.get('app_base_url'))

            # Extract performer name from a sample (caller may have set it, or we derive from path)
            def get_performer(sample):
                if sample.get('performer'): return sample['performer']
                if 'path' in sample:
                    parts = Path(sample['path']).parts
                    for i, p in enumerate(parts):
                        if p == 'pics' and i > 0: return parts[i-1]
                    if len(parts) >= 2: return parts[-2]
                return None

            # Tag every sample with a performer, filter to held-out if available.
            for s in test_samples:
                s['_performer'] = get_performer(s)
            in_distribution = False
            if holdout_set:
                filtered = [s for s in test_samples
                            if s['_performer'] and s['_performer'].lower().strip() in holdout_set]
                if not filtered:
                    return jsonify({'success': False,
                                    'error': 'No test images match this model\'s held-out performers'}), 400
                test_samples = filtered
                log(f"  🎯 Filtered to {len(test_samples)} images from {len(holdout_set)} held-out performers")
            else:
                # Old checkpoint with no holdout list — fall back to whatever was sampled.
                in_distribution = True
                log(f"  ⚠️ No holdout_performers in checkpoint — test set is in-distribution")

            # ── Unified scorer ─────────────────────────────────────────
            def get_rank(performer):
                if performer and performer.lower().strip() in perf_ratings_norm:
                    return perf_ratings_norm[performer.lower().strip()]
                return 2.5

            def score_image(img, performer=None):
                """Score one image. For keep/delete models returns sigmoid keep-prob;
                for performer_ranker returns predicted stars (0-5)."""
                inp = processor(images=img, return_tensors='pt').to(DEVICE)
                with torch.no_grad():
                    if model_type == 'binary' and not rank_conditioned:
                        return torch.sigmoid(test_model(inp['pixel_values'])).item()
                    if model_type == 'binary' and rank_conditioned:
                        r = torch.tensor([get_rank(performer)], dtype=torch.float32, device=DEVICE)
                        return torch.sigmoid(test_model(inp['pixel_values'], r)).item()
                    if model_type in ('pairwise', 'clip_siamese', 'clip_taste'):
                        return torch.sigmoid(test_model.forward_single(inp['pixel_values'])).item()
                    if model_type == 'performer_ranker':
                        return test_model.predict_rank(inp['pixel_values']).item()
                return 0.0

            # ── Branch by metric type ──────────────────────────────────
            if model_type == 'performer_ranker':
                # Regression metric: per-performer MAE / within-0.5 / Spearman ρ.
                from collections import defaultdict
                perf_preds = defaultdict(list)
                for sample in test_samples:
                    perf = sample.get('_performer')
                    if not perf: continue
                    try:
                        img = load_img(sample)
                        perf_preds[perf].append(score_image(img, perf))
                        if torch.cuda.is_available(): torch.cuda.synchronize()
                        time.sleep(0.005)
                    except: continue

                errors, within_half, pred_list, actual_list = [], 0, [], []
                for perf, scores in perf_preds.items():
                    if not scores: continue
                    actual = perf_ratings_norm.get(perf.lower().strip())
                    if actual is None: continue
                    avg_pred = sum(scores) / len(scores)
                    err = abs(avg_pred - actual)
                    errors.append(err)
                    if err <= 0.5: within_half += 1
                    pred_list.append(avg_pred); actual_list.append(actual)

                if not errors:
                    return jsonify({'success': False,
                                    'error': 'No held-out performers with both ratings and images'}), 400

                mae = sum(errors) / len(errors)
                within_pct = within_half / len(errors)
                if len(pred_list) >= 2:
                    p_t = torch.tensor(pred_list, dtype=torch.float32)
                    a_t = torch.tensor(actual_list, dtype=torch.float32)
                    pr = p_t.argsort().argsort().float()
                    ar = a_t.argsort().argsort().float()
                    rho = torch.corrcoef(torch.stack([pr, ar]))[0, 1].item()
                else:
                    rho = 0.0

                result = {
                    'mae': round(mae, 4),
                    'within_half_star': round(within_pct, 4),
                    'spearman_rho': round(rho, 4),
                    'total_tested': len(errors),
                    'metric_type': 'regression',
                    'model_type': model_type,
                    'in_distribution': in_distribution,
                    'holdout_performers_count': len(holdout_set),
                    # Compat fields so existing UI handlers don't crash
                    'accuracy': round(within_pct, 4),
                    'correct': within_half,
                }
            else:
                # Unified pair-ranking metric for all keep/delete models.
                # Build (keep, delete) pairs from the SAME performer — that's the
                # actual decision the model makes at inference time.
                from collections import defaultdict
                by_perf_keep = defaultdict(list)
                by_perf_del = defaultdict(list)
                for s in test_samples:
                    perf = s.get('_performer')
                    if not perf: continue
                    if s.get('label') == 1: by_perf_keep[perf].append(s)
                    else: by_perf_del[perf].append(s)

                pair_cap = max(1, sample_size // max(len(by_perf_keep), 1))
                test_pairs = []
                for perf, ks in by_perf_keep.items():
                    ds = by_perf_del.get(perf, [])
                    if not ks or not ds: continue
                    n = min(pair_cap, len(ks) * len(ds))
                    for _ in range(n):
                        test_pairs.append((random.choice(ks), random.choice(ds), perf))

                if not test_pairs:
                    return jsonify({'success': False,
                                    'error': 'No (keep, delete) pairs available — held-out performers need both classes'}), 400

                correct = 0
                keep_scores, delete_scores = [], []
                for k_obj, d_obj, perf in test_pairs:
                    try:
                        ks = score_image(load_img(k_obj), perf)
                        ds = score_image(load_img(d_obj), perf)
                        if ks > ds: correct += 1
                        keep_scores.append(ks); delete_scores.append(ds)
                        if torch.cuda.is_available(): torch.cuda.synchronize()
                        time.sleep(0.005)
                    except: continue

                total = len(keep_scores)
                accuracy = correct / max(total, 1)
                avg_keep = sum(keep_scores) / max(len(keep_scores), 1)
                avg_delete = sum(delete_scores) / max(len(delete_scores), 1)
                result = {
                    'accuracy': round(accuracy, 4),
                    'total_tested': total,
                    'correct': correct,
                    'avg_keep_score': round(avg_keep, 4),
                    'avg_delete_score': round(avg_delete, 4),
                    'separation': round(avg_keep - avg_delete, 4),
                    'metric_type': 'pair_ranking',
                    'model_type': model_type,
                    'rank_conditioned': rank_conditioned,
                    'in_distribution': in_distribution,
                    'holdout_performers_count': len(holdout_set),
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
    """A picture as a PIL Image, or None: a library path (/media/...) from ACM over HTTP (app_base_url, else the address
    ACM paired with), or a file in this app's own storage (training_data)."""
    try:
        own = Path(p).resolve()
        if own.is_relative_to(HERE) and own.is_file():
            return Image.open(own).convert('RGB')
    except (OSError, ValueError):
        pass
    return acm_client.image(p, app_base_url)

def _get_performer_name(image_path):
    """Extract performer name from folder structure."""
    p = Path(image_path)
    name = p.parent.name
    if name in ('pics', 'vids'):
        name = p.parent.parent.name
    return name

def _get_performer_images_for_rank(image_path, max_images=300, app_base_url=None):
    """Find up to 300 images for the same performer to get a better rank average: the pictures of her folder (its pics/
    folder when it has one), as ACM lists them."""
    folder = PurePosixPath(str(image_path).replace('\\', '/')).parent
    try:
        img_paths = acm_client.list_pictures(folder, app_base_url)
    except Exception as e:
        log(f"⚠️ Error listing performer images for rank: {e}")
        return [image_path]

    if not img_paths:
        return [image_path]
        
    import random
    if len(img_paths) > max_images:
        img_paths = random.sample(img_paths, max_images)
        
    return img_paths

@app.route('/rank_performer', methods=['POST'])
def rank_performer():
    """Run the performer ranker on up to 200 images and cache the result."""
    data = request.json
    image_paths = data.get('image_paths', [])[:200]
    performer_name = data.get('performer_name', 'unknown')
    app_base_url = data.get('app_base_url')

    if RANKER_MODEL is None:
        return jsonify({'success': False, 'error': 'No ranker model loaded'}), 400
    if not image_paths:
        return jsonify({'success': False, 'error': 'No image paths provided'}), 400

    loaded_data = []
    for p in image_paths:
        img = _load_image(p, app_base_url)
        if img:
            loaded_data.append((p, img))

    if not loaded_data:
        return jsonify({'success': False, 'error': 'Could not load any images'}), 400

    rank_preds = []
    with MODEL_LOCK:
        try:
            for i in range(0, len(loaded_data), 8):
                batch = loaded_data[i:i+8]
                imgs = [it[1] for it in batch]
                with torch.no_grad():
                    proc = RANKER_PROCESSOR or PROCESSOR
                    inputs = proc(images=imgs, return_tensors="pt")
                    pv = inputs['pixel_values'].to(DEVICE)
                    ranks = RANKER_MODEL.predict_rank(pv)
                    rank_preds.extend(ranks.cpu().tolist())
                if torch.cuda.is_available(): torch.cuda.synchronize()
        finally:
            for _, img in loaded_data: img.close()
            import gc; gc.collect()

    avg_rank = sum(rank_preds) / max(len(rank_preds), 1)
    CONTEXT_STAR_CACHE[performer_name] = avg_rank
    log(f"⭐ Pre-ranked '{performer_name}': {avg_rank:.2f} stars (from {len(rank_preds)} images)")

    return jsonify({
        'success': True,
        'rank': round(avg_rank, 2),
        'images_used': len(rank_preds),
        'performer': performer_name
    })


@app.route('/classify_batch', methods=['POST'])
def classify_batch():
    """Binary classification (Keep/Delete) for Smart Filtering."""
    data = request.json
    image_paths = data.get('images', [])
    threshold = data.get('threshold', 50.0)
    app_base_url = data.get('app_base_url')
    # Optional: caller-provided performer rank (used when the ranker has already
    # been run and unloaded — avoids needing RANKER_MODEL loaded during classification)
    performer_rank_override = data.get('performer_rank')

    if not image_paths: return jsonify({'error': 'No images'}), 400

    # If caller provided a rank, populate CONTEXT_STAR_CACHE for every performer
    # in this batch so the existing inside-lock logic uses it directly.
    if performer_rank_override is not None:
        try:
            r = float(performer_rank_override)
            for p in image_paths:
                CONTEXT_STAR_CACHE[_get_performer_name(p)] = r
            log(f"🎯 Using caller-provided performer rank: {r:.2f}")
        except (TypeError, ValueError):
            log(f"⚠️ Invalid performer_rank '{performer_rank_override}' — falling back to computed rank")

    # 1. PRE-LOAD IMAGES (Outside lock to avoid blocking and system lag)
    # 8 at a time: they come from the NAS share, and opening them one by one took most of a batch's time
    log(f"🧠 SMART FILTERING {len(image_paths)} images (Threshold: {threshold})...")
    open_all = lambda paths: [(p, img) for p, img in zip(paths, IMAGE_POOL.map(lambda q: _load_image(q, app_base_url), paths)) if img]
    loaded_data = open_all(image_paths)  # List of (path, PIL_Image)

    if not loaded_data:
        return jsonify({"success": False, "error": "Could not load any images."}), 500

    # K: the pictures of this performer already sorted (the filter view's keep-scores sends them) refit it for this batch. Her
    # embeddings are kept by file name while she is filtered, so a sorted picture is only opened again if it was never scored here.
    sorted_pics = [(p, 1) for p in data.get('sorted_keep') or []] + [(p, 0) for p in data.get('sorted_delete') or []]
    unseen = []
    if isinstance(MODEL, KeepDeleteModel):
        performer = _get_performer_name(image_paths[0])
        if KEEP_SEEN['performer'] != performer:
            KEEP_SEEN.update(performer=performer, features={}, sorted=None, head=None)
        unseen = open_all([p for p, _ in sorted_pics if Path(p).name not in KEEP_SEEN['features']])

    results = []
    start_time = time.time()
    import math

    # 2. PRE-COMPUTE PERFORMER RANKS (Outside lock — avoids holding MODEL_LOCK during heavy I/O)
    # If a rank-conditioned model is loaded and RANKER_MODEL is available, compute every
    # unique performer's rank now so classify_batch only needs a fast cache lookup inside the lock.
    if RANKER_MODEL is not None and isinstance(MODEL, RankedBinaryClassifier):
        performers_to_rank = {}
        for p, _ in loaded_data:
            perf = _get_performer_name(p)
            if perf not in CONTEXT_STAR_CACHE and perf not in performers_to_rank:
                performers_to_rank[perf] = p  # store one sample path per performer

        for perf, sample_path in performers_to_rank.items():
            if perf in CONTEXT_STAR_CACHE:
                continue  # another request may have filled it in the meantime
            performer_img_paths = _get_performer_images_for_rank(sample_path, max_images=200, app_base_url=app_base_url)
            rank_preds = []
            for ri in range(0, len(performer_img_paths), 8):
                chunk_paths = performer_img_paths[ri:ri+8]
                chunk_imgs = []
                for cp in chunk_paths:
                    cimg = _load_image(cp, app_base_url)
                    if cimg: chunk_imgs.append(cimg)
                if not chunk_imgs: continue
                with torch.no_grad():
                    proc = RANKER_PROCESSOR or PROCESSOR
                    inputs = proc(images=chunk_imgs, return_tensors="pt")
                    pv = inputs['pixel_values'].to(DEVICE)
                    ranks = RANKER_MODEL.predict_rank(pv)
                    rank_preds.extend(ranks.cpu().tolist())
                for cimg in chunk_imgs: cimg.close()
                if torch.cuda.is_available(): torch.cuda.synchronize()
            avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
            CONTEXT_STAR_CACHE[perf] = avg_rank
            log(f"  ⭐ {perf}: rank {avg_rank:.2f} (pre-computed from {len(rank_preds)} images, outside lock)")

    # 3. RUN INFERENCE (Inside lock)
    with MODEL_LOCK:
        if MODEL is None or PROCESSOR is None:
            return jsonify({'error': 'Model not loaded'}), 500
            
        try:
            # ── Rank-Conditioned Binary: Two-pass (ranker + classifier) ────
            if isinstance(MODEL, RankedBinaryClassifier):
                # Pass 0: Get performer ranks via RANKER_MODEL or fallback to 2.5
                performer_data = {}
                for p, img in loaded_data:
                    perf = _get_performer_name(p)
                    performer_data.setdefault(perf, []).append((p, img))
                
                for perf, items in performer_data.items():
                    if perf in CONTEXT_STAR_CACHE: continue
                    if RANKER_MODEL is not None:
                        # NEW: Load up to 300 images for this performer to get a robust rank
                        log(f"  🔍 Gathering images for {perf} to establish robust rank...")
                        performer_img_paths = _get_performer_images_for_rank(items[0][0], max_images=300, app_base_url=app_base_url)
                        log(f"  🔍 Running ranker on {len(performer_img_paths)} images for {perf}...")
                        
                        rank_preds = []
                        # Process in chunks of 8 for efficiency
                        for ri in range(0, len(performer_img_paths), 8):
                            chunk_paths = performer_img_paths[ri:ri+8]
                            chunk_imgs = []
                            for cp in chunk_paths:
                                cimg = _load_image(cp, app_base_url)
                                if cimg: chunk_imgs.append(cimg)
                            
                            if not chunk_imgs: continue
                            
                            with torch.no_grad():
                                proc = RANKER_PROCESSOR or PROCESSOR
                                inputs = proc(images=chunk_imgs, return_tensors="pt")
                                pv = inputs['pixel_values'].to(DEVICE)
                                ranks = RANKER_MODEL.predict_rank(pv)
                                rank_preds.extend(ranks.cpu().tolist())
                            
                            # Clean up chunk images immediately
                            for cimg in chunk_imgs: cimg.close()
                            if torch.cuda.is_available(): torch.cuda.synchronize()
                            
                        avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
                    else:
                        avg_rank = 2.5  # No ranker loaded — neutral fallback
                    CONTEXT_STAR_CACHE[perf] = avg_rank
                    log(f"  ⭐ {perf}: rank {avg_rank:.2f} (based on {len(rank_preds) if RANKER_MODEL else 0} images)")
                
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

            # ── Binary / Pairwise / Siamese: direct classification ──────────
            else:
                keep_model = isinstance(MODEL, KeepDeleteModel)
                head = None
                if keep_model:
                    seen = KEEP_SEEN['features']
                    for i in range(0, len(unseen), 4):
                        with torch.no_grad():
                            pv = PROCESSOR(images=[img for _, img in unseen[i:i+4]], return_tensors="pt")['pixel_values'].to(DEVICE)
                            for (p, _), v in zip(unseen[i:i+4], MODEL.features(pv).cpu()):
                                seen[Path(p).name] = v
                    known = [(Path(p).name, y) for p, y in sorted_pics if Path(p).name in seen]
                    if known and KEEP_SEEN['sorted'] == known:   # the filter view scores her in chunks: refit once per change
                        head = KEEP_SEEN['head']
                    elif known:
                        head = MODEL.refit(torch.stack([seen[n] for n, _ in known]).numpy(), torch.tensor([y for _, y in known]).numpy())
                        KEEP_SEEN.update(sorted=known, head=head)
                        log(f"🔁 K refit with {len(known)} sorted pictures of {KEEP_SEEN['performer']}")

                for i in range(0, len(loaded_data), 4):
                    batch = loaded_data[i:i+4]
                    imgs = [it[1] for it in batch]
                    paths = [it[0] for it in batch]

                    with torch.no_grad():
                        inputs = PROCESSOR(images=imgs, return_tensors="pt")
                        pv = inputs['pixel_values'].to(DEVICE)

                        if keep_model:
                            feats = MODEL.features(pv)
                            for p, v in zip(paths, feats.cpu()):
                                KEEP_SEEN['features'][Path(p).name] = v
                            logits = (MODEL.head if head is None else head)(feats)
                        elif hasattr(MODEL, 'forward_single'): logits = MODEL.forward_single(pv)
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
            for _, img in loaded_data + unseen: img.close()
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
        img = _load_image(p, data.get('app_base_url'))
        if img: loaded_imgs.append(img)
            
    if not loaded_imgs:
        return jsonify({"success": False, "error": "Could not load any images."}), 500

    # 2. RUN INFERENCE
    with MODEL_LOCK:
        try:
            # Determine which model to use for ranking
            target_model = None
            target_processor = None

            if RANKER_MODEL is not None:
                target_model = RANKER_MODEL
                target_processor = RANKER_PROCESSOR or PROCESSOR

            if not target_model:
                # Try auto-loading the newest ranker
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
                        RANKER_PROCESSOR = image_processor(model_name)
                        RANKER_MODEL_ID = ranker_filename

                        target_model = RANKER_MODEL
                        target_processor = RANKER_PROCESSOR
                        log("✅ Auto-loaded ranker successfully.")
                except Exception as le:
                    log(f"❌ Failed to auto-load ranker: {le}")
                
            if not target_model:
                return jsonify({"success": False, "error": "No rank-capable model loaded (load a Ranker first)"}), 400
                
            # Per-image ranker: predict each, then average.
            rank_preds = []
            for i in range(0, len(loaded_imgs), 8):
                batch = loaded_imgs[i:i+8]
                with torch.no_grad():
                    inputs = target_processor(images=batch, return_tensors="pt")
                    pv = inputs['pixel_values'].to(DEVICE)
                    ranks = target_model.predict_rank(pv)
                    rank_preds.extend(ranks.cpu().tolist())
                if torch.cuda.is_available(): torch.cuda.synchronize()

            avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
            log(f"  ✅ Prediction: {avg_rank:.2f} stars (based on {len(rank_preds)} images, per-image avg)")

            return jsonify({
                'success': True,
                'predicted_rank': round(avg_rank, 3),
                'sample_size': len(rank_preds),
                'aggregation': 'mean',
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
        
        img = _load_image(image_path, data.get('app_base_url')) if image_path else None
        if img is None:
            return jsonify({'error': 'Invalid image path'}), 400

        try:
            with torch.no_grad():
                inputs = PROCESSOR(images=[img], return_tensors="pt")
                pixel_values = inputs['pixel_values'].to(DEVICE)
                
                # Dispatch based on model type
                if isinstance(MODEL, RankedBinaryClassifier):
                    # Get rank for this performer
                    perf = _get_performer_name(image_path)
                    if perf not in CONTEXT_STAR_CACHE:
                        if RANKER_MODEL is not None:
                            # NEW: Also use up to 300 images for single classification if not cached
                            log(f"  🔍 Establishing robust rank for {perf} using up to 300 images...")
                            performer_img_paths = _get_performer_images_for_rank(image_path, max_images=300)
                            rank_preds = []
                            for ri in range(0, len(performer_img_paths), 8):
                                chunk_paths = performer_img_paths[ri:ri+8]
                                chunk_imgs = []
                                for cp in chunk_paths:
                                    cimg = _load_image(cp)
                                    if cimg: chunk_imgs.append(cimg)
                                if not chunk_imgs: continue
                                with torch.no_grad():
                                    proc = RANKER_PROCESSOR or PROCESSOR
                                    inp = proc(images=chunk_imgs, return_tensors="pt")
                                    p_val = inp['pixel_values'].to(DEVICE)
                                    ranks = RANKER_MODEL.predict_rank(p_val)
                                    rank_preds.extend(ranks.cpu().tolist())
                                for cimg in chunk_imgs: cimg.close()
                                if torch.cuda.is_available(): torch.cuda.synchronize()
                            
                            avg_rank = sum(rank_preds) / max(len(rank_preds), 1) if rank_preds else 2.5
                            CONTEXT_STAR_CACHE[perf] = avg_rank
                            log(f"  ⭐ {perf}: robust rank {avg_rank:.2f}")
                        else:
                            CONTEXT_STAR_CACHE[perf] = 2.5
                    rank = CONTEXT_STAR_CACHE[perf]
                    rank_t = torch.tensor([rank], dtype=torch.float32).to(DEVICE)
                    raw_scores = MODEL(pixel_values, rank_t)
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
                    if isinstance(MODEL, RankedBinaryClassifier):
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
from trainer import training_state, start_training, load_labeller_pairs, load_pairwise_db_orphans
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
    labeller = load_labeller_pairs()
    orphans = load_pairwise_db_orphans()

    return jsonify({
        'has_data': keep_count > 0 or delete_count > 0,
        'keep': keep_count,
        'delete': delete_count,
        'keep_performers': keep_performers,
        'delete_performers': delete_performers,
        'manifest': manifest,
        # Old labeller pairs: same performer (both CLIP models), across performers (CLIP taste only)
        'labeller_pairs': sum(wp == lp for _, _, wp, lp in labeller),
        'labeller_cross_pairs': sum(wp != lp for _, _, wp, lp in labeller),
        # pairwise.db pairs of performers deleted from the app, kept in a local file (legacy, like the import)
        'pairwise_db_orphans': len(orphans),
        'pairwise_db_orphans_intra': sum(p['type'] == 'intra' for p in orphans)
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

    # The library's base_path is never read here: training uses the copy ACM pushed (/upload_training) into
    # training_data, which has keep/ and delete/ subdirs
    base_path = data.get('base_path', '')
    if base_path:
        cached_keep = TRAINING_DATA_DIR / 'keep'
        cached_delete = TRAINING_DATA_DIR / 'delete'
        if cached_keep.exists() and cached_delete.exists():
            log(f"📂 training on the pushed copy of '{base_path}'")
            data['base_path'] = str(TRAINING_DATA_DIR)
            data['use_cached'] = True
        else:
            return jsonify({'success': False, 'message': 'No pushed training data yet. Push data first.'}), 400

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
    performer_model.start()
    log("👤 P and P2 follow the profile page (performer_model.py)")
    # Using use_reloader=False to prevent double model loading in debug mode
    app.run(host='0.0.0.0', port=3344, threaded=True, debug=True, use_reloader=False)
