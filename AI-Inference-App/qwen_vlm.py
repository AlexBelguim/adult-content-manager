"""
Qwen3.5-9B in the AI app, moved from the 2026-10-16 tests (the scenetest session's profile_* and kd_* scripts).

Tasks, each a LoRA in models/qwen/<task>_<date>/ (info.json: held-out performers and results):
    profile -> 8 kept pictures of one performer in, her profile (FIELDS) out as one JSON object, constrained to the
               label set (constrain.py). 3 sets of 8 are asked and voted; answers go to profile_labels.db as 'qwen'.
    keep    -> one picture in, p(keep) from the first answer token (keep vs delete). No stars, like the DINO binary.
    taste   -> the keep question trained on CLIP Taste's levels (2nd order test).

The base model is 4-bit nf4, about 6-7 GB of VRAM. It loads on first use with the adapter asked for and stays until
/qwen/unload or a training run, like the server's other models. Pictures go in at 448 px on the long side, as in
training. Needs transformers >= 5.2 (Qwen3.5).

Endpoints (registered at /qwen):
    GET  /qwen/health
    GET  /qwen/models
    GET  /qwen/labels                ?performer=&source=
    POST /qwen/profile               {performer, images: [paths] | folder, model?}
    POST /qwen/score                 {images: [paths], task='keep'|'taste', model?, threshold=50}
    POST /qwen/test                  {model, base_path?, per_performer=80}
    POST /qwen/unload
"""
import ctypes, gc, json, math, random, struct, sys, threading, time
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
import torch
from flask import Blueprint, request, jsonify
from peft import LoraConfig, PeftModel, get_peft_model
from PIL import Image, ImageOps
from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig, LogitsProcessorList
import constrain
import profile_labels

qwen_bp = Blueprint('qwen', __name__)

BASE = r"C:\Users\alexw\AppData\Roaming\StabilityMatrix\Packages\ComfyUI\models\text_encoders\Qwen3.5-9B"
QWEN_DIR = Path(__file__).parent / 'models' / 'qwen'
TASKS = ('profile', 'keep', 'taste')
SIDE = 448
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}
QUANT = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_quant_type='nf4', bnb_4bit_use_double_quant=True)
# LoRA on the language model's attention (full and linear) and MLP, and on the vision merger
TARGETS = (r"model\.language_model\.layers\.\d+\.(self_attn\.(q|k|v|o)_proj|linear_attn\.(in_proj_qkv|in_proj_z|out_proj)|"
           r"mlp\.(gate|up|down)_proj)|model\.visual\.merger\.linear_fc[12]")

FIELDS = {
    "hair_color": ["blonde", "light_brown", "brown", "black", "red", "dyed", "cannot_tell"],
    "hair_length": ["short", "shoulder", "long", "very_long", "cannot_tell"],
    "eye_color": ["blue", "green", "gray", "hazel", "brown", "cannot_tell"],
    "ethnicity": ["white", "latina", "asian", "black", "middle_eastern", "south_asian", "mixed", "cannot_tell"],
    "age_look": ["early_20s", "mid_20s", "late_20s", "30s", "40s_plus"],
    "body_type": ["petite", "slim", "athletic", "average", "curvy", "thick"],
    "breast_size": ["small", "medium", "large", "very_large", "cannot_tell"],
    "breast_type": ["natural", "enhanced", "cannot_tell"],
    "areola": ["small", "medium", "large", "puffy", "cannot_tell"],
    "butt": ["small", "medium", "large", "cannot_tell"],
    "style": ["girl_next_door", "glam", "alt_goth", "e_girl", "cosplay", "fitness", "elegant"],
    "tattoos": ["none", "few", "many", "cannot_tell"],
    "freckles": ["yes", "no", "cannot_tell"],
    "pubic_hair": ["shaved", "trimmed", "natural", "cannot_tell"],
}
RULES = ("hair_color: dyed = an unnatural colour (pink, blue, purple, green, white) or a coloured wig. "
         "eye_color and ethnicity: cannot_tell when her face is hidden. "
         "breast_type: enhanced = implants (round and high, they keep their shape when she lies down or leans over); natural = they hang and move naturally; "
         "cannot_tell when her breasts are covered. areola, pubic_hair, butt: cannot_tell when that part is covered or out of the frame. "
         "tattoos: few = one to three small ones. freckles: yes only for visible freckles on her face or body.")
Q_PROFILE = ("These pictures all show the same adult woman. Describe how she looks, judging from all of them together. " + RULES +
             " Answer with one JSON object on one line and nothing else: " + json.dumps({k: " | ".join(v) for k, v in FIELDS.items()}))
Q_KEEP = "Does Alex keep this picture of an adult performer, or delete it? Answer with one word: keep or delete."
# The profile test set stays frozen, so every retrain is scored on the same performers (the 2026-10-16 test's 8)
PROFILE_HOLDOUT = ["Amouranth", "rubyxparadise", "bratzmon", "lexi poy", "tbcosplay", "shawtnees", "Weijoannana", "kittybabykittyvip"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] [Qwen] {msg}", flush=True)


# Same convention as video_analyzer.py: ACM sends its own container paths.
def map_path(p):
    if str(p).startswith('/media'):
        return 'Z:\\Apps\\adultManager' + str(p)
    return str(p)


def performance_cores():
    """Keep this process on the CPU's performance cores. Windows moves a background process onto the i9-14900KF's
    efficiency cores, and Qwen3.5's linear attention without flash-linear-attention is a Python loop: 2x slower there."""
    if sys.platform != 'win32':
        return
    k = ctypes.WinDLL('kernel32')
    n = ctypes.c_ulong()
    k.GetSystemCpuSetInformation(None, 0, ctypes.byref(n), None, 0)
    buf = ctypes.create_string_buffer(n.value)
    k.GetSystemCpuSetInformation(buf, n, ctypes.byref(n), None, 0)
    cpus, off = [], 0
    while off < n.value:
        size, _, _, group, lp, _, _, _, eff = struct.unpack_from('<IIIHBBBBB', buf.raw, off)
        if group == 0:
            cpus.append((lp, eff))
        off += size
    best = max(e for _, e in cpus)
    if any(e != best for _, e in cpus):
        k.GetCurrentProcess.restype = ctypes.c_void_p
        k.SetProcessAffinityMask(ctypes.c_void_p(k.GetCurrentProcess()), ctypes.c_size_t(sum(1 << lp for lp, e in cpus if e == best)))


# ── Pictures and prompts ──────────────────────────────────────────────────────

def picture(path):
    """the picture at 448 px on the long side, or None when it can't be read"""
    try:
        im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    except OSError:
        return None
    im.thumbnail((SIDE, SIDE))
    return im


def performer_of(path):
    p = Path(path)
    return p.parent.parent.name if p.parent.name in ('pics', 'vids') else p.parent.name


def pictures_in(folder):
    p = Path(map_path(folder))
    return sorted(str(f) for f in p.rglob('*') if f.suffix.lower() in IMAGE_EXTS) if p.is_dir() else []


def inputs(processor, ims, text, answer=''):
    """the chat for these pictures and this question, tokenized; answer is appended after the assistant turn starts"""
    content = [{'type': 'image'}] if len(ims) == 1 else \
        [x for i in range(len(ims)) for x in ({'type': 'text', 'text': f'Picture {i + 1}:'}, {'type': 'image'})]
    msgs = [{'role': 'user', 'content': content + [{'type': 'text', 'text': text}]}]
    prompt = processor.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    return processor(text=[prompt + answer], images=ims, return_tensors='pt')


def keep_tokens(tokenizer):
    keep, delete = tokenizer.encode('keep', add_special_tokens=False)[0], tokenizer.encode('delete', add_special_tokens=False)[0]
    assert keep != delete
    return keep, delete


def keep_logit(model, processor, im):
    """log-odds of keep over delete as the first answer token: >= 0 means p(keep) >= 50%"""
    keep, delete = keep_tokens(processor.tokenizer)
    with torch.no_grad():
        logits = model(**inputs(processor, [im], Q_KEEP).to(model.device), logits_to_keep=1).logits[0, -1].float()
    return (logits[keep] - logits[delete]).item()


def profile_grammar():
    parts = [('lit', '{')]
    for i, (k, opts) in enumerate(FIELDS.items()):
        parts += [('lit', ('' if i == 0 else ', ') + '"%s": "' % k), ('enum', opts), ('lit', '"')]
    return constrain.Grammar(parts + [('lit', '}')])


def profile_tools(processor):
    """what constrained answers need: the vocabulary's token texts and the grammar, which caches its token masks"""
    return {'vocab': constrain.vocabulary(processor.tokenizer), 'grammar': profile_grammar()}


def ask_profile(model, processor, ims, tools):
    """one profile for one set of pictures; the answer can only be the FIELDS template with its options"""
    enc = inputs(processor, ims, Q_PROFILE).to(model.device)
    tok = processor.tokenizer
    eos = model.generation_config.eos_token_id
    eos = sorted({tok.convert_tokens_to_ids('<|im_end|>'), *(eos if isinstance(eos, list) else [eos])})
    lp = LogitsProcessorList([constrain.Constrained(tools['grammar'], tools['vocab'], eos, enc['input_ids'].shape[1])])
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=300, do_sample=False, logits_processor=lp, eos_token_id=eos)
    return json.loads(processor.decode(out[0][enc['input_ids'].shape[1]:], skip_special_tokens=True).strip())


def profile_sets(paths, seed, n=3, k=8):
    """up to n disjoint sets of k usable pictures (shuffled by seed); one smaller set when there are fewer than k"""
    paths = paths[:]
    random.Random(seed).shuffle(paths)
    ims = []
    for p in paths:
        im = picture(p)
        if im:
            ims.append(im)
        if len(ims) == n * k:
            break
    return [ims[i:i + k] for i in range(0, len(ims) - k + 1, k)] or ([ims] if ims else [])


def vote(answers):
    """per field: the most common answer that is not cannot_tell, else cannot_tell"""
    out = {}
    for k in FIELDS:
        seen = Counter(a[k] for a in answers if a[k] != 'cannot_tell')
        out[k] = seen.most_common(1)[0][0] if seen else 'cannot_tell'
    return out


def right(value, label):
    return value in label['any'] if isinstance(label, dict) else value == label


def profile_answer(labels):
    """(answer text, [(start, end) of each value left out of the loss]) for training: a field that was not labelled is in
    the answer but out of the loss; a set of fair values trains its first one"""
    text, skip = '{', []
    for i, (k, opts) in enumerate(FIELDS.items()):
        label = labels.get(k)
        v = label['any'][0] if isinstance(label, dict) else label
        if v is None:
            v = 'cannot_tell' if 'cannot_tell' in opts else opts[0]
        text += ('' if i == 0 else ', ') + f'"{k}": "'
        if label is None:
            skip.append((len(text), len(text) + len(v)))
        text += v + '"'
    return text + '}', skip


# ── Training pieces (the loops are in trainer.py) ─────────────────────────────

def lora():
    """(trainable LoRA model, processor). Set up to fit 16 GB: no prepare_model_for_kbit_training (it casts the 248k-token
    embedding and head to fp32), gradient checkpointing, and answer-only logits in the losses below."""
    performance_cores()
    processor = AutoProcessor.from_pretrained(BASE)
    model = AutoModelForImageTextToText.from_pretrained(BASE, quantization_config=QUANT, device_map='cuda')
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules=TARGETS, task_type='CAUSAL_LM'))
    return model, processor


def profile_loss(model, processor, ims, labels):
    answer, skip = profile_answer(labels)
    full = answer + '<|im_end|>\n'
    enc = inputs(processor, ims, Q_PROFILE, answer=full)
    a = processor.tokenizer(full, add_special_tokens=False, return_offsets_mapping=True)
    assert enc['input_ids'][0][-len(a['input_ids']):].tolist() == a['input_ids'], 'answer tokenizes differently inside the chat'
    target = torch.tensor(a['input_ids'], device=model.device)
    in_loss = torch.tensor([not any(s < e2 and e > s2 for s2, e2 in skip) for s, e in a['offset_mapping']], device=model.device)
    logits = model(**enc.to(model.device), logits_to_keep=len(target) + 1).logits[0, :-1]
    return torch.nn.functional.cross_entropy(logits[in_loss].float(), target[in_loss])


def keep_loss(model, processor, im, kept):
    keep, delete = keep_tokens(processor.tokenizer)
    logp = torch.log_softmax(model(**inputs(processor, [im], Q_KEEP).to(model.device), logits_to_keep=1).logits[0, -1].float(), 0)
    return -logp[keep if kept else delete]


def save_adapter(model, out_dir, info):
    model.save_pretrained(out_dir)
    (Path(out_dir) / 'info.json').write_text(json.dumps(info, indent=1), encoding='utf-8')


# ── The loaded model (one base model, adapters on top) ───────────────────────

_LOCK = threading.Lock()
_VLM = {'model': None, 'processor': None, 'tools': None, 'training': False}


def adapters(task=None):
    """[(adapter dir, info)], newest first"""
    out = []
    for d in QWEN_DIR.glob('*/info.json'):
        info = json.loads(d.read_text(encoding='utf-8'))
        if task is None or info['task'] == task:
            out.append((d.parent, info))
    return sorted(out, key=lambda x: x[1]['created_at'], reverse=True)


def adapter_dir(task, name=None):
    found = [d for d, _ in adapters(task) if name is None or d.name == name]
    if not found:
        raise FileNotFoundError(f"No Qwen {task} model{' ' + name if name else ''} in {QWEN_DIR}")
    return found[0]


@contextmanager
def using(adapter):
    """(model, processor) with this adapter active, held for the caller; loads the base model and the adapter the first time"""
    with _LOCK:
        yield _use(adapter)


def _use(adapter):
    if _VLM['training']:
        raise RuntimeError('Qwen is training; try again when the run is done')
    if _VLM['model'] is None:
        performance_cores()
        log(f"📦 Loading Qwen3.5-9B (4-bit) with {adapter.name}...")
        t0 = time.time()
        _VLM['processor'] = AutoProcessor.from_pretrained(BASE)
        base = AutoModelForImageTextToText.from_pretrained(BASE, quantization_config=QUANT, device_map='cuda')
        _VLM['model'] = PeftModel.from_pretrained(base, str(adapter), adapter_name=adapter.name)
        log(f"✅ Qwen loaded in {time.time() - t0:.0f}s, VRAM {torch.cuda.memory_allocated() / 2**30:.1f} GB")
    elif adapter.name not in _VLM['model'].peft_config:
        _VLM['model'].load_adapter(str(adapter), adapter_name=adapter.name)
    _VLM['model'].set_adapter(adapter.name)
    _VLM['model'].eval()
    return _VLM['model'], _VLM['processor']


def loaded():
    return _VLM['model'] is not None


def unload():
    with _LOCK:
        if _VLM['model'] is None:
            return False
        log("♻️ Unloading Qwen to free VRAM...")
        _VLM.update(model=None, processor=None, tools=None)
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            log(f"♻️ VRAM after Qwen unload: {torch.cuda.memory_allocated() / 2**20:.0f} MB")
        return True


@contextmanager
def training():
    """for a training run: frees the loaded model and refuses Qwen requests until the run ends, so they can't share the card"""
    _VLM['training'] = True
    unload()
    try:
        yield
    finally:
        _VLM['training'] = False


def profile_of(paths, performer, adapter):
    """(voted profile, the answers, pictures used) from up to 3 sets of 8 of these pictures"""
    sets = profile_sets(paths, 'profile ' + performer)
    if not sets:
        return None, [], 0
    with using(adapter) as (model, processor):
        _VLM['tools'] = _VLM['tools'] or profile_tools(processor)
        answers = [ask_profile(model, processor, s, _VLM['tools']) for s in sets]
    return vote(answers), answers, sum(len(s) for s in sets)


def keep_scores(paths, adapter):
    """{path: keep log-odds} for the pictures that could be read"""
    with using(adapter) as (model, processor):
        return {p: keep_logit(model, processor, im) for p in paths if (im := picture(p))}


# ── Endpoints ─────────────────────────────────────────────────────────────────

def _error(e, code=500):
    log(f"❌ {e}")
    return jsonify({'success': False, 'error': str(e)}), code


@qwen_bp.route('/health', methods=['GET'])
def health():
    model = _VLM['model']
    return jsonify({'loaded': model is not None, 'training': _VLM['training'],
                    'adapters': list(model.peft_config) if model is not None else [],
                    'vram_allocated': f"{torch.cuda.memory_allocated() / 2**20:.0f} MB" if torch.cuda.is_available() else "0 MB"})


@qwen_bp.route('/models', methods=['GET'])
def models():
    return jsonify({'success': True, 'models': [{'name': d.name, **info} for d, info in adapters()]})


@qwen_bp.route('/labels', methods=['GET'])
def labels():
    return jsonify({'success': True, 'profiles': profile_labels.profiles(request.args.get('performer'), request.args.get('source'))})


@qwen_bp.route('/profile', methods=['POST'])
def profile():
    data = request.json or {}
    performer = data.get('performer')
    paths = [map_path(p) for p in data.get('images', [])] or pictures_in(data.get('folder', ''))
    if not performer or not paths:
        return _error('performer and images (or a folder) required', 400)
    try:
        adapter = adapter_dir('profile', data.get('model'))
        t0 = time.time()
        labels, answers, used = profile_of(paths, performer, adapter)
        if labels is None:
            return _error('No readable pictures', 400)
        profile_labels.save(performer, 'qwen', labels, model=adapter.name, images=used)
        log(f"🏷️ Profile of '{performer}' from {used} pictures in {time.time() - t0:.0f}s")
        return jsonify({'success': True, 'performer': performer, 'labels': labels, 'answers': answers, 'images': used, 'model': adapter.name})
    except (FileNotFoundError, RuntimeError) as e:
        return _error(e, 409)


@qwen_bp.route('/score', methods=['POST'])
def score():
    """keep % per picture, in /classify_batch's shape"""
    data = request.json or {}
    paths = data.get('images', [])
    threshold = data.get('threshold', 50.0)
    if not paths:
        return _error('No images', 400)
    try:
        adapter = adapter_dir(data.get('task', 'keep'), data.get('model'))
        t0 = time.time()
        logits = keep_scores([map_path(p) for p in paths], adapter)
    except (FileNotFoundError, RuntimeError) as e:
        return _error(e, 409)
    results = []
    for p in paths:
        if map_path(p) in logits:
            s = 100 / (1 + math.exp(-logits[map_path(p)]))
            results.append({'path': p, 'score': s, 'decision': 'keep' if s >= threshold else 'delete', 'performer': performer_of(p)})
    log(f"✅ Scored {len(results)} pictures with {adapter.name} in {time.time() - t0:.1f}s")
    return jsonify({'success': True, 'results': results, 'model': adapter.name, 'duration': time.time() - t0})


@qwen_bp.route('/test', methods=['POST'])
def test():
    """a model's results on its held-out performers: profile fields right, or keep vs delete AUC"""
    from trainer import qwen_test  # trainer imports this module
    data = request.json or {}
    try:
        return jsonify({'success': True, 'results': qwen_test(data.get('model'), data.get('base_path'), data.get('per_performer', 80))})
    except (FileNotFoundError, RuntimeError, ValueError) as e:
        return _error(e, 409)


@qwen_bp.route('/unload', methods=['POST'])
def api_unload():
    return jsonify({'success': True, 'message': 'Qwen unloaded' if unload() else 'Qwen was not loaded'})
