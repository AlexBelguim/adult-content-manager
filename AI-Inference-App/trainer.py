"""
Training module for AI Inference App.
Supports: binary, pairwise, CLIP siamese, performer ranker and rank-conditioned binary.
Runs in a background thread so the server stays responsive.
"""
import os, sys, time, random, json, threading, torch, torch.nn as nn
from pathlib import Path
from PIL import Image
from transformers import AutoImageProcessor, AutoModel
from torch.utils.data import Dataset, DataLoader, random_split
import torchvision.transforms as T
from model_dinov2 import DinoV2PreferenceModel, PerformerRankerModel, RankedBinaryClassifier, ClipPreferenceModel

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
    """(winner_path, loser_path) pairs."""
    def __init__(self, pairs, processor, augment=True, deduplicate=False):
        resolved_pairs = []
        for w, l in pairs:
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
        w, l = self.pairs[idx]
        try:
            wimg = Image.open(w).convert('RGB')
            limg = Image.open(l).convert('RGB')
        except: return self.__getitem__((idx+1) % len(self))
        if self.augment:
            wimg, limg = self.aug_t(wimg), self.aug_t(limg)
        wi = self.processor(images=wimg, return_tensors='pt')
        li = self.processor(images=limg, return_tensors='pt')
        return {'winner': wi['pixel_values'].squeeze(0),
                'loser': li['pixel_values'].squeeze(0),
                'idx': idx}

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


def train_clip_siamese(config):
    """Train the CLIP picture ranker (ported from extra/vision-llm-pairwise/train_pairwise.py).
    CLIP stays frozen, so every picture is embedded once and only the score head trains,
    with RankNet on two kinds of winner > loser pairs:
      - kept beats deleted, within one performer (train performers, resampled every epoch);
      - the hand-made pairs from Rank images (pairwise_pairs).
    Val: kept > deleted pairs of held-out performers, plus hand pairs whose winner is one of them.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = 'openai/clip-vit-large-patch14-336'
    config['backbone'] = backbone  # the DINO backbone picker on the page does not apply
    epochs = config.get('epochs', 8)
    bs = config.get('batch_size', 16)
    per_perf = config.get('synthetic_pairs_per_epoch') or 500
    base_path = config.get('base_path', '')

    tlog(f"📋 CLIP Siamese Training | {epochs} epochs | {per_perf} kept>deleted pairs per performer per epoch")
    keep_map = scan_performer_dirs(os.path.join(base_path, 'keep'))
    delete_map = scan_performer_dirs(os.path.join(base_path, 'delete'))
    both = sorted(set(keep_map) & set(delete_map))
    if not both:
        raise ValueError("No performers have both keep and delete images.")
    train_performers, val_performers = split_performers(both, val_frac=0.15)
    val_set = set(val_performers)
    hand = [(resolve_path(p['winner']), resolve_path(p['loser'])) for p in config.get('pairs', [])]
    hand = [(w, l) for w, l in hand if w and l]
    tlog(f"  🎭 Performer split: {len(train_performers)} train / {len(val_performers)} val (holdout) | "
         f"hand pairs with both pictures found: {len(hand)}/{len(config.get('pairs', []))}")
    config['_keep_count'] = sum(len(v) for v in keep_map.values())
    config['_delete_count'] = sum(len(v) for v in delete_map.values())

    paths = sorted({p for perf in both for p in keep_map[perf] + delete_map[perf]} | {p for pair in hand for p in pair})
    processor = AutoImageProcessor.from_pretrained(backbone)
    model = ClipPreferenceModel(backbone).to(device).eval()
    training_state['phase'] = 'embedding'
    training_state['total_batches'] = (len(paths) + 31) // 32
    idx, feats = {}, []
    with torch.no_grad(), torch.autocast(device.type, enabled=device.type == 'cuda'):
        for bi, i in enumerate(range(0, len(paths), 32), 1):
            imgs = []
            for p in paths[i:i + 32]:
                try: imgs.append(Image.open(p).convert('RGB'))
                except Exception: continue
                idx[p] = len(idx)
            if imgs:
                feats.append(model.features(processor(images=imgs, return_tensors='pt')['pixel_values'].to(device)).float())
            training_state['batch'] = bi
    feats = torch.cat(feats)
    tlog(f"  🖼️ Embedded {len(idx)} pictures")

    def kept_beats_deleted(performers, n):
        out = []
        for perf in performers:
            k = [idx[p] for p in keep_map[perf] if p in idx]
            d = [idx[p] for p in delete_map[perf] if p in idx]
            if k and d:
                out += [(random.choice(k), random.choice(d)) for _ in range(min(n, len(k) * len(d)))]
        return out

    hand_idx = [(idx[w], idx[l], performer_from_path(w) in val_set) for w, l in hand if w in idx and l in idx]
    hand_train = [(w, l) for w, l, held_out in hand_idx if not held_out]
    val_pairs = kept_beats_deleted(val_performers, 200) + [(w, l) for w, l, held_out in hand_idx if held_out]
    tlog(f"  🧪 Val pair set: {len(val_pairs)} pairs from held-out performers")
    val_winners = torch.tensor([w for w, _ in val_pairs], device=device)
    val_losers = torch.tensor([l for _, l in val_pairs], device=device)

    head = model.score_head
    head.train()
    optimizer = torch.optim.AdamW(head.parameters(), lr=1e-4, weight_decay=0.01)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-6)
    criterion = nn.BCEWithLogitsLoss()  # RankNet: P(winner beats loser) = sigmoid(score difference)
    best_acc = 0.0
    out_path = Path(__file__).parent / 'models' / 'clip_siamese' / f'clip_siamese_{time.strftime("%Y%m%d_%H%M%S")}.pt'
    out_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        training_state['epoch'] = epoch
        training_state['phase'] = 'train'
        pairs = kept_beats_deleted(train_performers, per_perf) + hand_train
        random.shuffle(pairs)
        winners = torch.tensor([w for w, _ in pairs], device=device)
        losers = torch.tensor([l for _, l in pairs], device=device)
        num_batches = (len(pairs) + bs - 1) // bs
        training_state['total_batches'] = num_batches
        total_loss = correct = 0
        for bi in range(num_batches):
            diff = head(feats[winners[bi * bs:(bi + 1) * bs]]) - head(feats[losers[bi * bs:(bi + 1) * bs]])
            loss = criterion(diff, torch.ones_like(diff))
            optimizer.zero_grad(); loss.backward(); optimizer.step()
            total_loss += loss.item()
            correct += (diff > 0).sum().item()
            training_state['batch'] = bi + 1
            training_state['train_loss'] = total_loss / (bi + 1)
            training_state['train_acc'] = correct / min((bi + 1) * bs, len(pairs))
        scheduler.step()

        head.eval()
        with torch.no_grad():
            scores = head(feats)
        head.train()
        val_acc = (scores[val_winners] > scores[val_losers]).float().mean().item()
        train_acc = correct / len(pairs)
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch, 'train_loss': total_loss / num_batches,
            'train_acc': round(train_acc, 4), 'val_acc': round(val_acc, 4), 'pairs': len(pairs)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Loss: {total_loss/num_batches:.4f} | Train: {train_acc:.1%} | Val (held-out): {val_acc:.1%} | Pairs: {len(pairs)}")

        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({
                # CLIP is frozen, so only the head is saved; the backbone comes from the pretrained weights
                'model_state_dict': {k: v for k, v in model.state_dict().items() if k.startswith('score_head.')},
                'val_acc': val_acc, 'backbone': backbone, 'model_type': 'clip_siamese',
                'holdout_performers': val_performers,
                'samples': len(pairs),  # training pairs in the saved epoch
                'config': {'model_name': backbone, 'epochs': epochs, 'batch_size': bs},
                'created_at': time.time()
            }, out_path)
            tlog(f"  ⭐ Saved → {out_path.name} ({val_acc:.1%})")

    return {'model': f'clip_siamese/{out_path.name}', 'best_val_acc': best_acc}


TRAIN_FNS = {
    'binary': train_binary,
    'pairwise': train_pairwise,
    'clip_siamese': train_clip_siamese,
    'performer_ranker': train_performer_ranker,
    'ranked_binary': train_ranked_binary,
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
