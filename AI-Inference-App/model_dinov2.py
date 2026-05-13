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

class RankAwareSiameseModel(nn.Module):
    """
    Advanced DINOv2 model with two heads:
    1. Rank Head: Predicts performer's star rating from image context.
    2. Preference Head: Predicts image quality conditioned on that rank.
    """
    def __init__(self, model_name="facebook/dinov2-large", freeze_backbone=True, quantize=False):
        super().__init__()
        if quantize:
            print(f"💎 Loading {model_name} with 8-bit quantization...")
            self.backbone = AutoModel.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(model_name)
        hidden_dim = self.backbone.config.hidden_size
        
        # Head 1: Predict Rank (0.0 to 5.0)
        self.rank_head = nn.Sequential(
            nn.Linear(hidden_dim, 256),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(256, 1)
        )
        
        # Head 2: Preference Score (takes Image + Rank)
        self.preference_head = nn.Sequential(
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

    def predict_rank(self, pixel_values):
        """Pass 1: Estimate performer's star rating from images."""
        outputs = self.backbone(pixel_values)
        cls_token = outputs.last_hidden_state[:, 0, :]
        cls_token = nn.functional.normalize(cls_token, p=2, dim=1)
        return torch.clamp(self.rank_head(cls_token).squeeze(-1), 0.0, 5.0)

    def forward_single(self, pixel_values, rank):
        """Pass 2: Score image relative to a known/predicted rank."""
        outputs = self.backbone(pixel_values)
        cls_token = outputs.last_hidden_state[:, 0, :]
        cls_token = nn.functional.normalize(cls_token, p=2, dim=1)
        
        if len(rank.shape) == 1:
            rank = rank.unsqueeze(-1)
            
        combined = torch.cat([cls_token, rank], dim=1)
        return self.preference_head(combined).squeeze(-1)

    def forward(self, pixel_values_a, rank_a, pixel_values_b, rank_b):
        score_a = self.forward_single(pixel_values_a, rank_a)
        score_b = self.forward_single(pixel_values_b, rank_b)
        return score_a, score_b
    
    def score_images(self, pixel_values, rank):
        raw_scores = self.forward_single(pixel_values, rank)
        normalized = torch.sigmoid(raw_scores) * 100
        return normalized

SiamesePreferenceModel = DinoV2PreferenceModel
