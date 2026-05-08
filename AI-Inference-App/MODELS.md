# AI Inference App — Model Architecture Reference

This document describes every model architecture in the AI Inference App:
how each is structured, trained, used at inference, and what output you get per image.

---

## Table of Contents

1. [Pairwise Preference Model](#1-pairwise-preference-model)
2. [Binary Classifier](#2-binary-classifier)
3. [Context-Aware Binary Classifier](#3-context-aware-binary-classifier)
4. [Calibration Engine](#4-calibration-engine)
5. [Agent of Taste (Skeleton)](#5-agent-of-taste-skeleton)

---

## 1. Pairwise Preference Model

**File:** `model_dinov2.py` — `DinoV2PreferenceModel`
**Checkpoint type tag:** `model_type: 'pairwise'`
**This is the model loaded by default** when the frontend calls `/load_model` and used by the
`/score` and `/classify_batch` endpoints.

### Architecture

```
Input Image (any size, resized to 518×518 by processor)
    │
    ▼
DINOv2-Large Backbone (facebook/dinov2-large, 304M params)
    │
    ▼
CLS Token (1024-dim)
    │
    ▼
L2 Normalization (stabilizes training for pairwise ranking)
    │
    ▼
Head:
    Linear(1024 → 512) → BatchNorm1d → ReLU → Dropout(0.3)
    Linear(512 → 128)  → ReLU → Dropout(0.1)
    Linear(128 → 1)
    │
    ▼
Raw Score (unbounded float)
```

### Training

**Input data:** Winner/loser image pairs from pairwise labeling sessions.

| Setting | Value |
|---|---|
| Loss | `MarginRankingLoss(margin=1.0)` — pushes winner score above loser by ≥1.0 |
| Optimizer | AdamW |
| Phase 1 (epoch 1-2) | Backbone frozen, head trains at `lr=1e-3` |
| Phase 2 (epoch 3+) | Backbone unfrozen, head `1e-3`, backbone `1e-5` |
| Batch input | Two images per sample: `(winner_pixels, loser_pixels)` |

**What the model learns:** A relative quality ordering — "image A is better than image B."
It does NOT learn absolute keep/delete decisions. It learns your visual preference ranking.

### Inference — Two Modes

**Mode A: Pairwise comparison** — `forward(img_a, img_b)` → `(score_a, score_b)`
Used internally by pairwise ranking. Returns two raw floats; whichever is higher "wins."

**Mode B: Single-image scoring** — `forward_single(img)` → raw float → `sigmoid() × 100`
Used by `/score` and `/classify_batch`. Despite being trained on pairs, the model's
single-image path produces a standalone quality score.

### Output Per Image

```json
{
  "path": "/images/performer/pic.jpg",
  "score": 73.42,
  "decision": "keep"
}
```

- **score:** 0–100 (sigmoid-normalized). Higher = model thinks it's better.
- **decision:** `"keep"` if score ≥ threshold (default 50), else `"delete"`.
- **Caveat:** The score distribution depends heavily on training data.
  Sigmoid of raw pairwise scores tends to cluster around 40–60 for average images.

### Endpoints That Use This Model

| Endpoint | What it does |
|---|---|
| `POST /score` | Batch score images, returns `{ path, normalized }` |
| `POST /classify_batch` | Batch score + threshold → returns `{ path, score, decision }` |
| `POST /classify` | Single image → `{ path, score, decision, confidence }` |

---

## 2. Binary Classifier

**File:** `trainer.py` — `BinaryClassifier`
**Checkpoint type tag:** `model_type: 'binary'`
**Saved to:** `models/binary_filtering.pt`

### Architecture

```
Input Image (224×224 RGB)
    │
    ▼
DINOv2-Large Backbone (facebook/dinov2-large)
    │
    ▼
CLS Token (1024-dim)
    │
    ▼
Classifier Head:
    Linear(1024 → 256) → ReLU → Dropout(0.3) → Linear(256 → 1)
    │
    ▼
Raw Logit (single float, unbounded)
    │
    ▼
sigmoid() → keep probability [0.0 – 1.0]  → × 100 → score [0 – 100]
```

Key differences from pairwise model:
- **No L2 normalization** (not needed for binary classification)
- **No BatchNorm** (simpler head, only 2 layers vs 3)
- **Final bias zero-initialized** so sigmoid(0) = 0.5 — model starts perfectly neutral

### Training — Progressive Unfreezing

**Input data:** Images in `keep/` and `delete/` folders, organized by performer.

| Setting | Value |
|---|---|
| Loss | `BCEWithLogitsLoss` (binary cross-entropy on raw logits) |
| Phase 1 — WARMUP (default 2 epochs) | Backbone frozen, only head trains at `lr=1e-3` |
| Phase 2 — FINETUNE (default 6 epochs) | Backbone unfrozen, head `1e-3`, backbone `1e-5` |
| Class balancing | Downsample majority class to match minority |
| Augmentation | Mild: horizontal flip, random crop (0.85-1.0), light color jitter |
| Validation split | 15% |
| Mixed precision | AMP with GradScaler on CUDA |
| Scheduler | `OneCycleLR` (cosine annealing, steps per batch) |

**What the model learns:** An absolute keep/delete boundary — "this image should be kept"
regardless of which performer it belongs to. It learns global visual taste.

### Inference

Single pass — each image is independent:

```
Image → DINOv2 → CLS → Head → logit → sigmoid × 100 → score
```

### Output Per Image

```json
{
  "path": "/images/performer/pic.jpg",
  "score": 87.34,
  "decision": "keep"
}
```

- **score:** 0–100. `sigmoid(logit) × 100`.
  - 100 = definitely keep
  - 0 = definitely delete
  - 50 = model is unsure (this is the initial state before training)
- **decision:** `"keep"` if score ≥ threshold (default 50), else `"delete"`.

### Where It's Used

Trained via `POST /train` with `type: 'binary'`. Can be tested via `POST /test_model`.
**Not currently usable** through the main `/classify_batch` endpoint — that endpoint
always loads a `DinoV2PreferenceModel`. Only usable if loaded manually through the
pairwise backend's `inference_binary.py` server (port 3345).

---

## 3. Context-Aware Binary Classifier

**Status: NEEDS REIMPLEMENTATION** — The current code uses raw embedding averages
as "context." The correct design uses the performer's star rating.

### Correct Design (Two-Headed Architecture)

The context-aware model should understand **who** it's filtering for. A 5-star performer
gets a lenient filter; a 2-star performer gets a strict filter. The model learns this
relationship from training data where each image is labeled with both its performer's
star rating AND whether it was kept or deleted.

```
Input Image (224×224 RGB)
    │
    ▼
DINOv2-Large Backbone (shared)
    │
    ▼
CLS Token (1024-dim)
    │
    ├──────────────────────────────┐
    ▼                              ▼
  HEAD 1: Star Predictor       HEAD 2: Keep/Delete Classifier
    │                              │
    ▼                              ▼
  Linear(1024 → 256)           Linear(1024 + 1 → 512)
  ReLU                         ReLU → Dropout(0.3)
  Linear(256 → 1)             Linear(512 → 256)
    │                          ReLU
    ▼                          Linear(256 → 1)
  Predicted Star Rating            │
  (0–5 continuous)                 ▼
                               Raw Logit → sigmoid → keep probability
```

### Training

**Input data per image:**
- The image pixels
- The performer's `manual_star` rating from the DB (0–5 scale)
- The keep/delete label

**Both heads train simultaneously:**

| Head | Loss | Target |
|---|---|---|
| Head 1 (Star Predictor) | `MSELoss` | The performer's actual star rating (0–5) |
| Head 2 (Keep/Delete) | `BCEWithLogitsLoss` | 1.0 for keep, 0.0 for delete |

**Head 2 receives the star rating as input** — during training this is the REAL star
rating from the database. The head learns: "given that this is a 3.5-star performer,
is this specific image a keep or delete?"

**What the model learns:**
- **Head 1:** What visual patterns correlate with higher/lower star ratings
  (the user's taste in performers)
- **Head 2:** Given a known quality tier, what's the keep/delete threshold
  (a 5-star performer's "delete" might be a 2-star performer's "keep")

### Inference — Two-Pass System

**Pass 1 — Rate the Performer:**
Take ~100 images from the performer (or all available).
Run each through **Head 1** only → collect predicted star ratings → average them.
Result: "This performer is approximately 3.5 stars."

**Pass 2 — Keep/Delete Decisions:**
For each image, feed the image embedding + the predicted star rating (from Pass 1)
into **Head 2** → get keep/delete probability.

```
Pass 1 (once per performer):
    100 images → Head 1 → [3.2, 3.8, 3.4, 3.6, ...] → mean = 3.5

Pass 2 (per image):
    image_embedding + 3.5 → Head 2 → logit → sigmoid → score
```

The predicted star rating gets **cached per performer** — Pass 1 only runs once,
then all subsequent images from that performer skip straight to Pass 2.

### Output Per Image

```json
{
  "path": "/images/performer/pic.jpg",
  "score": 82.1,
  "decision": "keep",
  "predicted_stars": 3.5,
  "performer": "PerformerName"
}
```

- **score:** 0–100 (keep probability, contextualized to this performer's tier)
- **decision:** `"keep"` or `"delete"` based on threshold
- **predicted_stars:** The model's prediction of what star rating this performer
  deserves (averaged across their images in Pass 1). This is a bonus output —
  the system can now auto-rate new performers.
- **performer:** Which performer this image belongs to (from folder structure)

### Key Differences from Standard Binary

| Aspect | Standard Binary | Context-Aware |
|---|---|---|
| Knows performer quality? | No — same threshold for everyone | Yes — adapts per performer tier |
| Output | score + decision | score + decision + predicted stars |
| Inference passes | 1 | 2 (rate performer first, then classify) |
| Training labels needed | keep/delete only | keep/delete + performer star rating |
| Can auto-rate new performers? | No | Yes (Head 1 predicts stars) |

---

## 4. Calibration Engine

**File:** `calibration.py` — `CalibrationEngine`

This is NOT a neural network. It's a statistical post-processing layer that maps raw
AI scores to human-meaningful star ratings using isotonic regression.

### How It Works

1. User provides manual star ratings for some performers (`manual_star` in DB)
2. Each performer has a `raw_ai_score` from the pairwise model
3. Calibration fits a **monotonic curve**: `raw_score → predicted_stars`
4. Uses **Bayesian blending** with a population prior (shrinks toward `score/20`
   when few ratings exist, converges to user's curve with more ratings)

### Training (Fitting)

```
POST /calibrate
{
  "ratings": [
    { "raw_ai_score": 72.3, "manual_star": 4.0, "confidence": 0.8 },
    { "raw_ai_score": 31.2, "manual_star": 1.5, "confidence": 0.6 }
  ]
}
```

Fits a weighted isotonic regression → blended with prior → monotonic mapping curve.

### Inference

```
POST /predict_batch
{
  "performers": [
    { "id": 1, "raw_ai_score": 65.0 },
    { "id": 2, "raw_ai_score": 42.0 }
  ],
  "manual_ratings": { "1": 3.5 }
}
```

Returns predicted star ratings for all performers, with batch correction from
any manual ratings provided in the same request.

### Output Per Performer

```json
{
  "predictions": {
    "1": 3.52,
    "2": 2.11
  }
}
```

- Predicted star rating (0–5) for each performer ID.
- Incorporates: calibration curve + batch correction + rank monotonicity (PAVA).

---

## 5. Agent of Taste (Skeleton)

**File:** `trainer.py` — `AgentOfTasteModel`
**Status:** Architecture defined but **no training function or inference endpoint exists**.
This was a sketch that the Context-Aware model's redesign effectively replaces.

### Architecture (For Reference)

```
Image → DINOv2 → CLS token (1024-dim)
    │
    ├─→ Aesthetic Head   → Linear(1024→256) → Sigmoid → aesthetic score (0-1)
    │
    ├─→ Performer Embedding (Embedding table, 128-dim per performer ID)
    │       │
    │       ▼
    │   [CLS + performer_embed] = 1152-dim
    │       │
    │       ├─→ Preference Head → Linear(1152→256) → Sigmoid → preference (0-1)
    │       └─→ Action Head     → Linear(1152→256) → logit → keep/delete
```

**Problems with this design:**
- Requires a **fixed performer embedding table** (num_performers must be known at init)
- New performers need a new embedding slot or fall back to "unknown"
- The Context-Aware model's star-rating approach is strictly better: it uses a
  continuous signal (0–5) instead of a discrete embedding per performer

---

## Model Comparison Summary

| | Pairwise | Binary | Context-Aware | Calibration |
|---|---|---|---|---|
| **Type** | Neural (Siamese) | Neural (Classifier) | Neural (Two-Head) | Statistical |
| **Backbone** | DINOv2-Large | DINOv2-Large | DINOv2-Large (shared) | None |
| **Training signal** | Winner/loser pairs | Keep/delete labels | Keep/delete + star ratings | Manual star ratings |
| **Output per image** | Relative score 0-100 | Keep probability 0-100 | Keep probability 0-100 + predicted stars | — |
| **Output per performer** | — | — | Predicted star rating 0-5 | Predicted star rating 0-5 |
| **Performer-aware?** | No | No | Yes (via star context) | Yes (via calibration curve) |
| **Checkpoint tag** | `pairwise` | `binary` | `context_binary` | N/A (in-memory) |
| **Saved to** | `pairwise_preference.pt` | `binary_filtering.pt` | `context_binary.pt` | Not persisted |
| **Default for /classify_batch?** | ✅ Yes | ❌ No | ❌ No (needs wiring) | N/A |
