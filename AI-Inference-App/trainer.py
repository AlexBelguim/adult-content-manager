"""
Training module for AI Inference App.
Supports: binary, pairwise, context-aware binary, and agent-of-taste models.
Runs in a background thread so the server stays responsive.
"""
import os, sys, time, random, json, threading, torch, torch.nn as nn
from pathlib import Path
from PIL import Image
from transformers import AutoImageProcessor, AutoModel
from torch.utils.data import Dataset, DataLoader, random_split
import torchvision.transforms as T
from model_dinov2 import DinoV2PreferenceModel

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

# ── Models ───────────────────────────────────────────────────────────────────

class BinaryClassifier(nn.Module):
    def __init__(self, backbone_name='facebook/dinov2-large'):
        super().__init__()
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
    def __init__(self, backbone_name='facebook/dinov2-large'):
        super().__init__()
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
        self.aug_t = T.Compose([T.RandomHorizontalFlip(0.5), T.ColorJitter(0.1, 0.1, 0.1, 0.05)])

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
        return {'winner': wi['pixel_values'].squeeze(0), 'loser': li['pixel_values'].squeeze(0), 'idx': idx}

# ── Training Functions ───────────────────────────────────────────────────────

def train_binary(config):
    """Train binary keep/delete classifier."""
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    backbone = config.get('backbone', 'facebook/dinov2-large')
    epochs = config.get('epochs', 8)
    bs = config.get('batch_size', 16)
    warmup = config.get('warmup_epochs', 2)
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
    
    # Integrate Human Corrections (Hard Examples)
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

    all_keep = base_keep + hard_keep
    all_delete = base_delete + hard_delete
    
    config['_keep_count'] = len(all_keep)
    config['_delete_count'] = len(all_delete)
    tlog(f"  📊 Dataset: Keep={len(all_keep)}, Delete={len(all_delete)}")

    if not all_keep or not all_delete:
        raise ValueError("Need both keep and delete images")

    processor = AutoImageProcessor.from_pretrained(backbone)
    
    # Mining setup
    mining_pool = [] # list of (path, label)
    mining_mult = config.get('mining_multiplier', 4)

    # Initial split
    full_ds = BinaryDataset(all_keep, all_delete, processor, deduplicate=config.get('deduplicate', False))
    vs = max(1, int(len(full_ds) * 0.15))
    train_ds_base, val_ds = random_split(full_ds, [len(full_ds)-vs, vs])
    
    val_loader = DataLoader(val_ds, batch_size=bs, num_workers=0)
    model = BinaryClassifier(backbone_name=backbone).to(device)
    model.freeze_backbone()
    criterion = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW(model.classifier.parameters(), lr=1e-3)
    best_acc = 0.0
    out_path = Path(__file__).parent / 'models' / 'binary_filtering.pt'

    for epoch in range(1, epochs + 1):
        if epoch == warmup + 1:
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.classifier.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])
        training_state['epoch'] = epoch
        training_state['phase'] = 'warmup' if epoch <= warmup else 'finetune'

        # Create loader for this epoch (potentially with mining pool)
        current_keep = [s[0] for s in train_ds_base.dataset.samples if s[1] == 1.0]
        current_delete = [s[0] for s in train_ds_base.dataset.samples if s[1] == 0.0]
        
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

        # Validate
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
        train_acc = correct / max(total, 1)
        training_state['val_acc'] = val_acc
        training_state['epoch_history'].append({
            'epoch': epoch, 'train_loss': total_loss / num_batches,
            'train_acc': round(train_acc, 4), 'val_acc': round(val_acc, 4)
        })
        tlog(f"  Epoch {epoch}/{epochs} | Train: {train_acc:.1%} | Val: {val_acc:.1%}")

        if val_acc > best_acc:
            best_acc = val_acc
            training_state['best_val_acc'] = best_acc
            torch.save({'model_state_dict': model.state_dict(), 'val_acc': val_acc,
                        'backbone': backbone, 'model_type': 'binary',
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
    warmup = config.get('warmup_epochs', 2)
    bs = config.get('batch_size', 8)
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

    model = DinoV2PreferenceModel(model_name=backbone, freeze_backbone=True).to(device)
    criterion = nn.MarginRankingLoss(margin=1.0)
    optimizer = torch.optim.AdamW(model.head.parameters(), lr=1e-3)
    best_acc = 0.0
    out_path = Path(__file__).parent / 'models' / 'pairwise_preference.pt'

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

        training_state['epoch'] = epoch
        training_state['phase'] = 'warmup' if epoch <= warmup else 'finetune'
        
        if epoch == warmup + 1:
            for p in model.backbone.parameters(): p.requires_grad = True
            optimizer = torch.optim.AdamW([
                {'params': model.head.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5}
            ])
        
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
    warmup = config.get('warmup_epochs', 2)
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
            manifest = json.loads(manifest_path.read_text())
            star_ratings = manifest.get('performer_ratings', {})
            tlog(f"  ⭐ Loaded {len(star_ratings)} star ratings from manifest")
        except: pass

    # Default unknown performers to 2.5 (neutral)
    all_performers = set(list(keep_map.keys()) + list(delete_map.keys()))
    for p in all_performers:
        if p not in star_ratings:
            star_ratings[p] = 2.5
    rated_count = sum(1 for v in star_ratings.values() if v != 2.5)
    tlog(f"  Performers with real ratings: {rated_count}/{len(all_performers)}")

    # 3. Build dataset
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
    model = ContextBinaryClassifier(backbone).to(device)
    model.freeze_backbone()
    criterion_stars = nn.MSELoss()
    criterion_action = nn.BCEWithLogitsLoss()
    scaler = torch.amp.GradScaler('cuda') if device.type == 'cuda' else None
    optimizer = torch.optim.AdamW([
        {'params': model.star_head.parameters(), 'lr': 1e-3},
        {'params': model.action_head.parameters(), 'lr': 1e-3},
    ])
    best_acc = 0.0
    out_path = Path(__file__).parent / 'models' / 'context_binary.pt'
    out_path.parent.mkdir(exist_ok=True)

    # 5. Training loop
    for epoch in range(1, epochs+1):
        if epoch == warmup + 1:
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW([
                {'params': model.star_head.parameters(), 'lr': 1e-3},
                {'params': model.action_head.parameters(), 'lr': 1e-3},
                {'params': model.backbone.parameters(), 'lr': 1e-5},
            ])
        training_state['epoch'] = epoch
        training_state['phase'] = 'warmup' if epoch <= warmup else 'finetune'
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


# ── Background runner ────────────────────────────────────────────────────────

TRAIN_FNS = {
    'binary': train_binary,
    'pairwise': train_pairwise,
    'context_binary': train_context_binary,
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
