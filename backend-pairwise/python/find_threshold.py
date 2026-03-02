"""
Threshold Finder Script
Finds the optimal score threshold that best separates KEEP vs DELETE labels.

Usage:
    python find_threshold.py --dataset data/dataset.json --model output/best_model.pt --type clip
    python find_threshold.py --dataset data/dataset.json --model output_dinov2/best_model.pt --type dinov2
"""
import argparse
import json
import math
import sys
from pathlib import Path
from collections import defaultdict

import torch
from PIL import Image
from tqdm import tqdm
from transformers import CLIPProcessor, AutoImageProcessor

# Import models
from model import SiamesePreferenceModel
from model_dinov2 import DinoV2PreferenceModel


def load_model(device, model_path, model_type):
    """Load a model from checkpoint."""
    checkpoint_path = Path(model_path)
    
    if not checkpoint_path.exists():
        print(f"❌ Checkpoint not found: {checkpoint_path}")
        return None, None, None
    
    print(f"   Loading {model_type.upper()} from {checkpoint_path}...")
    
    checkpoint = torch.load(checkpoint_path, map_location=device)
    config = checkpoint.get('config', {})
    
    if model_type == 'clip':
        model_name = config.get('model_name', config.get('backbone_name', 'openai/clip-vit-large-patch14-336'))
        model = SiamesePreferenceModel(backbone_name=model_name, freeze_backbone=True)
        model.load_state_dict(checkpoint['model_state_dict'])
        model.to(device)
        model.eval()
        processor = CLIPProcessor.from_pretrained(model_name)
        
    elif model_type == 'dinov2':
        model_name = config.get('model_name', 'facebook/dinov2-large')
        model = DinoV2PreferenceModel(model_name=model_name, freeze_backbone=True)
        model.load_state_dict(checkpoint['model_state_dict'])
        model.to(device)
        model.eval()
        processor = AutoImageProcessor.from_pretrained(
            model_name,
            do_resize=True,
            size={"shortest_edge": 518},
            do_center_crop=True,
            crop_size={"height": 518, "width": 518}
        )
    else:
        print(f"❌ Unknown model type: {model_type}")
        return None, None, None
    
    return model, processor, model_name


def score_images(model, processor, items, device):
    """Score all images and return results with labels."""
    results = []
    
    for item in tqdm(items, desc="Scoring images"):
        path_raw = item['path']
        label = item['label']  # KEEP or DELETE
        
        # Resolve path
        img_path = Path(path_raw.lstrip('./'))
        if not img_path.exists():
            img_path = Path('data') / path_raw.lstrip('./')
        
        if not img_path.exists():
            continue
        
        try:
            img = Image.open(img_path).convert('RGB')
            
            with torch.no_grad():
                inputs = processor(images=img, return_tensors="pt")
                pixel_values = inputs['pixel_values'].to(device)
                
                # Get both raw and normalized scores
                raw_score = model.forward_single(pixel_values).item()
                normalized_score = model.score_images(pixel_values).item()
                
                results.append({
                    'path': path_raw,
                    'label': label,
                    'score': normalized_score,  # 0-100 for analysis
                    'raw': raw_score  # Raw for app threshold
                })
                
        except Exception as e:
            print(f"⚠️  Error processing {path_raw}: {e}")
            continue
    
    return results


def find_optimal_threshold(results):
    """Find the threshold that maximizes accuracy (correct KEEP + correct DELETE)."""
    if not results:
        return None, 0, {}
    
    # Separate by label
    keep_scores = [r['score'] for r in results if r['label'] == 'KEEP']
    delete_scores = [r['score'] for r in results if r['label'] == 'DELETE']
    
    if not keep_scores or not delete_scores:
        print("⚠️  Need both KEEP and DELETE labels to find threshold")
        return None, 0, {}
    
    # Get all unique thresholds to try
    all_scores = sorted(set(keep_scores + delete_scores))
    
    best_threshold = None
    best_accuracy = 0
    best_stats = {}
    
    # Try thresholds between each pair of scores
    thresholds_to_try = []
    for i in range(len(all_scores) - 1):
        thresholds_to_try.append((all_scores[i] + all_scores[i+1]) / 2)
    
    # Also try min-1 and max+1
    thresholds_to_try.insert(0, min(all_scores) - 1)
    thresholds_to_try.append(max(all_scores) + 1)
    
    for threshold in thresholds_to_try:
        # Above threshold = KEEP, Below threshold = DELETE
        true_positives = sum(1 for s in keep_scores if s >= threshold)     # Correctly kept
        false_negatives = sum(1 for s in keep_scores if s < threshold)     # Wrongly deleted
        true_negatives = sum(1 for s in delete_scores if s < threshold)    # Correctly deleted
        false_positives = sum(1 for s in delete_scores if s >= threshold)  # Wrongly kept
        
        total = len(keep_scores) + len(delete_scores)
        accuracy = (true_positives + true_negatives) / total
        
        precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0
        recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        
        if accuracy > best_accuracy:
            best_accuracy = accuracy
            best_threshold = threshold
            best_stats = {
                'accuracy': accuracy,
                'precision': precision,
                'recall': recall,
                'f1': f1,
                'true_positives': true_positives,
                'false_positives': false_positives,
                'true_negatives': true_negatives,
                'false_negatives': false_negatives,
                'total_keep': len(keep_scores),
                'total_delete': len(delete_scores)
            }
    
    return best_threshold, best_accuracy, best_stats


def find_percentile_thresholds(results):
    """Find thresholds at various percentiles."""
    keep_scores = [r['score'] for r in results if r['label'] == 'KEEP']
    delete_scores = [r['score'] for r in results if r['label'] == 'DELETE']
    all_scores = sorted([r['score'] for r in results])
    
    percentiles = [10, 25, 50, 75, 90]
    threshold_info = {}
    
    for p in percentiles:
        idx = int(len(all_scores) * p / 100)
        threshold = all_scores[idx] if idx < len(all_scores) else all_scores[-1]
        
        keep_above = sum(1 for s in keep_scores if s >= threshold)
        delete_above = sum(1 for s in delete_scores if s >= threshold)
        
        threshold_info[p] = {
            'threshold': threshold,
            'keep_above': keep_above,
            'keep_below': len(keep_scores) - keep_above,
            'delete_above': delete_above,
            'delete_below': len(delete_scores) - delete_above
        }
    
    return threshold_info


def main():
    parser = argparse.ArgumentParser(description='Find optimal KEEP/DELETE threshold')
    parser.add_argument('--dataset', required=True, help='Path to dataset.json')
    parser.add_argument('--model', required=True, help='Path to model checkpoint')
    parser.add_argument('--type', required=True, choices=['clip', 'dinov2'], help='Model type')
    parser.add_argument('--output', default=None, help='Save scored results to JSON')
    args = parser.parse_args()
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n{'='*60}")
    print(f"🎯 THRESHOLD FINDER")
    print(f"{'='*60}")
    print(f"Device: {device}")
    if device.type == 'cuda':
        print(f"GPU: {torch.cuda.get_device_name(0)}")
    
    # Load dataset
    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        print(f"❌ Dataset not found: {dataset_path}")
        sys.exit(1)
    
    with open(dataset_path, 'r') as f:
        data = json.load(f)
    
    # Handle different formats
    if isinstance(data, dict) and 'keepImages' in data:
        # Format: {keepImages: [...], deleteImages: [...]}
        items = data.get('keepImages', []) + data.get('deleteImages', [])
    elif isinstance(data, list):
        items = data
    elif isinstance(data, dict) and 'items' in data:
        items = data['items']
    else:
        items = list(data.values()) if isinstance(data, dict) else []
    
    # Count labels
    label_counts = defaultdict(int)
    for item in items:
        if isinstance(item, dict):
            label_counts[item.get('label', 'UNKNOWN')] += 1
    
    print(f"\n📊 Dataset: {dataset_path}")
    print(f"   Total items: {len(items)}")
    for label, count in sorted(label_counts.items()):
        print(f"   {label}: {count}")
    
    # Load model
    print(f"\n{'='*60}")
    print("📦 Loading Model...")
    print(f"{'='*60}")
    
    model, processor, model_name = load_model(device, args.model, args.type)
    if model is None:
        sys.exit(1)
    
    print(f"   Model: {model_name}")
    
    # Score all images
    print(f"\n{'='*60}")
    print("🧪 Scoring Images...")
    print(f"{'='*60}")
    
    results = score_images(model, processor, items, device)
    print(f"\n   Scored {len(results)} images")
    
    # Save results if requested
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"   Saved to {args.output}")
    
    # Find optimal threshold
    print(f"\n{'='*60}")
    print("🎯 FINDING OPTIMAL THRESHOLD")
    print(f"{'='*60}")
    
    threshold, accuracy, stats = find_optimal_threshold(results)
    
    if threshold is None:
        print("❌ Could not find threshold (need both KEEP and DELETE labels)")
        sys.exit(1)
    
    # Score statistics
    keep_scores = [r['score'] for r in results if r['label'] == 'KEEP']
    delete_scores = [r['score'] for r in results if r['label'] == 'DELETE']
    keep_raw = [r['raw'] for r in results if r['label'] == 'KEEP']
    delete_raw = [r['raw'] for r in results if r['label'] == 'DELETE']
    
    print(f"\n📈 SCORE DISTRIBUTION (Normalized 0-100):")
    print(f"\n   KEEP images ({len(keep_scores)}):")
    print(f"      Min:    {min(keep_scores):.1f}")
    print(f"      Max:    {max(keep_scores):.1f}")
    print(f"      Mean:   {sum(keep_scores)/len(keep_scores):.1f}")
    print(f"      Median: {sorted(keep_scores)[len(keep_scores)//2]:.1f}")
    
    print(f"\n   DELETE images ({len(delete_scores)}):")
    print(f"      Min:    {min(delete_scores):.1f}")
    print(f"      Max:    {max(delete_scores):.1f}")
    print(f"      Mean:   {sum(delete_scores)/len(delete_scores):.1f}")
    print(f"      Median: {sorted(delete_scores)[len(delete_scores)//2]:.1f}")
    
    print(f"\n📈 RAW SCORE DISTRIBUTION (App Scale):")
    print(f"\n   KEEP images:")
    print(f"      Min:    {min(keep_raw):.2f}")
    print(f"      Max:    {max(keep_raw):.2f}")
    print(f"      Mean:   {sum(keep_raw)/len(keep_raw):.2f}")
    print(f"      Median: {sorted(keep_raw)[len(keep_raw)//2]:.2f}")
    
    print(f"\n   DELETE images:")
    print(f"      Min:    {min(delete_raw):.2f}")
    print(f"      Max:    {max(delete_raw):.2f}")
    print(f"      Mean:   {sum(delete_raw)/len(delete_raw):.2f}")
    print(f"      Median: {sorted(delete_raw)[len(delete_raw)//2]:.2f}")
    
    # Optimal threshold results
    print(f"\n{'='*60}")
    print("🏆 OPTIMAL THRESHOLD")
    print(f"{'='*60}")
    
    print(f"\n   Threshold: {threshold:.1f}")
    print(f"   (Score >= {threshold:.1f} → KEEP, Score < {threshold:.1f} → DELETE)")
    
    print(f"\n   Performance:")
    print(f"      Accuracy:  {stats['accuracy']*100:.1f}%")
    print(f"      Precision: {stats['precision']*100:.1f}%")
    print(f"      Recall:    {stats['recall']*100:.1f}%")
    print(f"      F1 Score:  {stats['f1']*100:.1f}%")
    
    print(f"\n   Confusion Matrix:")
    print(f"                        Predicted")
    print(f"                    KEEP      DELETE")
    print(f"         KEEP    {stats['true_positives']:>5}     {stats['false_negatives']:>5}")
    print(f"   Actual")
    print(f"         DELETE  {stats['false_positives']:>5}     {stats['true_negatives']:>5}")
    
    print(f"\n   Summary:")
    print(f"      ✅ Correctly kept:    {stats['true_positives']}/{stats['total_keep']} ({stats['true_positives']/stats['total_keep']*100:.1f}%)")
    print(f"      ❌ Wrongly deleted:   {stats['false_negatives']}/{stats['total_keep']} ({stats['false_negatives']/stats['total_keep']*100:.1f}%)")
    print(f"      ✅ Correctly deleted: {stats['true_negatives']}/{stats['total_delete']} ({stats['true_negatives']/stats['total_delete']*100:.1f}%)")
    print(f"      ❌ Wrongly kept:      {stats['false_positives']}/{stats['total_delete']} ({stats['false_positives']/stats['total_delete']*100:.1f}%)")
    
    # Percentile thresholds
    print(f"\n{'='*60}")
    print("📊 PERCENTILE THRESHOLDS")
    print(f"{'='*60}")
    
    percentile_info = find_percentile_thresholds(results)
    
    print(f"\n   Percentile | Threshold | Keep Above | Delete Above")
    print(f"   -----------|-----------|------------|-------------")
    for p, info in percentile_info.items():
        keep_pct = info['keep_above'] / stats['total_keep'] * 100 if stats['total_keep'] > 0 else 0
        del_pct = info['delete_above'] / stats['total_delete'] * 100 if stats['total_delete'] > 0 else 0
        print(f"   {p:>9}% | {info['threshold']:>9.1f} | {info['keep_above']:>4} ({keep_pct:>5.1f}%) | {info['delete_above']:>4} ({del_pct:>5.1f}%)")
    
    # Recommendation
    print(f"\n{'='*60}")
    print("💡 RECOMMENDATION")
    print(f"{'='*60}")
    
    # Convert normalized threshold to raw using inverse sigmoid (logit)
    # normalized = sigmoid(raw) * 100
    # raw = logit(normalized / 100) = ln(p / (1-p))
    normalized_fraction = threshold / 100.0
    # Clamp to avoid log(0) or log(inf)
    normalized_fraction = max(0.001, min(0.999, normalized_fraction))
    raw_threshold = math.log(normalized_fraction / (1 - normalized_fraction))
    
    print(f"\n   Normalized Threshold: {threshold:.1f} (0-100 scale)")
    print(f"   Raw Threshold:        {raw_threshold:.2f} (app scale)")
    
    print(f"\n   ⚡ IN YOUR VIDEO PROCESSING APP, SET:")
    print(f"      Manual threshold: {raw_threshold:.2f}")
    print(f"\n   (The app uses raw scores in range ~-2 to ~2)")
    
    # Also find optimal raw threshold directly
    keep_raw = [r['raw'] for r in results if r['label'] == 'KEEP']
    delete_raw = [r['raw'] for r in results if r['label'] == 'DELETE']
    all_raw = sorted(set(keep_raw + delete_raw))
    
    best_raw_threshold = None
    best_raw_accuracy = 0
    
    for i in range(len(all_raw) - 1):
        t = (all_raw[i] + all_raw[i+1]) / 2
        tp = sum(1 for s in keep_raw if s >= t)
        tn = sum(1 for s in delete_raw if s < t)
        acc = (tp + tn) / (len(keep_raw) + len(delete_raw))
        if acc > best_raw_accuracy:
            best_raw_accuracy = acc
            best_raw_threshold = t
    
    if best_raw_threshold is not None:
        print(f"\n   🎯 OPTIMAL RAW THRESHOLD (calculated directly):")
        print(f"      Raw threshold: {best_raw_threshold:.2f}")
        print(f"      Accuracy:      {best_raw_accuracy*100:.1f}%")
    
    print()


if __name__ == '__main__':
    main()
