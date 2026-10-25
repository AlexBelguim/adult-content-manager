import numpy as np
import torch
import torch.nn as nn
from sklearn.linear_model import LogisticRegression
from transformers import AutoModel, CLIPVisionModelWithProjection

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


class ScoreHead(nn.Module):
    def __init__(self, input_dim=768, hidden_dim=512):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(hidden_dim // 2, 1)
        )

    def forward(self, x):
        return self.net(x).squeeze(-1)


class ClipPreferenceModel(nn.Module):
    """
    Picture ranker ported from extra/vision-llm-pairwise: frozen CLIP ViT-L/14-336 image
    embedding → ScoreHead, trained with RankNet on winner/loser picture pairs. Scores are
    relative (only their order means something), like the other siamese models.
    Keys match the original checkpoint (backbone.vision_model.*, score_head.net.*).
    """
    def __init__(self, model_name="openai/clip-vit-large-patch14-336"):
        super().__init__()
        self.backbone = CLIPVisionModelWithProjection.from_pretrained(model_name)
        for p in self.backbone.parameters():
            p.requires_grad = False
        self.score_head = ScoreHead(self.backbone.config.projection_dim)

    def features(self, pixel_values):
        return self.backbone(pixel_values=pixel_values).image_embeds

    def forward_single(self, pixel_values):
        return self.score_head(self.features(pixel_values))


class ClipKeepDeleteModel(nn.Module):
    """
    K: a keep % for any picture with a fixed 50% line, learned from keep/delete alone (trainer.train_clip_keepdelete):
    the frozen CLIP ViT-L/14-336 image embedding, L2-normalized, into one linear layer fitted as a class-balanced
    logistic regression (C=1) on every kept (1) and deleted (0) picture. The checkpoint keeps those training
    embeddings (train_X, train_y), so the filter view's AI can refit K with the pictures already sorted of the
    performer being filtered.
    """
    def __init__(self, model_name="openai/clip-vit-large-patch14-336"):
        super().__init__()
        self.backbone = CLIPVisionModelWithProjection.from_pretrained(model_name)
        for p in self.backbone.parameters():
            p.requires_grad = False
        self.head = nn.Linear(self.backbone.config.projection_dim, 1)
        self.train_X = self.train_y = None

    def features(self, pixel_values):
        return nn.functional.normalize(self.backbone(pixel_values=pixel_values).image_embeds, dim=-1)

    def forward_single(self, pixel_values):
        return self.head(self.features(pixel_values))

    def refit(self, X, y, weight=20.0):
        """A head refit with one performer's sorted pictures (X their embeddings, y 1 kept / 0 deleted) added to the
        training pictures, each counting as `weight` of them. Tested leave-one-performer-out (2026-10-24): her
        unsorted pictures went from AUC 0.760 to 0.792 after 20 sorted and 0.814 after 50."""
        m = LogisticRegression(C=1.0, max_iter=3000, class_weight='balanced').fit(
            np.concatenate([self.train_X, X]), np.concatenate([self.train_y, y]),
            sample_weight=np.r_[np.ones(len(self.train_y)), np.full(len(y), weight)])
        head = nn.Linear(X.shape[1], 1).to(self.head.weight.device)
        with torch.no_grad():
            head.weight.copy_(torch.from_numpy(m.coef_))
            head.bias.copy_(torch.from_numpy(m.intercept_))
        return head
