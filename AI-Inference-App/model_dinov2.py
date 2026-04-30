import torch
import torch.nn as nn
from transformers import AutoModel

class DinoV2PreferenceModel(nn.Module):
    """
    DINOv2-based Siamese network for learning image preferences.
    """
    def __init__(self, model_name="facebook/dinov2-large", freeze_backbone=True):
        super().__init__()
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
        # L2 Normalization is critical for stability in this architecture
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

SiamesePreferenceModel = DinoV2PreferenceModel
