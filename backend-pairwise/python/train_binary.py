"""
DINOv2 Binary Classifier Training — Progressive Unfreezing
Trains a simple keep-vs-delete classifier from folder structure.

Training recipe (standard transfer learning):
  Phase 1 — WARMUP:   backbone frozen, only head trains at head_lr (fast, stable)
  Phase 2 — FINETUNE: backbone unfrozen, backbone trains at backbone_lr (10-100x lower)

This prevents positive-class collapse by letting the head learn meaningful signal
before the backbone is allowed to shift.

Usage:
    python train_binary.py --keep-dirs "path1,path2" --delete-dirs "path3,path4"
    python train_binary.py --keep-dirs "path1" --delete-dirs "path2" --epochs 8 --warmup-epochs 2
    python train_binary.py --keep-dirs "path1" --delete-dirs "path2" --resume binary_model.pt
"""

import argparse
import sys
import random
from pathlib import Path
from typing import List, Tuple

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader, random_split
from PIL import Image
from transformers import AutoImageProcessor
import torchvision.transforms as T

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).parent))

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}


# ─── Model ───────────────────────────────────────────────────────────────────

class DINOv2BinaryClassifier(nn.Module):
    """DINOv2 backbone + single linear head for binary keep/delete classification."""

    def __init__(self, backbone_name: str = 'facebook/dinov2-large'):
        super().__init__()
        from transformers import AutoModel
        self.backbone = AutoModel.from_pretrained(backbone_name)
        hidden_size = self.backbone.config.hidden_size

        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 1)
        )

        # ── Fix 3: zero-init the final bias so model starts perfectly neutral
        #           sigmoid(0) = 0.5, no head start for either class
        nn.init.zeros_(self.classifier[-1].bias)
        nn.init.xavier_uniform_(self.classifier[-1].weight)

    def freeze_backbone(self):
        for param in self.backbone.parameters():
            param.requires_grad = False
        n = sum(p.numel() for p in self.backbone.parameters())
        print(f"  🧊 Backbone frozen  ({n:,} params)")

    def unfreeze_backbone(self):
        for param in self.backbone.parameters():
            param.requires_grad = True
        n = sum(p.numel() for p in self.backbone.parameters())
        print(f"  🔥 Backbone unfrozen ({n:,} params) — differential LR active")

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        outputs = self.backbone(pixel_values=pixel_values)
        cls = outputs.last_hidden_state[:, 0, :]   # CLS token
        return self.classifier(cls).squeeze(-1)     # raw logit


# ─── Dataset ─────────────────────────────────────────────────────────────────

def scan_images(dirs: List[str]) -> List[str]:
    images = []
    for d in dirs:
        p = Path(d)
        if not p.exists():
            print(f"  WARNING: directory not found: {d}")
            continue
        for f in p.rglob('*'):
            if f.suffix.lower() in IMAGE_EXTS:
                images.append(str(f))
    return images


class BinaryDataset(Dataset):
    def __init__(self, keep_images: List[str], delete_images: List[str],
                 processor: AutoImageProcessor, augment: bool = True):
        self.processor = processor
        self.augment = augment

        self.samples: List[Tuple[str, float]] = (
            [(p, 1.0) for p in keep_images] +
            [(p, 0.0) for p in delete_images]
        )
        random.shuffle(self.samples)

        # Keep augmentations mild — strong distortions destroy the aesthetic
        # signal we're trying to learn (especially color and composition).
        # NO grayscale: color is often part of what makes a photo "keep"
        self.augment_transform = T.Compose([
            T.RandomHorizontalFlip(p=0.5),
            T.RandomResizedCrop(size=224, scale=(0.85, 1.0), ratio=(0.9, 1.1)),
            T.ColorJitter(brightness=0.08, contrast=0.08, saturation=0.05, hue=0.02),
        ])

        print(f"Dataset: {len(keep_images)} keep + {len(delete_images)} delete = {len(self.samples)} total")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try:
            img = Image.open(path).convert('RGB')
        except Exception:
            return self.__getitem__((idx + 1) % len(self))

        if self.augment:
            img = self.augment_transform(img)

        inputs = self.processor(images=img, return_tensors='pt')
        return {
            'pixel_values': inputs['pixel_values'].squeeze(0),
            'label': torch.tensor(label, dtype=torch.float32)
        }


# ─── Training Helpers ─────────────────────────────────────────────────────────

def make_optimizer(model, phase: str, head_lr: float, backbone_lr: float):
    """
    Phase 1 (warmup):  only head parameters, head_lr
    Phase 2 (finetune): head at head_lr, backbone at backbone_lr (discriminative LR)
    """
    if phase == 'warmup':
        params = [{'params': model.classifier.parameters(), 'lr': head_lr}]
        print(f"  Optimizer: head-only  lr={head_lr:.0e}")
    else:
        params = [
            {'params': model.classifier.parameters(), 'lr': head_lr},
            {'params': model.backbone.parameters(),   'lr': backbone_lr},
        ]
        print(f"  Optimizer: full model  head_lr={head_lr:.0e}  backbone_lr={backbone_lr:.0e}")

    return torch.optim.AdamW(params, weight_decay=1e-4)


def train_epoch(model, loader, optimizer, scheduler, criterion, device, scaler, phase_label):
    model.train()
    total_loss = 0.0
    correct = 0
    total = 0

    for i, batch in enumerate(loader):
        pv = batch['pixel_values'].to(device)
        labels = batch['label'].to(device)
        optimizer.zero_grad()

        if scaler is not None:
            with torch.amp.autocast('cuda'):
                logits = model(pv)
                loss = criterion(logits, labels)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            logits = model(pv)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()

        scheduler.step()   # OneCycleLR: must step every batch

        total_loss += loss.item()
        preds = (torch.sigmoid(logits) > 0.5).float()
        correct += (preds == labels).sum().item()
        total += labels.size(0)

        if (i + 1) % 10 == 0:
            current_lr = optimizer.param_groups[0]['lr']
            print(f"  [{phase_label}] Batch {i+1}/{len(loader)} — loss: {loss.item():.4f}  lr: {current_lr:.2e}", flush=True)

    return total_loss / len(loader), correct / total


@torch.no_grad()
def validate(model, loader, criterion, device):
    model.eval()
    total_loss = 0.0
    correct = keep_correct = delete_correct = 0
    total = keep_total = delete_total = 0

    for batch in loader:
        pv = batch['pixel_values'].to(device)
        labels = batch['label'].to(device)
        logits = model(pv)
        loss = criterion(logits, labels)
        total_loss += loss.item()

        preds = (torch.sigmoid(logits) > 0.5).float()
        correct += (preds == labels).sum().item()
        total += labels.size(0)

        km = labels == 1.0
        dm = labels == 0.0
        keep_correct += (preds[km] == labels[km]).sum().item()
        keep_total += km.sum().item()
        delete_correct += (preds[dm] == labels[dm]).sum().item()
        delete_total += dm.sum().item()

    return (
        total_loss / len(loader),
        correct / max(total, 1),
        keep_correct / max(keep_total, 1),
        delete_correct / max(delete_total, 1),
    )


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--keep-dirs',      required=True)
    parser.add_argument('--delete-dirs',    required=True)
    parser.add_argument('--output',         default='binary_model.pt')
    parser.add_argument('--epochs',         type=int,   default=8,
                        help='Total epochs (warmup + finetune)')
    parser.add_argument('--warmup-epochs',  type=int,   default=2,
                        help='Epochs with frozen backbone (Phase 1)')
    parser.add_argument('--head-lr',        type=float, default=1e-3,
                        help='Learning rate for classifier head')
    parser.add_argument('--backbone-lr',    type=float, default=1e-5,
                        help='Learning rate for backbone during Phase 2 (10-100x lower than head)')
    parser.add_argument('--batch-size',     type=int,   default=16)
    parser.add_argument('--val-split',      type=float, default=0.15)
    parser.add_argument('--backbone',       default='facebook/dinov2-large')
    parser.add_argument('--resume',         default=None)
    args = parser.parse_args()

    finetune_epochs = max(0, args.epochs - args.warmup_epochs)

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"\n{'='*60}")
    print(f"  DINOv2 BINARY CLASSIFIER — Progressive Unfreezing")
    print(f"{'='*60}")
    print(f"  Device:  {device}")
    if device.type == 'cuda':
        print(f"  GPU:     {torch.cuda.get_device_name(0)}")
        print(f"  VRAM:    {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    print(f"  Backbone: {args.backbone}")
    print(f"  Phase 1 (warmup):   {args.warmup_epochs} epochs  head_lr={args.head_lr:.0e}  [backbone FROZEN]")
    print(f"  Phase 2 (finetune): {finetune_epochs} epochs  head_lr={args.head_lr:.0e}  backbone_lr={args.backbone_lr:.0e}")
    print(f"{'='*60}\n")

    # ── Gather images
    keep_dirs   = [d.strip() for d in args.keep_dirs.split(',')]
    delete_dirs = [d.strip() for d in args.delete_dirs.split(',')]

    print("Scanning keep directories...")
    keep_images = scan_images(keep_dirs)
    print(f"  Found {len(keep_images)} keep images")

    print("Scanning delete directories...")
    delete_images = scan_images(delete_dirs)
    print(f"  Found {len(delete_images)} delete images")

    if not keep_images or not delete_images:
        print("ERROR: Need both keep and delete images!")
        sys.exit(1)

    # Balance classes
    min_count = min(len(keep_images), len(delete_images))
    if len(keep_images) > min_count:
        keep_images = random.sample(keep_images, min_count)
        print(f"  Balanced: downsampled keep to {min_count}")
    elif len(delete_images) > min_count:
        delete_images = random.sample(delete_images, min_count)
        print(f"  Balanced: downsampled delete to {min_count}")

    # ── Dataset / Loaders
    processor = AutoImageProcessor.from_pretrained(args.backbone)
    dataset   = BinaryDataset(keep_images, delete_images, processor, augment=True)

    val_size   = max(1, int(len(dataset) * args.val_split))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=2, pin_memory=True)
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False,
                              num_workers=2, pin_memory=True)

    print(f"\nTrain: {train_size}  Val: {val_size}")

    # ── Model
    print("\nLoading DINOv2 backbone...")
    model = DINOv2BinaryClassifier(args.backbone)

    if args.resume:
        resume_path = Path(args.resume)
        if not resume_path.is_absolute():
            resume_path = Path(__file__).parent.parent / 'models' / args.resume
        if resume_path.exists():
            ckpt  = torch.load(resume_path, map_location='cpu')
            state = ckpt.get('model_state_dict', ckpt)
            model.load_state_dict(state, strict=False)
            print(f"  Resumed from: {resume_path.name}")
        else:
            print(f"  WARNING: resume checkpoint not found: {resume_path}")

    # ── Phase 1 setup: freeze backbone
    model.freeze_backbone()
    model = model.to(device)

    criterion = nn.BCEWithLogitsLoss()
    scaler    = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None

    output_dir  = Path(__file__).parent.parent / 'models'
    output_dir.mkdir(exist_ok=True)
    output_path = output_dir / args.output

    best_val_acc = 0.0
    current_phase = 'warmup'
    optimizer = make_optimizer(model, current_phase, args.head_lr, args.backbone_lr)
    # OneCycleLR: ramps LR up then cosine-anneals to near-zero each phase
    # updates per batch (not per epoch) → much smoother convergence
    warmup_steps = max(args.warmup_epochs, 1) * len(train_loader)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=[args.head_lr],          # one param group in warmup
        total_steps=warmup_steps,
        pct_start=0.3,                  # 30% of steps = ramp up, 70% = decay
        anneal_strategy='cos'
    )

    print(f"\nStarting training for {args.epochs} epochs...\n")

    for epoch in range(1, args.epochs + 1):

        # ── Phase transition: switch to finetune after warmup
        if epoch == args.warmup_epochs + 1 and finetune_epochs > 0:
            print(f"\n{'='*60}")
            print(f"  ► Phase 2: UNFREEZING backbone (epoch {epoch})")
            print(f"{'='*60}")
            model.unfreeze_backbone()
            current_phase = 'finetune'
            optimizer = make_optimizer(model, current_phase, args.head_lr, args.backbone_lr)
            finetune_steps = finetune_epochs * len(train_loader)
            scheduler = torch.optim.lr_scheduler.OneCycleLR(
                optimizer,
                max_lr=[args.head_lr, args.backbone_lr],  # two param groups now
                total_steps=finetune_steps,
                pct_start=0.2,           # shorter ramp, longer decay in finetune
                anneal_strategy='cos'
            )

        phase_label = '🧊 warmup' if current_phase == 'warmup' else '🔥 finetune'

        print(f"\n{'─'*50}")
        print(f"  EPOCH {epoch}/{args.epochs}  [{phase_label}]")
        print(f"{'─'*50}")

        train_loss, train_acc = train_epoch(
            model, train_loader, optimizer, scheduler, criterion, device, scaler, phase_label
        )
        val_loss, val_acc, keep_acc, delete_acc = validate(
            model, val_loader, criterion, device
        )
        # OneCycleLR steps per batch inside train_epoch; no extra step needed here

        print(f"\n  Train  — loss: {train_loss:.4f}  acc: {train_acc*100:.1f}%")
        print(f"  Val    — loss: {val_loss:.4f}  acc: {val_acc*100:.1f}%")
        print(f"  Val    — keep_acc: {keep_acc*100:.1f}%  delete_acc: {delete_acc*100:.1f}%", flush=True)

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                'epoch':            epoch,
                'model_state_dict': model.state_dict(),
                'val_acc':          val_acc,
                'keep_acc':         keep_acc,
                'delete_acc':       delete_acc,
                'backbone':         args.backbone,
                'model_type':       'binary'
            }, output_path)
            print(f"  ✅ Saved best model → {output_path.name}  (val_acc={val_acc*100:.1f}%)")

    print(f"\n{'='*60}")
    print(f"  Training complete!")
    print(f"  Best val accuracy: {best_val_acc*100:.1f}%")
    print(f"  Model: {output_path}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
