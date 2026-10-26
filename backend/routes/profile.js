/**
 * Profile data — the performer profiles collected from Babepedia and Boobpedia on the GPU PC (extra/profile-data/collect.py),
 * Alex's verdicts on them and his duels between his keeps, for the page at /profile.html (the Taste Dashboard links it).
 *
 * Everything is in <data>/profile: <site>.jsonl and <site>/<slug>/<file> as collected, alex_labels / alex_duels /
 * alex_sorting.json as he answers, and predictions.json (P, the keep chance) and ranking.json (P2, how much he likes her) as
 * the follower on the GPU PC (performer_model.py --follow) sends them.
 *
 * - GET  /api/profile/performers   — every performer as a card: fields, verdict, in the app, popularity, P, P2, list place
 * - GET  /api/profile/performer    — ?site=&slug=: her record, verdict and P
 * - POST /api/profile/label        — { site, slug, verdict, reasons, note }: his verdict (verdict null clears it)
 * - GET  /api/profile/duel/next    — the next two keeps to compare, and how far the sorting is
 * - POST /api/profile/duel         — { a, b, winner: a|b|draw|skip }, or { undo: true }
 * - GET  /api/profile/model        — how P was made
 * - GET  /api/profile/training     — the follower's input: { verdicts, duels, lists }
 * - PUT  /api/profile/predictions  — the follower's P
 * - PUT  /api/profile/ranking      — the follower's P2
 * - GET  /api/profile/thumb, /full — ?site=&slug=&file=: one of her pictures (thumbnails kept in .thumbnails)
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../db');
const config = require('../config');

const DATA = path.join(config.dataPath, 'profile');
const SITES = ['babepedia', 'boobpedia'];
const LABELS = path.join(DATA, 'alex_labels.json');
const DUELS = path.join(DATA, 'alex_duels.json');
const SORTING = path.join(DATA, 'alex_sorting.json');
const PREDICTIONS = path.join(DATA, 'predictions.json');
const RANKING = path.join(DATA, 'ranking.json');

const readJson = (file, empty) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : empty);
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const norm = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const pairKey = (a, b) => JSON.stringify([a, b].sort());
const sameList = (x, y) => x.length === y.length && x.every((k, i) => k === y[i]);

function saveJson(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
  fs.renameSync(file + '.tmp', file);
}

// every performer once, by "site/slug": a Boobpedia performer gets the Babepedia pictures collect.py found for her (b1.jpg ...),
// and her own Babepedia record, when the collection has one too, is left out
function records() {
  const out = new Map();
  for (const site of SITES) for (const r of readLines(path.join(DATA, `${site}.jsonl`))) out.set(`${site}/${r.slug}`, r);
  for (const x of readLines(path.join(DATA, 'boobpedia_extra.jsonl'))) {
    const r = out.get(`boobpedia/${x.slug}`);
    if (r && x.pictures.length) {
      out.set(`boobpedia/${x.slug}`, { ...r, pictures: [...r.pictures, ...x.pictures], babepedia_slug: x.babepedia, babepedia_fields: x.babepedia_fields });
      out.delete(`babepedia/${x.babepedia}`);
    }
  }
  return out;
}

// her verdict; for a Boobpedia performer merged with her Babepedia twin, the twin's when she has none of her own
const labelOf = (r, lab) => lab[`${r.site}/${r.slug}`] || (r.babepedia_slug && lab[`babepedia/${r.babepedia_slug}`]) || null;

const SAME = { white: 'caucasian', latina: 'latin', latino: 'latin', hispanic: 'latin', ebony: 'black', brunette: 'brown',
  'strawberry blonde': 'blonde', auburn: 'red' };   // the two sites' words for one thing

function word(v) {
  const w = v ? v.split('/')[0].split(',')[0].trim().toLowerCase() : null;
  return SAME[w] || w;
}

// the fields both sites can be filtered on, in one vocabulary
function card(r) {
  const f = r.fields;
  const cup = /([A-K]+)/.exec(f.cup || '');
  const nat = f.boobs || f.natural;
  const tat = f.tattoos;
  return {
    site: r.site, slug: r.slug, name: r.name, pictures: r.pictures.length,
    hair: word(f.hair_color), eyes: word(f.eye_color), ethnicity: word(f.ethnicity), body: word(f.body_type),
    cup: cup ? cup[1][0] : null,
    natural: !nat ? null : /^(real|y)/i.test(nat) ? 'natural' : /^(fake|n)/i.test(nat) ? 'enhanced' : null,
    age: f.birth_year ? new Date().getFullYear() - f.birth_year : null,
    tattoos: tat == null ? null : ['none', 'no'].includes(tat.trim().toLowerCase()) ? 'none' : 'yes',
  };
}

// slug -> her best rank on Babepedia's popularity lists (collect.py BP_POPULAR), 1 the most popular
function popularity() {
  const best = {};
  for (const slugs of Object.values(readJson(path.join(DATA, 'babepedia_popular.json'), {}))) {
    slugs.forEach((s, i) => { best[s] = Math.min(best[s] ?? i + 1, i + 1); });
  }
  return best;
}

// the app's performer names and aliases, normalized, to mark the ones Alex already has
function inApp() {
  const names = new Set();
  for (const p of db.prepare('SELECT p.name, p.aliases FROM performers p JOIN folders f ON p.folder_id = f.id').all()) {
    names.add(norm(p.name));
    for (const a of (p.aliases || '').split(/[,;|]/)) if (a.trim()) names.add(norm(a));
  }
  names.delete('');
  return names;
}

// Which two keeps duel: group and merge (Alex, 2026-10-25). Up to GROUP of his page keeps and loves, spread over the ranking's
// guess, are sorted by binary insertion; sorted lists of similar length are merged two by two, as in merge sort, so the ordered
// pairs inside a list (far more than the duels it took) teach P2 too. A few leftovers go into the longest list; with everyone in
// one list the closest unasked pairs of the ranking refine it. A draw or a skip is "about the same": the newcomer goes below,
// the left list's performer first. The state is alex_sorting.json, with the states before his last answers for Undo.
const GROUP = 12;

const sorting = () => readJson(SORTING, { lists: [], task: null, history: [] });

// Alex's page keeps and loves -> the ranking's guess for them (P2, else P's keep chance, love one higher)
function keptScores(recs, lab) {
  const rank = readJson(RANKING, { score: {} }).score, pred = readJson(PREDICTIONS, { keep_chance: {} }).keep_chance, out = {};
  for (const [key, r] of recs) {
    const v = (labelOf(r, lab) || {}).verdict;
    if (v === 'keep' || v === 'love') out[key] = key in rank ? rank[key] : (pred[key] || 0.5) + (v === 'love' ? 1 : 0);
  }
  return out;
}

// performers no longer kept leave the lists; a task that holds one starts over
function clean(st, scores) {
  st.lists = st.lists.map((l) => l.filter((k) => k in scores)).filter((l) => l.length);
  const t = st.task;
  if (t && !(t.type === 'sort' ? [...t.sorted, ...t.todo] : [...t.left, ...t.right]).every((k) => k in scores)) st.task = null;
}

function newTask(st, scores) {
  const lists = [...st.lists].sort((x, y) => x.length - y.length);
  if (lists.length >= 2 && lists[0].length >= GROUP && lists[1].length <= 2 * lists[0].length) {
    return { type: 'merge', left: lists[0], right: lists[1], out: [], i: 0, j: 0 };
  }
  const placed = new Set(st.lists.flat());
  const loose = Object.keys(scores).filter((k) => !placed.has(k)).sort((a, b) => scores[a] - scores[b] || (a < b ? -1 : 1));
  if (loose.length >= 4 || (loose.length && !st.lists.length)) {
    const n = Math.min(GROUP, loose.length);
    const pick = [...new Set(Array.from({ length: n }, (_, i) => loose[Math.round(i * (loose.length - 1) / Math.max(1, n - 1))]))];   // lowest to highest guess
    for (let i = pick.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pick[i], pick[j]] = [pick[j], pick[i]];
    }
    return { type: 'sort', into: null, sorted: pick.slice(0, 1), todo: pick.slice(1), lo: 0, hi: 1 };
  }
  if (loose.length) {
    const main = st.lists.reduce((a, b) => (b.length > a.length ? b : a));
    return { type: 'sort', into: true, sorted: [...main], todo: loose, lo: 0, hi: main.length };
  }
  if (lists.length >= 2) {   // the remaining lists differ too much in length to wait for a partner
    return { type: 'merge', left: lists[0], right: lists[1], out: [], i: 0, j: 0 };
  }
  return null;
}

const taskPair = (t) => (t.type === 'sort' ? [t.todo[0], t.sorted[Math.floor((t.lo + t.hi) / 2)]] : [t.left[t.i], t.right[t.j]]);

function taskProgress(t, st) {
  if (!t) return `All ${st.lists.flat().length} in one list: refining`;
  if (t.type === 'merge') return `Merging ${t.left.length} + ${t.right.length}: ${t.out.length} of ${t.left.length + t.right.length} placed`;
  if (t.into) return `Adding ${t.todo.length} to your list of ${t.sorted.length}`;
  return `Sorting a group: ${t.sorted.length} of ${t.sorted.length + t.todo.length} placed`;
}

// a sort task with no one left to place becomes a list (stragglers: the list they joined, which it replaces)
function finish(st) {
  const t = st.task;
  if (t && t.type === 'sort' && !t.todo.length) {
    if (t.into) st.lists = st.lists.filter((l) => !l.every((k) => t.sorted.includes(k)));
    st.lists.push(t.sorted);
    st.task = null;
  }
}

// the task one step on after a duel: winner = the key that won, null for a draw or a skip
function answer(st, winner) {
  const t = st.task;
  if (t.type === 'sort') {
    const mid = Math.floor((t.lo + t.hi) / 2);
    if (winner === t.todo[0]) t.hi = mid;
    else t.lo = mid + 1;
    if (t.lo >= t.hi) {
      t.sorted.splice(t.lo, 0, t.todo.shift());
      t.lo = 0;
      t.hi = t.sorted.length;
    }
    finish(st);
  } else {
    const x = t.left[t.i], y = t.right[t.j];
    if (winner === y) { t.out.push(y); t.j += 1; } else { t.out.push(x); t.i += 1; }
    if (t.i === t.left.length || t.j === t.right.length) {
      st.lists = st.lists.filter((l) => !sameList(l, t.left) && !sameList(l, t.right));
      st.lists.push([...t.out, ...t.left.slice(t.i), ...t.right.slice(t.j)]);
      st.task = null;
    }
  }
}

// with everyone sorted: of the pairs that sit closest in the ranking's guess, one not asked yet, fewest duels first
function closestPair(scores, done, count) {
  const asked = new Set(done.map((d) => pairKey(d.a, d.b)));
  const kept = Object.keys(scores).sort((a, b) => scores[a] - scores[b] || (a < b ? -1 : 1));
  const cands = [];
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < Math.min(i + 4, kept.length); j++) {
      if (!asked.has(pairKey(kept[i], kept[j]))) {
        cands.push([scores[kept[j]] - scores[kept[i]] + 0.02 * ((count[kept[i]] || 0) + (count[kept[j]] || 0)), kept[i], kept[j]]);
      }
    }
  }
  if (!cands.length) return [null, null];
  const top = cands.sort((x, y) => x[0] - y[0]).slice(0, 12);
  return top[Math.floor(Math.random() * top.length)].slice(1);
}

router.get('/duel/next', (req, res) => {
  const recs = records(), lab = readJson(LABELS, {}), done = readJson(DUELS, []);
  const count = {};
  for (const d of done) for (const k of [d.a, d.b]) count[k] = (count[k] || 0) + 1;
  const st = sorting(), scores = keptScores(recs, lab);
  clean(st, scores);
  while (!st.task) {
    st.task = newTask(st, scores);
    if (!st.task) break;
    finish(st);   // a group of one is a list at once
  }
  saveJson(SORTING, st);
  const [a, b] = st.task ? taskPair(st.task) : closestPair(scores, done, count);
  const info = { done: done.length, kept: Object.keys(scores).length, progress: taskProgress(st.task, st), lists: st.lists.map((l) => l.length).sort((x, y) => y - x) };
  if (a == null) return res.json({ ...info, a: null, b: null });
  const side = (key) => {
    const r = recs.get(key);
    return { ...card(r), key, pictures: r.pictures, duels: count[key] || 0, verdict: (labelOf(r, lab) || {}).verdict || null };
  };
  const [x, y] = Math.random() < 0.5 ? [a, b] : [b, a];
  res.json({ ...info, a: side(x), b: side(y) });
});

// a duel's outcome: winner a, b, draw (alike) or skip (no answer); it also moves the sorting task on when the pair is its
// current one. undo removes the last duel and puts the sorting back as it was before it
router.post('/duel', (req, res) => {
  const q = req.body;
  let done = readJson(DUELS, []);
  const st = sorting();
  if (q.undo) {
    done = done.slice(0, -1);
    const prev = st.history.pop();
    if (prev) { st.lists = prev.lists; st.task = prev.task; }
  } else {
    if (!['a', 'b', 'draw', 'skip'].includes(q.winner)) return res.status(400).json({ error: 'winner must be a, b, draw or skip' });
    const mode = st.task && pairKey(...taskPair(st.task)) === pairKey(q.a, q.b) ? st.task.type : 'refine';
    done.push({ a: q.a, b: q.b, winner: q.winner, mode, at: stamp() });
    st.history = [...st.history, JSON.parse(JSON.stringify({ lists: st.lists, task: st.task }))].slice(-30);
    if (mode !== 'refine') answer(st, q.winner === 'a' ? q.a : q.winner === 'b' ? q.b : null);
  }
  saveJson(DUELS, done);
  saveJson(SORTING, st);
  res.json({ done: done.length });
});

router.get('/model', (req, res) => {
  const p = readJson(PREDICTIONS, {});
  res.json({ model: p.model ?? null, made: p.made ?? null, judged: p.judged ?? null });
});

router.get('/performers', (req, res) => {
  const lab = readJson(LABELS, {}), have = inApp(), rank = popularity();
  const pred = readJson(PREDICTIONS, { keep_chance: {} }).keep_chance, p2 = readJson(RANKING, { score: {} }).score;
  const lpos = {};
  [...sorting().lists].sort((x, y) => y.length - x.length).forEach((l, i) => l.forEach((k, j) => { lpos[k] = i * 100000 + j; }));
  res.json([...records()].map(([key, r]) => ({
    ...card(r), label: (labelOf(r, lab) || {}).verdict || null, in_app: have.has(norm(r.name)),
    rank: rank[r.site === 'babepedia' ? r.slug : r.babepedia_slug] ?? null,
    pred: pred[key] ?? null, p2: p2[key] ?? null, lpos: lpos[key] ?? null,
  })));
});

router.get('/performer', (req, res) => {
  const key = `${req.query.site}/${req.query.slug}`, r = records().get(key);
  if (!r) return res.status(404).json({ error: 'no such performer' });
  res.json({ ...r, label: labelOf(r, readJson(LABELS, {})), pred: readJson(PREDICTIONS, { keep_chance: {} }).keep_chance[key] ?? null });
});

// Alex's verdict on one performer: keep, love (a keep he likes a lot) or delete (null clears it), the deciding traits, a note;
// bad = no usable picture, left out of any training
router.post('/label', (req, res) => {
  const { site, slug, verdict = null, reasons = [], note = '' } = req.body;
  const key = `${site}/${slug}`;
  if (!records().has(key) || !['keep', 'love', 'delete', 'bad', null].includes(verdict)) {
    return res.status(400).json({ error: 'unknown performer or verdict' });
  }
  const lab = readJson(LABELS, {});
  if (verdict === null) delete lab[key];
  else lab[key] = { verdict, reasons: reasons.slice(0, 20).map((x) => String(x).slice(0, 40)), note: String(note).slice(0, 500), at: stamp() };
  saveJson(LABELS, lab);
  res.json(lab[key] || null);
});

// the follower's input: his verdict per performer, his duels and his sorted lists
router.get('/training', (req, res) => {
  const lab = readJson(LABELS, {}), verdicts = {};
  for (const [key, r] of records()) {
    const v = (labelOf(r, lab) || {}).verdict;
    if (v) verdicts[key] = v;
  }
  res.json({ verdicts, duels: readJson(DUELS, []), lists: sorting().lists });
});

router.put('/predictions', (req, res) => {
  if (!req.body.keep_chance) return res.status(400).json({ error: 'keep_chance required' });
  saveJson(PREDICTIONS, req.body);
  res.json({ ok: true });
});

router.put('/ranking', (req, res) => {
  if (!req.body.score) return res.status(400).json({ error: 'score required' });
  saveJson(RANKING, req.body);
  res.json({ ok: true });
});

// one of her pictures: only a file her record lists, so no other path is ever read
function picturePath(site, slug, file) {
  const r = SITES.includes(site) && records().get(`${site}/${slug}`);
  return r && r.pictures.includes(file) ? path.join(DATA, site, slug, file) : null;
}

router.get('/thumb', async (req, res) => {
  const { site, slug, file = '1.jpg' } = req.query;
  const src = picturePath(site, slug, file);
  if (!src) return res.status(404).end();
  const thumb = path.join(DATA, '.thumbnails', site, slug, file);
  try {
    if (!fs.existsSync(thumb)) {
      const buf = await sharp(src).resize(360, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      fs.mkdirSync(path.dirname(thumb), { recursive: true });
      fs.writeFileSync(thumb + '.tmp', buf);
      fs.renameSync(thumb + '.tmp', thumb);
    }
  } catch (err) {
    return res.status(500).json({ error: `unreadable picture: ${err.message}` });
  }
  res.set('Cache-Control', 'public, max-age=86400').sendFile(thumb);
});

router.get('/full', (req, res) => {
  const src = picturePath(req.query.site, req.query.slug, req.query.file);
  if (!src) return res.status(404).end();
  res.sendFile(src);
});

module.exports = router;
