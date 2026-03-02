"""
DINOv2-based Siamese Network for Pairwise Preference Learning

DINOv2 advantages over CLIP:
- Better spatial understanding (no text-image contrastive bias)
- Stronger local features (better for detecting fine details)
- Higher native resolution (518x518 vs 224/336)
- Self-supervised on pure vision tasks

Architecture:
    Image A ──┐
              ├──► DINOv2 Backbone ──► Preference Head ──► Score
    Image B ──┘     (shared)
"""

import torch
import torch.nn as nn
from transformers import AutoModel


class DinoV2PreferenceModel(nn.Module):
    """
    DINOv2-based Siamese network for learning image preferences.
    
    Uses DINOv2's [CLS] token as the image representation,
    followed by a preference scoring head.
    """
    
    def __init__(
        self, 
        model_name: str = "facebook/dinov2-large",
        freeze_backbone: bool = True
    ):
        super().__init__()
        
        self.model_name = model_name
        
        # Load DINOv2 Backbone
        print(f"🦕 Loading DINOv2: {model_name}")
        self.backbone = AutoModel.from_pretrained(model_name)
        
        # DINOv2 hidden dimensions:
        # - dinov2-small: 384
        # - dinov2-base: 768  
        # - dinov2-large: 1024
        # - dinov2-giant: 1536
        hidden_dim = self.backbone.config.hidden_size
        print(f"   Hidden dim: {hidden_dim}")
        
        # Preference Head - deeper MLP for nuanced scoring
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 1)  # Single scalar score
        )
        
        # Freeze backbone (train only the head)
        if freeze_backbone:
            print(f"   Freezing backbone weights")
            for param in self.backbone.parameters():
                param.requires_grad = False
    
    def forward_single(self, pixel_values: torch.Tensor) -> torch.Tensor:
        """
        Score a single image (or batch of images).
        
        Args:
            pixel_values: [B, C, H, W] tensor
            
        Returns:
            scores: [B] tensor of preference scores
        """
        # DINOv2 forward pass
        outputs = self.backbone(pixel_values)
        
        # Extract [CLS] token (first token, represents whole image)
        # Shape: [batch, hidden_dim]
        cls_token = outputs.last_hidden_state[:, 0, :]
        
        # L2 normalize for training stability
        cls_token = nn.functional.normalize(cls_token, p=2, dim=1)
        
        # Get preference score
        score = self.head(cls_token)
        return score.squeeze(-1)
    
    def forward(
        self, 
        pixel_values_a: torch.Tensor, 
        pixel_values_b: torch.Tensor
    ) -> tuple:
        """
        Siamese forward pass - score both images.
        
        Args:
            pixel_values_a: [B, C, H, W] first image batch
            pixel_values_b: [B, C, H, W] second image batch
            
        Returns:
            (score_a, score_b): tuple of [B] score tensors
        """
        score_a = self.forward_single(pixel_values_a)
        score_b = self.forward_single(pixel_values_b)
        return score_a, score_b
    
    def score_images(self, pixel_values: torch.Tensor) -> torch.Tensor:
        """
        Score images and return normalized 0-100 scale.
        Compatible with inference scripts.
        """
        raw_scores = self.forward_single(pixel_values)
        # Sigmoid to 0-1, then scale to 0-100
        normalized = torch.sigmoid(raw_scores) * 100
        return normalized


# For backwards compatibility with existing code
SiamesePreferenceModel = DinoV2PreferenceModel
