"""
Training module for AI Inference App.
Supports: binary, pairwise, siamese binary, performer ranker, and rank-conditioned variants.
Legacy: context_binary and rank_aware_siamese checkpoints still loadable but no new training.
Runs in a background thread so the server stays responsive.
"""
import os, sys, time, random, json, threading, torch, torch.nn as nn
from pathlib import Path
from PIL import Image
from transformers import AutoImageProcessor, AutoModel
from torch.utils.data import Dataset, DataLoader, random_split
import torchvision.transforms as T
from model_dinov2 import (
    DinoV2PreferenceModel, RankAwareSiameseModel,
    PerformerRankerModel, PerformerAttentionRanker,
    RankedBinaryClassifier, RankedSiameseModel
)

IMAGE_EXTS = {'.jpg','.jpeg','.png','.webp','.gif','.bmp'}

# ── Global training state ────────────────────────────────────────────────────
training_state = {
    'active': False,
    'type': None,
    'epoch': 0,
    'total_epochs': 0,
    'batch': 0,
    'total_batches': 0,
    'train_loss': 0,
    'train_acc': 0,
    'val_acc': 0,
    'best_val_acc': 0,
    'phase': 'idle',
    'message': '',
    'error': None,
    'started_at': None,
    'finished_at': None,
    'epoch_history': [],
    'log': []
}

HISTORY_PATH = Path(__file__).parent / 'training_history.json'

def save_run_to_history(run_data):
    """Append a training run record to the history file."""
    history = []
    if HISTORY_PATH.exists():
        try:
            import json as _json
            history = _json.loads(HISTORY_PATH.read_text())
        except: pass
    history.append(run_data)
    # Keep last 50 runs
    history = history[-50:]
    import json as _json
    HISTORY_PATH.write_text(_json.dumps(history, indent=2))

def tlog(msg):
    ts = time.strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    training_state['log'].append(line)
    if len(training_state['log']) > 200:
        training_state['log'] = training_state['log'][-200:]

def scan_images_flat(directory):
    imgs = []
    p = Path(directory)
    if not p.exists(): return imgs
    for f in p.rglob('*'):
        if f.suffix.lower() in IMAGE_EXTS:
            imgs.append(str(f))
    return imgs

def scan_performer_dirs(base_dir):
    """Returns {performer_name: [image_paths]} for dirs under base_dir."""
    result = {}
    p = Path(base_dir)
    if not p.exists(): return result
    for d in sorted(p.iterdir()):
        if d.is_dir() and not d.name.startswith('.'):
            pics = scan_images_flat(d / 'pics')
            if not pics:
                pics = scan_images_flat(d)
            if pics:
                result[d.name] = pics
    return result

def performer_from_path(path):
    """Extract performer name from an image path. Handles both
    `base/keep/performer/img.jpg` and `base/keep/performer/pics/img.jpg`."""
    p = Path(path)
    perf = p.parent.name
    if perf == 'pics':
        perf = p.parent.parent.name
    return perf

def split_performers(performer_names, val_frac=0.15, seed=42):
    """Hold out a fraction of performers entirely. Returns (train, val)
    as sorted lists. Uses a fixed seed so the same dataset yields a
    stable split across runs — important if you want to compare models
    trained against each other.
    """
    perfs = sorted(set(performer_names))
    rng = random.Random(seed)
    shuffled = perfs[:]
    rng.shuffle(shuffled)
    n_val = max(1, int(len(shuffled) * val_frac))
    if n_val >= len(shuffled):  # tiny dataset — keep at least one for train
        n_val = max(1, len(shuffled) - 1)
    val = sorted(shuffled[:n_val])
    train = sorted(shuffled[n_val:])
    return train, val

# ── Models ───────────────────────────────────────────────────────────────────

class BinaryClassifier(nn.Module):
    def __init__(self, backbone_name='facebook/dinov2-large', quantize=False):
        super().__init__()
        if quantize:
            tlog(f"  💎 Loading backbone in 8-bit quantization...")
            self.backbone = AutoModel.from_pretrained(backbone_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(backbone_name)
        hs = self.backbone.config.hidden_size
        self.classifier = nn.Sequential(
            nn.Linear(hs, 256), nn.ReLU(), nn.Dropout(0.3), nn.Linear(256, 1)
        )
        nn.init.zeros_(self.classifier[-1].bias)
    def freeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = False
    def unfreeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = True
    def forward(self, pixel_values):
        out = self.backbone(pixel_values=pixel_values)
        return self.classifier(out.last_hidden_state[:, 0, :]).squeeze(-1)

class ContextBinaryClassifier(nn.Module):
    """Two-headed context-aware classifier.
    Head 1 (Star Predictor): image_embedding → predicted star rating (0-5)
    Head 2 (Keep/Delete):    image_embedding + star_rating → keep/delete logit
    Training: both heads train simultaneously with real star ratings from DB.
    Inference: Head 1 runs first on a batch → average → feeds into Head 2.
    """
    def __init__(self, backbone_name='facebook/dinov2-large', quantize=False):
        super().__init__()
        if quantize:
            tlog(f"  💎 Loading backbone in 8-bit quantization...")
            self.backbone = AutoModel.from_pretrained(backbone_name, load_in_8bit=True, device_map="auto")
        else:
            self.backbone = AutoModel.from_pretrained(backbone_name)
        hs = self.backbone.config.hidden_size
        # Head 1: Star Predictor (image → star rating 0-5)
        self.star_head = nn.Sequential(
            nn.Linear(hs, 256), nn.ReLU(), nn.Dropout(0.2), nn.Linear(256, 1)
        )
        nn.init.zeros_(self.star_head[-1].bias)
        # Head 2: Keep/Delete (image + normalized star rating → logit)
        self.action_head = nn.Sequential(
            nn.Linear(hs + 1, 512), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(512, 256), nn.ReLU(), nn.Linear(256, 1)
        )
        nn.init.zeros_(self.action_head[-1].bias)
    def freeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = False
    def unfreeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = True
    def _backbone_cls(self, pixel_values):
        """Shared backbone forward — returns CLS token."""
        out = self.backbone(pixel_values=pixel_values)
        return out.last_hidden_state[:, 0, :]
    def forward(self, pixel_values, star_rating):
        """Full forward: returns (predicted_stars, action_logit).
        star_rating: ground-truth stars used as input to Head 2 during training."""
        cls = self._backbone_cls(pixel_values)
        predicted_stars = torch.clamp(self.star_head(cls).squeeze(-1), 0.0, 5.0)
        star_norm = (star_rating / 5.0).view(-1, 1)
        combined = torch.cat([cls, star_norm], dim=1)
        action_logit = self.action_head(combined).squeeze(-1)
        return predicted_stars, action_logit
    def predict_stars(self, pixel_values):
        """Head 1 only — predict star rating per image (inference Pass 1)."""
        cls = self._backbone_cls(pixel_values)
        return torch.clamp(self.star_head(cls).squeeze(-1), 0.0, 5.0)
    def classify_with_stars(self, pixel_values, star_rating):
        """Head 2 only — keep/delete given a known star rating (inference Pass 2)."""
        cls = self._backbone_cls(pixel_values)
        star_norm = (star_rating / 5.0).view(-1, 1)
        combined = torch.cat([cls, star_norm], dim=1)
        return self.action_head(combined).squeeze(-1)


class AgentOfTasteModel(nn.Module):
    """Multi-head model: aesthetic + preference + action heads."""
    def __init__(self, backbone_name='facebook/dinov2-large', num_performers=100):
        super().__init__()
        self.backbone = AutoModel.from_pretrained(backbone_name)
        hs = self.backbone.config.hidden_size
        self.performer_embed = nn.Embedding(num_performers + 1, 128)  # +1 for unknown
        # Aesthetic head (image quality 0-1)
        self.aesthetic_head = nn.Sequential(
            nn.Linear(hs, 256), nn.ReLU(), nn.Dropout(0.2), nn.Linear(256, 1), nn.Sigmoid()
        )
        # Preference head (performer sentiment 0-1)
        self.preference_head = nn.Sequential(
            nn.Linear(hs + 128, 256), nn.ReLU(), nn.Dropout(0.2), nn.Linear(256, 1), nn.Sigmoid()
        )
        # Action head (keep/delete)
        self.action_head = nn.Sequential(
            nn.Linear(hs + 128, 256), nn.ReLU(), nn.Dropout(0.3), nn.Linear(256, 1)
        )
    def freeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = False
    def unfreeze_backbone(self):
        for p in self.backbone.parameters(): p.requires_grad = True
    def forward(self, pixel_values, performer_ids=None):
        out = self.backbone(pixel_values=pixel_values)
        cls = out.last_hidden_state[:, 0, :]
        aesthetic = self.aesthetic_head(cls)
        if performer_ids is not None:
            perf_emb = self.performer_embed(performer_ids)
        else:
            perf_emb = torch.zeros(cls.size(0), 128, device=cls.device)
        combined = torch.cat([cls, perf_emb], dim=1)
        preference = self.preference_head(combined)
        action = self.action_head(combined)
        return aesthetic.squeeze(-1), preference.squeeze(-1), action.squeeze(-1)

# ── Helpers ──────────────────────────────────────────────────────────────────

def resolve_path(p):
    """Attempt to find an image path, falling back to local training_data if absolute path fails."""
    if not p: return None
    pth = Path(p)
    if pth.exists(): return str(pth)
    
    # Fallback: try to find it in the local training_data folder
    # Usually images are pushed as training_data/keep/performer/file.jpg 
    # We try to match the last parts: performer/file.jpg
    parts = pth.parts
    if len(parts) >= 2:
        filename = parts[-1]
        performer = parts[-2]
        if performer == 'pics' and len(parts) >= 3:
            performer = parts[-3]
        
        # Check both local subfolders
        local_root = Path(__file__).parent / 'training_data'
        for cat in ['keep', 'delete']:
            # Try performer subfolder
            p_path = local_root / cat / performer / filename
            if p_path.exists(): return str(p_path)
            # Try flat
            f_path = local_root / cat / filename
            if f_path.exists(): return str(f_path)
    
    return None

class BinaryDataset(Dataset):
    def __init__(self, keep_imgs, delete_imgs, processor, augment=True, deduplicate=False):
        self.processor = processor
        self.augment = augment
        samples = [(p, 1.0) for p in keep_imgs] + [(p, 0.0) for p in delete_imgs]
        if deduplicate:
            # Deduplicate by path
            d = {p: l for p, l in samples}
            self.samples = list(d.items())
        else:
            self.samples = samples
        random.shuffle(self.samples)
        self.aug_t = T.Compose([
            T.RandomHorizontalFlip(0.5),
            T.RandomResizedCrop(224, scale=(0.85, 1.0)),
            T.ColorJitter(0.08, 0.08, 0.05, 0.02),
        ])
    def __len__(self): return len(self.samples)
    def __getitem__(self, idx):
        path, label = self.samples[idx]
        try: img = Image.open(path).convert('RGB')
        except: return self.__getitem__((idx+1) % len(self))
        if self.augment: img = self.aug_t(img)
        inp = self.processor(images=img, return_tensors='pt')
        return {'pixel_values': inp['pixel_values'].squeeze(0),
                'label': torch.tensor(label, dtype=torch.float32),
                'path': path}

class PairwiseDataset(Dataset):
    """Pairs are either (winner_path, loser_path) — plain pairwise —
    or (winner_path, rank_w, loser_path, rank_l) — rank-conditioned siamese.
    When ranks are present, the batch also yields rank_winner / rank_loser tensors.
    """
    def __init__(self, pairs, processor, augment=True, deduplicate=False):
        self.has_ranks = len(pairs) > 0 and len(pairs[0]) == 4
        resolved_pairs = []
        for tup in pairs:
            if self.has_ranks:
                w, rw_, l, rl_ = tup
                rw = resolve_path(w)
                rl = resolve_path(l)
                if rw and rl:
                    resolved_pairs.append((rw, float(rw_), rl, float(rl_)))
            else:
                w, l = tup
                rw = resolve_path(w)
                rl = resolve_path(l)
                if rw and rl:
                    resolved_pairs.append((rw, rl))

        if deduplicate:
            resolved_pairs = list(set(resolved_pairs))

        self.pairs = resolved_pairs
        self.processor = processor
        self.augment = augment
        # Pre-resize to 224 in the dataset so the processor doesn't have to decode
        # and downsample full-resolution JPEGs every step — major perf win for siamese.
        self.aug_t = T.Compose([
            T.RandomHorizontalFlip(0.5),
            T.RandomResizedCrop(224, scale=(0.85, 1.0)),
            T.ColorJitter(0.1, 0.1, 0.1, 0.05),
        ])

    def __len__(self): return len(self.pairs)
    def __getitem__(self, idx):
        tup = self.pairs[idx]
        if self.has_ranks:
            w, rw_, l, rl_ = tup
        else:
            w, l = tup
        try:
            wimg = Image.open(w).convert('RGB')
            limg = Image.open(l).convert('RGB')
        except: return self.__getitem__((idx+1) % len(self))
        if self.augment:
            wimg, limg = self.aug_t(wimg), self.aug_t(limg)
        wi = self.processor(images=wimg, return_tensors='pt')
        li = self.processor(images=limg, return_tensors='pt')
        out = {'winner': wi['pixel_values'].squeeze(0),
               'loser': li['pixel_values'].squeeze(0),
               'idx': idx}
        if self.has_ranks:
            out['rank_winner'] = torch.tensor(rw_, dtype=torch.float32)
            out['rank_loser'] = torch.tensor(rl_, dtype=torch.float32)
        return out

# ── Training Functions ───────────────────────────────────────────────────────

def train_binary(config):
    """Train binary keep/delete classifier."""
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    bs = config.get('batch_size', 16)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    base_path = config.get('base_path', '')
    use_cached = config.get('use_cached', False)

    tlog(f"📋 Binary Training | {epochs} epochs | backbone: {backbone}")

    if use_cached or Path(os.path.join(base_path, 'keep')).exists():
        keep_dir = os.path.join(base_path, 'keep')
        delete_dir = os.path.join(base_path, 'delete')
    else:
        keep_dir = os.path.join(base_path, 'after filter performer')
        delete_dir = os.path.join(base_path, 'deleted keep for training')

    def scan_images(dir_path):
        paths = []
        if not os.path.exists(dir_path): return paths
        for root, _, files in os.walk(dir_path):
            for f in files:
                if Path(f).suffix.lower() in IMAGE_EXTS:
                    paths.append(os.path.join(root, f))
        return paths

    base_keep = scan_images(keep_dir)
    base_delete = scan_images(delete_dir)

    # Performer-held-out split: group images by performer, then split the
    # PERFORMER list. Prevents the model from cheating by memorizing
    # "this performer = always keep" — the val set is now performers it
    # has literally never seen.
    all_performers = sorted(set(performer_from_path(p) for p in base_keep + base_delete))
    train_performers, val_performers = split_performers(all_performers, val_frac=0.15)
    train_set = set(train_performers)
    val_set = set(val_performers)
    tlog(f"  🎭 Performer split: {len(train_performers)} train / {len(val_performers)} val (holdout)")

    train_keep = [p for p in base_keep if performer_from_path(p) in train_set]
    train_delete = [p for p in base_delete if performer_from_path(p) in train_set]
    val_keep = [p for p in base_keep if performer_from_path(p) in val_set]
    val_delete = [p for p in base_delete if performer_from_path(p) in val_set]

    # Integrate Human Corrections (Hard Examples) — always train, never val.
    hard_examples = config.get('hard_examples', [])
    hard_keep = []
    hard_delete = []
    if config.get('use_hard_examples', True) and hard_examples:
        tlog(f"  🧠 Integrating {len(hard_examples)} human corrections (Hard Examples)")
        mult = config.get('mining_multiplier', 4)
        for h in hard_examples:
            p = resolve_path(h['file_path'])
            if not p: continue
            for _ in range(mult):
                if h['corrected_label'] == 'keep': hard_keep.append(p)
                else: hard_delete.append(p)
    train_keep += hard_keep
    train_delete += hard_delete

    config['_keep_count'] = len(train_keep) + len(val_keep)
    config['_delete_count'] = len(train_delete) + len(val_delete)
    tlog(f"  📊 Train: Keep={len(train_keep)}, Delete={len(train_delete)} | Val: Keep={len(val_keep)}, Delete={len(val_delete)}")

    if not train_keep or not train_delete:
        raise ValueError("Need both keep and delete images in train split")
    if not val_keep or not val_delete:
        tlog("  ⚠️ Val split missing one class — val_acc will be unreliable")

    processor = AutoImageProcessor.from_pretrained(backbone)

    # Mining setup
    mining_pool = [] # list of (path, label)
    mining_mult = config.get('mining_multiplier', 4)

    # Build the train base dataset once (its sample list drives per-epoch
    # mining rebuilds). Val dataset is built from val performers only.
    train_ds_base = BinaryDataset(train_keep, train_delete, processor, deduplicate=config.get('deduplicate', False))
    val_ds = BinaryDataset(val_keep, val_delete, processor, augment=False, deduplicate=False) if (val_keep and val_delete) else None

    val_loader = DataLoader(val_ds, batch_size=bs, num_workers=0) if val_ds is not None else None
    model = BinaryClassifier(backbone_name=backbone, quantize=quantize).to(device)
    if not quantize: model.freeze_backbone()
    criterion = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW(model.classifier.parameters(), lr=1e-3)
    best_acc = 0.0
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'binary_filtering_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)

    for epoch in range(1, epochs + 1):
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Starting Fine-tuning (unfreezing backbone) at epoch {epoch}")
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.classifier.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])
        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'

        # Create loader for this epoch (potentially with mining pool)
        current_keep = [s[0] for s in train_ds_base.samples if s[1] == 1.0]
        current_delete = [s[0] for s in train_ds_base.samples if s[1] == 0.0]

        if config.get('enable_mining') and mining_pool:
            tlog(f"  ⛏️ Mining: adding {len(mining_pool)} previous failures (x{mining_mult})")
            for p, l in mining_pool:
                for _ in range(mining_mult):
                    if l == 1.0: current_keep.append(p)
                    else: current_delete.append(p)
        
        train_ds = BinaryDataset(current_keep, current_delete, processor, augment=True, deduplicate=False)
        train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, num_workers=0)
        num_batches = len(train_loader)
        training_state['total_batches'] = num_batches

        model.train()
        total_loss = correct = total = 0
        new_mining_pool = set()

        for bi, batch in enumerate(train_loader, 1):
            pv = batch['pixel_values'].to(device)
            labels = batch['label'].to(device)
            optimizer.zero_grad()
            
            if scaler:
                with torch.amp.autocast('cuda'):
                    logits = model(pv); loss = criterion(logits, labels)
                scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            else:
                logits = model(pv); loss = criterion(logits, labels)
                loss.backward(); optimizer.step()
                
            total_loss += loss.item()
            preds = (torch.sigmoid(logits) > 0.5).float()
            correct += (preds == labels).sum().item()
            total += labels.size(0)
            
            if config.get('enable_mining'):
                failed = (preds != labels)
                for i in range(failed.size(0)):
                    if failed[i]:
                        new_mining_pool.add((batch['path'][i], labels[i].item()))

            # Update batch progress
            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / bi
            training_state['train_acc'] = correct / max(total, 1)

        if config.get('enable_mining'):
            mining_pool = list(new_mining_pool)
            if mining_pool:
                tlog(f"  🚩 Epoch {epoch} failures tracked: {len(mining_pool)}")

        # Validate on held-out performers
        if val_loader is not None:
            model.eval()
            vc = vt = 0
            with torch.no_grad():
                for batch in val_loader:
                    pv = batch['pixel_values'].to(device)
                    labels = batch['label'].to(device)
                    logits = model(pv)
                    vc += ((torch.sigmoid(logits) > 0.5).float() == labels).sum().item()
                    vt += labels.size(0)
            val_acc = vc / max(vt, 1)
        else:
            val_acc = 0.0
        train_acc = correct / max(total, 1)
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch, 'train_loss': total_loss / num_batches,
            'train_acc': round(train_acc, 4), 'val_acc': round(val_acc, 4)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Train: {train_acc:.1%} | Val (held-out): {val_acc:.1%}")

        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({'model_state_dict': model.state_dict(), 'val_acc': val_acc,
                        'backbone': backbone, 'model_type': 'binary',
                        'holdout_performers': val_performers,
                        'config': {'model_name': backbone, 'epochs': epochs, 'batch_size': bs}}, out_path)
            tlog(f"  ⭐ Saved best → {out_path.name} ({val_acc:.1%})")

        # Cleanup memory
        if device.type == 'cuda':
            torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': best_acc}


def train_pairwise(config):
    """Train pairwise preference model."""
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 10)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    bs = config.get('batch_size', 16)
    base_path = config.get('base_path', '')
    pairs = config.get('pairs', [])

    tlog(f"📋 Pairwise Training | {len(pairs)} pairs | {epochs} epochs")
    if len(pairs) < 10:
        raise ValueError(f"Need at least 10 pairs, got {len(pairs)}")

    def resolve(p):
        if not p: return p
        if Path(p).exists(): return str(p)
        if base_path:
            # Try direct relative to base_path
            alt = Path(base_path) / p
            if alt.exists(): return str(alt)
            # Try cleaning path (if it has backslashes or absolute parts from another system)
            p_clean = p.replace('\\', '/').split('/')
            if 'keep' in p_clean: p_clean = p_clean[p_clean.index('keep'):]
            elif 'delete' in p_clean: p_clean = p_clean[p_clean.index('delete'):]
            alt2 = Path(base_path) / '/'.join(p_clean)
            if alt2.exists(): return str(alt2)
        return p

    pair_tuples = [(resolve(p['winner']), resolve(p['loser'])) for p in pairs]
    
    processor = AutoImageProcessor.from_pretrained(backbone)
    full_ds = PairwiseDataset(pair_tuples, processor, deduplicate=False)
    tlog(f"  Valid pairs after path check: {len(full_ds)}")
    if len(full_ds) < 5:
        raise ValueError("Too few valid pairs (images not found)")

    vs = max(1, int(len(full_ds) * 0.15))
    train_ds_base, val_ds = random_split(full_ds, [len(full_ds)-vs, vs])
    val_loader = DataLoader(val_ds, batch_size=bs, num_workers=0)

    model = DinoV2PreferenceModel(model_name=backbone, freeze_backbone=not quantize, quantize=quantize).to(device)
    criterion = nn.MarginRankingLoss(margin=1.0)
    optimizer = torch.optim.AdamW(model.head.parameters(), lr=1e-3)
    best_acc = 0.0
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'pairwise_preference_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)

    mining_pool = [] # list of indices into train_ds_base
    mining_mult = config.get('mining_multiplier', 4)

    for epoch in range(1, epochs+1):
        # Create loader with mining pool
        current_pairs = [train_ds_base.dataset.pairs[i] for i in train_ds_base.indices]
        if config.get('enable_mining') and mining_pool:
            tlog(f"  ⛏️ Mining: adding {len(mining_pool)} previous failures (x{mining_mult})")
            for pair in mining_pool:
                for _ in range(mining_mult):
                    current_pairs.append(pair)

        train_ds = PairwiseDataset(current_pairs, processor, augment=True, deduplicate=False)
        train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, num_workers=0)
        num_batches = len(train_loader)
        training_state['total_batches'] = num_batches

        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Starting Fine-tuning (unfreezing backbone) at epoch {epoch}")
            for p in model.backbone.parameters(): p.requires_grad = True
            optimizer = torch.optim.AdamW([
                {'params': model.head.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])
        
        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'
        
        model.train()
        total_loss = 0
        new_mining_pool = set()

        for bi, batch in enumerate(train_loader, 1):
            w = batch['winner'].to(device)
            l = batch['loser'].to(device)
            optimizer.zero_grad()
            sw, sl = model(w, l)
            target = torch.ones(sw.size(0), device=device)
            loss = criterion(sw, sl, target)
            loss.backward(); optimizer.step()
            total_loss += loss.item()
            
            if config.get('enable_mining'):
                failed = (sw <= sl).squeeze()
                if failed.dim() == 0: failed = failed.unsqueeze(0)
                for i in range(failed.size(0)):
                    if failed[i] and 'idx' in batch:
                        new_mining_pool.add(tuple(current_pairs[batch['idx'][i].item()]))

            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / bi

        if config.get('enable_mining'):
            mining_pool = list(new_mining_pool)
            if mining_pool:
                tlog(f"  🚩 Epoch {epoch} failures tracked: {len(mining_pool)}")
        # Validate
        model.eval()
        correct = total = 0
        with torch.no_grad():
            for batch in val_loader:
                w = batch['winner'].to(device)
                l = batch['loser'].to(device)
                sw, sl = model(w, l)
                correct += (sw > sl).sum().item()
                total += sw.size(0)
        val_acc = correct / max(total, 1)
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch, 'train_loss': total_loss / num_batches, 'val_acc': round(val_acc, 4)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Loss: {total_loss/num_batches:.4f} | Val Acc: {val_acc:.1%}")
        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({'model_state_dict': model.state_dict(), 'val_acc': val_acc,
                        'backbone': backbone, 'model_type': 'pairwise',
                        'config': {'model_name': backbone, 'epochs': epochs, 'batch_size': bs}}, out_path)
            tlog(f"  ⭐ Saved best → {out_path.name}")

        # Cleanup memory
        if device.type == 'cuda':
            torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': best_acc}


def train_context_binary(config):
    """Train context-aware binary classifier with star rating heads.
    Head 1 learns to predict performer star ratings from images.
    Head 2 learns keep/delete decisions contextualized by star rating.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    bs = config.get('batch_size', 16)
    base_path = config.get('base_path', '')
    use_cached = config.get('use_cached', False)

    tlog(f"📋 Context-Aware Binary Training | {epochs} epochs | backbone: {backbone}")

    # 1. Resolve directories
    if use_cached or Path(os.path.join(base_path, 'keep')).exists():
        keep_map = scan_performer_dirs(os.path.join(base_path, 'keep'))
        delete_map = scan_performer_dirs(os.path.join(base_path, 'delete'))
        tlog("  📂 Using cached training data layout")
    else:
        keep_map = scan_performer_dirs(os.path.join(base_path, 'after filter performer'))
        delete_map = scan_performer_dirs(os.path.join(base_path, 'deleted keep for training'))
        tlog("  📂 Using local folder layout")
    tlog(f"  Keep performers: {len(keep_map)} | Delete performers: {len(delete_map)}")

    if not keep_map or not delete_map:
        raise ValueError("Need both keep and delete performer directories")

    # 2. Load performer star ratings from manifest or config
    star_ratings = config.get('performer_ratings', {})
    manifest_path = Path(base_path) / 'manifest.json'
    if not star_ratings and manifest_path.exists():
        try:
            # Use utf-8 explicitly to avoid encoding issues on Windows
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            star_ratings = manifest.get('performer_ratings', {})
            tlog(f"  ⭐ Loaded {len(star_ratings)} star ratings from manifest")
        except Exception as e:
            tlog(f"  ⚠️ Failed to load manifest.json: {e}")
    elif not star_ratings:
        tlog(f"  ℹ️ No manifest.json found at {manifest_path}")

    # 3. Normalize star_ratings keys for case-insensitive lookup
    # This handles discrepancies between folder names and manifest keys
    star_ratings_norm = {k.lower().strip(): v for k, v in star_ratings.items()}
    
    # Default unknown performers to 2.5 (neutral)
    all_performers = set(list(keep_map.keys()) + list(delete_map.keys()))
    final_ratings = {}
    for p in all_performers:
        p_norm = p.lower().strip()
        if p_norm in star_ratings_norm:
            final_ratings[p] = star_ratings_norm[p_norm]
        else:
            final_ratings[p] = 2.5
    
    star_ratings = final_ratings
    rated_count = sum(1 for v in star_ratings.values() if v != 2.5)
    tlog(f"  Performers with real ratings: {rated_count}/{len(all_performers)}")

    # 4. Build dataset
    processor = AutoImageProcessor.from_pretrained(backbone)
    all_samples = []  # (path, performer_name, star_rating, label)
    for perf, imgs in keep_map.items():
        stars = star_ratings.get(perf, 2.5)
        for p in imgs: all_samples.append((p, perf, stars, 1.0))
    for perf, imgs in delete_map.items():
        stars = star_ratings.get(perf, 2.5)
        for p in imgs: all_samples.append((p, perf, stars, 0.0))
    random.shuffle(all_samples)
    tlog(f"  Total samples: {len(all_samples)}")

    class CtxDS(Dataset):
        def __init__(self, samples):
            self.samples = samples
            self.aug = T.Compose([T.RandomHorizontalFlip(0.5),
                                  T.RandomResizedCrop(224, scale=(0.85, 1.0)),
                                  T.ColorJitter(0.08, 0.08, 0.05, 0.02)])
        def __len__(self): return len(self.samples)
        def __getitem__(self, idx):
            path, perf, stars, label = self.samples[idx]
            try: img = Image.open(path).convert('RGB')
            except: return self.__getitem__((idx+1) % len(self))
            img = self.aug(img)
            inp = processor(images=img, return_tensors='pt')
            return {'pixel_values': inp['pixel_values'].squeeze(0),
                    'star_rating': torch.tensor(stars, dtype=torch.float32),
                    'label': torch.tensor(label, dtype=torch.float32)}

    ds = CtxDS(all_samples)
    vs = max(1, int(len(ds) * 0.15))
    train_ds, val_ds = random_split(ds, [len(ds)-vs, vs])
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=bs, num_workers=0)

    # 4. Model setup
    model = ContextBinaryClassifier(backbone, quantize=quantize).to(device)
    if not quantize: model.freeze_backbone()
    criterion_stars = nn.MSELoss()
    criterion_action = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW([
        {'params': model.star_head.parameters(), 'lr': 1e-3},
        {'params': model.action_head.parameters(), 'lr': 1e-3},
    ])
    best_acc = 0.0
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'context_binary_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)

    # 5. Training loop
    for epoch in range(1, epochs+1):
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Starting Fine-tuning (unfreezing backbone) at epoch {epoch}")
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.star_head.parameters(), 'lr': 1e-3},
                {'params': model.action_head.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5},
            ])
        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'
        model.train()
        total_loss = correct = total = 0
        star_loss_sum = action_loss_sum = 0
        num_batches = len(train_loader)
        training_state['total_batches'] = num_batches

        for bi, batch in enumerate(train_loader, 1):
            pv = batch['pixel_values'].to(device)
            stars_gt = batch['star_rating'].to(device)
            labels = batch['label'].to(device)
            optimizer.zero_grad()

            if scaler:
                with torch.amp.autocast('cuda'):
                    pred_stars, action_logit = model(pv, stars_gt)
                    loss_s = criterion_stars(pred_stars, stars_gt)
                    loss_a = criterion_action(action_logit, labels)
                    loss = loss_s + loss_a
                scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            else:
                pred_stars, action_logit = model(pv, stars_gt)
                loss_s = criterion_stars(pred_stars, stars_gt)
                loss_a = criterion_action(action_logit, labels)
                loss = loss_s + loss_a
                loss.backward(); optimizer.step()

            total_loss += loss.item()
            star_loss_sum += loss_s.item()
            action_loss_sum += loss_a.item()
            correct += ((torch.sigmoid(action_logit) > 0.5).float() == labels).sum().item()
            total += labels.size(0)
            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / bi
            training_state['train_acc'] = correct / max(total, 1)

        # Validate
        model.eval()
        vc = vt = 0
        val_star_err = val_star_n = 0
        with torch.no_grad():
            for batch in val_loader:
                pv = batch['pixel_values'].to(device)
                stars_gt = batch['star_rating'].to(device)
                labels = batch['label'].to(device)
                pred_stars, action_logit = model(pv, stars_gt)
                vc += ((torch.sigmoid(action_logit) > 0.5).float() == labels).sum().item()
                vt += labels.size(0)
                val_star_err += (pred_stars - stars_gt).abs().sum().item()
                val_star_n += stars_gt.size(0)

        val_acc = vc / max(vt, 1)
        val_mae = val_star_err / max(val_star_n, 1)
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch, 'train_loss': total_loss / num_batches,
            'star_loss': round(star_loss_sum / num_batches, 4),
            'action_loss': round(action_loss_sum / num_batches, 4),
            'train_acc': round(correct / max(total, 1), 4),
            'val_acc': round(val_acc, 4),
            'val_star_mae': round(val_mae, 3)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Val Acc: {val_acc:.1%} | Star MAE: {val_mae:.2f}")

        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({
                'model_state_dict': model.state_dict(),
                'val_acc': val_acc,
                'val_star_mae': val_mae,
                'backbone': backbone,
                'model_type': 'context_binary',
                'performer_ratings': star_ratings,
                'config': {'model_name': backbone, 'epochs': epochs, 'batch_size': bs}
            }, out_path)
            tlog(f"  ⭐ Saved → {out_path.name} ({val_acc:.1%})")

    return {'model': str(out_path.name), 'best_val_acc': best_acc}


def train_siamese_binary(config):
    """Train a Siamese Pairwise Ranker using synthetic Keep > Delete pairs.
    Instead of needing manual pairwise labels, it dynamically samples
    random (keep_image, delete_image) pairs from the binary training folders
    each epoch. This creates a bimodal score distribution ideal for
    triple-zone inference (confident keep / uncertain / confident delete).
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    bs = config.get('batch_size', 16)
    base_path = config.get('base_path', '')
    use_cached = config.get('use_cached', False)
    synthetic_pairs_per_epoch = config.get('synthetic_pairs_per_epoch', 500)
    per_performer = config.get('per_performer_pairs', False)

    mode_label = f"{synthetic_pairs_per_epoch} pairs/performer" if per_performer else f"{synthetic_pairs_per_epoch} pairs total"
    tlog(f"📋 Siamese Binary Training | {epochs} epochs | {mode_label} | backbone: {backbone}")

    # Resolve keep/delete dirs (same as binary)
    if use_cached or Path(os.path.join(base_path, 'keep')).exists():
        keep_dir = os.path.join(base_path, 'keep')
        delete_dir = os.path.join(base_path, 'delete')
    else:
        keep_dir = os.path.join(base_path, 'after filter performer')
        delete_dir = os.path.join(base_path, 'deleted keep for training')

    def scan_images(dir_path):
        paths = []
        if not os.path.exists(dir_path): return paths
        for root, _, files in os.walk(dir_path):
            for f in files:
                if Path(f).suffix.lower() in IMAGE_EXTS:
                    paths.append(os.path.join(root, f))
        return paths

    keep_imgs = scan_images(keep_dir)
    delete_imgs = scan_images(delete_dir)
    tlog(f"  📊 Found: {len(keep_imgs)} keep, {len(delete_imgs)} delete images")
    config['_keep_count'] = len(keep_imgs)
    config['_delete_count'] = len(delete_imgs)

    if not keep_imgs or not delete_imgs:
        raise ValueError("Need both keep and delete images for Siamese Binary training")

    # Build per-performer lookup for balanced sampling
    def group_by_performer(img_list):
        """Group image paths by their immediate parent folder (= performer name)."""
        groups = {}
        for p in img_list:
            perf = Path(p).parent.name
            # If parent is 'pics', go one level up
            if perf == 'pics':
                perf = Path(p).parent.parent.name
            groups.setdefault(perf, []).append(p)
        return groups

    keep_by_perf = group_by_performer(keep_imgs)
    delete_by_perf = group_by_performer(delete_imgs)
    all_performers = sorted(set(list(keep_by_perf.keys()) + list(delete_by_perf.keys())))

    # Performer-held-out split. Train pools = only train performers' images;
    # val pairs are synthesized from val performers only.
    train_performers, val_performers = split_performers(all_performers, val_frac=0.15)
    train_set = set(train_performers); val_set = set(val_performers)
    keep_by_perf_train = {p: keep_by_perf[p] for p in train_set if p in keep_by_perf}
    delete_by_perf_train = {p: delete_by_perf[p] for p in train_set if p in delete_by_perf}
    keep_by_perf_val = {p: keep_by_perf[p] for p in val_set if p in keep_by_perf}
    delete_by_perf_val = {p: delete_by_perf[p] for p in val_set if p in delete_by_perf}
    keep_imgs_train = [p for perf, ps in keep_by_perf_train.items() for p in ps]
    delete_imgs_train = [p for perf, ps in delete_by_perf_train.items() for p in ps]
    tlog(f"  🎭 Performer split: {len(train_performers)} train / {len(val_performers)} val (holdout)")
    tlog(f"  👤 Performers: {len(all_performers)} | Mode: {'Per-Performer' if per_performer else 'Global'}")
    if per_performer:
        perf_both_train = [p for p in train_set if p in keep_by_perf and p in delete_by_perf]
        tlog(f"  📐 Total pairs/epoch: ~{synthetic_pairs_per_epoch} × {len(perf_both_train)} = {synthetic_pairs_per_epoch * len(perf_both_train)}")

    if not keep_imgs_train or not delete_imgs_train:
        raise ValueError("Training pool empty after performer split — too few performers?")

    processor = AutoImageProcessor.from_pretrained(backbone)
    model = DinoV2PreferenceModel(model_name=backbone, freeze_backbone=not quantize, quantize=quantize).to(device)
    criterion = nn.MarginRankingLoss(margin=1.0)
    optimizer = torch.optim.AdamW(model.head.parameters(), lr=1e-3)
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    best_acc = 0.0
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'siamese_binary_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)
    mining_pool = []
    mining_mult = config.get('mining_multiplier', 4)

    # Build a stable val pair set from held-out performers. Reused every epoch.
    val_pairs = []
    perf_both_val = [p for p in val_set if p in keep_by_perf_val and p in delete_by_perf_val]
    val_pairs_per_perf = min(50, synthetic_pairs_per_epoch)
    for perf in perf_both_val:
        p_keep = keep_by_perf_val[perf]
        p_del = delete_by_perf_val[perf]
        n = min(val_pairs_per_perf, len(p_keep) * len(p_del))
        for _ in range(n):
            val_pairs.append((random.choice(p_keep), random.choice(p_del)))
    val_ds = PairwiseDataset(val_pairs, processor, augment=False, deduplicate=False) if val_pairs else None
    val_loader_ep = DataLoader(val_ds, batch_size=bs, num_workers=0) if val_ds is not None else None
    tlog(f"  🧪 Val pair set: {len(val_pairs)} pairs from {len(perf_both_val)} held-out performers")

    for epoch in range(1, epochs + 1):
        # Unfreeze backbone after warmup
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Starting Fine-tuning (unfreezing backbone) at epoch {epoch}")
            for p in model.backbone.parameters(): p.requires_grad = True
            optimizer = torch.optim.AdamW([
                {'params': model.head.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])

        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'

        # ── Sample synthetic pairs from TRAIN performers only ──────────
        pairs = []
        if per_performer:
            performers_with_both = [p for p in train_set if p in keep_by_perf_train and p in delete_by_perf_train]
            if epoch == 1:
                tlog(f"  🎯 Siamese Mode: Strictly Per-Performer ({len(performers_with_both)} train performers with both sides)")

            for perf in performers_with_both:
                p_keep = keep_by_perf_train[perf]
                p_del  = delete_by_perf_train[perf]
                n = min(synthetic_pairs_per_epoch, len(p_keep) * len(p_del))
                for _ in range(n):
                    pairs.append((random.choice(p_keep), random.choice(p_del)))
        else:
            # Global: random draw from the train pool only
            n = min(synthetic_pairs_per_epoch, len(keep_imgs_train) * len(delete_imgs_train))
            for _ in range(n):
                pairs.append((random.choice(keep_imgs_train), random.choice(delete_imgs_train)))

        # Add mining failures from previous epoch
        if config.get('enable_mining') and mining_pool:
            tlog(f"  ⛏️ Mining: adding {len(mining_pool)} failures (x{mining_mult})")
            for pair in mining_pool:
                for _ in range(mining_mult):
                    pairs.append(pair)

        train_ds = PairwiseDataset(pairs, processor, augment=True, deduplicate=False)
        train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, num_workers=0)
        num_batches = len(train_loader)
        training_state['total_batches'] = num_batches

        model.train()
        total_loss = 0
        new_mining_pool = set()

        for bi, batch in enumerate(train_loader, 1):
            w = batch['winner'].to(device)
            l = batch['loser'].to(device)
            optimizer.zero_grad()

            if scaler:
                with torch.amp.autocast('cuda'):
                    sw, sl = model(w, l)
                    target = torch.ones(sw.size(0), device=device)
                    loss = criterion(sw, sl, target)
                scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            else:
                sw, sl = model(w, l)
                target = torch.ones(sw.size(0), device=device)
                loss = criterion(sw, sl, target)
                loss.backward(); optimizer.step()

            total_loss += loss.item()

            if config.get('enable_mining'):
                failed = (sw <= sl).squeeze()
                if failed.dim() == 0: failed = failed.unsqueeze(0)
                for i in range(failed.size(0)):
                    if failed[i]:
                        idx = batch['idx'][i].item()
                        if idx < len(pairs):
                            new_mining_pool.add(tuple(pairs[idx]))

            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / bi

        if config.get('enable_mining'):
            mining_pool = list(new_mining_pool)
            if mining_pool:
                tlog(f"  🚩 Failures tracked: {len(mining_pool)}")

        # Validate on held-out performer pair set
        if val_loader_ep is not None:
            model.eval()
            correct = total = 0
            with torch.no_grad():
                for batch in val_loader_ep:
                    w = batch['winner'].to(device)
                    l = batch['loser'].to(device)
                    sw, sl = model(w, l)
                    correct += (sw > sl).sum().item()
                    total += sw.size(0)
            val_acc = correct / max(total, 1)
        else:
            val_acc = 0.0
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch,
            'train_loss': total_loss / max(num_batches, 1),
            'val_acc': round(val_acc, 4),
            'pairs_generated': len(pairs)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Loss: {total_loss/max(num_batches,1):.4f} | Val Acc (held-out): {val_acc:.1%} | Pairs: {len(pairs)}")

        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({
                'model_state_dict': model.state_dict(),
                'val_acc': val_acc,
                'backbone': backbone,
                'model_type': 'siamese_binary',
                'holdout_performers': val_performers,
                'config': {
                    'model_name': backbone,
                    'epochs': epochs,
                    'batch_size': bs,
                    'synthetic_pairs_per_epoch': synthetic_pairs_per_epoch
                }
            }, out_path)
            tlog(f"  ⭐ Saved best → {out_path.name} ({val_acc:.1%})")

        if device.type == 'cuda':
            torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': best_acc}


def train_rank_aware_siamese(config):
    """
    Trains a Rank-Aware Siamese model that takes (Image + Performer Rank) as input.
    """
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    bs = config.get('batch_size', 8)
    base_path = config.get('base_path', '')
    synthetic_pairs_per_epoch = config.get('synthetic_pairs_per_epoch', 500)
    
    tlog(f"📋 Rank-Aware Siamese Training | {epochs} epochs | backbone: {backbone}")

    # 1. Load Data
    keep_map = scan_performer_dirs(os.path.join(base_path, 'keep'))
    delete_map = scan_performer_dirs(os.path.join(base_path, 'delete'))
    tlog(f"  📂 Keep: {len(keep_map)} | Delete: {len(delete_map)} performers")

    # 2. Load star ratings
    star_ratings = config.get('performer_ratings', {})
    manifest_path = Path(base_path) / 'manifest.json'
    if not star_ratings and manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            star_ratings = manifest.get('performer_ratings', {})
            tlog(f"  ⭐ Loaded {len(star_ratings)} star ratings from manifest")
        except: pass
    
    # Normalize ratings keys
    star_ratings_norm = {k.lower().strip(): v for k, v in star_ratings.items()}

    # Strictly use performers with BOTH sides
    all_performers = sorted(set(keep_map.keys()) & set(delete_map.keys()))
    tlog(f"  🎯 Using {len(all_performers)} performers with both Keep & Delete data")
    
    if not all_performers:
        raise ValueError("No performers have both Keep and Delete images. Need intra-performer pairs.")

    # 3. Setup Model
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = RankAwareSiameseModel(model_name=backbone, freeze_backbone=True, quantize=quantize).to(device)
    
    criterion = nn.MarginRankingLoss(margin=1.0)
    optimizer = torch.optim.AdamW(
        list(model.rank_head.parameters()) + list(model.preference_head.parameters()), lr=1e-3
    )
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    
    best_acc = 0.0
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'rank_siamese_{backbone_short}_{timestamp}.pt'

    # Build transform once outside the batch loop — was being re-created per batch.
    transform = T.Compose([
        T.Resize((224,224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225])
    ])

    for epoch in range(1, epochs + 1):
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Starting Fine-tuning at epoch {epoch}")
            for p in model.backbone.parameters(): p.requires_grad = True
            optimizer = torch.optim.AdamW([
                {'params': list(model.rank_head.parameters()) + list(model.preference_head.parameters()), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])

        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'

        # Sample pairs with ratings
        pairs = [] # (img_a, rank_a, img_b, rank_b)
        for perf in all_performers:
            p_keep = keep_map[perf]
            p_del = delete_map[perf]
            rank = star_ratings_norm.get(perf.lower().strip(), 2.5)
            n = min(synthetic_pairs_per_epoch, len(p_keep) * len(p_del))
            for _ in range(n):
                pairs.append((random.choice(p_keep), rank, random.choice(p_del), rank))

        random.shuffle(pairs)

        # Training loop
        model.train()
        total_loss = 0
        correct = 0
        total = 0

        training_state['total_batches'] = (len(pairs) + bs - 1) // bs

        for i in range(0, len(pairs), bs):
            batch = pairs[i:i+bs]
            training_state['batch'] = (i // bs) + 1

            # Load images and ranks
            imgs_a = []
            ranks_a = []
            imgs_b = []
            ranks_b = []

            for path_a, r_a, path_b, r_b in batch:
                try:
                    imgs_a.append(transform(Image.open(path_a).convert('RGB')))
                    imgs_b.append(transform(Image.open(path_b).convert('RGB')))
                    ranks_a.append(float(r_a))
                    ranks_b.append(float(r_b))
                except: continue
            
            if not imgs_a: continue
            
            x_a = torch.stack(imgs_a).to(device)
            r_a = torch.tensor(ranks_a, dtype=torch.float32).to(device)
            x_b = torch.stack(imgs_b).to(device)
            r_b = torch.tensor(ranks_b, dtype=torch.float32).to(device)
            
            optimizer.zero_grad()
            
            with torch.amp.autocast('cuda', enabled=(scaler is not None)):
                # Rank Prediction Loss (Head 1)
                pred_r_a = model.predict_rank(x_a)
                pred_r_b = model.predict_rank(x_b)
                loss_rank = nn.functional.mse_loss(pred_r_a, r_a) + nn.functional.mse_loss(pred_r_b, r_b)
                
                # Preference Loss (Head 2)
                score_a, score_b = model(x_a, r_a, x_b, r_b)
                target = torch.ones(score_a.size(0)).to(device)
                loss_pref = criterion(score_a, score_b, target)
                
                # Combine losses
                loss = loss_pref + 0.5 * loss_rank
            
            if scaler:
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                optimizer.step()
                
            total_loss += loss.item()
            correct += (score_a > score_b).sum().item()
            total += score_a.size(0)
            
            training_state['train_loss'] = total_loss / (i // bs + 1)
            training_state['train_acc'] = correct / total if total > 0 else 0
            
        epoch_acc = correct / total if total > 0 else 0
        training_state['val_acc'] = epoch_acc
        training_state['epoch_history'].append({'epoch': epoch, 'loss': total_loss/max(1, training_state['total_batches']), 'acc': epoch_acc})
        
        if epoch_acc > best_acc:
            best_acc = epoch_acc
            training_state['best_val_acc'] = best_acc
            torch.save({
                'model_state_dict': model.state_dict(),
                'model_type': 'rank_aware_siamese',
                'backbone': backbone,
                'val_acc': best_acc,
                'config': config,
                'created_at': time.time()
            }, out_path)
            tlog(f"  ⭐ Epoch {epoch}: Loss {training_state['train_loss']:.4f}, Acc {epoch_acc:.1%} (New Best!)")
        else:
            tlog(f"  Epoch {epoch}: Loss {training_state['train_loss']:.4f}, Acc {epoch_acc:.1%}")

        if device.type == 'cuda':
            torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': best_acc}


# ── New Training Functions ──────────────────────────────────────────────────

def train_performer_ranker(config):
    """Train a standalone performer ranker: image → star rating regression.
    Uses ALL images (keep + delete) from rated performers.
    manifest.json star ratings are the ground-truth labels.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    bs = config.get('batch_size', 16)
    base_path = config.get('base_path', '')

    tlog(f"📋 Performer Ranker Training | {epochs} epochs | backbone: {backbone}")

    # 1. Load performer directories (both keep and delete)
    keep_map = scan_performer_dirs(os.path.join(base_path, 'keep'))
    delete_map = scan_performer_dirs(os.path.join(base_path, 'delete'))

    # 2. Load star ratings from manifest
    star_ratings = config.get('performer_ratings', {})
    manifest_path = Path(base_path) / 'manifest.json'
    if not star_ratings and manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            star_ratings = manifest.get('performer_ratings', {})
            tlog(f"  ⭐ Loaded {len(star_ratings)} star ratings from manifest")
        except Exception as e:
            tlog(f"  ⚠️ Failed to load manifest.json: {e}")

    if not star_ratings:
        raise ValueError("No performer ratings found. Need manifest.json with performer_ratings.")

    # Normalize keys for case-insensitive matching
    star_ratings_norm = {k.lower().strip(): v for k, v in star_ratings.items()}

    # Performer-held-out split among RATED performers only — unrated ones
    # can't contribute to either split because we'd have no label.
    all_performers_with_images = set(list(keep_map.keys()) + list(delete_map.keys()))
    rated_performers = sorted([p for p in all_performers_with_images
                               if p.lower().strip() in star_ratings_norm])
    train_performers, val_performers = split_performers(rated_performers, val_frac=0.15)
    train_set = set(train_performers); val_set = set(val_performers)
    tlog(f"  🎭 Performer split: {len(train_performers)} train / {len(val_performers)} val (holdout) from {len(rated_performers)} rated")

    def build_samples(performer_subset):
        out = []
        for perf in performer_subset:
            stars = star_ratings_norm[perf.lower().strip()]
            for p in keep_map.get(perf, []):
                out.append((p, stars))
            for p in delete_map.get(perf, []):
                out.append((p, stars))
        return out

    train_samples = build_samples(train_set)
    val_samples = build_samples(val_set)
    random.shuffle(train_samples)

    tlog(f"  📊 Train: {len(train_samples)} images | Val: {len(val_samples)} images")
    config['_keep_count'] = sum(len(v) for v in keep_map.values())
    config['_delete_count'] = sum(len(v) for v in delete_map.values())

    if len(train_samples) < 10:
        raise ValueError(f"Too few training samples ({len(train_samples)}) after performer split.")

    # 4. Dataset
    processor = AutoImageProcessor.from_pretrained(backbone)

    class RankerDS(Dataset):
        def __init__(self, samples, augment=True):
            self.samples = samples
            self.augment = augment
            self.aug = T.Compose([T.RandomHorizontalFlip(0.5),
                                  T.RandomResizedCrop(224, scale=(0.85, 1.0)),
                                  T.ColorJitter(0.08, 0.08, 0.05, 0.02)])
        def __len__(self): return len(self.samples)
        def __getitem__(self, idx):
            path, stars = self.samples[idx]
            try: img = Image.open(path).convert('RGB')
            except: return self.__getitem__((idx+1) % len(self))
            if self.augment:
                img = self.aug(img)
            inp = processor(images=img, return_tensors='pt')
            return {'pixel_values': inp['pixel_values'].squeeze(0),
                    'star_rating': torch.tensor(stars, dtype=torch.float32)}

    train_ds = RankerDS(train_samples, augment=True)
    val_ds = RankerDS(val_samples, augment=False) if val_samples else None
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=bs, num_workers=0) if val_ds is not None else None

    # 5. Model
    model = PerformerRankerModel(backbone, freeze_backbone=not quantize, quantize=quantize).to(device)
    if not quantize: model.freeze_backbone()
    criterion = nn.MSELoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW(model.rank_head.parameters(), lr=1e-3)
    best_mae = float('inf')
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'performer_ranker_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)

    for epoch in range(1, epochs+1):
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Unfreezing backbone at epoch {epoch}")
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.rank_head.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5},
            ])
        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'

        model.train()
        total_loss = 0
        num_batches = len(train_loader)
        training_state['total_batches'] = num_batches

        for bi, batch in enumerate(train_loader, 1):
            pv = batch['pixel_values'].to(device)
            stars_gt = batch['star_rating'].to(device)
            optimizer.zero_grad()

            if scaler:
                with torch.amp.autocast('cuda'):
                    pred = model(pv)
                    loss = criterion(pred, stars_gt)
                scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            else:
                pred = model(pv)
                loss = criterion(pred, stars_gt)
                loss.backward(); optimizer.step()

            total_loss += loss.item()
            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / bi

        # Validate on held-out performers
        if val_loader is not None:
            model.eval()
            val_err = val_n = 0
            with torch.no_grad():
                for batch in val_loader:
                    pv = batch['pixel_values'].to(device)
                    stars_gt = batch['star_rating'].to(device)
                    pred = model(pv)
                    val_err += (pred - stars_gt).abs().sum().item()
                    val_n += stars_gt.size(0)
            val_mae = val_err / max(val_n, 1)
        else:
            val_mae = float('inf')
        # Use inverse MAE as "accuracy" for the training state UI
        val_acc_proxy = max(0.0, 1.0 - val_mae / 5.0) if val_mae != float('inf') else 0.0
        training_state['val_acc'] = val_acc_proxy
        training_state['epoch_history'].append({
            'epoch': epoch, 'train_loss': total_loss / max(num_batches, 1),
            'val_mae': round(val_mae, 3) if val_mae != float('inf') else None,
            'val_acc_proxy': round(val_acc_proxy, 4)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Loss: {total_loss/max(num_batches,1):.4f} | Val MAE (held-out): {val_mae:.3f}")

        if val_mae < best_mae:
            best_mae = val_mae
            training_state['best_val_acc'] = val_acc_proxy
            torch.save({
                'model_state_dict': model.state_dict(),
                'val_mae': val_mae,
                'backbone': backbone,
                'model_type': 'performer_ranker',
                'performer_ratings': star_ratings,
                'holdout_performers': val_performers,
                'config': {'model_name': backbone, 'epochs': epochs, 'batch_size': bs},
                'created_at': time.time()
            }, out_path)
            tlog(f"  ⭐ Saved → {out_path.name} (MAE: {val_mae:.3f})")

        if device.type == 'cuda':
            torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': max(0, 1.0 - best_mae / 5.0)}


def train_performer_attention_ranker(config):
    """Train the gallery-level attention ranker.

    One training sample = (one performer's gallery, that performer's star rating).
    Each epoch resamples K images per performer (the augmentation).
    Loss is MSE, optionally weighted by the performer's comparison_count.

    Manifest fields read:
      - performer_ratings: {name: star}            (required)
      - performer_comparison_counts: {name: int}   (optional; enables weighting)
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 12)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    k_per_gallery = config.get('gallery_size', 32)
    attn_dropout = config.get('attn_dropout', 0.1)
    min_comparisons = config.get('min_comparisons', 2)
    base_path = config.get('base_path', '')

    tlog(f"📋 Attention Ranker | {epochs} epochs | K={k_per_gallery} | backbone: {backbone}")

    # 1. Gather images per performer
    keep_map = scan_performer_dirs(os.path.join(base_path, 'keep'))
    delete_map = scan_performer_dirs(os.path.join(base_path, 'delete'))

    # 2. Load star ratings + comparison counts from manifest
    star_ratings = config.get('performer_ratings', {})
    comparison_counts = config.get('performer_comparison_counts', {})
    manifest_path = Path(base_path) / 'manifest.json'
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            if not star_ratings:
                star_ratings = manifest.get('performer_ratings', {})
                tlog(f"  ⭐ Loaded {len(star_ratings)} star ratings from manifest")
            if not comparison_counts:
                comparison_counts = manifest.get('performer_comparison_counts', {})
                if comparison_counts:
                    tlog(f"  ⚖️ Loaded {len(comparison_counts)} comparison counts from manifest")
        except Exception as e:
            tlog(f"  ⚠️ Manifest read failed: {e}")

    if not star_ratings:
        raise ValueError("No performer ratings found. Need manifest.json with performer_ratings.")

    star_ratings_norm = {k.lower().strip(): v for k, v in star_ratings.items()}
    comparison_counts_norm = {k.lower().strip(): v for k, v in comparison_counts.items()}

    # 3. Build per-performer image lists
    performer_to_images = {}
    performer_to_target = {}
    performer_to_weight = {}
    skipped_low_data = 0
    all_performers = set(list(keep_map.keys()) + list(delete_map.keys()))

    for perf in all_performers:
        perf_key = perf.lower().strip()
        if perf_key not in star_ratings_norm:
            continue
        stars = star_ratings_norm[perf_key]
        n_comparisons = comparison_counts_norm.get(perf_key, None)

        # Hard floor: skip undertrained ratings IF comparison data exists
        if n_comparisons is not None and n_comparisons < min_comparisons:
            skipped_low_data += 1
            continue

        images = list(keep_map.get(perf, [])) + list(delete_map.get(perf, []))
        if len(images) < 2:
            continue  # need at least 2 to learn anything from a gallery

        performer_to_images[perf] = images
        performer_to_target[perf] = float(stars)
        # Soft weighting: cap at 1.0, ramps up linearly to 10 comparisons.
        # If counts aren't provided, everyone gets weight 1.0.
        if n_comparisons is None:
            performer_to_weight[perf] = 1.0
        else:
            performer_to_weight[perf] = min(n_comparisons / 10.0, 1.0)

    n_performers = len(performer_to_images)
    tlog(f"  📊 {n_performers} performers (skipped {skipped_low_data} with < {min_comparisons} comparisons)")
    if n_performers < 5:
        raise ValueError(f"Too few rated performers ({n_performers}). Need at least 5 with images.")

    # Side-channel for history saving
    config['_keep_count'] = sum(len(v) for v in keep_map.values())
    config['_delete_count'] = sum(len(v) for v in delete_map.values())

    # 4. Performer-level train/val split — deterministic, shared across trainers
    train_names, val_names_list = split_performers(
        list(performer_to_images.keys()), val_frac=0.15
    )
    val_names = set(val_names_list)
    tlog(f"  🎭 Performer split: {len(train_names)} train / {len(val_names)} val (holdout)")

    processor = AutoImageProcessor.from_pretrained(backbone)

    class GalleryDS(Dataset):
        def __init__(self, names, training):
            self.names = names
            self.training = training
            self.aug = T.Compose([
                T.RandomHorizontalFlip(0.5),
                T.RandomResizedCrop(224, scale=(0.85, 1.0)),
                T.ColorJitter(0.08, 0.08, 0.05, 0.02),
            ]) if training else None

        def __len__(self): return len(self.names)

        def __getitem__(self, idx):
            name = self.names[idx]
            paths = performer_to_images[name]
            # Subsample K (with replacement if too few)
            if len(paths) >= k_per_gallery:
                chosen = random.sample(paths, k_per_gallery)
            else:
                chosen = list(paths) + random.choices(paths, k=k_per_gallery - len(paths))

            tensors = []
            for p in chosen:
                try:
                    img = Image.open(p).convert('RGB')
                except Exception:
                    continue
                if self.aug is not None:
                    img = self.aug(img)
                inp = processor(images=img, return_tensors='pt')
                tensors.append(inp['pixel_values'].squeeze(0))

            if not tensors:
                # last resort: return a black image
                tensors = [torch.zeros(3, 224, 224)]
            pv = torch.stack(tensors)  # (K, 3, H, W) — K may be < k_per_gallery if loads failed

            return {
                'name': name,
                'pixel_values': pv,
                'target': torch.tensor(performer_to_target[name], dtype=torch.float32),
                'weight': torch.tensor(performer_to_weight[name], dtype=torch.float32),
            }

    train_ds = GalleryDS(train_names, training=True)
    val_ds = GalleryDS(list(val_names), training=False)
    # Each sample is already a gallery → effective batch on the GPU is K.
    train_loader = DataLoader(train_ds, batch_size=1, shuffle=True, num_workers=0,
                              collate_fn=lambda b: b[0])
    val_loader = DataLoader(val_ds, batch_size=1, shuffle=False, num_workers=0,
                            collate_fn=lambda b: b[0])

    # 5. Model — warm-start from existing performer_ranker if backbone weights are around
    model = PerformerAttentionRanker(backbone, freeze_backbone=not quantize, quantize=quantize).to(device)
    if not quantize:
        model.freeze_backbone()
    criterion = nn.MSELoss(reduction='none')
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW(
        list(model.attention.parameters()) + list(model.rank_head.parameters()),
        lr=1e-3,
    )

    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'performer_attention_ranker_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)

    best_val_mae = float('inf')

    for epoch in range(1, epochs + 1):
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Unfreezing backbone at epoch {epoch}")
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': list(model.attention.parameters()) + list(model.rank_head.parameters()), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5},
            ])
        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'

        # Train
        model.train()
        total_loss = 0.0
        total_w = 0.0
        n_batches = len(train_loader)
        training_state['total_batches'] = n_batches

        for bi, sample in enumerate(train_loader, 1):
            pv = sample['pixel_values'].to(device)        # (K, 3, H, W)
            target = sample['target'].to(device)          # scalar
            weight = sample['weight'].to(device)          # scalar

            optimizer.zero_grad()
            if scaler:
                with torch.amp.autocast('cuda'):
                    rating, _ = model(pv, attn_dropout=attn_dropout)
                    loss = criterion(rating, target) * weight
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
            else:
                rating, _ = model(pv, attn_dropout=attn_dropout)
                loss = criterion(rating, target) * weight
                loss.backward()
                optimizer.step()

            total_loss += loss.item()
            total_w += weight.item()
            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / max(total_w, 1e-6)

        # Validate
        model.eval()
        val_err = 0.0
        val_n = 0
        with torch.no_grad():
            for sample in val_loader:
                pv = sample['pixel_values'].to(device)
                target = sample['target'].to(device)
                rating, _ = model(pv)
                val_err += (rating - target).abs().item()
                val_n += 1
        val_mae = val_err / max(val_n, 1)
        val_acc_proxy = max(0.0, 1.0 - val_mae / 5.0)
        training_state['val_acc'] = val_acc_proxy
        training_state['epoch_history'].append({
            'epoch': epoch,
            'train_loss': round(total_loss / max(total_w, 1e-6), 4),
            'val_mae': round(val_mae, 3),
            'val_acc_proxy': round(val_acc_proxy, 4),
        })
        tlog(f"  Epoch {epoch}/{epochs} | Train Loss: {total_loss / max(total_w, 1e-6):.4f} | Val MAE: {val_mae:.3f} (n={val_n})")

        if val_mae < best_val_mae:
            best_val_mae = val_mae
            training_state['best_val_acc'] = val_acc_proxy
            torch.save({
                'model_state_dict': model.state_dict(),
                'val_mae': val_mae,
                'backbone': backbone,
                'model_type': 'performer_attention_ranker',
                'performer_ratings': star_ratings,
                'holdout_performers': val_names_list,
                'config': {
                    'model_name': backbone,
                    'epochs': epochs,
                    'gallery_size': k_per_gallery,
                    'attn_dropout': attn_dropout,
                    'min_comparisons': min_comparisons,
                },
                'created_at': time.time(),
            }, out_path)
            tlog(f"  ⭐ Saved → {out_path.name} (MAE: {val_mae:.3f})")

        if device.type == 'cuda':
            torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': max(0, 1.0 - best_val_mae / 5.0)}


def train_ranked_binary(config):
    """Train a rank-conditioned binary classifier.
    Same as train_binary but the model takes (image, performer_rank) as input.
    During training, rank comes from manifest.json star ratings.
    During inference, rank comes from a separately loaded PerformerRankerModel.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    bs = config.get('batch_size', 16)
    base_path = config.get('base_path', '')

    tlog(f"📋 Ranked Binary Training | {epochs} epochs | backbone: {backbone}")

    # Load performer directories
    keep_map = scan_performer_dirs(os.path.join(base_path, 'keep'))
    delete_map = scan_performer_dirs(os.path.join(base_path, 'delete'))
    tlog(f"  Keep performers: {len(keep_map)} | Delete performers: {len(delete_map)}")

    if not keep_map or not delete_map:
        raise ValueError("Need both keep and delete performer directories")

    # Load star ratings
    star_ratings = config.get('performer_ratings', {})
    manifest_path = Path(base_path) / 'manifest.json'
    if not star_ratings and manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            star_ratings = manifest.get('performer_ratings', {})
            tlog(f"  ⭐ Loaded {len(star_ratings)} star ratings from manifest")
        except Exception as e:
            tlog(f"  ⚠️ Failed to load manifest.json: {e}")

    star_ratings_norm = {k.lower().strip(): v for k, v in star_ratings.items()}

    # Performer-held-out split before building samples.
    all_performers = sorted(set(list(keep_map.keys()) + list(delete_map.keys())))
    train_performers, val_performers = split_performers(all_performers, val_frac=0.15)
    train_set = set(train_performers); val_set = set(val_performers)
    tlog(f"  🎭 Performer split: {len(train_performers)} train / {len(val_performers)} val (holdout)")

    def build_samples(performer_subset):
        out = []
        for perf in performer_subset:
            stars = star_ratings_norm.get(perf.lower().strip(), 2.5)
            for p in keep_map.get(perf, []):
                out.append((p, stars, 1.0))
            for p in delete_map.get(perf, []):
                out.append((p, stars, 0.0))
        return out

    train_samples = build_samples(train_set)
    val_samples = build_samples(val_set)
    random.shuffle(train_samples)

    config['_keep_count'] = sum(len(v) for v in keep_map.values())
    config['_delete_count'] = sum(len(v) for v in delete_map.values())
    tlog(f"  📊 Train: {len(train_samples)} samples | Val: {len(val_samples)} samples (held-out)")

    if not train_samples:
        raise ValueError("No training samples after performer split")

    processor = AutoImageProcessor.from_pretrained(backbone)

    class RankedBinaryDS(Dataset):
        def __init__(self, samples, augment=True):
            self.samples = samples
            self.augment = augment
            self.aug = T.Compose([T.RandomHorizontalFlip(0.5),
                                  T.RandomResizedCrop(224, scale=(0.85, 1.0)),
                                  T.ColorJitter(0.08, 0.08, 0.05, 0.02)])
        def __len__(self): return len(self.samples)
        def __getitem__(self, idx):
            path, stars, label = self.samples[idx]
            try: img = Image.open(path).convert('RGB')
            except: return self.__getitem__((idx+1) % len(self))
            if self.augment:
                img = self.aug(img)
            inp = processor(images=img, return_tensors='pt')
            return {'pixel_values': inp['pixel_values'].squeeze(0),
                    'star_rating': torch.tensor(stars, dtype=torch.float32),
                    'label': torch.tensor(label, dtype=torch.float32)}

    train_ds = RankedBinaryDS(train_samples, augment=True)
    val_ds = RankedBinaryDS(val_samples, augment=False) if val_samples else None
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=bs, num_workers=0) if val_ds is not None else None

    model = RankedBinaryClassifier(backbone, quantize=quantize).to(device)
    if not quantize: model.freeze_backbone()
    criterion = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW(model.classifier.parameters(), lr=1e-3)
    best_acc = 0.0
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'binary_filtering_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)

    for epoch in range(1, epochs+1):
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Unfreezing backbone at epoch {epoch}")
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.classifier.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5},
            ])
        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'

        model.train()
        total_loss = correct = total = 0
        num_batches = len(train_loader)
        training_state['total_batches'] = num_batches

        for bi, batch in enumerate(train_loader, 1):
            pv = batch['pixel_values'].to(device)
            stars = batch['star_rating'].to(device)
            labels = batch['label'].to(device)
            optimizer.zero_grad()
            if scaler:
                with torch.amp.autocast('cuda'):
                    logits = model(pv, stars)
                    loss = criterion(logits, labels)
                scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            else:
                logits = model(pv, stars)
                loss = criterion(logits, labels)
                loss.backward(); optimizer.step()
            total_loss += loss.item()
            preds = (torch.sigmoid(logits) > 0.5).float()
            correct += (preds == labels).sum().item()
            total += labels.size(0)
            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / bi
            training_state['train_acc'] = correct / max(total, 1)

        # Validate on held-out performers
        if val_loader is not None:
            model.eval()
            vc = vt = 0
            with torch.no_grad():
                for batch in val_loader:
                    pv = batch['pixel_values'].to(device)
                    stars = batch['star_rating'].to(device)
                    labels = batch['label'].to(device)
                    logits = model(pv, stars)
                    vc += ((torch.sigmoid(logits) > 0.5).float() == labels).sum().item()
                    vt += labels.size(0)
            val_acc = vc / max(vt, 1)
        else:
            val_acc = 0.0
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch, 'train_loss': total_loss / num_batches,
            'train_acc': round(correct / max(total, 1), 4), 'val_acc': round(val_acc, 4)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Train: {correct/max(total,1):.1%} | Val (held-out): {val_acc:.1%}")

        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({
                'model_state_dict': model.state_dict(), 'val_acc': val_acc,
                'backbone': backbone, 'model_type': 'binary',
                'rank_conditioned': True,
                'holdout_performers': val_performers,
                'performer_ratings': star_ratings,
                'config': {'model_name': backbone, 'epochs': epochs, 'batch_size': bs},
                'created_at': time.time()
            }, out_path)
            tlog(f"  ⭐ Saved → {out_path.name} ({val_acc:.1%})")

        if device.type == 'cuda': torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': best_acc}


def train_ranked_siamese_binary(config):
    """Train a rank-conditioned siamese binary using synthetic keep>delete pairs.
    Same as train_siamese_binary but the model takes (image, rank) as input.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    finetune_start = config.get('finetune_start_epoch', 3)
    quantize = config.get('quantize', False)
    bs = config.get('batch_size', 16)
    base_path = config.get('base_path', '')
    synthetic_pairs_per_epoch = config.get('synthetic_pairs_per_epoch', 500)

    tlog(f"📋 Ranked Siamese Binary Training | {epochs} epochs | backbone: {backbone}")

    keep_map = scan_performer_dirs(os.path.join(base_path, 'keep'))
    delete_map = scan_performer_dirs(os.path.join(base_path, 'delete'))

    # Load star ratings
    star_ratings = config.get('performer_ratings', {})
    manifest_path = Path(base_path) / 'manifest.json'
    if not star_ratings and manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            star_ratings = manifest.get('performer_ratings', {})
            tlog(f"  ⭐ Loaded {len(star_ratings)} ratings from manifest")
        except: pass
    star_ratings_norm = {k.lower().strip(): v for k, v in star_ratings.items()}

    # Strictly use performers with BOTH sides
    all_performers = sorted(set(keep_map.keys()) & set(delete_map.keys()))
    tlog(f"  🎯 {len(all_performers)} performers with both keep & delete")
    if not all_performers:
        raise ValueError("No performers have both keep and delete images.")

    # Performer-held-out split — val pairs come from never-seen performers.
    train_performers, val_performers = split_performers(all_performers, val_frac=0.15)
    train_set = set(train_performers); val_set = set(val_performers)
    tlog(f"  🎭 Performer split: {len(train_performers)} train / {len(val_performers)} val (holdout)")

    config['_keep_count'] = sum(len(v) for v in keep_map.values())
    config['_delete_count'] = sum(len(v) for v in delete_map.values())

    processor = AutoImageProcessor.from_pretrained(backbone)
    model = RankedSiameseModel(model_name=backbone, freeze_backbone=not quantize, quantize=quantize).to(device)
    criterion = nn.MarginRankingLoss(margin=1.0)
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW(model.head.parameters(), lr=1e-3)
    best_acc = 0.0
    backbone_short = backbone.split('/')[-1]
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = Path(__file__).parent / 'models' / f'siamese_binary_{backbone_short}_{timestamp}.pt'
    out_path.parent.mkdir(exist_ok=True)

    # Build stable val pair set from held-out performers
    val_pairs = []
    val_pairs_per_perf = min(50, synthetic_pairs_per_epoch)
    for perf in val_performers:
        p_keep = keep_map.get(perf, [])
        p_del = delete_map.get(perf, [])
        if not p_keep or not p_del: continue
        rank = star_ratings_norm.get(perf.lower().strip(), 2.5)
        n = min(val_pairs_per_perf, len(p_keep) * len(p_del))
        for _ in range(n):
            val_pairs.append((random.choice(p_keep), rank, random.choice(p_del), rank))
    val_ds = PairwiseDataset(val_pairs, processor, augment=False, deduplicate=False) if val_pairs else None
    val_loader_ep = DataLoader(val_ds, batch_size=bs, num_workers=0) if val_ds is not None else None
    tlog(f"  🧪 Val pair set: {len(val_pairs)} pairs from held-out performers")

    for epoch in range(1, epochs+1):
        if finetune_start > 0 and epoch == finetune_start:
            tlog(f"  🔥 Unfreezing backbone at epoch {epoch}")
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.head.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])
        training_state['epoch'] = epoch
        is_finetuning = finetune_start > 0 and epoch >= finetune_start
        training_state['phase'] = 'finetune' if is_finetuning else 'warmup'

        # Generate synthetic pairs from TRAIN performers only.
        pairs = []
        for perf in train_performers:
            p_keep = keep_map.get(perf, [])
            p_del = delete_map.get(perf, [])
            if not p_keep or not p_del: continue
            rank = star_ratings_norm.get(perf.lower().strip(), 2.5)
            n = min(synthetic_pairs_per_epoch, len(p_keep) * len(p_del))
            for _ in range(n):
                pairs.append((random.choice(p_keep), rank, random.choice(p_del), rank))

        train_ds = PairwiseDataset(pairs, processor, augment=True, deduplicate=False)
        train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, num_workers=0)
        num_batches = len(train_loader)
        training_state['total_batches'] = num_batches

        model.train()
        total_loss = correct = total = 0
        for bi, batch in enumerate(train_loader, 1):
            w = batch['winner'].to(device)
            l = batch['loser'].to(device)
            rw = batch['rank_winner'].to(device)
            rl = batch['rank_loser'].to(device)
            optimizer.zero_grad()
            if scaler:
                with torch.amp.autocast('cuda'):
                    sw, sl = model(w, rw, l, rl)
                    target = torch.ones(sw.size(0), device=device)
                    loss = criterion(sw, sl, target)
                scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
            else:
                sw, sl = model(w, rw, l, rl)
                target = torch.ones(sw.size(0), device=device)
                loss = criterion(sw, sl, target)
                loss.backward(); optimizer.step()
            total_loss += loss.item()
            correct += (sw > sl).sum().item()
            total += sw.size(0)
            training_state['batch'] = bi
            training_state['train_loss'] = total_loss / bi
            training_state['train_acc'] = correct / max(total, 1)

        # Validate on held-out performer pair set
        if val_loader_ep is not None:
            model.eval()
            vc = vt = 0
            with torch.no_grad():
                for batch in val_loader_ep:
                    w = batch['winner'].to(device)
                    l = batch['loser'].to(device)
                    rw = batch['rank_winner'].to(device)
                    rl = batch['rank_loser'].to(device)
                    sw, sl = model(w, rw, l, rl)
                    vc += (sw > sl).sum().item()
                    vt += sw.size(0)
            val_acc = vc / max(vt, 1)
        else:
            val_acc = 0.0
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch,
            'train_loss': total_loss / max(num_batches, 1),
            'train_acc': round(correct / max(total, 1), 4),
            'val_acc': round(val_acc, 4),
            'pairs': len(pairs)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Loss: {total_loss/max(num_batches,1):.4f} | Train: {correct/max(total,1):.1%} | Val (held-out): {val_acc:.1%} | Pairs: {len(pairs)}")

        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({
                'model_state_dict': model.state_dict(), 'val_acc': best_acc,
                'backbone': backbone, 'model_type': 'siamese_binary',
                'rank_conditioned': True,
                'holdout_performers': val_performers,
                'performer_ratings': star_ratings,
                'config': {'model_name': backbone, 'epochs': epochs, 'batch_size': bs},
                'created_at': time.time()
            }, out_path)
            tlog(f"  ⭐ Saved → {out_path.name} ({val_acc:.1%})")

        if device.type == 'cuda': torch.cuda.empty_cache()

    return {'model': str(out_path.name), 'best_val_acc': best_acc}


TRAIN_FNS = {
    'binary': train_binary,
    'pairwise': train_pairwise,
    'pairwise_siamese_binary': train_siamese_binary,
    'performer_ranker': train_performer_ranker,
    'performer_attention_ranker': train_performer_attention_ranker,
    'ranked_binary': train_ranked_binary,
    'ranked_siamese_binary': train_ranked_siamese_binary,
    # Legacy: kept for backward compat — functions still exist but not recommended
    'context_binary': train_context_binary,
    'rank_aware_siamese': train_rank_aware_siamese,
}

def start_training(config):
    """Start training in a background thread. Returns immediately."""
    train_type = config.get('type', 'binary')
    if training_state['active']:
        return False, "Training already in progress"
    if train_type not in TRAIN_FNS:
        return False, f"Unknown type: {train_type}. Valid: {list(TRAIN_FNS.keys())}"

    training_state.update({
        'active': True, 'type': train_type, 'epoch': 0,
        'total_epochs': config.get('epochs', 8), 'batch': 0, 'total_batches': 0,
        'train_loss': 0, 'train_acc': 0, 'val_acc': 0, 'best_val_acc': 0,
        'phase': 'starting', 'message': f'Starting {train_type} training...',
        'error': None, 'started_at': time.time(), 'finished_at': None,
        'epoch_history': [], 'log': []
    })

    def run():
        try:
            tlog(f"🚀 Training started: {train_type}")
            result = TRAIN_FNS[train_type](config)
            training_state['message'] = f"✅ Complete! Best acc: {result['best_val_acc']:.1%}"
            training_state['phase'] = 'complete'
            tlog(f"✅ Training complete: {result}")
            # Save to history
            save_run_to_history({
                'type': train_type,
                'started_at': training_state['started_at'],
                'finished_at': time.time(),
                'duration_s': round(time.time() - training_state['started_at'], 1),
                'epochs': config.get('epochs', 8),
                'batch_size': config.get('batch_size', 16),
                'backbone': config.get('backbone', 'facebook/dinov2-large'),
                'best_val_acc': result['best_val_acc'],
                'model_file': result.get('model'),
                'epoch_history': training_state.get('epoch_history', []),
                'data': {
                    'keep': config.get('_keep_count', 0),
                    'delete': config.get('_delete_count', 0)
                }
            })
        except Exception as e:
            training_state['error'] = str(e)
            training_state['message'] = f"❌ Error: {e}"
            training_state['phase'] = 'error'
            tlog(f"❌ Training error: {e}")
            import traceback; traceback.print_exc()
        finally:
            training_state['active'] = False
            training_state['finished_at'] = time.time()

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return True, f"Training {train_type} started in background"
