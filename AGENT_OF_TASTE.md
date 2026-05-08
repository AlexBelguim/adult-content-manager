# Agent of Taste — Full Roadmap

This document defines the implementation plan for the **Agent of Taste** system — a multi-level AI architecture that evolves from simple image filtering into a personalized curator that understands your visual preferences at an abstract level.

---

## Overview: The Three Levels

| | Level 1: Binary | Level 2: Agent of Taste v1 | Level 3: Agent of Taste v2 |
|:---|:---|:---|:---|
| **Status** | ✅ Implemented | 🔧 Architecture exists, training not implemented | 📋 Design phase |
| **Role** | Quick quality filter | Per-performer preference engine | Abstract taste profiler |
| **Learns** | Keep vs delete patterns | "I like Performer X's photos that look like this" | "I prefer natural expressions over posed ones" |
| **New performer?** | Generic score | ❌ Needs labeled data first | ✅ Can predict from appearance alone |
| **Architecture** | DINOv2 + 1 head | DINOv2 + performer embeddings + 3 heads | DINOv2 + VLM-derived taste encoder + 4 heads |
| **Training data** | Keep/delete folders | Keep/delete + Elo scores + pairwise labels | All of Level 2 + VLM reasoning on failed pairs |
| **Training style** | One-shot (8 epochs) | One-shot multi-task | Multi-phase with VLM diagnosis |

---

## Level 1: Binary Classifier (Implemented)

Already in production. A blunt instrument that learns "this looks like something you'd keep" vs "this looks like something you'd delete." Works well for obvious cases (blur, bad lighting, clearly good photos) but cannot reason about taste, performer context, or subjective preference.

**File:** `trainer.py` → `train_binary()`, `BinaryClassifier`

No changes needed. This model continues to serve as the fast first-pass filter.

---

## Level 2: Agent of Taste v1 — Per-Performer Preference

### The Vision

Unlike the binary model that compresses everything into one number, Level 2 **decomposes** the keep/delete decision into three independent signals:

- **Aesthetic quality** — Is this a technically good photo? (lighting, sharpness, composition)
- **Performer preference** — Do I enjoy looking at this person? (learned per-performer)
- **Action** — Given both signals, keep or delete? (the final decision)

This enables the "bad photo, good person" distinction: a blurry photo of your favorite performer might still be a keep, while a technically perfect photo of someone you're less interested in might be a delete.

### Architecture

```
Image → DINOv2 backbone → CLS features (1024-dim)
                              │
                              ├──→ aesthetic_head  → quality score (0.0 - 1.0)
                              │
Performer ID → Embedding ──┐  │
                           ├──┤
                           │  ├──→ preference_head → taste score (0.0 - 1.0)
                           │  │
                           │  └──→ action_head     → keep / delete
                           │
                    [features + performer embedding]
```

**File:** `trainer.py` → `AgentOfTasteModel` (class exists, training function not yet implemented)

### Data Sources (4 signals)

| Signal | Supervises | Source |
|:---|:---|:---|
| Keep/delete folder assignments | `action_head` | `after filter performer/` + `deleted keep for training/` |
| Performer Elo ratings | `preference_head` (global performer bias) | Pairwise backend database |
| Intra-performer pairs (same person, different photos) | `aesthetic_head` (which photo is technically better?) | Pairwise labeler |
| Inter-performer pairs (different people) | `preference_head` (who do you prefer?) | Pairwise labeler |

### Training Pipeline

```
1. Load all 4 data sources
2. Build MultiTaskDataset that samples from all sources per batch
3. Train with joint loss:
   total_loss = λ1 · aesthetic_loss    (MSE on quality scores)
              + λ2 · preference_loss   (MSE on Elo-derived scores)
              + λ3 · action_loss       (BCE on keep/delete)
              + λ4 · pairwise_loss     (MarginRanking on pairs)
4. Warmup: freeze backbone for 2 epochs, then unfreeze
5. Save best checkpoint by validation accuracy on action_head
```

### Limitations

- **Performer lookup table**: The model memorizes preferences per performer via `nn.Embedding`. A new performer it's never seen gets a zero embedding — effectively falling back to generic scoring.
- **No transferable taste**: It knows "I like Performer A" but not "I like natural-looking brunettes" — it can't generalize WHY it likes Performer A to predict preferences for unseen performers.
- **No self-explanation**: The model outputs numbers but cannot tell the user why it made a decision.

---

## Level 3: Agent of Taste v2 — Abstract Taste Profiling

### The Vision

Level 3 replaces the per-performer lookup table with a **learned taste encoder** that extracts abstract preference dimensions from any image. Instead of memorizing "I like Performer X," it learns "I like natural expressions, soft lighting, and minimal styling" — and applies that understanding to performers it has never encountered.

The key innovation: a **Vision-Language Model (VLM)** is used during training to generate rich, comparative reasoning about why the user prefers one image over another. This reasoning is distilled into the model's taste encoder, teaching it what your preference dimensions actually are.

### What makes this fundamentally different from Level 2

```
Level 2 (memorization):
  "Performer A" → embedding [0.3, -0.1, 0.8, ...] → "I like her"
  "Performer B" → embedding [-0.2, 0.5, -0.3, ...] → "I don't like her"
  New performer → embedding [0, 0, 0, ...] → "I have no opinion" ← USELESS

Level 3 (understanding):
  Any image → taste_encoder → [naturalness: 0.9, warmth: 0.7, styling: 0.2, ...]
  These dimensions are LEARNED from VLM reasoning across all performers
  New performer → same taste dimensions extracted → "She matches your taste" ← WORKS
```

### Architecture

```
Image → DINOv2 backbone → CLS features (1024-dim)
              │
              ├──→ aesthetic_head     → quality score (0.0 - 1.0)
              │
              ├──→ taste_encoder      → preference dimensions (N-dim)
              │         ↑ trained via VLM-derived taste labels
              │         │
              │    [features + taste_dims]
              │         │
              │         ├──→ preference_head → taste score (0.0 - 1.0)
              │         │
              │         ├──→ action_head     → keep / delete
              │         │
              │         └──→ reason_head     → reason category (optional)
              │
              └──→ No performer ID needed — taste is inferred from the image itself
```

### The VLM's Role: Training-Time Reasoning

The VLM is used **only during training** as a label enrichment tool. It is never loaded during inference.

#### When the VLM runs

After Phase 1 training, the model is validated against the pairwise holdout set. Every pair the model gets wrong is sent to the VLM for comparative analysis:

```
VLM Input:
  Image A: [photo the user preferred]
  Image B: [photo the model incorrectly ranked higher]
  Prompt: "The user preferred Image A over Image B. Analyze both images
           and explain what visual properties drive this preference.
           Consider: expression, pose, lighting, styling, composition,
           authenticity, and overall mood."

VLM Output:
  "Image A shows a relaxed, candid moment with natural lighting and
   a genuine smile. Image B is technically sharper but has a stiff,
   posed quality with harsh studio lighting. The user appears to
   value authenticity and warmth over technical perfection."
```

This comparative reasoning is far more grounded than analyzing single images because the VLM sees the actual preference contrast.

#### How VLM reasoning becomes training data

The VLM's free-text reasoning is parsed into structured taste dimensions:

```json
{
  "pair": ["img_a.jpg", "img_b.jpg"],
  "winner": "img_a.jpg",
  "vlm_reasoning": "Natural expression preferred over posed...",
  "taste_labels": {
    "naturalness": 0.9,
    "expression_warmth": 0.85,
    "technical_quality": 0.6,
    "styling_preference": 0.3,
    "composition": 0.7
  },
  "reason_category": "authenticity_over_production"
}
```

These structured labels supervise the `taste_encoder` during post-training.

### Multi-Phase Training Pipeline

```
Phase 1: Base Training (no VLM)
  ├── Train aesthetic_head from intra-performer pairs
  ├── Train preference_head from Elo scores (using performer embeddings as warmup)
  ├── Train action_head from keep/delete labels
  └── Save Phase 1 checkpoint

Phase 2: Pairwise Validation & Diagnosis
  ├── Validate against pairwise holdout set
  ├── Collect all failed pairs (model ranked incorrectly)
  ├── Include inter-performer failures (taste errors)
  │   AND intra-performer failures (quality errors)
  └── Report: "Model failed on 25 out of 150 pairs"

Phase 3: VLM Reasoning
  ├── Load VLM (e.g., Qwen2-VL 7B 4-bit, ~5GB VRAM)
  ├── Analyze each failed pair with comparative prompt
  ├── Parse reasoning into structured taste dimensions
  ├── Present results to user:
  │     "Your model struggles with these patterns:"
  │     □ Prefers natural over posed (12 pairs)
  │     □ Misjudges lighting quality (6 pairs)
  │     □ Doesn't capture performer-type preference (7 pairs)
  ├── User confirms, adjusts, or adds custom notes
  └── Unload VLM, free VRAM

Phase 4: Post-Training (targeted fine-tuning)
  ├── Load Phase 1 checkpoint
  ├── Replace performer embeddings with taste_encoder
  ├── Add VLM-derived taste labels to training data
  ├── Oversample the failed pairs (3-5x)
  ├── Apply targeted augmentation based on failure categories
  ├── Train 3-4 epochs at lower learning rate (1e-5)
  └── Save final Level 3 checkpoint
```

### VLM Selection

Since the VLM only runs during training (not inference), you can afford to use a capable model:

| Model | VRAM | Quality | Best for |
|:---|:---|:---|:---|
| LLaVA-1.6 7B (4-bit) | ~5 GB | Good | Fast iteration, testing |
| Qwen2-VL 7B (4-bit) | ~5 GB | Very good | Best balance of speed and quality |
| InternVL2 8B (4-bit) | ~6 GB | Excellent | Most detailed reasoning |
| Gemini Flash (API) | 0 GB | Great | No local GPU needed, small cost per call |

### Reason Categories (for optional reason_head)

If the reason_head is included, it predicts one of these learned categories:

```python
REASON_CATEGORIES = [
    # Positive (keep) reasons
    "high_quality_keep",           # Technically excellent, matches taste
    "favorite_type",               # Matches abstract performer preference
    "great_expression",            # Compelling facial expression / mood
    "strong_composition",          # Well-framed, good use of space

    # Negative (delete) reasons
    "poor_technical_quality",      # Blur, noise, bad lighting
    "unflattering_angle",          # Bad pose or unflattering framing
    "low_type_preference",         # Doesn't match taste profile
    "overproduced",                # Too styled / artificial / posed

    # Ambiguous
    "borderline_quality",          # Could go either way
    "good_photo_wrong_vibe",       # Technically fine, taste mismatch
    "bad_photo_good_subject",      # Poor quality, but subject matches taste
]
```

These categories are seeded initially, then refined based on what the VLM actually identifies in your data.

---

## Additional Recommendations

### 1. Continuous Learning Loop

Don't treat training as a one-time event. Every time the user corrects a model decision in the Smart Filter UI ("model said delete, I say keep"), that correction becomes a new training sample. Accumulate corrections and periodically trigger a short post-training pass:

```
Smart Filter: User overrides 20 model decisions this week
                    │
System: "You've corrected 20 decisions. Run a refinement pass?"
                    │
Post-training: Load latest checkpoint → train 2 epochs on
               corrections + a sample of confirmed-correct decisions
               → save updated checkpoint
```

This creates a flywheel where the model improves continuously without the user explicitly "training" it.

### 2. Confidence Calibration

The model should know when it's uncertain. Images where `action_head` outputs a probability near 0.5 should be flagged for human review rather than auto-decided:

```
Score > 0.8  → auto-keep (high confidence)
Score < 0.2  → auto-delete (high confidence)
0.2 - 0.8   → "needs review" (low confidence) → show to user
```

The model only auto-handles easy cases and defers hard cases — which is where corrections generate the highest-value training data.

### 3. Active Learning for VLM Labeling

Don't randomly sample images for VLM analysis. Use **uncertainty sampling**: pick the images where the model is most confused (predictions closest to 0.5, or where aesthetic and preference heads disagree). These yield the highest improvement per VLM call.

```
Most valuable for VLM analysis:
  aesthetic_head = 0.85 (great photo)
  preference_head = 0.20 (don't like the subject)
  action_head = 0.48 (completely unsure)
  → The "good photo, wrong person" case the model needs help with
```

### 4. Taste Drift Detection

Preferences change over time. The model should detect when its predictions start diverging from recent decisions:

```
Monthly check:
  - Compare model predictions vs user corrections from last 30 days
  - If correction rate > 15%: suggest a refinement pass
  - If specific reason category dominates corrections:
    highlight the shift to the user
```

### 5. Transfer Learning Between Levels

Don't train Level 3 from scratch. Use the Level 2 checkpoint as initialization:

```
Level 2 backbone weights     → Level 3 backbone (frozen initially)
Level 2 aesthetic_head       → Level 3 aesthetic_head (transferred)
Level 2 preference_head      → Level 3 preference_head (partially transferred)
Level 2 performer_embed      → discarded (replaced by taste_encoder)
```

Level 3 inherits all visual knowledge from Level 2 and only needs to learn the new taste dimensions from VLM data.

### 6. Taste Profile Export

Once Level 3 learns your abstract taste dimensions, those dimensions become a portable preference profile:

```json
{
  "taste_profile": {
    "naturalness_preference": 0.85,
    "technical_quality_weight": 0.60,
    "expression_warmth_weight": 0.90,
    "styling_preference": 0.25,
    "composition_sensitivity": 0.70
  },
  "learned_from": "450 pairwise labels + 1200 keep/delete decisions",
  "last_updated": "2026-05-08"
}
```

This profile could be backed up or used to initialize training on a new machine without starting from zero.

---

## Level 4: Personal VLM — Conversational Taste AI

### The Vision

Level 4 is a **fine-tuned Vision-Language Model** that can have natural language conversations about your preferences. Unlike Levels 1-3 which output numbers and categories, Level 4 speaks in full sentences, explains its reasoning, and can answer arbitrary questions about any image through the lens of your personal taste.

This is the difference between a calculator and an advisor.

### Capabilities

```
You:  "How attractive do I find this person?"
VLM:  "Based on your preference history, you'd rate her around 8.7/10. 
       She has the natural, minimal-styling look you consistently prefer, 
       with a warm candid expression similar to your top-ranked performers. 
       The slightly tight framing pulls the score down — you tend to favor 
       wider compositions."

You:  "Rank these 5 performers for me"
VLM:  "1. Performer C (9.3) — Closest match to your taste profile. Natural 
          lighting, relaxed posing, genuine expressions throughout.
       2. Performer A (8.5) — Strong aesthetics but slightly over-styled 
          compared to what you usually keep.
       3. Performer E (7.1) — Good technical quality, but not your usual 
          type. You'd probably keep ~60% of her photos.
       4. Performer B (5.4) — Mixed bag. Some candid shots you'd love, 
          but most of her portfolio has the studio look you tend to delete.
       5. Performer D (3.8) — Heavily produced. This is the opposite of 
          your taste — you deleted 90% of similar images in training."

You:  "Which of these 20 images should I keep?"
VLM:  "I'd recommend keeping 12 of these. Here's my breakdown:
       KEEP (high confidence): #1, #3, #5, #8, #12, #15, #18
       KEEP (your taste, but borderline quality): #7, #11, #14, #19, #20
       DELETE: #2 (blurry), #4 (awkward crop), #6 (harsh lighting), 
               #9 (too posed), #10 (overprocessed), #13 (duplicate angle), 
               #16 (low resolution), #17 (unflattering expression)"

You:  "Why did you say delete #9?"
VLM:  "Image #9 has a rigid, forced pose with studio lighting — your 
       labeling history shows you delete this type 85% of the time. 
       You kept a similar pose once for Performer A, but only because 
       the expression was exceptionally natural despite the staging. 
       #9 doesn't have that redeeming quality."
```

### Architecture: Fine-Tuned VLM with LoRA

Level 4 does NOT use the DINOv2 backbone. It's a completely separate model — a full vision-language model fine-tuned on your taste data:

```
Base model: Qwen2-VL 7B (or similar)
  ├── Vision encoder (built-in, understands images natively)
  ├── Language model (generates natural text)
  └── Cross-attention (connects vision to language)
        │
Fine-tuned with LoRA adapters on YOUR data:
  ├── Pairwise preference conversations
  ├── Keep/delete decision explanations
  ├── Performer ranking discussions
  └── VLM reasoning from Level 3 Phase 3  ← KEY DATA SOURCE
        │
Result: A 7B model with ~100MB of LoRA weights
        that sees the world through your taste
```

### Training Data: Level 3 Feeds Level 4

This is the most elegant part of the system. The VLM reasoning generated during Level 3's diagnostic phase (Phase 3) becomes the fine-tuning dataset for Level 4. Each level naturally produces training data for the next:

```
Level 3 Phase 3 generates:
  ┌──────────────────────────────────────────────────────┐
  │ Image A: [user preferred]                            │
  │ Image B: [model incorrectly ranked higher]           │
  │                                                      │
  │ VLM reasoning: "Image A has a natural, candid feel   │
  │ with soft ambient lighting. Image B is technically    │
  │ sharper but feels posed and over-lit. The user        │
  │ consistently values authenticity over production."    │
  │                                                      │
  │ User confirmed: ✅ Yes, this is accurate             │
  └──────────────────────────────────────────────────────┘
                         │
                         ▼
  This becomes a Level 4 training sample:
  ┌──────────────────────────────────────────────────────┐
  │ Input:  [Image A] + [Image B]                        │
  │ Prompt: "The user preferred Image A. Explain why."   │
  │ Target: "Image A has a natural, candid feel with     │
  │          soft ambient lighting..."                    │
  └──────────────────────────────────────────────────────┘
```

The data pipeline across all levels:

```
Your clicks & labels
  │
  ├──→ Keep/delete folders ──────────→ Level 1, 2, 3 training
  ├──→ Pairwise labels ─────────────→ Level 2, 3 training
  ├──→ Elo rankings ────────────────→ Level 2, 3 training
  │
  └──→ Level 3 Phase 3 VLM reasoning (user-confirmed)
         │
         ├──→ Level 3 taste_encoder labels (structured)
         │
         └──→ Level 4 fine-tuning data (conversational)
              Format: (images, question, reasoning answer)
```

Every Level 3 training cycle produces more Level 4 training data. The more you use Level 3, the smarter Level 4 becomes — without any extra labeling effort from you.

### Fine-Tuning Dataset Construction

From your existing data + Level 3 outputs, construct conversational training pairs:

```python
# Type 1: Pairwise preference explanation
{
  "images": ["performer_a_img.jpg", "performer_b_img.jpg"],
  "conversations": [
    {"role": "user", "content": "Which image do I prefer and why?"},
    {"role": "assistant", "content": "You prefer the first image. 
     It has the natural, candid quality you gravitate toward — 
     relaxed expression, ambient lighting, minimal post-processing. 
     The second image is more produced, which you tend to delete."}
  ]
}

# Type 2: Single image scoring
{
  "images": ["photo.jpg"],
  "conversations": [
    {"role": "user", "content": "Score this image for me."},
    {"role": "assistant", "content": "8.2/10. Strong natural lighting 
     and a genuine expression. The composition is slightly tight for 
     your taste — you prefer more breathing room in the frame. 
     This performer matches your general type preferences."}
  ]
}

# Type 3: Batch keep/delete
{
  "images": ["img1.jpg", "img2.jpg", "img3.jpg", "img4.jpg"],
  "conversations": [
    {"role": "user", "content": "Which should I keep?"},
    {"role": "assistant", "content": "Keep #1 and #3. Delete #2 (harsh 
     studio lighting, you delete this style 80% of the time) and #4 
     (awkward crop cuts off the natural framing you prefer)."}
  ]
}

# Type 4: Performer ranking
{
  "images": ["perf_a.jpg", "perf_b.jpg", "perf_c.jpg"],
  "conversations": [
    {"role": "user", "content": "Rank these performers by my preference."},
    {"role": "assistant", "content": "1. Performer B (9.1) — closest to 
     your type: natural look, warm tones. 2. Performer A (7.3) — good 
     aesthetics but more styled than you usually prefer. 3. Performer C 
     (4.2) — heavily produced look, opposite of your taste profile."}
  ]
}
```

### Training Approach: LoRA Fine-Tuning

Full fine-tuning of a 7B model requires 40+ GB VRAM. **LoRA** (Low-Rank Adaptation) lets you fine-tune with ~8GB VRAM by only training small adapter layers:

```
Base Qwen2-VL 7B:     ~14B parameters (frozen)
LoRA adapters:         ~20M parameters (trained)  ← 0.15% of the model
Total VRAM:            ~8 GB in 4-bit quantization
Training time:         1-2 hours on a single GPU
Output:                ~100MB adapter file (not a full model copy)
```

The base model's general vision-language understanding stays intact. The LoRA adapters teach it YOUR specific taste without overwriting its general knowledge.

### Inference Modes

Level 4 serves two roles depending on the context:

```
Interactive mode (user-facing):
  User asks a question → VLM responds in ~2-3 seconds
  Use case: "Explain this", "Compare these", "Why did you rank..."
  VRAM: ~5 GB (4-bit quantized with LoRA merged)

Batch reasoning mode (system-facing):
  Process N images → generate scores + short reasoning per image
  Use case: Enriching Smart Filter results with explanations
  Speed: ~2 seconds per image (parallelizable)
  VRAM: same ~5 GB
```

For bulk processing (1000s of images), Level 3's DINOv2 model is still faster (~5ms/image). Level 4 handles the interactive, reasoning-heavy queries where speed matters less than depth.

### The Hybrid System at Scale

```
Incoming images (bulk import, 500 photos)
         │
         ▼
Level 1 (Binary) ──→ Quick filter: auto-delete obvious junk
         │              (~5ms/image, removes ~30%)
         ▼
Level 3 (AoT v2) ──→ Score + categorize remaining images
         │              (~5ms/image, scores + reason tags)
         ▼
User reviews borderline cases in Smart Filter UI
         │
         ├── Clicks "Why?" on any image
         │         │
         │         ▼
         │   Level 4 (VLM) ──→ "You'd delete this because the 
         │                       harsh lighting washes out the 
         │                       natural skin tones you prefer."
         │
         └── Corrections feed back into training data
                   for ALL levels
```

### Requirements

| Resource | Requirement |
|:---|:---|
| **Base VLM** | Qwen2-VL 7B, LLaVA-Next 7B, or InternVL2 8B |
| **Fine-tuning** | LoRA (rank 16-64), ~8 GB VRAM, 1-2 hours |
| **Training data** | 200+ conversational pairs (generated from Level 3 outputs) |
| **Inference VRAM** | ~5 GB (4-bit) — can coexist with Level 3 on a 12GB+ GPU |
| **Adapter size** | ~100 MB (portable, easy to version and back up) |
| **Framework** | HuggingFace Transformers + PEFT (LoRA library) |

---

## The Complete Data Flywheel

Each level produces training data for the next, and user corrections improve all levels simultaneously:

```
                    YOUR INTERACTIONS
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   Keep/Delete       Pairwise          Smart Filter
   Folders           Labels            Corrections
        │                │                 │
        ▼                ▼                 ▼
  ┌──────────┐    ┌──────────┐     ┌──────────┐
  │ Level 1  │    │ Level 2  │     │ Level 3  │
  │ Binary   │    │ AoT v1   │     │ AoT v2   │
  └──────────┘    └──────────┘     └────┬─────┘
                                        │
                              VLM reasoning on
                              failed pairs (Phase 3)
                                        │
                                        ▼
                                 ┌──────────┐
                                 │ Level 4  │
                                 │ Personal │
                                 │   VLM    │
                                 └──────────┘
                                        │
                              User asks "Why?" →
                              VLM explains →
                              User confirms/corrects →
                              Corrections flow back up
                              to ALL levels
```


Every interaction makes the system smarter. No data is wasted. The VLM reasoning is the bridge that connects silent clicks (pairwise labels) to articulated understanding (natural language taste).

---

## Level 5: Taste-Driven Generation — "Show Me What I Like"

### The Vision

Levels 1-4 analyze and evaluate existing images. Level 5 flips the pipeline: instead of scoring what exists, it **generates** what you'd score highest. Using your learned taste profile, it can:

- Visualize your "ideal" performer — the composite of features you find most attractive
- Blend features from different performers — "eyes from Performer A, smile from Performer B, styling of Performer C"
- Generate variations — "show me what Performer X would look like in the natural lighting I prefer"

This is the creative counterpart to the analytical Levels 1-4.

### Capabilities

```
You:  "Show me my ideal type"
System: Generates an image that would score 0.99 on your taste profile
        — combining the facial features, lighting, expression style,
        and composition that your Level 3 taste_encoder rates highest.

You:  "Combine Performer A's smile with Performer C's styling"
System: Uses IP-Adapter to extract specific features from reference
        images of each performer, blending them into a new composite
        that maintains your preferred aesthetic.

You:  "What would Performer B look like in natural lighting?"
System: Takes a reference image of Performer B and re-renders it
        with the ambient, warm lighting style your taste profile
        indicates you prefer (learned from Level 3 dimensions).

You:  "Generate 4 variations — more natural, less styled"
System: Produces variants along your taste dimensions, pushing
        the "naturalness" slider higher and "styling" lower while
        keeping the subject consistent.
```

### Architecture: Diffusion Model + IP-Adapter + Taste Conditioning

```
Level 3 taste_encoder output
  │  [naturalness: 0.9, warmth: 0.85, styling: 0.2, ...]
  │
  ├──→ Text prompt (generated by Level 4 VLM from taste dims)
  │    "Natural, warm lighting, candid expression, minimal makeup,
  │     soft ambient tones, relaxed pose"
  │
  ▼
Stable Diffusion XL / Flux
  │
  ├── Text conditioning ← taste-derived prompt
  ├── IP-Adapter ← reference images from specific performers
  │     (extracts facial features, body type, expression style)
  └── LoRA weights ← fine-tuned on your "keep" images (optional)
  │
  ▼
Generated image → scored by Level 3 → iterate until score > threshold
```

### Key Components

**1. IP-Adapter (Image Prompt Adapter)**

IP-Adapter lets you condition a diffusion model on reference images rather than just text. This is how you "combine features from different performers":

```
Reference image A → IP-Adapter encoder → face/expression features
Reference image B → IP-Adapter encoder → body/pose features
Reference image C → IP-Adapter encoder → styling/aesthetic features

Combined features → Diffusion model → Blended output
```

Each reference image contributes specific visual attributes. You control the blend weights per feature — "70% of the face from A, 30% from B" etc.

**2. Taste-Conditioned Prompting**

Level 4's VLM translates your taste profile dimensions into a text prompt that guides the diffusion model:

```
Taste profile:
  naturalness: 0.9
  expression_warmth: 0.85
  technical_quality: 0.7
  styling_preference: 0.2
  composition: wide/breathing room

Level 4 VLM generates prompt:
  "Portrait with natural ambient lighting, genuine warm smile,
   minimal makeup and styling, wide composition with breathing
   room, soft bokeh background, candid relaxed pose"
```

This prompt steers the generation toward images you'd actually rate highly.

**3. Score-Guided Iteration**

Generate multiple candidates, score each with Level 3, keep the highest:

```
Generate 8 candidates
  │
  ▼
Level 3 scores each:
  Candidate 1: 0.72
  Candidate 2: 0.45
  Candidate 3: 0.91  ← best
  Candidate 4: 0.83
  ...
  │
  ▼
Return candidate 3 (or iterate further with candidate 3 as new seed)
```

This creates a feedback loop where the generation model and the scoring model collaborate to produce images that maximize your preference.

**4. Optional: Aesthetic LoRA**

Fine-tune a small LoRA adapter for the diffusion model on your "keep" images. This teaches the generation model your preferred visual aesthetic (color grading, contrast style, composition patterns) beyond what text prompting alone can achieve:

```
Training data: Your top-rated "keep" images (200+)
Method: Dreambooth or standard LoRA fine-tuning
Output: ~50-100MB adapter weights
Effect: Generated images naturally adopt your preferred color
        palette, contrast style, and composition patterns
```

### Feature Blending UI Concept

```
┌─────────────────────────────────────────────────────┐
│  🎨 Taste Generator                                 │
│                                                     │
│  Reference Performers:                              │
│  ┌──────┐ ┌──────┐ ┌──────┐                        │
│  │ [A]  │ │ [B]  │ │ [C]  │  [+ Add Reference]     │
│  │ Face │ │ Body │ │Style │                         │
│  │ 70%  │ │ 50%  │ │ 80%  │                         │
│  └──────┘ └──────┘ └──────┘                        │
│                                                     │
│  Taste Dimensions:           Generated Result:      │
│  Naturalness   [====●===]    ┌──────────────┐      │
│  Warmth        [=====●==]    │              │      │
│  Styling       [●========]    │  [Generated  │      │
│  Composition   [===●====]    │   Image]     │      │
│                               │              │      │
│  Taste Score: 0.94 ⭐         │  Score: 9.4  │      │
│                               └──────────────┘      │
│                                                     │
│  [Generate] [Variations] [Save to Gallery]          │
└─────────────────────────────────────────────────────┘
```

### How Levels 3/4 Feed Level 5

```
Level 3 taste_encoder dimensions → conditioning signal for generation
Level 4 VLM → translates taste dims into natural language prompts
Level 3 scoring → evaluates generated candidates (feedback loop)
Level 4 VLM → explains why a generation scored high or low

All working together:
  Taste profile → VLM writes prompt → Diffusion generates →
  Level 3 scores → Level 4 explains → user adjusts → iterate
```

### Requirements

| Resource | Requirement |
|:---|:---|
| **Base model** | SDXL, Flux.1-dev, or similar diffusion model |
| **IP-Adapter** | IP-Adapter-FaceID-Plus for face blending |
| **VRAM** | ~8-10 GB for SDXL + IP-Adapter in FP16 |
| **Generation speed** | ~5-15 seconds per image (GPU dependent) |
| **Aesthetic LoRA** | Optional, ~200 "keep" images, 1 hour to train |
| **Score iteration** | 8 candidates × Level 3 scoring (~40ms total) |

### Important Considerations

- **Ethical boundaries**: Generated images should be clearly marked as AI-generated and never mixed into the real image library without explicit labeling
- **This is exploratory, not core**: Levels 1-4 are the production pipeline. Level 5 is a creative tool that uses the same taste data in a generative direction
- **Quality depends on reference images**: Feature blending works best with high-quality, consistent reference photos for each performer
- **Not a replacement for real content**: The value is in visualization ("what would my ideal look like?") and creative exploration, not in replacing real images

---

## The Complete Data Flywheel

Each level produces training data for the next, and user corrections improve all levels simultaneously:

```
                    YOUR INTERACTIONS
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   Keep/Delete       Pairwise          Smart Filter
   Folders           Labels            Corrections
        │                │                 │
        ▼                ▼                 ▼
  ┌──────────┐    ┌──────────┐     ┌──────────┐
  │ Level 1  │    │ Level 2  │     │ Level 3  │
  │ Binary   │    │ AoT v1   │     │ AoT v2   │
  └──────────┘    └──────────┘     └────┬─────┘
                                        │
                              VLM reasoning on
                              failed pairs (Phase 3)
                                        │
                                        ▼
                                 ┌──────────┐
                                 │ Level 4  │
                                 │ Personal │
                                 │   VLM    │
                                 └────┬─────┘
                                      │
                            Taste profile + prompts
                                      │
                                      ▼
                               ┌──────────┐
                               │ Level 5  │
                               │  Taste   │
                               │Generator │
                               └──────────┘
                                      │
                            Generated images scored
                            by Level 3, explained by
                            Level 4, corrections feed
                            back to ALL levels
```

---

## Implementation Order

| Priority | Task | Depends on |
|:---|:---|:---|
| **P0** | Implement `train_agent_of_taste_v1()` for Level 2 | Existing pairwise data + keep/delete folders |
| **P0** | Build `MultiTaskDataset` that loads all 4 data sources | Backend DB access for pairs/Elo |
| **P1** | Add pairwise validation with failure collection | Level 2 training working |
| **P1** | Integrate VLM for failed pair analysis | Choose and test VLM model |
| **P2** | Build taste_encoder replacing performer embeddings | VLM reasoning pipeline working |
| **P2** | Implement multi-phase training pipeline | All above |
| **P3** | Add reason_head to Level 3 (optional) | Enough VLM-labeled data |
| **P3** | Continuous learning loop | Level 2 or 3 in production |
| **P3** | Taste drift detection | Continuous learning running |
| **P4** | Build Level 4 conversational dataset from Level 3 outputs | Level 3 with VLM diagnosis running |
| **P4** | LoRA fine-tune VLM on taste conversations | Conversational dataset ready |
| **P4** | Interactive "Why?" endpoint in AI server | Fine-tuned VLM working |
| **P4** | Integrate Level 4 into Smart Filter UI | Endpoint working |
| **P5** | Set up SDXL/Flux + IP-Adapter pipeline | GPU with 10GB+ VRAM |
| **P5** | Taste-to-prompt generation via Level 4 VLM | Level 4 working |
| **P5** | Score-guided iteration loop (Level 3 scoring candidates) | Level 3 + generation pipeline |
| **P5** | Feature blending UI | Generation pipeline working |
| **P5** | Optional: Aesthetic LoRA on "keep" images | 200+ curated images |

---

## Conclusion

The Agent of Taste system evolves through five distinct levels:

- **Level 1 (Binary)** catches the obvious cases — already working.
- **Level 2 (Agent of Taste v1)** learns your per-performer preferences — architecture exists, needs training implementation.
- **Level 3 (Agent of Taste v2)** understands your abstract taste and can evaluate anyone — powered by VLM reasoning during training.
- **Level 4 (Personal VLM)** can explain, discuss, and reason about your taste in natural language — fine-tuned on Level 3's reasoning outputs.
- **Level 5 (Taste Generator)** can visualize your ideal and blend features from different performers — guided by your taste profile and scored by Level 3.

Each level builds on the previous one's weights and data. The system creates a self-reinforcing flywheel: your clicks become labels, labels become model improvements, model failures become VLM reasoning, VLM reasoning becomes conversational training data, and the taste profile drives both evaluation and generation.

The complete arc goes from **passive sorting** (Level 1) to **active understanding** (Level 4) to **creative generation** (Level 5) — all powered by the same core data: your preferences, expressed through simple keep/delete and pairwise decisions.

