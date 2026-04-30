"""
DINOv2 Context-Aware Binary Classifier Training
Trains a classifier that "views" a performer's typical images (context)
before deciding if a specific image is a Keep or Delete.

This implements the "Performer Baseline" concept to improve accuracy
by learning personalized taste per performer.
"""

import argparse
import sys
import random
import json
import os
from pathlib import Path
from typing import List, Tuple, Dict

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
from PIL import Image
from transformers import AutoImageProcessor, AutoModel
import torchvision.transforms as T
from tqdm import tqdm

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).parent))

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}

# ─── Model ───────────────────────────────────────────────────────────────────

class DINOv2ContextBinaryClassifier(nn.Module):
    """
    DINOv2 backbone + Context-Aware Head.
    The head takes the current image embedding AND the performer's average embedding.
    """

    def __init__(self, backbone_name: str = 'facebook/dinov2-large'):
        super().__init__()
        self.backbone = AutoModel.from_pretrained(backbone_name)
        hidden_size = self.backbone.config.hidden_size

        # Input is concatenated: [Current Image (hidden_size), Performer Context (hidden_size)]
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size * 2, 512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, 1)
        )

        nn.init.zeros_(self.classifier[-1].bias)
        nn.init.xavier_uniform_(self.classifier[-1].weight)

    def freeze_backbone(self):
        for param in self.backbone.parameters():
            param.requires_grad = False
        print(f"  🧊 Backbone frozen")

    def unfreeze_backbone(self):
        for param in self.backbone.parameters():
            param.requires_grad = True
        print(f"  🔥 Backbone unfrozen")

    def forward(self, pixel_values: torch.Tensor, context_embeddings: torch.Tensor) -> torch.Tensor:
        outputs = self.backbone(pixel_values=pixel_values)
        cls = outputs.last_hidden_state[:, 0, :]   # CLS token [batch, hidden]
        
        # Concatenate current image with its performer's context
        combined = torch.cat([cls, context_embeddings], dim=1) # [batch, hidden * 2]
        return self.classifier(combined).squeeze(-1)


# ─── Context Pre-computation ──────────────────────────────────────────────────

@torch.no_grad()
def compute_performer_contexts(model, processor, performer_map: Dict[str, List[str]], device):
    """
    Computes the average embedding for each performer based on their 'Keep' images.
    """
    model.eval()
    contexts = {}
    print(f"\nComputing context profiles for {len(performer_map)} performers...")

    for perf_name, image_paths in tqdm(performer_map.items()):
        if not image_paths:
            continue
            
        embeddings = []
        # Sample up to 20 images to build the context (balance speed/accuracy)
        sample_paths = random.sample(image_paths, min(20, len(image_paths)))
        
        for path in sample_paths:
            try:
                img = Image.open(path).convert('RGB')
                inputs = processor(images=img, return_tensors='pt').to(device)
                outputs = model.backbone(**inputs)
                emb = outputs.last_hidden_state[:, 0, :].cpu()
                embeddings.append(emb)
            except Exception:
                continue
        
        if embeddings:
            contexts[perf_name] = torch.mean(torch.stack(embeddings), dim=0).squeeze(0)
        else:
            # Fallback to zero if no images could be loaded
            contexts[perf_name] = torch.zeros(model.backbone.config.hidden_size)
            
    return contexts


# ─── Dataset ─────────────────────────────────────────────────────────────────

class ContextBinaryDataset(Dataset):
    def __init__(self, keep_performer_map: Dict[str, List[str]], 
                 delete_performer_map: Dict[str, List[str]],
                 contexts: Dict[str, torch.Tensor],
                 processor: AutoImageProcessor, augment: bool = True):
        self.processor = processor
        self.augment = augment
        self.contexts = contexts

        self.samples: List[Tuple[str, str, float]] = [] # (path, performer_name, label)
        
        for perf, images in keep_performer_map.items():
            for p in images:
                self.samples.append((p, perf, 1.0))
        
        for perf, images in delete_performer_map.items():
            for p in images:
                self.samples.append((p, perf, 0.0))

        random.shuffle(self.samples)

        self.augment_transform = T.Compose([
            T.RandomHorizontalFlip(p=0.5),
            T.RandomResizedCrop(size=224, scale=(0.85, 1.0), ratio=(0.9, 1.1)),
            T.ColorJitter(brightness=0.08, contrast=0.08, saturation=0.05, hue=0.02),
        ])

        print(f"Dataset: {len(self.samples)} total images across {len(contexts)} performers")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, perf_name, label = self.samples[idx]
        try:
            img = Image.open(path).convert('RGB')
        except Exception:
            return self.__getitem__((idx + 1) % len(self))

        if self.augment:
            img = self.augment_transform(img)

        inputs = self.processor(images=img, return_tensors='pt')
        context_emb = self.contexts.get(perf_name, torch.zeros_like(next(iter(self.contexts.values()))))

        return {
            'pixel_values': inputs['pixel_values'].squeeze(0),
            'context_embedding': context_emb,
            'label': torch.tensor(label, dtype=torch.float32)
        }


# ─── Training Helpers ─────────────────────────────────────────────────────────

def train_epoch(model, loader, optimizer, scheduler, criterion, device, scaler):
    model.train()
    total_loss = 0.0
    correct = 0
    total = 0

    for i, batch in enumerate(loader):
        pv = batch['pixel_values'].to(device)
        ctx = batch['context_embedding'].to(device)
        labels = batch['label'].to(device)
        optimizer.zero_grad()

        if scaler is not None:
            with torch.amp.autocast('cuda'):
                logits = model(pv, ctx)
                loss = criterion(logits, labels)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            logits = model(pv, ctx)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()

        if scheduler:
            scheduler.step()

        total_loss += loss.item()
        preds = (torch.sigmoid(logits) > 0.5).float()
        correct += (preds == labels).sum().item()
        total += labels.size(0)

    return total_loss / len(loader), correct / total

@torch.no_grad()
def validate(model, loader, criterion, device):
    model.eval()
    total_loss = 0.0
    correct = total = 0

    for batch in loader:
        pv = batch['pixel_values'].to(device)
        ctx = batch['context_embedding'].to(device)
        labels = batch['label'].to(device)
        
        logits = model(pv, ctx)
        loss = criterion(logits, labels)
        total_loss += loss.item()

        preds = (torch.sigmoid(logits) > 0.5).float()
        correct += (preds == labels).sum().item()
        total += labels.size(0)

    return total_loss / len(loader), correct / max(total, 1)


# ─── Main ─────────────────────────────────────────────────────────────────────

def scan_images(dirs_str: str) -> Dict[str, List[str]]:
    perf_map = {}
    dirs = [d.strip() for d in dirs_str.split(',')]
    for d in dirs:
        p = Path(d)
        if not p.exists(): continue
        # Assume directory name is performer name
        perf_name = p.name
        images = []
        for f in p.rglob('*'):
            if f.suffix.lower() in IMAGE_EXTS:
                images.append(str(f))
        if images:
            perf_map[perf_name] = images
    return perf_map

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--keep-dirs',      required=True)
    parser.add_argument('--delete-dirs',    required=True)
    parser.add_argument('--output',         default='context_binary_model.pt')
    parser.add_argument('--epochs',         type=int,   default=8)
    parser.add_argument('--warmup-epochs',  type=int,   default=2)
    parser.add_argument('--batch-size',     type=int,   default=16)
    parser.add_argument('--backbone',       default='facebook/dinov2-large')
    args = parser.parse_args()

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"\n🚀 DINOv2 CONTEXT-AWARE BINARY TRAINING")
    print(f"   Backbone: {args.backbone} | Device: {device}")

    # 1. Scan images
    keep_perf_map = scan_images(args.keep_dirs)
    delete_perf_map = scan_images(args.delete_dirs)
    
    # 2. Setup Model & Processor
    processor = AutoImageProcessor.from_pretrained(args.backbone)
    model = DINOv2ContextBinaryClassifier(args.backbone).to(device)
    
    # 3. Pre-compute Contexts (The "First Viewing" Phase)
    # Use 'Keep' images to define the user's taste baseline for each performer
    contexts = compute_performer_contexts(model, processor, keep_perf_map, device)

    # 4. Create Dataset
    dataset = ContextBinaryDataset(keep_perf_map, delete_perf_map, contexts, processor)
    val_size = max(1, int(len(dataset) * 0.15))
    train_ds, val_ds = random_split(dataset, [len(dataset)-val_size, val_size])
    
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=2)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=2)

    # 5. Training Loop
    criterion = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    
    model.freeze_backbone()
    optimizer = torch.optim.AdamW(model.classifier.parameters(), lr=1e-3)
    
    best_acc = 0.0
    output_path = Path(__file__).parent.parent / 'models' / args.output
    output_path.parent.mkdir(exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        if epoch == args.warmup_epochs + 1:
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.classifier.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])

        train_loss, train_acc = train_epoch(model, train_loader, optimizer, None, criterion, device, scaler)
        val_loss, val_acc = validate(model, val_loader, criterion, device)

        print(f"Epoch {epoch}/{args.epochs} | Train Loss: {train_loss:.4f} Acc: {train_acc:.2f} | Val Acc: {val_acc:.2f}")

        if val_acc > best_acc:
            best_acc = val_acc
            torch.save({
                'model_state_dict': model.state_dict(),
                'val_acc': val_acc,
                'backbone': args.backbone,
                'model_type': 'context_binary'
            }, output_path)
            print(f"  ⭐ Saved best model to {output_path.name}")

    print(f"\n✅ Training Complete. Best Val Acc: {best_acc:.2f}")

if __name__ == '__main__':
    main()
