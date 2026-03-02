"""
DINOv2 Inference Server
Persistent server to avoid model reloading penalties.

Run: python inference_server_dinov2.py
Then the labeler server calls http://localhost:5002/score

Uses port 5002 to not conflict with CLIP server on 5001.
"""
import os
import sys
# Force UTF-8 for Windows console to support emojis
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

import torch
import time
from pathlib import Path
from flask import Flask, request, jsonify
from PIL import Image
from transformers import AutoImageProcessor

sys.path.insert(0, str(Path(__file__).parent))
from model_dinov2 import DinoV2PreferenceModel

app = Flask(__name__)

# Global model state
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
MODEL = None
PROCESSOR = None
MODEL_NAME = None

def find_models():
    """Find all available .pt models in models directory."""
    candidates = []
    
    # Only look in ../models
    models_path = Path(__file__).parent.parent / 'models'
    
    if models_path.exists():
        for file in models_path.glob('*.pt'):
            candidates.append(file)
                
    return candidates

def load_model(path=None):
    """Load DINOv2 model. Path should be absolute or filename in models dir."""
    global MODEL, PROCESSOR, MODEL_NAME
    
    print(f"\n{'='*60}")
    print(f"🦕 DINOV2 INFERENCE SERVER - Loading Model")
    print(f"{'='*60}")
    print(f"🖥️  Device: {DEVICE}")
    
    if DEVICE.type == 'cuda':
        print(f"   GPU: {torch.cuda.get_device_name(0)}")
        print(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    checkpoint_path = None
    
    if path:
        # Check if it's a full path
        p = Path(path)
        if p.exists():
            checkpoint_path = p
        else:
            # Check if it's just a filename in models dir
            models_path = Path(__file__).parent.parent / 'models'
            p = models_path / path
            if p.exists():
                checkpoint_path = p
            else:
                print(f"❌ Model not found: {path}")
                return False, f"Model not found: {path}"
    else:
        # No path provided? Do nothing. User must select model.
        print("⚠️  No model specified. Waiting for user selection.")
        return False, "No model specified"
    
    try:
        print(f"📦 Loading checkpoint: {checkpoint_path}")
        start_time = time.time()
        
        checkpoint = torch.load(checkpoint_path, map_location=DEVICE)
        
        # Get model config
        config = checkpoint.get('config', {})
        MODEL_NAME = config.get('model_name', "facebook/dinov2-large")
        
        print(f"🦕 Model: {MODEL_NAME}")
        
        # Load model
        MODEL = DinoV2PreferenceModel(model_name=MODEL_NAME, freeze_backbone=True)
        
        # Debug: Print checkpoint keys to help diagnosis
        keys = list(checkpoint['model_state_dict'].keys())
        print(f"🔑 Checkpoint keys sample ({len(keys)} total): {keys[:5]}")
        
        # Load state dict with strict=False to allow missing backbone weights
        # (Since we initialize backbone from pretrained HF, it's fine if checkpoint only has head)
        msg = MODEL.load_state_dict(checkpoint['model_state_dict'], strict=False)
        
        # Verify that we at least loaded the HEAD
        missing = msg.missing_keys
        if missing:
            # Check if missing keys are only backbone
            all_backbone = all('backbone.' in k or 'dinov2.' in k for k in missing)
            if all_backbone:
                print("⚠️  Checkpoint missing backbone weights (using pretrained backbone). This is normal for optimized checkpoints.")
            else:
                print(f"⚠️  Missing keys: {missing[:5]}...")
                
        MODEL.to(DEVICE)
        MODEL.eval()
        
        # Load processor with 518px resolution for fine detail capture
        print(f"🔧 Loading DINOv2 processor (518px)...")
        PROCESSOR = AutoImageProcessor.from_pretrained(
            MODEL_NAME,
            do_resize=True,
            size={"shortest_edge": 518},
            do_center_crop=True,
            crop_size={"height": 518, "width": 518}
        )
        
        load_time = time.time() - start_time
        print(f"✅ Model loaded in {load_time:.1f}s")
        print(f"{'='*60}\n")
        return True, "Model loaded successfully"
        
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        MODEL = None
        return False, str(e)


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'device': str(DEVICE),
        'model': MODEL_NAME,
        'model_type': 'dinov2',
        'model_loaded': MODEL is not None
    })

@app.route('/load', methods=['POST'])
def load_route():
    """Load a specific model."""
    data = request.json
    path = data.get('path')
    success, message = load_model(path)
    if success:
        return jsonify({'success': True, 'message': message, 'model': MODEL_NAME})
    else:
        return jsonify({'success': False, 'error': message}), 400


@app.route('/score', methods=['POST'])
def score_images():
    """Score a batch of images."""
    if MODEL is None:
        return jsonify({'error': 'Model not loaded'}), 500
    
    data = request.json
    image_paths = data.get('images', [])
    
    if not image_paths:
        return jsonify({'error': 'No images provided'}), 400
    
    start_time = time.time()
    results = []
    errors = 0
    
    # Process in batches
    batch_size = 8
    
    for batch_start in range(0, len(image_paths), batch_size):
        batch_paths = image_paths[batch_start:batch_start + batch_size]
        batch_images = []
        valid_indices = []
        
        # Load images
        for i, img_path in enumerate(batch_paths):
            try:
                img = Image.open(img_path).convert('RGB')
                batch_images.append(img)
                valid_indices.append(batch_start + i)
            except Exception as e:
                errors += 1
                print(f"⚠️  Error loading {img_path}: {e}")
                results.append({
                    'path': img_path,
                    'score': 0,
                    'normalized': 50,
                    'error': str(e)
                })
        
        if batch_images:
            try:
                with torch.no_grad():
                    # Process batch
                    inputs = PROCESSOR(images=batch_images, return_tensors="pt")
                    pixel_values = inputs['pixel_values'].to(DEVICE)
                    
                    if batch_start == 0:
                        print(f"📊 Batch 0 Pixel Stats: Mean={pixel_values.mean().item():.3f}, Std={pixel_values.std().item():.3f}")
                    
                    # Get scores
                    raw_scores = MODEL.forward_single(pixel_values)
                    
                    if batch_start == 0:
                        print(f"📊 Batch 0 Raw Scores (logits): {raw_scores[:5].cpu().numpy()}")
                    
                    normalized_scores = MODEL.score_images(pixel_values)
                    
                    # Handle dimensions
                    if raw_scores.dim() == 0:
                        raw_scores = raw_scores.unsqueeze(0)
                    if normalized_scores.dim() == 0:
                        normalized_scores = normalized_scores.unsqueeze(0)
                    
                    raw_list = raw_scores.cpu().numpy().tolist()
                    norm_list = normalized_scores.cpu().numpy().tolist()
                    
                    if isinstance(raw_list, float):
                        raw_list = [raw_list]
                    if isinstance(norm_list, float):
                        norm_list = [norm_list]
                    
                    for j, (raw, norm) in enumerate(zip(raw_list, norm_list)):
                        original_idx = valid_indices[j]
                        results.append({
                            'path': image_paths[original_idx],
                            'score': float(raw),
                            'normalized': float(norm)
                        })
                        
            except Exception as e:
                print(f"⚠️  Batch inference error: {e}")
                for j in range(len(batch_images)):
                    errors += 1
                    results.append({
                        'path': image_paths[valid_indices[j]],
                        'score': 0,
                        'normalized': 50,
                        'error': str(e)
                    })
    
    # Sort by original order
    path_order = {p: i for i, p in enumerate(image_paths)}
    results.sort(key=lambda x: path_order.get(x['path'], 999999))
    
    elapsed = time.time() - start_time
    speed = len(image_paths) / elapsed if elapsed > 0 else 0
    
    print(f"🦕 Scored {len(image_paths)} images in {elapsed:.2f}s ({speed:.1f} img/s)")
    
    return jsonify({
        'success': True,
        'results': results,
        'count': len(results),
        'errors': errors,
        'time': elapsed,
        'speed': speed,
        'model_type': 'dinov2'
    })


if __name__ == '__main__':
    # Do NOT auto-load model. Wait for user.
    print("🦕 DINOv2 Inference Server Ready (Waiting for model)...")
    print(f"   Endpoint: http://localhost:3344/score")
    print(f"   Health:   http://localhost:3344/health")
    
    # Port 3344 for DINOv2 server
    app.run(host='0.0.0.0', port=3344, threaded=True)
