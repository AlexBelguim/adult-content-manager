/**
 * What the AI & Training page knows about the models: the five live ones (K, CLIP Siamese, CLIP Taste, P, P2), how each
 * is measured, where the app uses it, and the history of the removed ones. The figures of a file come from acm-gpu
 * (/list_models); the hand-written texts here say only what no file can.
 */

// The one model setting with a reader: filterService.keepScores loads this K file for the filter view's AI toggle.
export const PREFERRED_K_KEY = 'preferred_clip_keepdelete_model';

export const TRAINABLE_TYPES = ['clip_keepdelete', 'clip_siamese', 'clip_taste'];
export const LIVE_TYPES = ['clip_keepdelete', 'clip_siamese', 'clip_taste', 'performer_keep', 'performer_rank'];

// The Train tab's model choice, in this order.
export const MODEL_TYPES = [
  {
    id: 'clip_keepdelete', name: 'K (keep / delete)',
    does: 'Gives any picture a keep % with a fixed 50% line, learned from your keeps and deletes alone. Refits on the performer you are sorting every 10 decisions.',
    requirements: 'Needs keep and delete folders pushed to the AI server; uses the performers that have both. No pairs, no stars. Fine-tunes SigLIP-384 with a LoRA, starting from ComfyUI\'s clip_vision/sigclip_vision_patch14_384 file on the AI PC. 15% of the performers are held out.',
    fixedRun: 'Fixed run: 3 epochs, batch 16, about 40 minutes.',
  },
  {
    id: 'clip_siamese', name: 'CLIP Siamese',
    does: 'Puts the pictures of one performer in order: kept beats deleted, and your hand-picked winners beat their losers. The scores are an order, not a %.',
    requirements: 'Needs keep and delete folders pushed to the AI server; also uses your same-performer hand pairs: Rank images, the legacy pairwise.db import and the legacy old labeller file on the AI PC. The first run downloads CLIP ViT-L/14-336 (about 1.7 GB) from Hugging Face.',
    fixedRun: null,
  },
  {
    id: 'clip_taste', name: 'CLIP Taste',
    does: 'Gives any picture a keep % with a fixed 50% line, inside a performer and across performers. Knows your disliked and blacklisted performers.',
    requirements: 'Needs keep and delete folders pushed to the AI server. Performers with only deleted pictures count as disliked, or as blacklisted when blacklisted in the app; stars only pick pairs (2+ stars apart), they are no input. Uses every hand pair, across performers too. 15% of the performers of every level are held out.',
    fixedRun: null,
  },
];

const NAMES = {
  clip_keepdelete: 'K (keep / delete)',
  clip_siamese: 'CLIP Siamese',
  clip_taste: 'CLIP Taste',
  performer_keep: 'P (performer keep %)',
  performer_rank: 'P2 (performer ranking)',
  binary: 'Simple Binary',
  ranked_binary: 'Ranked Binary',
  pairwise: 'DINO Pairwise',
  performer_ranker: 'Performer Ranker',
  unknown: 'Unknown',
};

export function modelName(type) {
  return NAMES[type] || type || 'Unknown';
}

const isNum = (v) => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const signed = (n, text) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${text}`;

const auc = (text) => ({
  label: 'AUC',
  format: (v) => (isNum(v) ? Number(v).toFixed(2) : '–'),
  diff: (a, b) => {
    if (!isNum(a) || !isNum(b)) return '';
    const d = Math.round((Number(a) - Number(b)) * 100) / 100;
    return signed(d, Math.abs(d).toFixed(2));
  },
  chance: 0.5,
  text,
});

const percent = (label, text) => ({
  label,
  format: (v) => (isNum(v) ? `${Math.round(Number(v) * 100)}%` : '–'),
  diff: (a, b) => {
    if (!isNum(a) || !isNum(b)) return '';
    const d = Math.round(Number(a) * 100) - Math.round(Number(b) * 100);
    return signed(d, `${Math.abs(d)} ${Math.abs(d) === 1 ? 'point' : 'points'}`);
  },
  chance: 0.5,
  text,
});

/** How a type's saved figure (val_acc, or the profile's figures for P and P2) reads: its name, format and test set. */
export function metricOf(type) {
  switch (type) {
    case 'clip_keepdelete':
      return auc('Keep vs delete inside one performer, on the 15% of performers held out of training');
    case 'clip_taste':
      return auc('Keep vs delete on the 15% of performers of every level held out of training');
    case 'clip_siamese':
      return percent('pairs right', 'Held-out pairs put in the right order: kept > deleted and the hand pairs of the performers held out of training');
    case 'performer_keep':
      return auc('Your profile-page verdicts, cross-validated');
    case 'performer_rank':
      return percent('of held-out duels right', 'Duels left out of training, cross-validated');
    default:
      return percent('saved figure', 'The figure saved with the file');
  }
}

/** What a file trained on: P and P2 save their samples by kind ({ 'page judged': 2329, ... }), the trainer one count. */
export function samplesText(type, samples) {
  if (samples == null) return '';
  if (typeof samples === 'object') {
    return Object.entries(samples)
      .map(([k, n]) => `${isNum(n) ? Number(n).toLocaleString() : n} ${k}`)
      .join(', ');
  }
  const n = isNum(samples) ? Number(samples).toLocaleString() : String(samples);
  if (type === 'clip_keepdelete') return `${n} pictures`;
  if (type === 'clip_siamese') return `${n} training pairs`;
  if (type === 'clip_taste') return `${n} pairs and pictures`;
  return `${n} samples`;
}

const validDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);

/** When a file was made: the trainer saves created_at as epoch seconds, P2 as an ISO string; else the file's mtime. */
export function fileDate(m) {
  if (!m) return null;
  const c = m.created_at;
  if (c != null && c !== '') {
    if (typeof c === 'number') return validDate(new Date(c * 1000));
    return validDate(new Date(c));
  }
  if (isNum(m.modified)) return validDate(new Date(Number(m.modified) * 1000));
  return null;
}

const asDate = (d) => {
  if (d == null || d === '') return null;
  return validDate(d instanceof Date ? d : new Date(d));
};

/** '3 Nov 2026' from a Date or epoch ms; '' for none. */
export function fmtDay(d) {
  const x = asDate(d);
  return x ? x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** '3 Nov 2026, 21:40' from a Date or epoch ms; '' for none. */
export function fmtWhen(d) {
  const x = asDate(d);
  if (!x) return '';
  return `${fmtDay(x)}, ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

/**
 * Hand-pair sources: Rank images (source NULL), the pairwise.db import, and the old labeller's file on the AI PC.
 * Legacy sources count, and train, only while "Use legacy pairs" is on. all = every pair that trains, across
 * performers too (CLIP 2nd order; "both bad" votes order nothing), same = same performer (CLIP 1st order).
 * The import's pairs of performers deleted from the app before it ran are in a PC file next to the labeller's.
 */
export function pairSourcesOf(training, aiTrainingData) {
  const tp = training?.pairwise || {};
  const labellerPairs = aiTrainingData?.labeller_pairs;
  const orphans = aiTrainingData?.pairwise_db_orphans;
  const rankPairs = (tp.rankPairs || 0) - (tp.bothBad || 0);
  const pairSources = [
    { id: 'rank', label: 'Rank images', all: rankPairs, same: (tp.intraPairs || 0) - (tp.importedIntra || 0) },
    { id: 'pairwise_db', label: 'pairwise.db import', legacy: true,
      all: (tp.importedPairs || 0) + (orphans || 0), same: (tp.importedIntra || 0) + (aiTrainingData?.pairwise_db_orphans_intra || 0),
      note: `${tp.importedPairs || 0} in the app · ${orphans == null ? 'PC file: AI server offline' : `${orphans} in a PC file (deleted performers)`}` },
    { id: 'labeller', label: 'old labeller file', legacy: true, all: labellerPairs == null ? null : labellerPairs + aiTrainingData.labeller_cross_pairs,
      same: labellerPairs, note: labellerPairs == null ? 'AI server offline' : `${labellerPairs} same performer, on the AI PC` },
  ];
  return pairSources;
}

export const sumPairs = (sources, key) => sources.reduce((n, s) => n + (s[key] || 0), 0);

// The one figure CLIP Siamese's newest file has: it saved none of its own (trained before the held-out split).
export const HAND_TEST = {
  file: 'clip_siamese/clip_siamese_20251207.pt',
  type: 'clip_siamese',
  value: 0.73,
  label: 'AUC',
  text: 'Hand test, 16 Oct 2026: keep vs delete inside one performer, on 38 performers added after it was trained (2,623 pictures)',
};

export const HAND_TEST_INTRO = 'Tested 16 Oct 2026 on pictures none of the models trained on: keep vs delete for the 2,623 pictures of 38 performers added after the May training set, and Rank images pairs made after each model was trained. AUC: 0.50 is chance, 1.00 is perfect.';

// Removed types (their old files can still be deleted) and the two labellers of the scenetest app.
export const HISTORY = [
  {
    name: 'Simple Binary / Ranked Binary (DINO)', state: 'Removed 2 Nov 2026', types: ['binary', 'ranked_binary'],
    result: 'Keep vs delete AUC 0.74–0.77 on 38 new performers and 0.65–0.69 inside one performer; CLIP Siamese beat it on both.',
  },
  {
    name: 'DINO Pairwise Preference', state: 'Removed 2 Nov 2026', types: ['pairwise'],
    result: 'Keep vs delete AUC 0.75, 0.68 inside one performer and 57% of 306 later Rank images pairs; CLIP Siamese does the same job better.',
  },
  {
    name: 'Performer Ranker', state: 'Removed 2 Nov 2026', types: ['performer_ranker'],
    result: 'Right in 49% of your Smart Compare duels (chance is 50%): it learned from 53 rated performers, so it learned who, not what.',
  },
  {
    name: 'Qwen keep/delete and Qwen Taste', state: 'Removed 26 Oct 2026', types: [],
    result: 'Keep vs delete AUC 0.65–0.69 on 16 performers; Qwen Taste 0.724 inside one performer over 46 performers, against K 0.779.',
  },
  {
    name: 'Profile labeller', state: 'Another app: scenetest', types: [],
    result: '83% of the profile fields right on 8 held-out performers.',
  },
  {
    name: 'Scene labeller', state: 'Another app: scenetest', types: [],
    result: '86% of the fields right on 104 held-out looks.',
  },
];

// Per live type: where the app uses it (to = a route, href = a static page) and the "How it works" lines.
export const LIVE_INFO = {
  clip_keepdelete: {
    usedIn: [{ label: 'Filter view, AI toggle', to: '/filter' }],
    trainsOn: 'Keep and delete folders pushed to the AI server, for performers that have both. No pairs, no stars.',
    how: 'Fine-tunes SigLIP-384 with a LoRA for 3 epochs, about 40 minutes. 15% of the performers are held out.',
    better: 'It does not know disliked performers.',
  },
  clip_siamese: {
    usedIn: [],
    trainsOn: 'Kept > deleted pairs of every performer, plus your same-performer hand pairs (Rank images, legacy imports).',
    how: 'Frozen CLIP ViT-L/14-336 and a small score head, trained on pairs (RankNet).',
    better: 'Retrain it here with held-out performers for an honest figure.',
  },
  clip_taste: {
    usedIn: [],
    trainsOn: 'Kept pictures against deleted ones, disliked (delete-only) and blacklisted performers, stars 2+ apart, and every hand pair.',
    how: 'The CLIP Siamese network with two losses: keep/delete and RankNet. 15% of the performers of every level are held out.',
    better: 'Only 11 blacklisted performers have pictures.',
  },
  performer_keep: {
    usedIn: [{ label: 'Profile page', href: '/profile.html' }, { label: 'Discover judge', to: '/discover' }],
    trainsOn: 'Your keep / love / delete on the profile page, plus this app\'s performers counted 10x.',
    how: 'A class-balanced logistic regression on the mean CLIP embedding of her pictures.',
    better: 'The site fields (hair, cup, ethnicity) never beat the pictures.',
  },
  performer_rank: {
    usedIn: [{ label: 'Profile duels', href: '/profile.html#duels' }],
    trainsOn: 'Your profile duels, plus your sorted lists at half weight.',
    how: 'A score per performer learned from who wins your duels, on the mean CLIP embedding of her pictures.',
    better: 'More duels: it learns slowly below about 270.',
  },
};
