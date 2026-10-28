"""P and P2, the profile page's performer models (2026-10-25; part of the AI app since 2026-10-27, before that a script of their own).
P, the "would Alex like her" model: one keep chance per performer. Each performer is the mean of her pictures' L2-normalized CLIP
ViT-L/336 embeddings (the backbone of the app's CLIP taste models); a class-balanced logistic regression learns from Alex's verdicts on
the profile page (bad data left out) and from his own app's performers, kept (keep folder) = keep and delete-only (disliked,
blacklisted) = delete, counted APP_WEIGHT times. Without them the model ranked his app right (kept above disliked 82% of the time) but
put nearly all of them over 50%; with them x10 kept 91% and disliked 45% are over 50%, at a small cost on the page (AUC 0.892 -> 0.884;
app_train_cv.py, 2026-10-25). The site fields (ethnicity, hair, body, cup...) never beat the pictures alone, and the app's performers
have none, so the model uses pictures only.
P2, how much he likes a performer, learns from his duels (see train_p2).
App pictures are the synced copy in training_data (the keep/delete folders the trainer uses). CLIP runs on the GPU when no scenetest
GPU job holds its lock and 3 GB are free, else on the CPU; embeddings are cached in D:\\profile_data\\clip_feats.pt, so only new
pictures are embedded.
The profile page lives in the app (/profile.html, backend/routes/profile.js): Alex's verdicts, duels and sorted lists come from there,
and the keep chance and P2's ranking go back there. The pictures and the <site>.jsonl index are read from the collection in
D:\\profile_data (extra/profile-data/collect.py); the app holds a copy of them.
server.py starts follow() when it starts: P and P2 are retrained on every new verdict or duel while the AI app runs, cross-validated
again every 25, and then saved to models/performer_keep/performer_keep.pt and models/performer_rank/performer_rank.pt.

    venv\\Scripts\\python.exe -X utf8 performer_model.py [--before N]
      once:     the cross-validation -> data/performer_model.json
      --before: the keep chance of every performer in the app's "before filter performer" folder, from N random pictures each
                (their embeddings in a cache of their own, clip_feats_before.pt) -> D:\\profile_data\\before_ranking.json, which
                extra/taste-preview shows next to each performer"""
import argparse
import json
import os
import random
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import torch
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import KFold, StratifiedKFold

from model_dinov2 import ClipPreferenceModel, image_processor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = r"D:\profile_data"
PROFILE = "http://192.168.1.125:4069/api/profile"   # the app's backend
SITES = ("babepedia", "boobpedia")
APP = os.path.join(HERE, "training_data")
BEFORE = r"Z:\Apps\adultManager\media\before filter performer"
APP_WEIGHT = 10
CACHE = os.path.join(DATA, "clip_feats.pt")
BACKBONE = "openai/clip-vit-large-patch14-336"
REPORT = os.path.join(HERE, "data", "performer_model.json")
P_FILE = os.path.join(HERE, "models", "performer_keep", "performer_keep.pt")
P2_FILE = os.path.join(HERE, "models", "performer_rank", "performer_rank.pt")
LOCK = r"F:\git\scenetest\data\runs\bakeoff.lock"   # held by a scenetest GPU job such as a labelmaster training
STATE = {"running": False}   # what follow() did last, for /health
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def gpu_ok():
    """the GPU is ours: no scenetest GPU job (its memory use swings, so free memory alone said yes mid-training) and 3 GB free"""
    if os.path.exists(LOCK):
        return False
    out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout
    return int(out.split()[0]) * 2**20 > 3 * 2**30


def path_of(key):
    """a picture key: (site, slug, file) of the profile data, ("app", keep|delete, performer, file), or ("before", performer, path
    inside her folder)"""
    return os.path.join(APP, *key[1:]) if key[0] == "app" else os.path.join(BEFORE, *key[1:]) if key[0] == "before" else os.path.join(DATA, *key)


class Embedder:
    def __init__(self, cache=CACHE):
        self.device = "cuda" if gpu_ok() else "cpu"
        self.model = ClipPreferenceModel(BACKBONE).to(self.device).eval()
        self.processor = image_processor(BACKBONE)
        self.path = cache
        self.cache = torch.load(cache) if os.path.exists(cache) else {}
        print(f"P: CLIP on the {self.device}; {len(self.cache)} pictures cached", flush=True)

    def pixels(self, key):
        try:
            return self.processor(images=[Image.open(path_of(key)).convert("RGB")], return_tensors="pt")["pixel_values"][0]
        except Exception:
            return None

    def embed(self, keys, quiet=False):
        """the missing keys embedded and cached, every 640 saved"""
        todo = [k for k in dict.fromkeys(keys) if "/".join(k) not in self.cache]
        t0 = time.time()
        with ThreadPoolExecutor(8) as pool:
            for i in range(0, len(todo), 32):
                part = todo[i:i + 32]
                ok = [(k, x) for k, x in zip(part, pool.map(self.pixels, part)) if x is not None]
                if ok:
                    with torch.no_grad(), torch.autocast("cuda", enabled=self.device == "cuda"):
                        f = self.model.features(torch.stack([x for _, x in ok]).to(self.device)).float().cpu()
                    for (k, _), e in zip(ok, torch.nn.functional.normalize(f, dim=-1)):
                        self.cache["/".join(k)] = e.half()
                if (i // 32) % 20 == 19 or i + 32 >= len(todo):
                    torch.save(self.cache, self.path)
                    if not quiet:
                        print(f"P: embedded {min(i + 32, len(todo))} of {len(todo)} ({time.time() - t0:.0f} s)", flush=True)

    def vector(self, keys):
        """a performer: the mean of her embedded pictures, normalized; None when none is embedded"""
        vs = [self.cache["/".join(k)] for k in keys if "/".join(k) in self.cache]
        return torch.nn.functional.normalize(torch.stack(vs).float().mean(0), dim=0).numpy() if vs else None


def pictures(r):
    return [(r["site"], r["slug"], f) for f in r["pictures"]]


def records():
    """every performer once, as the page lists her (backend/routes/profile.js records()): a Boobpedia performer gets the Babepedia
    pictures collect.py enrich found for her (b1.jpg ...), and her own Babepedia record, when the collection has one too, is left out"""
    out = {}
    for site in SITES:
        path = os.path.join(DATA, f"{site}.jsonl")
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                r = json.loads(line)
                out[(site, r["slug"])] = r
    path = os.path.join(DATA, "boobpedia_extra.jsonl")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            x = json.loads(line)
            r = out.get(("boobpedia", x["slug"]))
            if r and x["pictures"]:
                out[("boobpedia", x["slug"])] = {**r, "pictures": r["pictures"] + x["pictures"], "babepedia_slug": x["babepedia"]}
                out.pop(("babepedia", x["babepedia"]), None)
    return out


def popularity():
    """slug -> her best rank on Babepedia's popularity lists (collect.py BP_POPULAR), 1 the most popular"""
    path = os.path.join(DATA, "babepedia_popular.json")
    best = {}
    if os.path.exists(path):
        for slugs in json.load(open(path, encoding="utf-8")).values():
            for i, s in enumerate(slugs, 1):
                best[s] = min(best.get(s, i), i)
    return best


def api(path, body=None):
    """GET from the app's profile API, or PUT body to it"""
    req = urllib.request.Request(PROFILE + path, None if body is None else json.dumps(body).encode(), {"Content-Type": "application/json"},
                                 method="GET" if body is None else "PUT")
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def model(C):
    return LogisticRegression(C=C, max_iter=5000, class_weight="balanced")


class Data:
    """the page's performers and Alex's verdicts, duels and sorted lists on them; his app's performers that he did not also judge
    on the page"""
    def __init__(self, test=None):
        """test: a test's id, to learn from that test's selection instead of the one Training data picks now"""
        self.recs = records()
        t = api("/training" + (f"?test={test}" if test is not None else ""))
        self.verdict = {k: t["verdicts"].get(f"{k[0]}/{k[1]}") for k in self.recs}
        self.duels, self.lists = t["duels"], t["lists"]
        # what Training data picks (the rounds of each source, and whether his library counts); a new selection is retrained at once
        self.selection, self.selection_text = t.get("selection"), t.get("selection_text", "all verdicts")
        # Discover verdicts (source "discover") count only for the performers in records(): the app's discovery endpoint, once
        # built, has to add her to the collection with her pictures (as collect.py does) for P to learn from her
        self.judged = [k for k, v in self.verdict.items() if v in ("keep", "love", "delete")]   # love is a keep he likes a lot
        seen = {norm(self.recs[k]["name"]) for k in self.judged}
        kept = set(os.listdir(os.path.join(APP, "keep")))
        self.app = {}   # performer -> (picture keys, kept)
        for folder in ("keep", "delete") if t.get("app", True) else ():
            for p in os.listdir(os.path.join(APP, folder)):
                if norm(p) not in seen and (folder == "keep" or p not in kept):
                    self.app[p] = ([("app", folder, p, f) for f in os.listdir(os.path.join(APP, folder, p))], folder == "keep")

    def grid_order(self):
        """the unjudged performers as the page's grid sorts them by default: best popularity rank first, the newest first after"""
        rank, keys = popularity(), list(self.recs)
        r = lambda k: rank.get(k[1] if k[0] == "babepedia" else self.recs[k].get("babepedia_slug"))
        return sorted((k for k in keys if self.verdict[k] is None), key=lambda k: (r(k) or 1e9, -keys.index(k)))

    def training(self, emb):
        """(page vectors, their verdicts, app vectors, kept or not)"""
        page = [(emb.vector(pictures(self.recs[k])), self.verdict[k] in ("keep", "love")) for k in self.judged]
        page = [(v, y) for v, y in page if v is not None]
        app = [(emb.vector(keys), kept) for keys, kept in self.app.values()]
        app = [(v, y) for v, y in app if v is not None]
        Xp = np.stack([v for v, _ in page])
        # his library left out under Training data: no app rows (the fit and the cross-validation then use the page alone)
        Xa = np.stack([v for v, _ in app]) if app else np.zeros((0, Xp.shape[1]), Xp.dtype)
        return Xp, np.array([y for _, y in page], int), Xa, np.array([y for _, y in app], int)

    def duel_pairs(self, emb):
        """(winner vectors, loser vectors) of his decisive duels (draws and skips teach nothing)"""
        key = lambda s: tuple(s.split("/", 1))
        pairs = []
        for x in self.duels:
            if x["winner"] in ("a", "b") and key(x["a"]) in self.recs and key(x["b"]) in self.recs:
                w, l = (x["a"], x["b"]) if x["winner"] == "a" else (x["b"], x["a"])
                vw, vl = emb.vector(pictures(self.recs[key(w)])), emb.vector(pictures(self.recs[key(l)]))
                if vw is not None and vl is not None:
                    pairs.append((vw, vl))
        return pairs


def fit(C, Xp, yp, Xa, ya):
    return model(C).fit(np.vstack([Xp, Xa]), np.concatenate([yp, ya]),
                        sample_weight=np.concatenate([np.ones(len(yp)), np.full(len(ya), APP_WEIGHT)]))


def ranknet(diff, weight=None):
    """P2's linear score: a logistic regression on winner - loser vectors, both orders"""
    w = None if weight is None else np.r_[weight, weight]
    return LogisticRegression(C=1.0, max_iter=5000, fit_intercept=False).fit(np.vstack([diff, -diff]), np.r_[np.ones(len(diff)), np.zeros(len(diff))],
                                                                             sample_weight=w)


def cross_validate(emb, d, report_file=REPORT):
    """5-fold on the page verdicts (the app's performers in every training fold) and on the app's performers (every page verdict
    in training), for a few C; and P2 on held-out duels, trained on the other duels only (the sorted lists are built from these same
    duels, so they would leak the answers). Without his library (Training data) only the page is cross-validated. A test writes
    no report file (report_file None): its outcome goes back to the page instead"""
    Xp, yp, Xa, ya = d.training(emb)
    folds = lambda y: StratifiedKFold(5, shuffle=True, random_state=7).split(np.zeros(len(y)), y)
    with_app = len(ya) >= 10 and len(set(ya.tolist())) == 2
    res = {"made": time.strftime("%Y-%m-%d %H:%M"), "learned from": d.selection_text, "judged": len(yp), "keep": int(yp.sum()),
           "app performers": len(ya), "app kept": int(ya.sum()), "app weight": APP_WEIGHT, "cross-validated AUC": {}}
    best = None
    for C in (0.3, 1.0, 3.0):
        pp, pa = np.zeros(len(yp)), np.zeros(len(ya))
        for tr, te in folds(yp):
            pp[te] = fit(C, Xp[tr], yp[tr], Xa, ya).decision_function(Xp[te])
        if with_app:
            for tr, te in folds(ya):
                pa[te] = fit(C, Xp, yp, Xa[tr], ya[tr]).predict_proba(Xa[te])[:, 1]
        auc = roc_auc_score(yp, pp)
        res["cross-validated AUC"][f"C={C}"] = {"page": round(auc, 3)}
        if with_app:
            res["cross-validated AUC"][f"C={C}"].update({"app": round(roc_auc_score(ya, pa), 3),
                                                         "app kept over 50%": round(float((pa[ya == 1] >= 0.5).mean()), 3),
                                                         "app deleted over 50%": round(float((pa[ya == 0] >= 0.5).mean()), 3)})
        if best is None or auc > best[0]:
            best = (auc, C)
    duels = d.duel_pairs(emb)
    res["duels"] = len(duels)
    if len(duels) >= 10:
        diff, right = np.stack([w - l for w, l in duels]), np.zeros(len(duels), bool)
        for tr, te in KFold(5, shuffle=True, random_state=7).split(diff):
            right[te] = ranknet(diff[tr]).decision_function(diff[te]) > 0
        res["P2 held-out duels right"] = round(float(right.mean()), 3)
    res["best"] = {"C": best[1], "auc": round(best[0], 3), "app_auc": res["cross-validated AUC"][f"C={best[1]}"].get("app")}
    if report_file:
        json.dump(res, open(report_file, "w"), indent=1)
    print(f"P: cross-validated on {len(yp)} verdicts: page AUC {res['best']['auc']}, app {res['best']['app_auc']}; "
          f"P2 {res.get('P2 held-out duels right')} of {len(duels)} held-out duels", flush=True)
    return res


def save(path, ckpt):
    """the checkpoint written in place (the AI app's model list may be reading it)"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    torch.save(ckpt, path + ".tmp")
    os.replace(path + ".tmp", path)


def predict(emb, d, report, write):
    """the model on every page verdict and app performer; its keep chance for every page performer with an embedded picture; saved
    to P_FILE when write"""
    best = report["best"]
    Xp, yp, Xa, ya = d.training(emb)
    final = fit(best["C"], Xp, yp, Xa, ya)
    out = {}
    for k, r in d.recs.items():
        v = emb.vector(pictures(r))
        if v is not None:
            out[f"{k[0]}/{k[1]}"] = round(float(final.predict_proba(v[None])[0, 1]), 3)
    api("/predictions", {"model": {**best, "variant": f"pictures, page verdicts + app performers x{APP_WEIGHT}" if len(ya) else "pictures, page verdicts",
                                   "learned_from": d.selection_text},
                         "made": time.strftime("%Y-%m-%d %H:%M"), "judged": len(yp), "keep_chance": out})
    if write:
        save(P_FILE, {"model_type": "performer_keep", "backbone": BACKBONE, "coef": torch.tensor(final.coef_[0], dtype=torch.float32),
                      "intercept": float(final.intercept_[0]), "config": {"C": best["C"], "app_weight": APP_WEIGHT, "class_weight": "balanced"},
                      "samples": {"page judged": len(yp), "page keep": int(yp.sum()), "app performers": len(ya), "app kept": int(ya.sum())},
                      "learned_from": d.selection_text,
                      "val_acc": best["auc"], "val_auc": report["cross-validated AUC"][f"C={best['C']}"], "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    return len(yp), len(out)


def train_p2(emb, d, report, write):
    """P2, how much Alex likes a performer: a linear score on her mean picture, learned from his duels (RankNet as a logistic
    regression on the difference of the two performers' vectors) -> the page, a score for every page performer with a picture; nothing
    before the first duel; saved to P2_FILE when write. Love above keep and his app's star ratings made it worse: on 126 duels, held
    out, duels alone picked the winner 64%, with those pairs added 58%, those pairs alone 35% (p2_check.py).
    The ordered pairs inside his sorted lists (group and merge on the page) count too, at half a duel's weight: each performer
    against the 20 below her (all pairs of 351 keeps would be 61k)"""
    key = lambda s: tuple(s.split("/", 1))
    pairs = d.duel_pairs(emb)
    weight = [1.0] * len(pairs)
    for l in d.lists:
        vs = [v for v in (emb.vector(pictures(d.recs[key(k)])) for k in l if key(k) in d.recs) if v is not None]
        for i in range(len(vs)):
            for j in range(i + 1, min(i + 21, len(vs))):
                pairs.append((vs[i], vs[j])); weight.append(0.5)
    if not pairs:
        return None
    m = ranknet(np.stack([w - l for w, l in pairs]), weight)
    score = {}
    for k, r in d.recs.items():
        v = emb.vector(pictures(r))
        if v is not None:
            score[f"{k[0]}/{k[1]}"] = round(float(m.decision_function(v[None])[0]), 4)
    duels = weight.count(1.0)
    api("/ranking", {"made": time.strftime("%Y-%m-%d %H:%M"), "duels": duels, "list_pairs": len(pairs) - duels,
                     "held_out": report.get("P2 held-out duels right"), "score": score})
    if write:
        save(P2_FILE, {"model_type": "performer_rank", "backbone": BACKBONE, "coef": torch.tensor(m.coef_[0], dtype=torch.float32),
                       "samples": {"duels": duels, "list pairs": len(pairs) - duels}, "val_acc": report.get("P2 held-out duels right"),
                       "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    return len(pairs)


MIN_EACH = 5   # keeps and deletes a selection needs at least: the 5-fold cross-validation needs 5 of each


def too_few(d):
    """why the verdicts of this selection cannot train P (too few keeps or deletes), or None"""
    keep = sum(d.verdict[k] in ("keep", "love") for k in d.judged)
    delete = len(d.judged) - keep
    if min(keep, delete) < MIN_EACH:
        return f"too few verdicts picked under Training data: {keep} keep, {delete} delete ({MIN_EACH} of each at least)"
    return None


def claim_test():
    """the oldest test queued under Training data (it is running from then on), or None; also None from a backend that has no tests
    yet (404), so a follower updated before the app keeps training"""
    try:
        return api("/tests/claim", {}).get("test")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def run_test(emb, test):
    """a test asked for under Training data: P cross-validated on exactly the rounds and sources that test picked (they may differ
    from what is picked now), the outcome sent back to the page, where "Use this version" sets the toggles back to that selection"""
    try:
        d = Data(test=test["id"])
        if too_few(d):
            raise ValueError(too_few(d))
        emb.embed([p for k in d.judged for p in pictures(d.recs[k])] + [p for keys, _ in d.app.values() for p in keys], quiet=True)
        r = cross_validate(emb, d, report_file=None)
        result = {"made": r["made"], "learned from": r["learned from"], "judged": r["judged"], "keep": r["keep"],
                  "app performers": r["app performers"], "auc": r["best"]["auc"], "app_auc": r["best"]["app_auc"], "C": r["best"]["C"],
                  "cross-validated AUC": r["cross-validated AUC"]}
        api(f"/tests/{test['id']}", {"status": "done", "result": result})
        print(f"P: test #{test['id']} ({r['learned from']}): page AUC {result['auc']}, app {result['app_auc']}", flush=True)
    except (urllib.error.URLError, TimeoutError):
        raise
    except Exception as e:   # a test that cannot run says why on the page, and the follower goes on
        api(f"/tests/{test['id']}", {"status": "failed", "error": str(e)})
        print(f"P: test #{test['id']} failed: {e}", flush=True)


def follow():
    """keeps going while Alex labels: retrains on every new verdict or duel (the cross-validation and the saved files again every 25,
    or at once when Training data picks other rounds or sources), runs the tests asked for on the page, and embeds the unjudged
    performers 20 at a time in the profile page's grid order (popular first) so the ones he sees next have a keep chance on the page"""
    emb, report, cv_at, picked = Embedder(), None, None, None
    STATE.update(running=True, device=emb.device)
    while True:
        try:
            test = claim_test()
            if test:
                run_test(emb, test)
            d = Data()
            if too_few(d):   # Training data picks (almost) nothing: P stays as it was until it picks enough
                if STATE.get("error") != too_few(d):
                    print(f"P: {time.strftime('%H:%M')} {too_few(d)}; P stays as it was", flush=True)
                STATE.update(error=too_few(d))
                time.sleep(60)
                continue
            emb.embed([p for k in d.judged for p in pictures(d.recs[k])] + [p for keys, _ in d.app.values() for p in keys], quiet=report is not None)
            now = len(d.judged) + len(d.duels)
            selection = json.dumps(d.selection, sort_keys=True)
            write = cv_at is None or now - cv_at >= 25 or selection != picked
            picked = selection
            if write:
                report, cv_at = cross_validate(emb, d), now
            ahead = [k for k in d.grid_order() if any("/".join(p) not in emb.cache for p in pictures(d.recs[k]))][:20]
            emb.embed([p for k in ahead for p in pictures(d.recs[k])], quiet=True)
            n, m = predict(emb, d, report, write)
            pair_count = train_p2(emb, d, report, write)
        except (urllib.error.URLError, TimeoutError) as e:   # the app is restarting or the NAS is off
            print(f"P: {time.strftime('%H:%M')} the app is unreachable ({e}); trying again in a minute", flush=True)
            STATE.update(error=str(e))
            time.sleep(60)
            continue
        except Exception as e:   # anything else (a selection sklearn cannot fit, a bad picture): logged, and the follower goes on
            print(f"P: {time.strftime('%H:%M')} training failed ({type(e).__name__}: {e}); trying again in a minute", flush=True)
            STATE.update(error=f"{type(e).__name__}: {e}")
            time.sleep(60)
            continue
        STATE.update(updated=time.strftime("%Y-%m-%d %H:%M"), judged=n, scored=m, p2_pairs=pair_count, device=emb.device, error=None)
        if (emb.device == "cuda") != gpu_ok():   # a labelmaster training started or ended: CLIP moves off or onto the GPU
            emb = None
            torch.cuda.empty_cache()
            emb = Embedder()
        if not ahead:
            time.sleep(60)


def start():
    threading.Thread(target=follow, name="performer_model", daemon=True).start()


def rank_before(n):
    """every "before filter performer" performer's keep chance from n random pictures (seeded by her name), by the model trained
    as predict() trains it"""
    emb = Embedder(cache=os.path.join(DATA, "clip_feats_before.pt"))
    picked = {}
    for p in sorted(os.listdir(BEFORE)):
        d = os.path.join(BEFORE, p, "pics") if os.path.isdir(os.path.join(BEFORE, p, "pics")) else os.path.join(BEFORE, p)
        if p.startswith(".") or not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png", ".webp", ".bmp"))
        sub = os.path.relpath(d, os.path.join(BEFORE, p))
        picked[p] = [("before", p, os.path.normpath(os.path.join(sub, f))) for f in random.Random(p).sample(files, min(n, len(files)))]
    print(f"{len(picked)} performers, {sum(map(len, picked.values()))} pictures", flush=True)
    emb.embed([k for ks in picked.values() for k in ks])
    trained = Embedder.__new__(Embedder)
    trained.cache = torch.load(CACHE)
    best = api("/model")["model"]
    final = fit(best["C"], *Data().training(trained))
    out = {}
    for p, ks in picked.items():
        v = emb.vector(ks)
        if v is not None:
            out[p] = {"keep_chance": round(float(final.predict_proba(v[None])[0, 1]), 3), "pictures": sum("/".join(k) in emb.cache for k in ks)}
    json.dump({"made": time.strftime("%Y-%m-%d %H:%M"), "model": best, "pictures_each": n, "performers": out},
              open(os.path.join(DATA, "before_ranking.json"), "w"), indent=1)
    for p, r in sorted(out.items(), key=lambda x: -x[1]["keep_chance"]):
        print(f"{r['keep_chance']:6.0%}  {p}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", type=int, default=0, help="rank the before folder from this many random pictures a performer")
    a = ap.parse_args()
    if a.before:
        rank_before(a.before)
    else:
        e, data = Embedder(), Data()
        e.embed([p for k in data.judged for p in pictures(data.recs[k])] + [p for keys, _ in data.app.values() for p in keys])
        cross_validate(e, data)
