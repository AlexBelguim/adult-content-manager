import torch
from pathlib import Path

checkpoint_path = Path(r'f:\git\adult-content-manager\AI-Inference-App\models\final_model.pt')
if not checkpoint_path.exists():
    print("Checkpoint not found")
    exit()

checkpoint = torch.load(checkpoint_path, map_location='cpu')
print(f"Keys in checkpoint: {checkpoint.keys()}")
if 'config' in checkpoint:
    print(f"Config: {checkpoint['config']}")

state_dict = checkpoint.get('model_state_dict', checkpoint)
print("\nFirst 20 state_dict keys:")
for i, key in enumerate(list(state_dict.keys())[:20]):
    print(f"  {key}: {state_dict[key].shape}")

print("\nHead keys:")
for key in state_dict.keys():
    if 'head' in key:
        print(f"  {key}: {state_dict[key].shape}")
