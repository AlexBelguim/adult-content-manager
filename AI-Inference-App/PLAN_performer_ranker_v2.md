# Plan — Performer Ranker v2 (Gallery-Level Attention)

## Why

Current `PerformerRankerModel` ([model_dinov2.py:51](model_dinov2.py:51)) treats each image independently, then `/predict_rank` averages predictions across the gallery in Python ([server.py:1268](server.py:1268)). This doesn't match the original intent — the model should look at the performer's gallery and emit one rating, the same way a human rater would.

Measured today: per-image val_mae ≈ 0.344 (during training, on 15% holdout), but per-performer MAE ≈ 0.60 across all 42 rated performers. Errors are dominated by systematic per-performer bias (e.g. NinaYumiOF: 50 images, std=0.17, off by +1.33). Mean-aggregation doesn't fix that — the model is *confidently* wrong on those performers, not just noisy.

## Goal

One model, one forward call per performer, one output rating. Internal mechanism free to learn whatever aggregation pattern best predicts the user's labels — no per-image score exposed.

## Architecture

```
Performer Gallery (K images, K variable)
        │
        ▼
DINOv2-Large Backbone (shared, weights from current ranker as warm start)
        │
        ▼
K × CLS tokens (1024-d each)
        │
        ▼
Attention Head (small MLP → softmax over K) → K attention weights
        │
        ▼
Weighted sum of CLS tokens → 1 × 1024-d gallery embedding
        │
        ▼
Rank Head (Linear 1024 → 256 → 1, clamp 0-5)
        │
        ▼
Single star rating
```

**Attention head**: `Linear(1024, 128) → tanh → Linear(128, 1)` → softmax over K. No assumption baked in about how aggregation should work — the head discovers it from labels.

**Loss**: MSE between single output and `manual_star`.

## Training data shape

- One sample = one rated performer's gallery.
- Each epoch, randomly sample K=32 images per performer (or all if fewer). This is the augmentation: same target, different gallery slice → attention head learns stable patterns rather than overfitting on specific images.
- Use **both** `keep/` and `delete/` images (same as current ranker), since the user's filtered library is the realistic inference distribution.
- 15% performer-level holdout (not image-level). This is the honest val split.

## Regularization to avoid attention collapse

Small dataset (42 performers growing) → attention head can collapse to:
1. Uniform weights (degenerates to mean pool)
2. All weight on one image (degenerates to max)

Mitigations:
- **Attention dropout**: drop a random subset of K weights during training (force the head to use multiple images).
- **Entropy floor (optional)**: penalize attention distributions with entropy below threshold τ. Skip if it's fighting the signal.
- Use the current ranker checkpoint as backbone warm start, so we're not training all 304M params from scratch.

## Inference path changes

- `/predict_rank` endpoint ([server.py:1180](server.py:1180)): drop the Python-side averaging. Load all gallery images, single forward, return the model's output.
- Rank-conditioned models (`RankedBinaryClassifier`, `RankedSiameseModel`): unchanged — they still consume one rank scalar per performer. The pre-rank flow in smart filtering ([commit 7e4fe21](#)) is exactly the right pattern for the new model.
- Old `PerformerRankerModel` class: **keep** for backward compatibility (so older `performer_ranker_*.pt` checkpoints still load). New class is additive.

## File changes

| File | Change |
|---|---|
| `model_dinov2.py` | Add `PerformerAttentionRanker` class. Keep old `PerformerRankerModel`. |
| `trainer.py` | Add `train_performer_attention_ranker(config)`. Reuse `scan_performer_dirs` and manifest loading from existing `train_performer_ranker`. |
| `trainer.py` | Register new type `'performer_attention_ranker'` in `start_training()` dispatch. |
| `server.py` | Add model type recognition in `/load_model` (look for `model_type: 'performer_attention_ranker'` in checkpoint). Update `/predict_rank` to call the new gallery-level forward when this model is loaded. |
| `backend/routes/training.js` | Recognize new type in the training dispatch around [training.js:409](../backend/routes/training.js:409). |
| `frontend/src/pages/TrainingHubPage.js` | Add it as a training option. |

## Migration / rollout

1. Implement new class + training function alongside existing one. No breaking changes.
2. Train v2 on current 42 performers, compare per-performer MAE against current 0.60 baseline. Expect similar-or-modestly-better at this dataset size; the real win comes as labels grow.
3. Once v2 is validated, switch the default auto-load in `/predict_rank` to prefer `performer_attention_ranker_*.pt` over `performer_ranker_*.pt`.
4. Leave the old training pipeline available for comparison/fallback.

## What this does NOT solve

- The current ~7 outliers (NinaYumiOF, shawtnees, etc.) where the model is consistently wrong about specific performers. Those need either (a) more labels in the 2.0–3.0 range, or (b) features the backbone doesn't capture well (no architecture change will fix that).
- The 42-performer ceiling. More ratings → better model. This is the primary lever.

## Ground truth: how `manual_star` is actually computed

Confirmed via [backend/routes/performers.js:946-1175](../backend/routes/performers.js:946) and [backend/routes/pairwise.js:228-254](../backend/routes/pairwise.js:228). `manual_star` is itself an **Elo rating on a 0–5 scale** (divisor /1.5 instead of /400, K-factor 0.3 normal / 0.6 for unrated / ×1.5 on upset). Updated from:

1. **Group Rate** 1v1 duels (`performer_rank` / `group_rate`)
2. **Smart Compare** N-way ordering, all pairs applied in one transaction (`performer_rank_batch` / `smart_compare`)
3. **Image-level pairwise** inter-performer votes, with tiny K=0.1 (`pairwise.js:231`)

AI is advisory only — predictions are shown to the user, but only the user's clicks update `manual_star`.

**Implication for this plan**: the ground truth itself has noise — a 2.5-star performer with few duels has a less-converged rating than one with many. Two mitigations to bake into v2:

- Use the `confidence` field (or `comparison_count`) as a per-sample loss weight during training — well-rated performers count more in the gradient.
- Skip performers with very few comparisons (e.g., `comparison_count < 3`) entirely.

## Calibration: not legacy, but scoped to a different model

`AI-Inference-App/calibration.py` is **actively wired**, but only against `raw_ai_score` (from the pairwise model), not the ranker. See `triggerModelCalibration()` in [backend/routes/performers.js:17](../backend/routes/performers.js:17) — the query filters `WHERE p.raw_ai_score IS NOT NULL`.

The ranker already emits values in 0–5; it doesn't need score-mapping calibration. **Drop the "add calibration pass" recommendation from the v2 rollout** — it doesn't apply here.
