"""
DINOv2-based Pairwise Preference Training

Usage:
    python train_dinov2.py --pairs pairwise_labels.json
    python train_dinov2.py --pairs pairwise_labels.json --model dinov2-base  # Faster, less VRAM
    python train_dinov2.py --pairs pairwise_labels.json --model dinov2-large # More accurate (default)
    python train_dinov2.py --pairs pairwise_labels.json --epochs 5 --lr 1e-4

DINOv2 Models:
    - dinov2-small: 384 dim, fastest, ~22M params
    - dinov2-base:  768 dim, balanced, ~86M params  
    - dinov2-large: 1024 dim, best quality, ~300M params (default)
    - dinov2-giant: 1536 dim, highest quality, ~1.1B params (needs lots of VRAM)
"""

import argparse
import json
import random
from pathlib import Path
from typing import List, Tuple, Dict

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
from tqdm import tqdm
from PIL import Image
from transformers import AutoImageProcessor
import torchvision.transforms as T
from torch.optim.lr_scheduler import CosineAnnealingLR

from model_dinov2 import DinoV2PreferenceModel


# ============== Dataset ==============

class DINOv2PairwiseDataset(Dataset):
    """
    Pairwise dataset for DINOv2 training.
    
    Uses AutoImageProcessor which handles resizing appropriately
    for DINOv2 (typically 518x518 or 224x224).
    """
    
    def __init__(
        self,
        pairs: List[Tuple[str, str]],  # [(winner_path, loser_path), ...]
        processor: AutoImageProcessor,
        images_dir: str = None,
        augment: bool = True
    ):
        self.pairs = pairs
        self.processor = processor
        self.augment = augment
        
        self.augment_transform = T.Compose([
            T.RandomHorizontalFlip(p=0.5),
            T.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1, hue=0.05)
        ])
        
        # Resolve paths
        self.valid_pairs = []
        if images_dir:
            base_dir = Path(images_dir)
        else:
            base_dir = Path(__file__).parent / 'data' / 'images'
        
        def resolve(p):
            p = str(p)
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
                debug_count += 1
            if winner_path.exists() and loser_path.exists():
                self.valid_pairs.append((str(winner_path), str(loser_path)))
        
        print(f"Dataset: {len(self.valid_pairs)} valid pairs "
              f"(filtered from {len(pairs)})")
    
    def __len__(self) -> int:
        return len(self.valid_pairs)
    
    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        winner_path, loser_path = self.valid_pairs[idx]
        
        try:
            winner_img = Image.open(winner_path).convert("RGB")
            loser_img = Image.open(loser_path).convert("RGB")
        except Exception as e:
            # Fallback to next pair
            return self.__getitem__((idx + 1) % len(self))
        
        # Balance Protocol: 50% chance to swap positions
        if self.augment and random.random() > 0.5:
            image_a, image_b = loser_img, winner_img
            label = 0.0  # A is NOT the winner
        else:
            image_a, image_b = winner_img, loser_img
            label = 1.0  # A IS the winner
            
        if self.augment:
            image_a = self.augment_transform(image_a)
            image_b = self.augment_transform(image_b)
        
        # Process with DINOv2 processor
        inputs_a = self.processor(images=image_a, return_tensors="pt")
        inputs_b = self.processor(images=image_b, return_tensors="pt")
        
        return {
            "pixel_values_a": inputs_a["pixel_values"].squeeze(0),
            "pixel_values_b": inputs_b["pixel_values"].squeeze(0),
            "label": torch.tensor(label, dtype=torch.float32)
        }


# ============== Training Functions ==============

def train_epoch(model, loader, optimizer, criterion, device):
    """Train for one epoch."""
    model.train()
    total_loss = 0
    correct = 0
    total = 0
    
    for batch in tqdm(loader, desc="Training"):
        img_a = batch["pixel_values_a"].to(device)
        img_b = batch["pixel_values_b"].to(device)
        labels = batch["label"].to(device)
        
        optimizer.zero_grad()
        
        score_a, score_b = model(img_a, img_b)
        
        # RankNet loss: P(A > B) = sigmoid(score_a - score_b)
        diff = score_a - score_b
        loss = criterion(diff, labels)
        
        loss.backward()
        optimizer.step()
        
        total_loss += loss.item()
        
        # Accuracy: did we predict correctly?
        preds = (diff > 0).float()
        correct += (preds == labels).sum().item()
        total += labels.size(0)
    
    return total_loss / len(loader), correct / total


@torch.no_grad()
def validate(model, loader, criterion, device):
    """Validate the model."""
    model.eval()
    total_loss = 0
    correct = 0
    total = 0
    
    for batch in tqdm(loader, desc="Validating", leave=False):
        img_a = batch["pixel_values_a"].to(device)
        img_b = batch["pixel_values_b"].to(device)
        labels = batch["label"].to(device)
        
        score_a, score_b = model(img_a, img_b)
        diff = score_a - score_b
        loss = criterion(diff, labels)
        
        total_loss += loss.item()
        preds = (diff > 0).float()
        correct += (preds == labels).sum().item()
        total += labels.size(0)
    
    return total_loss / len(loader), correct / total


# ============== Main ==============

def main():
    parser = argparse.ArgumentParser(description="Train DINOv2 preference model")
    parser.add_argument("--pairs", required=True, help="Path to pairwise_labels.json")
    parser.add_argument("--model", default="dinov2-large", 
                       choices=["dinov2-small", "dinov2-base", "dinov2-large", "dinov2-giant"],
                       help="DINOv2 model size")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)  # Smaller batch for larger model
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--val-split", type=float, default=0.1)
    parser.add_argument("--output", default="output_dinov2", help="Output directory")
    parser.add_argument("--images", default="data/images", help="Path to images directory")
    parser.add_argument("--resume", default=None, help="Path to checkpoint to resume from")
    parser.add_argument("--unfreeze-blocks", type=int, default=1, help="Number of final transformer blocks to unfreeze")
    args = parser.parse_args()
    
    # Device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n🖥️  Device: {device}")
    if device.type == "cuda":
        print(f"   GPU: {torch.cuda.get_device_name(0)}")
        print(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    
    # Model name mapping
    model_map = {
        "dinov2-small": "facebook/dinov2-small",
        "dinov2-base": "facebook/dinov2-base",
        "dinov2-large": "facebook/dinov2-large",
        "dinov2-giant": "facebook/dinov2-giant",
    }
    model_name = model_map[args.model]
    
    # Load pairs
    print(f"\n📊 Loading pairs from: {args.pairs}")
    with open(args.pairs, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    pairs = [(p['winner'], p['loser']) for p in data['pairs']]
    print(f"   Total pairs: {len(pairs)}")
    
    # Create dataset with DINOv2 processor
    print(f"\n🦕 Using DINOv2 processor: {model_name}")
    # Force 518px resolution to capture fine details (cosplay fabrics, facial aesthetics)
    # Default is 224px which loses texture information
    processor = AutoImageProcessor.from_pretrained(
        model_name,
        do_resize=True,
        size={"shortest_edge": 518},
        do_center_crop=True,
        crop_size={"height": 518, "width": 518}
    )
    print(f"   Image size: {processor.size}")
    
    # Resolve images path
    images_dir = Path(args.images)
    if not images_dir.is_absolute():
        images_dir = Path(__file__).parent / images_dir
    print(f"   Images directory: {images_dir}")
    
    dataset = DINOv2PairwiseDataset(pairs, processor, images_dir=str(images_dir))
    
    # Split train/val
    val_size = int(len(dataset) * args.val_split)
    train_size = len(dataset) - val_size
    train_dataset, val_dataset = random_split(dataset, [train_size, val_size])
    
    print(f"   Train pairs: {train_size}")
    print(f"   Val pairs: {val_size}")
    
    # Dataloaders
    train_loader = DataLoader(
        train_dataset, 
        batch_size=args.batch_size, 
        shuffle=True,
        num_workers=0,
        pin_memory=True
    )
    val_loader = DataLoader(
        val_dataset, 
        batch_size=args.batch_size,
        num_workers=0
    )
    
    # Create model
    print(f"\n🔧 Creating DINOv2 model...")
    model = DinoV2PreferenceModel(model_name=model_name, unfreeze_last_n_blocks=args.unfreeze_blocks).to(device)
    
    if args.resume:
        print(f"\n🔄 Resuming from checkpoint: {args.resume}")
        checkpoint = torch.load(args.resume, map_location=device)
        model.load_state_dict(checkpoint['model_state_dict']) # Load state_dict from checkpoint
    
    # Optimizer and loss
    
    # Count parameters
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"   Trainable parameters: {trainable:,}")
    
    # Optimizer and loss
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=args.lr,
        weight_decay=0.01
    )
    scheduler = CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.BCEWithLogitsLoss()
    
    # Output directory
    output_dir = Path(args.output)
    output_dir.mkdir(exist_ok=True)
    
    # Training loop
    print(f"\n🚀 Training for {args.epochs} epochs...")
    best_acc = 0
    history = {"train_loss": [], "train_acc": [], "val_loss": [], "val_acc": []}
    
    for epoch in range(args.epochs):
        print(f"\n📈 Epoch {epoch + 1}/{args.epochs}")
        
        train_loss, train_acc = train_epoch(model, train_loader, optimizer, criterion, device)
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        
        scheduler.step()
        
        history["train_loss"].append(train_loss)
        history["train_acc"].append(train_acc)
        history["val_loss"].append(val_loss)
        history["val_acc"].append(val_acc)
        
        current_lr = scheduler.get_last_lr()[0]
        print(f"   LR:         {current_lr:.6f}")
        print(f"   Train Loss: {train_loss:.4f} | Train Acc: {train_acc:.4f}")
        print(f"   Val Loss:   {val_loss:.4f} | Val Acc:   {val_acc:.4f}")
        
        # Save best model
        if val_acc > best_acc:
            best_acc = val_acc
            torch.save({
                'model_state_dict': model.state_dict(),
                'config': {
                    'model_name': model_name,
                    'model_type': 'dinov2',
                    'hidden_dim': model.backbone.config.hidden_size,
                },
                'val_acc': val_acc
            }, output_dir / "best_model.pt")
            print(f"   ✨ New best model saved! (Val Acc: {val_acc:.4f})")
    
    # Save final model
    torch.save({
        'model_state_dict': model.state_dict(),
        'config': {
            'model_name': model_name,
            'model_type': 'dinov2',
            'hidden_dim': model.backbone.config.hidden_size,
        }
    }, output_dir / "final_model.pt")
    
    # Save history
    with open(output_dir / "history.json", 'w') as f:
        json.dump(history, f, indent=2)
    
    print(f"\n✅ Training complete!")
    print(f"   Best Val Acc: {best_acc:.4f}")
    print(f"   Output: {output_dir}")
    print(f"\n📦 Files saved:")
    print(f"   - final_model.pt (for inference)")
    print(f"   - best_model.pt (highest accuracy)")
    print(f"   - history.json (training metrics)")
    
    # Performance guide
    print(f"\n📊 Performance Guide:")
    if best_acc >= 0.85:
        print(f"   🌟 Excellent! Your model learned strong preferences.")
    elif best_acc >= 0.75:
        print(f"   👍 Good! Model is learning your preferences well.")
    elif best_acc >= 0.65:
        print(f"   ⚠️  Moderate. Consider: more data, unfreeze backbone, or more epochs.")
    else:
        print(f"   ❌ Low accuracy. Check data quality or try different model size.")


if __name__ == "__main__":
    main()
