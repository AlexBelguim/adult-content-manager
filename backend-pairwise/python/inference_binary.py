"""
DINOv2 Binary Classifier Inference Server
Scores individual images with a trained binary keep/delete model.

Port: 3345 (pairwise server is on 3344)

Endpoints:
  GET  /health         → { model_loaded, model_name, model_type }
  POST /load           → { path } → loads model
  POST /score          → { images: [path, ...] } → { results: [{ path, score }] }
  POST /evaluate       → { keep_images, delete_images } → accuracy stats
"""
import sys
import os
from pathlib import Path

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

import torch
import torch.nn as nn
from flask import Flask, request, jsonify
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

app = Flask(__name__)

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
MODEL = None
PROCESSOR = None
MODEL_NAME = None
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}


# ─── Model Definition (must match train_binary.py) ───────────────────────────

class DINOv2BinaryClassifier(nn.Module):
    def __init__(self, backbone_name='facebook/dinov2-large'):
        super().__init__()
        self.backbone = AutoModel.from_pretrained(backbone_name)
        hidden_size = self.backbone.config.hidden_size
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 1)
        )

    def forward(self, pixel_values):
        outputs = self.backbone(pixel_values=pixel_values)
        cls = outputs.last_hidden_state[:, 0, :]
        logit = self.classifier(cls).squeeze(-1)
        return logit


# ─── Load ─────────────────────────────────────────────────────────────────────

def load_model(path=None):
    global MODEL, PROCESSOR, MODEL_NAME

    if not path:
        return False, 'No model path specified'

    model_path = Path(path)
    if not model_path.is_absolute():
        # look in models/ dir relative to this script
        model_path = Path(__file__).parent.parent / 'models' / path

    if not model_path.exists():
        return False, f'Model not found: {model_path}'

    print(f'\n{"="*50}')
    print(f'  Loading binary model: {model_path.name}')
    print(f'  Device: {DEVICE}')

    try:
        ckpt = torch.load(model_path, map_location='cpu')
        backbone_name = ckpt.get('backbone', 'facebook/dinov2-large')

        print(f'  Backbone: {backbone_name}')
        PROCESSOR = AutoImageProcessor.from_pretrained(backbone_name)

        model = DINOv2BinaryClassifier(backbone_name)
        state = ckpt.get('model_state_dict', ckpt)
        model.load_state_dict(state, strict=False)
        model = model.to(DEVICE)
        model.eval()

        MODEL = model
        MODEL_NAME = model_path.name

        val_acc = ckpt.get('val_acc', None)
        if val_acc:
            print(f'  Val accuracy at save: {val_acc*100:.1f}%')
        print(f'  ✅ Binary model ready')
        print(f'{"="*50}\n')
        return True, 'Loaded successfully'

    except Exception as e:
        print(f'  ❌ Error: {e}')
        MODEL = None
        return False, str(e)


# ─── Inference ────────────────────────────────────────────────────────────────

@torch.no_grad()
def score_image(path: str) -> float:
    """Score a single image. Returns 0-100 scale (100 = definitely keep)."""
    try:
        img = Image.open(path).convert('RGB')
        inputs = PROCESSOR(images=img, return_tensors='pt')
        pv = inputs['pixel_values'].to(DEVICE)
        logit = MODEL(pv)
        prob = torch.sigmoid(logit).item()
        return round(prob * 100, 2)
    except Exception as e:
        print(f'  Score error for {path}: {e}')
        return 50.0


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'device': str(DEVICE),
        'model_loaded': MODEL is not None,
        'model_name': MODEL_NAME,
        'model_type': 'binary'
    })


@app.route('/load', methods=['POST'])
def load_route():
    data = request.json or {}
    path = data.get('path')
    success, message = load_model(path)
    if success:
        return jsonify({'success': True, 'model': MODEL_NAME, 'message': message})
    return jsonify({'success': False, 'error': message}), 400


@app.route('/score', methods=['POST'])
def score_route():
    if MODEL is None:
        return jsonify({'error': 'No model loaded'}), 400

    data = request.json or {}
    images = data.get('images', [])

    results = []
    for img_path in images:
        score = score_image(img_path)
        results.append({'path': img_path, 'score': score})

    return jsonify({'results': results})


@app.route('/evaluate', methods=['POST'])
def evaluate_route():
    """Evaluate accuracy on known keep/delete images."""
    if MODEL is None:
        return jsonify({'error': 'No model loaded'}), 400

    data = request.json or {}
    keep_images = data.get('keep_images', [])
    delete_images = data.get('delete_images', [])
    threshold = data.get('threshold', 50.0)

    keep_correct = 0
    delete_correct = 0
    keep_scores = []
    delete_scores = []

    for path in keep_images:
        score = score_image(path)
        keep_scores.append(score)
        if score >= threshold:
            keep_correct += 1

    for path in delete_images:
        score = score_image(path)
        delete_scores.append(score)
        if score < threshold:
            delete_correct += 1

    total = len(keep_images) + len(delete_images)
    total_correct = keep_correct + delete_correct

    return jsonify({
        'total': total,
        'correct': total_correct,
        'accuracy': round(total_correct / max(total, 1) * 100, 1),
        'keep_accuracy': round(keep_correct / max(len(keep_images), 1) * 100, 1),
        'delete_accuracy': round(delete_correct / max(len(delete_images), 1) * 100, 1),
        'keep_count': len(keep_images),
        'delete_count': len(delete_images),
        'keep_mean_score': round(sum(keep_scores) / max(len(keep_scores), 1), 1),
        'delete_mean_score': round(sum(delete_scores) / max(len(delete_scores), 1), 1),
        'threshold': threshold
    })


if __name__ == '__main__':
    print('\n🔬 DINOv2 Binary Classifier Server Ready (Waiting for model)...')
    print('   Score:    http://localhost:3345/score')
    print('   Health:   http://localhost:3345/health')
    app.run(host='0.0.0.0', port=3345, debug=False)
