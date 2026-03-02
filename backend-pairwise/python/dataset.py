"""
Balanced Pairwise Dataset

Implements the "Balance Protocol" - random swapping to prevent position bias.
The model should learn preferences, not "left is always better".
"""

import random
from pathlib import Path
from typing import List, Tuple, Dict

import torch
from torch.utils.data import Dataset
from PIL import Image
from transformers import CLIPProcessor


class BalancedPairwiseDataset(Dataset):
    """
    Dataset for pairwise preference learning with position balancing.
    
    Each sample is a pair of images where one is preferred.
    50% of the time we swap positions to prevent position bias.
    """
    
    def __init__(
        self,
        pairs: List[Tuple[str, str]],  # [(winner_path, loser_path), ...]
        processor: CLIPProcessor,
        augment: bool = True
    ):
        """
        Args:
            pairs: List of (winner_path, loser_path) tuples
            processor: CLIP image processor
            augment: Whether to apply random swapping
        """
        self.pairs = pairs
        self.processor = processor
        self.augment = augment
        
        # Filter to existing pairs, resolve relative paths
        self.valid_pairs = []
        base_dir = Path(__file__).parent / 'data' / 'images'
        def resolve(p):
            p = str(p)
            # Remove leading ./, .\, /, \ and images/ prefix
            rel = p.lstrip('./\\/')
            if rel.startswith('images/'):
                rel = rel[7:]
            return base_dir / rel
        debug_count = 0
        for winner, loser in pairs:
            winner_path = resolve(winner)
            loser_path = resolve(loser)
            if debug_count < 5:
                print(f"Resolved: {winner} -> {winner_path}")
                print(f"Resolved: {loser} -> {loser_path}")
                debug_count += 1
            if winner_path.exists() and loser_path.exists():
                self.valid_pairs.append((str(winner_path), str(loser_path)))
        
        print(f"Dataset: {len(self.valid_pairs)} valid pairs "
              f"(filtered from {len(pairs)})")
    
    def __len__(self) -> int:
        return len(self.valid_pairs)
    
    def __getitem__(self, idx: int, _depth: int = 0) -> Dict[str, torch.Tensor]:
        winner_path, loser_path = self.valid_pairs[idx]
        
        try:
            # Load images
            winner_img = Image.open(winner_path).convert("RGB")
            loser_img = Image.open(loser_path).convert("RGB")
        except Exception as e:
            # On error, try next pair (with depth limit to prevent infinite recursion)
            if _depth < 10:
                return self.__getitem__((idx + 1) % len(self), _depth + 1)
            else:
                # Return zero tensors as fallback (336px model size)
                dummy = torch.zeros(3, 336, 336)
                return {
                    'image_a': dummy,
                    'image_b': dummy,
                    'label': torch.tensor(0.5)
                }
        
        # THE BALANCE PROTOCOL
        # 50% chance to swap positions to prevent position bias
        if self.augment and random.random() > 0.5:
            # Swapped: A is loser, B is winner
            image_a = loser_img
            image_b = winner_img
            label = 0.0  # A is NOT the winner
        else:
            # Original: A is winner, B is loser
            image_a = winner_img
            image_b = loser_img
            label = 1.0  # A IS the winner
        
        # Process images
        inputs_a = self.processor(images=image_a, return_tensors="pt")
        inputs_b = self.processor(images=image_b, return_tensors="pt")
        
        return {
            "pixel_values_a": inputs_a["pixel_values"].squeeze(0),
            "pixel_values_b": inputs_b["pixel_values"].squeeze(0),
            "label": torch.tensor(label, dtype=torch.float32)
        }


class MixedPairwiseDataset(Dataset):
    """
    Combines multiple pair sources:
    1. Keep/Delete pairs (keep > delete)
    2. ELO ranking pairs (preferred > rejected)
    
    Balances sampling between sources.
    """
    
    def __init__(
        self,
        keep_delete_pairs: List[Tuple[str, str]],
        elo_pairs: List[Tuple[str, str]],
        processor: CLIPProcessor,
        keep_delete_weight: float = 1.0,
        elo_weight: float = 1.5  # ELO pairs are more valuable
    ):
        self.processor = processor
        
        # Create weighted list
        self.all_pairs = []
        self.weights = []
        
        for pair in keep_delete_pairs:
            if Path(pair[0]).exists() and Path(pair[1]).exists():
                self.all_pairs.append(pair)
                self.weights.append(keep_delete_weight)
        
        for pair in elo_pairs:
            if Path(pair[0]).exists() and Path(pair[1]).exists():
                self.all_pairs.append(pair)
                self.weights.append(elo_weight)
        
        print(f"Mixed dataset: {len(self.all_pairs)} pairs")
        print(f"  - Keep/Delete: {len([w for w in self.weights if w == keep_delete_weight])}")
        print(f"  - ELO: {len([w for w in self.weights if w == elo_weight])}")
    
    def __len__(self) -> int:
        return len(self.all_pairs)
    
    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        winner_path, loser_path = self.all_pairs[idx]
        
        try:
            winner_img = Image.open(winner_path).convert("RGB")
            loser_img = Image.open(loser_path).convert("RGB")
        except:
            return self.__getitem__((idx + 1) % len(self))
        
        # Balance protocol
        if random.random() > 0.5:
            image_a, image_b = loser_img, winner_img
            label = 0.0
        else:
            image_a, image_b = winner_img, loser_img
            label = 1.0
        
        inputs_a = self.processor(images=image_a, return_tensors="pt")
        inputs_b = self.processor(images=image_b, return_tensors="pt")
        
        return {
            "pixel_values_a": inputs_a["pixel_values"].squeeze(0),
            "pixel_values_b": inputs_b["pixel_values"].squeeze(0),
            "label": torch.tensor(label, dtype=torch.float32),
            "weight": torch.tensor(self.weights[idx], dtype=torch.float32)
        }
