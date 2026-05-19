import torch
import torch.nn as nn
from transformers import AutoModel

class DinoV2PreferenceModel(nn.Module):
    """
    DINOv2-based Siamese network for learning image preferences.
    """
    def __init__(self, model_name="facebook/dinov2-large", freeze_backbone=True, quantize=False):
        super().__init__()
        if quantize:
            print(f"💎 Loading {model_name} with 8-bit quantization...")
            self.backbone = AutoModel.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(model_name)
        hidden_dim = self.backbone.config.hidden_size
        
        # Standard head for CLS-only model
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 1)
        )
        
        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

    def forward_single(self, pixel_values):
        outputs = self.backbone(pixel_values)
        cls_token = outputs.last_hidden_state[:, 0, :]
        combined_features = nn.functional.normalize(cls_token, p=2, dim=1)
        return self.head(combined_features).squeeze(-1)

    def forward(self, pixel_values_a, pixel_values_b):
        score_a = self.forward_single(pixel_values_a)
        score_b = self.forward_single(pixel_values_b)
        return score_a, score_b
    
    def score_images(self, pixel_values):
        raw_scores = self.forward_single(pixel_values)
        normalized = torch.sigmoid(raw_scores) * 100
        return normalized


class PerformerRankerModel(nn.Module):
    """
    Standalone DINOv2-based regression model for predicting performer star ratings.
    Trained on manifest.json ratings (training only), used at inference to estimate
    performer tier from visual features alone.
    
    Architecture: DINOv2 CLS token → MLP → star rating (0-5)
    Loss: MSELoss (pure regression, no competing objectives)
    """
    def __init__(self, model_name="facebook/dinov2-large", freeze_backbone=True, quantize=False):
        super().__init__()
        if quantize:
            print(f"💎 Loading {model_name} with 8-bit quantization...")
            self.backbone = AutoModel.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(model_name)
        hidden_dim = self.backbone.config.hidden_size
        
        self.rank_head = nn.Sequential(
            nn.Linear(hidden_dim, 256),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(256, 1)
        )
        nn.init.zeros_(self.rank_head[-1].bias)
        
        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False
    
    def freeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = False
    def unfreeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = True

    def forward(self, pixel_values):
        """Predict performer star rating from image(s)."""
        outputs = self.backbone(pixel_values)
        cls_token = outputs.last_hidden_state[:, 0, :]
        return torch.clamp(self.rank_head(cls_token).squeeze(-1), 0.0, 5.0)
    
    def predict_rank(self, pixel_values):
        """Alias for forward — used at inference for clarity."""
        return self.forward(pixel_values)


class RankedBinaryClassifier(nn.Module):
    """
    Binary keep/delete classifier conditioned on performer rank.
    Takes (image, rank_scalar) as input — the rank input widens the first linear layer.
    
    Training: rank comes from manifest.json (ground truth).
    Inference: rank comes from PerformerRankerModel (visual estimate).
    Fallback: if no ranker loaded, rank defaults to 2.5 (neutral).
    """
    def __init__(self, backbone_name='facebook/dinov2-large', quantize=False):
        super().__init__()
        if quantize:
            self.backbone = AutoModel.from_pretrained(backbone_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(backbone_name)
        hs = self.backbone.config.hidden_size
        # Head input: CLS token + rank scalar (normalized)
        self.classifier = nn.Sequential(
            nn.Linear(hs + 1, 256), nn.ReLU(), nn.Dropout(0.3), nn.Linear(256, 1)
        )
        nn.init.zeros_(self.classifier[-1].bias)
    
    def freeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = False
    def unfreeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = True

    def forward(self, pixel_values, rank):
        """Forward with rank conditioning.
        rank: tensor of shape (batch,) with values 0-5.
        """
        out = self.backbone(pixel_values=pixel_values)
        cls = out.last_hidden_state[:, 0, :]
        rank_norm = (rank / 5.0).view(-1, 1)  # normalize to 0-1
        combined = torch.cat([cls, rank_norm], dim=1)
        return self.classifier(combined).squeeze(-1)
    
    def forward_no_rank(self, pixel_values):
        """Fallback: forward without rank (uses 2.5 as neutral)."""
        batch_size = pixel_values.size(0)
        rank = torch.full((batch_size,), 2.5, device=pixel_values.device)
        return self.forward(pixel_values, rank)


class RankedSiameseModel(nn.Module):
    """
    Siamese network for pairwise preference learning, conditioned on performer rank.
    Same Siamese architecture as DinoV2PreferenceModel but the head takes (CLS + rank).
    
    Training: rank comes from manifest.json (ground truth).
    Inference: rank comes from PerformerRankerModel (visual estimate).
    Fallback: if no ranker loaded, rank defaults to 2.5 (neutral).
    """
    def __init__(self, model_name="facebook/dinov2-large", freeze_backbone=True, quantize=False):
        super().__init__()
        if quantize:
            print(f"💎 Loading {model_name} with 8-bit quantization...")
            self.backbone = AutoModel.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(model_name)
        hidden_dim = self.backbone.config.hidden_size
        
        # Head takes CLS + rank scalar
        self.head = nn.Sequential(
            nn.Linear(hidden_dim + 1, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 1)
        )
        
        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

    def freeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = False
    def unfreeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = True

    def forward_single(self, pixel_values, rank):
        """Score a single image given its performer rank."""
        outputs = self.backbone(pixel_values)
        cls_token = outputs.last_hidden_state[:, 0, :]
        cls_token = nn.functional.normalize(cls_token, p=2, dim=1)
        rank_norm = (rank / 5.0).view(-1, 1)
        combined = torch.cat([cls_token, rank_norm], dim=1)
        return self.head(combined).squeeze(-1)

    def forward(self, pixel_values_a, rank_a, pixel_values_b, rank_b):
        """Siamese forward: score two images with their respective ranks."""
        score_a = self.forward_single(pixel_values_a, rank_a)
        score_b = self.forward_single(pixel_values_b, rank_b)
        return score_a, score_b
    
    def forward_no_rank(self, pixel_values):
        """Fallback: score without rank (uses 2.5 as neutral)."""
        batch_size = pixel_values.size(0)
        rank = torch.full((batch_size,), 2.5, device=pixel_values.device)
        return self.forward_single(pixel_values, rank)
    
    def score_images(self, pixel_values, rank):
        raw_scores = self.forward_single(pixel_values, rank)
        normalized = torch.sigmoid(raw_scores) * 100
        return normalized


# ── Legacy compatibility aliases ─────────────────────────────────────────────
# These models are no longer trained but their classes must exist so old
# checkpoints can still be loaded and used for inference.

class RankAwareSiameseModel(nn.Module):
    """
    LEGACY — kept for backward compat with existing checkpoints only.
    Use RankedSiameseModel + PerformerRankerModel for new training.
    """
    def __init__(self, model_name="facebook/dinov2-large", freeze_backbone=True, quantize=False):
        super().__init__()
        if quantize:
            self.backbone = AutoModel.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(model_name)
        hidden_dim = self.backbone.config.hidden_size
        
        self.rank_head = nn.Sequential(
            nn.Linear(hidden_dim, 256), nn.ReLU(), nn.Dropout(0.2), nn.Linear(256, 1)
        )
        self.preference_head = nn.Sequential(
            nn.Linear(hidden_dim + 1, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(512, 128), nn.ReLU(), nn.Dropout(0.1), nn.Linear(128, 1)
        )
        
        if freeze_backbone:
            for param in self.backbone.parameters():
                param.requires_grad = False

    def predict_rank(self, pixel_values):
        outputs = self.backbone(pixel_values)
        cls_token = outputs.last_hidden_state[:, 0, :]
        cls_token = nn.functional.normalize(cls_token, p=2, dim=1)
        return torch.clamp(self.rank_head(cls_token).squeeze(-1), 0.0, 5.0)

    def forward_single(self, pixel_values, rank=None):
        outputs = self.backbone(pixel_values)
        cls_token = outputs.last_hidden_state[:, 0, :]
        cls_token = nn.functional.normalize(cls_token, p=2, dim=1)
        if rank is None:
            rank = torch.full((pixel_values.size(0),), 2.5, device=pixel_values.device)
        if len(rank.shape) == 1:
            rank = rank.unsqueeze(-1)
        combined = torch.cat([cls_token, rank], dim=1)
        return self.preference_head(combined).squeeze(-1)

    def forward(self, pixel_values_a, rank_a, pixel_values_b, rank_b):
        score_a = self.forward_single(pixel_values_a, rank_a)
        score_b = self.forward_single(pixel_values_b, rank_b)
        return score_a, score_b


SiamesePreferenceModel = DinoV2PreferenceModel


class PerformerAttentionRanker(nn.Module):
    """
    Gallery-level performer ranker. Looks at K images from one performer
    and emits one star rating (0-5) via learned attention pooling.

    Attention is internal — the model chooses how to weight images
    when forming its gallery representation. Mean pooling, top-K,
    or content-conditioned focus all fall out as special cases.

    Training: one sample = (K images, performer_star_rating).
    Inference: single forward per performer; no Python-side averaging.
    """
    def __init__(self, model_name="facebook/dinov2-large", freeze_backbone=True, quantize=False):
        super().__init__()
        if quantize:
            print(f"💎 Loading {model_name} with 8-bit quantization...")
            self.backbone = AutoModel.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(model_name)
        hidden_dim = self.backbone.config.hidden_size

        self.attention = nn.Sequential(
            nn.Linear(hidden_dim, 128),
            nn.Tanh(),
            nn.Linear(128, 1),
        )

        self.rank_head = nn.Sequential(
            nn.Linear(hidden_dim, 256),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(256, 1),
        )
        nn.init.zeros_(self.rank_head[-1].bias)

        if freeze_backbone:
            for p in self.backbone.parameters():
                p.requires_grad = False

    def freeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = False

    def unfreeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = True

    def _embed(self, pixel_values):
        # pixel_values: (K, 3, H, W) → (K, D)
        out = self.backbone(pixel_values)
        return out.last_hidden_state[:, 0, :]

    def _aggregate(self, cls_tokens, mask=None, attn_dropout=0.0):
        """
        cls_tokens: (K, D) or (B, K, D)
        mask: optional same-shape-minus-D, 1 = real, 0 = padding
        Returns: (gallery_embedding, attention_weights)
        """
        squeeze = False
        if cls_tokens.dim() == 2:
            cls_tokens = cls_tokens.unsqueeze(0)
            squeeze = True
        if mask is not None and mask.dim() == 1:
            mask = mask.unsqueeze(0)

        scores = self.attention(cls_tokens).squeeze(-1)  # (B, K)
        if mask is not None:
            scores = scores.masked_fill(mask == 0, float('-inf'))

        if self.training and attn_dropout > 0:
            keep = torch.rand_like(scores) > attn_dropout
            # Detect "all real positions dropped" — checking keep alone would
            # be fooled if padding positions happen to be kept by chance.
            if mask is not None:
                real_kept = keep & (mask == 1)
                all_dropped = ~(real_kept.any(dim=-1, keepdim=True))
            else:
                all_dropped = ~(keep.any(dim=-1, keepdim=True))
            # Recover by un-dropping the row; padding scores stay -inf from the earlier mask
            keep = keep | all_dropped
            scores = scores.masked_fill(~keep, float('-inf'))

        weights = torch.softmax(scores, dim=-1)  # (B, K)
        gallery = (weights.unsqueeze(-1) * cls_tokens).sum(dim=1)  # (B, D)
        if squeeze:
            gallery = gallery.squeeze(0)
            weights = weights.squeeze(0)
        return gallery, weights

    def forward(self, pixel_values, mask=None, attn_dropout=0.0):
        """
        pixel_values: (K, 3, H, W) for one performer
                  or (B, K, 3, H, W) for B performers
        Returns: (rating, attention_weights)
        """
        if pixel_values.dim() == 4:
            cls = self._embed(pixel_values)
            gallery, weights = self._aggregate(cls, mask=mask, attn_dropout=attn_dropout)
            rating = self.rank_head(gallery).squeeze(-1)
        else:
            B, K = pixel_values.shape[:2]
            cls = self._embed(pixel_values.flatten(0, 1)).view(B, K, -1)
            gallery, weights = self._aggregate(cls, mask=mask, attn_dropout=attn_dropout)
            rating = self.rank_head(gallery).squeeze(-1)
        return torch.clamp(rating, 0.0, 5.0), weights

    def predict_rank(self, pixel_values, mask=None):
        """Inference helper — returns just the rating tensor."""
        rating, _ = self.forward(pixel_values, mask=mask)
        return rating
