/**
 * What the AI & Training page says about the models: the types that can be trained, and what each one achieved.
 */
import React from 'react';
import { Psychology, FilterAlt, AutoAwesome } from '@mui/icons-material';

export const MODEL_TYPES = [
  { id: 'clip_siamese', name: 'CLIP Siamese (1st order)', icon: <AutoAwesome />, desc: 'Scores pictures so kept beats deleted and your hand-picked winners beat their losers, inside one performer. Best model so far.',
    color: 'var(--accent)', requirements: 'Needs keep + delete folders pushed to the AI server; also uses your same-performer hand pairs: Rank images, the legacy pairwise.db import and the legacy old labeller file on the AI PC. The first run downloads CLIP ViT-L/14-336 (~1.7 GB) from Hugging Face.',
    pros: ['Best on new performers', 'Fast: CLIP stays frozen'], cons: ['Scores are an order, not a %'] },
  { id: 'clip_taste', name: 'CLIP Taste (2nd order)', icon: <Psychology />, desc: 'A keep % for any picture with a fixed 50% line. Learns kept vs deleted inside a performer and across performers: your disliked and blacklisted performers, and your stars.',
    color: 'var(--chart-5)', requirements: 'Needs keep + delete folders pushed to the AI server. Performers with only deleted pictures count as disliked, or as blacklisted when blacklisted in the app; stars only pick pairs (2+ stars apart), they are no input. Uses every hand pair, across performers too. 15% of the performers of every level are held out.',
    pros: ['Keep % with a 50% line', 'Knows disliked performers'], cons: ['Only 11 blacklisted performers'] },
  { id: 'clip_keepdelete', name: 'K (keep / delete)', icon: <FilterAlt />, desc: 'A keep % for any picture with a fixed 50% line, learned from your keeps and deletes alone, so it grows as you filter. With the AI toggle in the filter view it refits every 10 decisions, with that performer\'s sorted pictures weighing 20x.',
    color: 'var(--ok)', requirements: 'Needs keep + delete folders pushed to the AI server; uses the performers that have both. No pairs, no stars. Fine-tunes SigLIP-384 with a LoRA for 3 epochs, about 40 minutes (the epochs and batch size fields do not apply); it starts from ComfyUI\'s clip_vision/sigclip_vision_patch14_384 file on the AI PC. 15% of the performers are held out.',
    pros: ['Learns the performer while you filter', 'Best inside a performer (AUC 0.779 vs 0.750 for CLIP)'], cons: ['Does not know disliked performers', 'About 40 minutes to train'] },
];

// What each model achieved so far (Claude's tests, 2026-10-16): keep vs delete on the 2,623 pictures of the
// 38 performers added after the May training set, and Rank images pairs made after each model was trained.
export const MODEL_NOTES = [
  {
    name: 'CLIP Taste — 2nd order (keep %)', status: 'New', tone: 'warn', where: 'Train here',
    result: 'Not trained yet: results on held-out performers come after the first GPU run',
    data: 'Kept pictures (keep) against deleted pictures of kept performers and every picture of disliked (delete-only) and blacklisted performers; on 2026-10-17: 68 kept performers (6,891 pictures, 47 with 3,979 deletes), 49 disliked (2,925), 11 blacklisted (400). Pairs: kept > deleted, kept > disliked/blacklisted, disliked > blacklisted, stars 2+ apart, and every hand pair (legacy ones optional).',
    how: 'The CLIP Siamese network (frozen CLIP ViT-L/14-336 + score head) with two losses: keep/delete (a real keep %, cut at a fixed 50%) and RankNet on the pairs. Stars only pick pairs, never kept vs kept: those would teach who, not what. 15% of the performers of every level are held out.',
    better: ['Only 11 blacklisted performers have pictures (another 49 are blacklisted without any)', 'More hand pairs across performers'],
  },
  {
    name: 'CLIP Siamese — 1st order (within performer)', status: 'Best', tone: 'ok', where: 'Train here',
    result: 'Keep vs delete AUC 0.82 on 38 new performers · 0.73 inside one performer · picks your winner in 66% of 1,091 later Rank images pairs',
    data: '1,969 hand-made pairs from the old labeller (Dec 2025): 1,781 same performer, 188 across performers. 3 epochs. File: clip_siamese/clip_siamese_20251207.pt',
    how: 'CLIP ViT-L/14-336 (frozen) turns a picture into 768 numbers; a small head (768 → 512 → 256 → 1) turns those into a score. Trained on pairs: the winner must score higher (RankNet). Only the order of the scores means something, so a cut has to be picked per batch.',
    better: [
      'Retrain here: adds kept > deleted pairs of every performer plus your same-performer hand pairs, and holds performers out for an honest score',
      'Hand pairs come from three sources, counted apart in the training log: Rank images; legacy pairs imported from backend-pairwise/pairwise.db (785 of its 788, 764 of them same performer: 483 in the app DB, 302 of performers deleted from the app in a PC file); legacy old labeller file on the AI PC (2,763 same-performer pairs of the Jan 2026 export)',
      'A keep cut-off per performer, stricter for performers with fewer stars',
      '2nd order (across performers) only from hand-made cross pairs (698 in the labeller file, 21 from pairwise.db); pairs made from stars teach the model who, not what',
    ],
  },
  {
    name: 'Simple Binary / Ranked Binary (DINO)', status: 'Removed', tone: 'bad', where: 'acm-gpu',
    result: 'Keep vs delete AUC 0.74–0.77 on the same 38 new performers · 0.65–0.69 inside one performer',
    data: 'Keep folder (after filter performer) vs delete folder (deleted keep for training), May 2026 set: about 4,700 keep + 5,800 delete pictures. 15% of performers held out. Ranked also gets the performer\'s stars.',
    how: 'DINOv2-large picture embedding → small head → keep probability. The backbone unfreezes from epoch 3. At filter time Ranked got its stars from the Performer Ranker, which had no signal.',
    better: [
      'Learned one global "keep look", not your choice inside a performer; CLIP Siamese beat it on both, so both were taken out on 2026-11-02',
      'The old 98.5% score came from a random picture split (same performers in train and val), not new performers',
    ],
  },
  {
    name: 'DINO Pairwise Preference', status: 'Removed', tone: 'bad', where: 'acm-gpu',
    result: 'Keep vs delete AUC 0.75 · 0.68 inside one performer · 57% of 306 later Rank images pairs',
    data: 'Your Rank images pairs. File: pairwise/pairwise_rating.pt',
    how: 'The same pair idea as CLIP Siamese, on a DINOv2-large embedding with a margin loss.',
    better: ['CLIP Siamese does the same job better, so it was taken out on 2026-11-02; your pairs train the CLIP models'],
  },
  {
    name: 'Performer Ranker', status: 'Removed', tone: 'bad', where: 'acm-gpu',
    result: 'Right in 49% of your Smart Compare duels (chance is 50%)',
    data: 'Every picture of a rated performer gets that performer\'s stars (53 rated performers).',
    how: 'DINOv2-large → small head → stars (0–5), regression. A performer\'s stars are the average over their pictures.',
    better: [
      'The real sample size was the number of rated performers (53), not the pictures, so it learned who, not what',
      'Would need hundreds of rated performers, so it was taken out on 2026-11-02, with Smart Compare\'s Ask AI and Rate Performer (AI) that ran on it',
    ],
  },
  {
    name: 'Qwen keep/delete and Qwen Taste', status: 'Removed', tone: 'bad', where: 'scenetest test, then acm-gpu',
    result: 'Keep vs delete AUC 0.65–0.69 on 16 performers; Qwen Taste over 46 performers (5 folds, 2026-10-26): 0.724 inside one performer, against K 0.779 and CLIP Taste 0.730',
    data: 'Keep and delete pictures of 16, then 46 performers.',
    how: 'Qwen3.5-9B with a LoRA reads one picture and answers keep or delete. A two-step version (performer score from 8 pictures, then picture + score) collapsed to the average.',
    better: ['No higher than the CLIP models and 0.25 s a picture on the GPU, so it was taken out of acm-gpu on 2026-10-26; K is the keep/delete model'],
  },
  {
    name: 'P and P2 — performers (profile page)', status: 'Live', tone: 'ok', where: 'acm-gpu, by itself', live: 'profile',
    result: 'No numbers yet: P and P2 retrain while acm-gpu runs',
    data: 'P: your keep / love / delete on the profile page, plus this app\'s performers (keep folder = keep, delete-only = delete) counted 10x. P2: your profile duels, plus your sorted lists at half weight.',
    how: 'A performer is the mean CLIP ViT-L/14-336 embedding of her pictures. P: a class-balanced logistic regression on it, her keep chance. P2: a score learned from who wins your duels. acm-gpu retrains both on every new verdict or duel, cross-validates every 25 and saves models/performer_keep/performer_keep.pt and models/performer_rank/performer_rank.pt.',
    better: ['More duels: P2 learns slowly from about 270', 'Pictures only: the site fields (hair, cup, ethnicity) never beat them'],
  },
  {
    name: 'Profile labeller (race, hair colour, age…)', status: 'Works', tone: 'ok', where: 'scenetest',
    result: '83% of fields right on 8 held-out performers (81% before tuning)',
    data: '30 performers labelled by Claude, 8 pictures each.',
    how: 'Qwen3.5-9B looks at 8 pictures of a performer and fills in the profile fields; LoRA fine-tune.',
    better: ['Habits to fix: hair length ("shoulder"), age ("mid 20s"), ethnicity', 'More labelled performers', 'Useful as input for taste models only once many more performers are rated'],
  },
  {
    name: 'Scene labeller', status: 'Works', tone: 'ok', where: 'scenetest',
    result: '86% of fields right on 104 held-out looks · solo dildo ride 46% → 95%',
    data: '711 checked looks from 30 videos (the gold set).',
    how: 'Qwen3.5-9B with a QLoRA fine-tune, merged as models/merged_261016_1331; the scenetest app uses it since 2026-10-16.',
    better: ['Webcam framing: with only a head in frame it invents acts and calls bare shoulders topless', 'Grow the gold set from the scripted library; keep a frozen test set'],
  },
];

export const NOTE_TONE = {
  ok: { color: 'var(--ok)', bg: 'var(--ok-quiet)' },
  warn: { color: 'var(--warn)', bg: 'var(--warn-quiet)' },
  bad: { color: 'var(--bad)', bg: 'var(--bad-quiet)' },
};

// Training-type → settings key of its default model (the filter view's AI loads K's)
export const PREFERRED_KEYS = {
  clip_siamese: 'preferred_clip_siamese_model',
  clip_taste: 'preferred_clip_taste_model',
  clip_keepdelete: 'preferred_clip_keepdelete_model',
};

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
