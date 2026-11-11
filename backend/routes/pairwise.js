/**
 * Pairwise Routes — Image-level comparison, scoring, and AI proxy
 *
 * Absorbed from the old standalone pairwise service (retired).
 * Data lives in app.db (pairwise_pairs, pairwise_image_scores, etc.)
 * The models that train on these pairs are started from the AI & Training page.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

const { getAiServerUrl } = require('../utils/aiUrl');

const AI_SERVER_URL = getAiServerUrl();

// ── Prepared Statements ──────────────────────────────────────
const queries = {
  // performer_name keeps whose pair it is after the performer is deleted (performer_id then becomes NULL)
  insertPair: db.prepare(`
    INSERT INTO pairwise_pairs (performer_id, performer_name, winner, loser, type)
    VALUES (@pid, (SELECT name FROM performers WHERE id = @pid), @winner, @loser, @type)
  `),
  getRecentPairs: db.prepare(`SELECT * FROM pairwise_pairs ORDER BY created_at DESC LIMIT ?`),
  getPairCount: db.prepare(`SELECT COUNT(*) as count FROM pairwise_pairs`),
  getPairCountByPerformer: db.prepare(`SELECT COUNT(*) as count FROM pairwise_pairs WHERE performer_id = ?`),

  getScore: db.prepare(`SELECT * FROM pairwise_image_scores WHERE performer_id = ? AND path = ?`),
  upsertScore: db.prepare(`
    INSERT INTO pairwise_image_scores (performer_id, path, score, comparisons, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(performer_id, path) DO UPDATE SET
      score = excluded.score,
      comparisons = excluded.comparisons,
      updated_at = CURRENT_TIMESTAMP
  `),
  getScoresByPerformer: db.prepare(`SELECT * FROM pairwise_image_scores WHERE performer_id = ? ORDER BY score DESC`),
  insertScoreIgnore: db.prepare(`
    INSERT OR IGNORE INTO pairwise_image_scores (performer_id, path, score, comparisons)
    VALUES (?, ?, ?, ?)
  `),


  getSelectedPerformers: db.prepare(`SELECT performer_id FROM pairwise_selected_performers`),
  clearSelectedPerformers: db.prepare(`DELETE FROM pairwise_selected_performers`),
  insertSelectedPerformer: db.prepare(`INSERT OR IGNORE INTO pairwise_selected_performers (performer_id) VALUES (?)`),
};

// ── In-memory session state ──────────────────────────────────
const seenPairs = new Set();

// Load seen pairs from DB on module load
try {
  const allPairs = db.prepare('SELECT winner, loser FROM pairwise_pairs').all();
  for (const pair of allPairs) {
    seenPairs.add(pairKey(pair.winner, pair.loser));
  }
  console.log(`[Pairwise] Loaded ${seenPairs.size} seen pairs from database`);
} catch (err) {
  console.log('[Pairwise] No existing pairs (clean start)');
}

// ── Helper Functions ─────────────────────────────────────────

function pairKey(path1, path2) {
  return [path1, path2].sort().join('|');
}

function getImageScore(performerId, imagePath) {
  const row = queries.getScore.get(performerId, imagePath);
  return row ? { score: row.score, comparisons: row.comparisons } : { score: 50, comparisons: 0 };
}

function updateScores(performerId, winnerPath, loserPath) {
  const winner = getImageScore(performerId, winnerPath);
  const loser = getImageScore(performerId, loserPath);

  const winnerDelta = Math.max(5, 20 / (winner.comparisons + 1));
  const loserDelta = Math.max(5, 20 / (loser.comparisons + 1));

  queries.upsertScore.run(performerId, winnerPath, Math.min(100, winner.score + winnerDelta), winner.comparisons + 1);
  queries.upsertScore.run(performerId, loserPath, Math.max(0, loser.score - loserDelta), loser.comparisons + 1);
}

function getPairUncertainty(performerId, path1, path2) {
  const score1 = getImageScore(performerId, path1);
  const score2 = getImageScore(performerId, path2);

  const scoreDiff = Math.abs(score1.score - score2.score);
  let urgency = 100 - scoreDiff;

  const minComparisons = Math.min(score1.comparisons, score2.comparisons);
  if (minComparisons === 0) urgency += 30;
  else if (minComparisons < 3) urgency += 15;

  const totalFatigue = score1.comparisons + score2.comparisons;
  urgency -= totalFatigue * 3;

  return Math.max(0, urgency);
}

/** Resolve performer's image folder path */
function getPerformerPicsPath(performerId) {
  const performer = db.prepare(`
    SELECT p.*, f.path as folder_path FROM performers p
    JOIN folders f ON p.folder_id = f.id WHERE p.id = ?
  `).get(performerId);
  if (!performer) return null;

  const sub = performer.moved_to_after === 1 ? 'after filter performer' : 'before filter performer';
  return {
    picsPath: path.join(performer.folder_path, sub, performer.name, 'pics'),
    performer
  };
}

/** Scan a directory recursively for images */
function scanForImages(dirPath) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  let images = [];
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);
      if (file.isDirectory() && !file.name.startsWith('.')) {
        images = images.concat(scanForImages(fullPath));
      } else if (file.isFile() && imageExtensions.includes(path.extname(file.name).toLowerCase())) {
        images.push(fullPath);
      }
    }
  } catch (_) { /* directory might not exist */ }
  return images;
}

// A performer's image list, rescanned at most once a minute. Every next-pair used to rescan the folder and run one
// INSERT per image outside a transaction; now new images are seeded once per scan, in one transaction.
const FOLDER_TTL_MS = 60000;
const folderCache = new Map(); // `${performerId}|${picsPath}` -> { at, images }
const seedScores = db.transaction((pid, images) => {
  for (const img of images) queries.insertScoreIgnore.run(pid, img, 50, 0);
});

function listImages(pid, picsPath) {
  const key = `${pid}|${picsPath}`;
  const hit = folderCache.get(key);
  if (hit && Date.now() - hit.at < FOLDER_TTL_MS) return hit.images;
  const images = scanForImages(picsPath);
  seedScores(pid, images);
  folderCache.set(key, { at: Date.now(), images });
  return images;
}

function forgetImages(pid) {
  for (const key of folderCache.keys()) if (key.startsWith(`${pid}|`)) folderCache.delete(key);
}

const findSameVote = db.prepare(`
  SELECT id FROM pairwise_pairs
  WHERE performer_id = ? AND winner = ? AND loser = ? AND type = ? AND source IS NULL LIMIT 1
`);

/** Store one vote and move the scores, in one transaction. A resent vote (its first answer was lost) finds its
 *  identical row and changes nothing; the answer names that row, so its Undo can still take it back. */
const storeVote = db.transaction((pid, winner, loser, type) => {
  const same = findSameVote.get(pid, winner, loser, type);
  if (same) return { pairId: Number(same.id), duplicate: true };
  const info = queries.insertPair.run({ pid, winner, loser, type });
  updateScores(pid, winner, loser);
  return { pairId: Number(info.lastInsertRowid), duplicate: false };
});

/** Both bad: both pictures lose points; one row of type 'both_bad' (winner = left), same duplicate rule. */
const storeBothBad = db.transaction((pid, left, right) => {
  const same = findSameVote.get(pid, left, right, 'both_bad');
  if (same) return { pairId: Number(same.id), duplicate: true };
  const s1 = getImageScore(pid, left);
  const s2 = getImageScore(pid, right);
  const d1 = Math.max(5, 20 / (s1.comparisons + 1));
  const d2 = Math.max(5, 20 / (s2.comparisons + 1));
  queries.upsertScore.run(pid, left, Math.max(0, s1.score - d1), s1.comparisons + 1);
  queries.upsertScore.run(pid, right, Math.max(0, s2.score - d2), s2.comparisons + 1);
  const info = queries.insertPair.run({ pid, winner: left, loser: right, type: 'both_bad' });
  return { pairId: Number(info.lastInsertRowid), duplicate: false };
});

/** Take one stored vote back: restore both scores and delete the row, in one transaction. */
const undoVote = db.transaction((pid, row) => {
  const winner = getImageScore(pid, row.winner);
  const loser = getImageScore(pid, row.loser);

  if (winner.comparisons > 0) {
    const wDelta = Math.max(5, 20 / winner.comparisons);
    // A 'both_bad' row lowered BOTH images (the "winner" column is just the
    // left one), so undoing it has to raise both.
    const wRestored = row.type === 'both_bad' ? winner.score + wDelta : winner.score - wDelta;
    queries.upsertScore.run(pid, row.winner, Math.max(0, Math.min(100, wRestored)), winner.comparisons - 1);
  }
  if (loser.comparisons > 0) {
    const lDelta = Math.max(5, 20 / loser.comparisons);
    queries.upsertScore.run(pid, row.loser, loser.score + lDelta, loser.comparisons - 1);
  }

  db.prepare('DELETE FROM pairwise_pairs WHERE id = ?').run(row.id);
});

// ═══════════════════════════════════════════════════════════════
// LABELING ROUTES
// ═══════════════════════════════════════════════════════════════

// Get next pair for a performer
router.get('/next-pair', (req, res) => {
  const { performer_id, type = 'intra' } = req.query;

  if (!performer_id) {
    return res.status(400).json({ error: 'performer_id is required' });
  }

  const info = getPerformerPicsPath(parseInt(performer_id));
  if (!info) return res.status(404).json({ error: 'Performer not found' });

  const allImages = listImages(parseInt(performer_id), info.picsPath);
  if (allImages.length < 2) {
    return res.json({ error: 'Not enough images', done: true });
  }

  // Generate candidate pairs
  const candidates = [];
  for (let i = 0; i < Math.min(20, allImages.length * 2); i++) {
    const idx1 = Math.floor(Math.random() * allImages.length);
    let idx2 = Math.floor(Math.random() * allImages.length);
    while (idx2 === idx1) idx2 = Math.floor(Math.random() * allImages.length);

    const key = pairKey(allImages[idx1], allImages[idx2]);
    if (!seenPairs.has(key)) {
      candidates.push({
        path1: allImages[idx1],
        path2: allImages[idx2],
        uncertainty: getPairUncertainty(parseInt(performer_id), allImages[idx1], allImages[idx2])
      });
    }
  }

  // The random draws can all land on seen pairs long before every pair is seen: walk the pairs from a random
  // start before saying done.
  if (candidates.length === 0) {
    const n = allImages.length;
    const off = Math.floor(Math.random() * n);
    outer:
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = allImages[(i + off) % n];
        const b = allImages[(j + off) % n];
        if (seenPairs.has(pairKey(a, b))) continue;
        candidates.push({ path1: a, path2: b, uncertainty: getPairUncertainty(parseInt(performer_id), a, b) });
        if (candidates.length >= 20) break outer;
      }
    }
  }

  if (candidates.length === 0) {
    return res.json({ error: 'No more unseen pairs', done: true });
  }

  // Active learning: pick by uncertainty with some randomness
  candidates.sort((a, b) => b.uncertainty - a.uncertainty);
  const roll = Math.random();
  const pick = roll < 0.2
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];

  const swapped = Math.random() < 0.5;
  const leftPath = swapped ? pick.path2 : pick.path1;
  const rightPath = swapped ? pick.path1 : pick.path2;

  res.json({
    id: uuidv4(),
    left: leftPath,
    right: rightPath,
    leftScore: getImageScore(parseInt(performer_id), leftPath),
    rightScore: getImageScore(parseInt(performer_id), rightPath),
    performer_id: parseInt(performer_id),
    performer_name: info.performer.name,
    uncertainty: pick.uncertainty,
    swapped
  });
});

// Submit labeled pair
router.post('/submit', (req, res) => {
  const { performer_id, winner, loser, type, winner_performer_id, loser_performer_id } = req.body;

  if (!performer_id || !winner || !loser) {
    return res.status(400).json({ error: 'performer_id, winner, and loser are required' });
  }

  if (winner === loser) {
    return res.status(400).json({ error: 'winner and loser are the same picture' });
  }

  const pid = parseInt(performer_id);
  const { pairId, duplicate } = storeVote(pid, winner, loser, type || 'intra');
  seenPairs.add(pairKey(winner, loser));

  const pairCount = queries.getPairCountByPerformer.get(pid)?.count || 0;

  // ── Inter-performer ELO propagation ────────────────────────
  // If this was an inter-performer comparison, update performer_rating (not again for a resent vote)
  if (!duplicate && type === 'inter' && winner_performer_id && loser_performer_id &&
      winner_performer_id !== loser_performer_id) {
    try {
      const K = 0.1; // Small K-factor — image comparisons should nudge, not swing
      const winnerRating = db.prepare('SELECT manual_star FROM ratings WHERE performer_id = ?').get(parseInt(winner_performer_id));
      const loserRating = db.prepare('SELECT manual_star FROM ratings WHERE performer_id = ?').get(parseInt(loser_performer_id));

      const wR = winnerRating?.manual_star ?? 2.5;
      const lR = loserRating?.manual_star ?? 2.5;

      // ELO expected scores
      const expectedW = 1 / (1 + Math.pow(10, (lR - wR) / 1.5));
      const expectedL = 1 - expectedW;

      const newWR = Math.min(5, Math.max(0, wR + K * (1 - expectedW)));
      const newLR = Math.min(5, Math.max(0, lR + K * (0 - expectedL)));

      db.prepare('UPDATE ratings SET manual_star = ? WHERE performer_id = ?').run(
        Math.round(newWR * 100) / 100, parseInt(winner_performer_id)
      );
      db.prepare('UPDATE ratings SET manual_star = ? WHERE performer_id = ?').run(
        Math.round(newLR * 100) / 100, parseInt(loser_performer_id)
      );
    } catch (err) {
      console.warn('[Pairwise] Inter-performer ELO update skipped:', err.message);
    }
  }

  res.json({
    success: true,
    totalPairs: pairCount,
    winnerScore: getImageScore(pid, winner),
    loserScore: getImageScore(pid, loser),
    pairId,
    duplicate
  });
});

// Both bad
router.post('/both-bad', (req, res) => {
  const { performer_id, left, right } = req.body;

  if (!performer_id || !left || !right) {
    return res.status(400).json({ error: 'performer_id, left, and right are required' });
  }

  if (left === right) {
    return res.status(400).json({ error: 'left and right are the same picture' });
  }

  const pid = parseInt(performer_id);
  const { pairId, duplicate } = storeBothBad(pid, left, right);
  seenPairs.add(pairKey(left, right));

  res.json({ success: true, pairId, duplicate });
});

// Undo a vote: with pair_id exactly that row, without it the performer's newest (made here, not imported)
router.post('/undo', (req, res) => {
  const { performer_id, pair_id } = req.body;
  if (!performer_id) return res.status(400).json({ error: 'performer_id required' });

  const pid = parseInt(performer_id);
  try {
    let row;
    if (pair_id !== undefined && pair_id !== null) {
      row = db.prepare('SELECT * FROM pairwise_pairs WHERE id = ? AND performer_id = ? AND source IS NULL').get(parseInt(pair_id), pid);
      if (!row) return res.status(404).json({ error: 'That vote is not stored any more' });
    } else {
      row = db.prepare('SELECT * FROM pairwise_pairs WHERE performer_id = ? AND source IS NULL ORDER BY id DESC LIMIT 1').get(pid);
      if (!row) return res.status(400).json({ error: 'No vote to undo' });
    }

    undoVote(pid, row);
    seenPairs.delete(pairKey(row.winner, row.loser));

    res.json({ success: true, totalPairs: queries.getPairCountByPerformer.get(pid)?.count || 0, undonePairId: row.id });
  } catch (err) {
    console.error('[Pairwise] Undo error:', err);
    res.status(500).json({ error: 'Failed to undo' });
  }
});

// Skip pair
router.post('/skip', (req, res) => {
  const { left, right } = req.body;
  if (left && right) seenPairs.add(pairKey(left, right));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// SCORES & RANKINGS
// ═══════════════════════════════════════════════════════════════

// Get image rankings for a performer
router.get('/image-rankings', (req, res) => {
  const { performer_id } = req.query;
  if (!performer_id) return res.status(400).json({ error: 'performer_id required' });

  const scores = queries.getScoresByPerformer.all(parseInt(performer_id));
  const pairCount = queries.getPairCountByPerformer.get(parseInt(performer_id))?.count || 0;

  const bothBad = new Set();
  const badRows = db.prepare(`SELECT winner, loser FROM pairwise_pairs WHERE performer_id = ? AND type = 'both_bad'`).all(parseInt(performer_id));
  for (const row of badRows) {
    bothBad.add(row.winner);
    bothBad.add(row.loser);
  }

  res.json({
    performer_id: parseInt(performer_id),
    totalComparisons: pairCount,
    totalImages: scores.length,
    images: scores.map(s => ({
      path: s.path,
      score: s.score,
      comparisons: s.comparisons,
      bothBad: bothBad.has(s.path)
    }))
  });
});

// Reset scores for a performer
router.post('/reset-scores', (req, res) => {
  const { performer_id } = req.body;
  if (!performer_id) return res.status(400).json({ error: 'performer_id required' });

  const pid = parseInt(performer_id);

  // Read pairs BEFORE deleting so we can clear them from seenPairs
  const pairs = db.prepare('SELECT winner, loser FROM pairwise_pairs WHERE performer_id = ?').all(pid);

  db.prepare('DELETE FROM pairwise_image_scores WHERE performer_id = ?').run(pid);
  db.prepare('DELETE FROM pairwise_pairs WHERE performer_id = ?').run(pid);

  for (const p of pairs) seenPairs.delete(pairKey(p.winner, p.loser));
  forgetImages(pid); // the next next-pair seeds the pictures again

  res.json({ success: true, message: `Scores and ${pairs.length} pairs reset` });
});

// Export pairs (for training data)
router.get('/export', (req, res) => {
  const { performer_id } = req.query;
  let allPairs;
  if (performer_id) {
    allPairs = db.prepare('SELECT * FROM pairwise_pairs WHERE performer_id = ? ORDER BY created_at DESC').all(parseInt(performer_id));
  } else {
    allPairs = db.prepare('SELECT * FROM pairwise_pairs ORDER BY created_at DESC').all();
  }

  res.json({
    totalPairs: allPairs.length,
    pairs: allPairs.map(p => ({ winner: p.winner, loser: p.loser, type: p.type, performer_id: p.performer_id }))
  });
});

// ═══════════════════════════════════════════════════════════════
// HEALTH & STATUS
// ═══════════════════════════════════════════════════════════════

// Pairwise health per performer
router.get('/performer-health', (req, res) => {
  const { performer_id } = req.query;
  if (!performer_id) return res.status(400).json({ error: 'performer_id required' });

  const pid = parseInt(performer_id);
  const scores = queries.getScoresByPerformer.all(pid);
  const pairCount = queries.getPairCountByPerformer.get(pid)?.count || 0;

  let avgScore = 50;
  let certainty = 0;
  if (scores.length > 1) {
    avgScore = scores.reduce((a, b) => a + b.score, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s.score - avgScore, 2), 0) / scores.length;
    certainty = Math.sqrt(variance);
  }

  const top10 = scores.slice(0, 10);
  const peakScore = top10.length > 0 ? Math.round(top10.reduce((a, b) => a + b.score, 0) / top10.length) : 0;

  res.json({
    performer_id: pid,
    totalImages: scores.length,
    avgScore: Math.round(avgScore * 10) / 10,
    peakScore,
    certainty: Math.round(certainty),
    totalComparisons: pairCount,
    certaintyStatus: certainty > 20 ? 'high' : certainty > 10 ? 'medium' : 'low'
  });
});

// Global pairwise stats
router.get('/stats', (req, res) => {
  const totalPairs = queries.getPairCount.get()?.count || 0;
  const totalScores = db.prepare('SELECT COUNT(*) as count FROM pairwise_image_scores').get()?.count || 0;
  const performersWithScores = db.prepare('SELECT COUNT(DISTINCT performer_id) as count FROM pairwise_image_scores').get()?.count || 0;

  const out = {
    totalPairs,
    totalScoredImages: totalScores,
    performersWithScores
  };

  // Optional per-performer numbers; the global fields above never change.
  const pid = parseInt(req.query.performer_id);
  if (!isNaN(pid)) {
    out.performer_id = pid;
    out.performerPairs = queries.getPairCountByPerformer.get(pid)?.count || 0;
    out.performerImages = db.prepare('SELECT COUNT(*) as count FROM pairwise_image_scores WHERE performer_id = ?').get(pid)?.count || 0;
    out.performerScoredImages = db.prepare('SELECT COUNT(*) as count FROM pairwise_image_scores WHERE performer_id = ? AND comparisons > 0').get(pid)?.count || 0;
  }

  res.json(out);
});

// ═══════════════════════════════════════════════════════════════
// AI SERVER
// ═══════════════════════════════════════════════════════════════

// Check AI server health
router.get('/ai-health', async (req, res) => {
  const aiUrl = req.query.url || AI_SERVER_URL;
  try {
    const response = await axios.get(`${aiUrl}/health`, { timeout: 5000 });
    res.json({ online: true, url: aiUrl, ...response.data });
  } catch (err) {
    res.json({ online: false, url: aiUrl, error: err.message });
  }
});

// Active Learning: suggest hard pairs for refinement
router.post('/refine', async (req, res) => {
  const { performer_id, model } = req.body;
  if (!performer_id) return res.status(400).json({ error: 'performer_id required' });

  const pid = parseInt(performer_id);
  const info = getPerformerPicsPath(pid);
  if (!info) return res.status(404).json({ error: 'Performer not found' });

  const allImages = scanForImages(info.picsPath);
  if (allImages.length < 2) return res.json({ pairs: [] });

  // Get top + random images for candidate generation
  const scores = allImages.map(img => ({ path: img, score: getImageScore(pid, img).score }))
    .sort((a, b) => b.score - a.score);

  const topImages = scores.slice(0, 10).map(s => s.path);
  const randomImages = scores.slice(10).sort(() => 0.5 - Math.random()).slice(0, 10).map(s => s.path);
  const candidates = [...new Set([...topImages, ...randomImages])];

  // Generate pairs
  let pairsToCheck = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      pairsToCheck.push({ left: candidates[i], right: candidates[j] });
    }
  }
  pairsToCheck = pairsToCheck.sort(() => 0.5 - Math.random()).slice(0, 50);

  // Score-based uncertainty (no AI call needed for basic version)
  const hardPairs = pairsToCheck.map(p => {
    const sLeft = getImageScore(pid, p.left).score;
    const sRight = getImageScore(pid, p.right).score;
    return {
      ...p,
      scoreDiff: Math.abs(sLeft - sRight),
      leftScore: sLeft,
      rightScore: sRight
    };
  }).filter(p => p.scoreDiff < 15)
    .sort((a, b) => a.scoreDiff - b.scoreDiff)
    .slice(0, 20);

  res.json({
    pairs: hardPairs.map(p => ({
      id: uuidv4(),
      left: p.left,
      right: p.right,
      type: 'refine',
      performer_id: pid,
      performer_name: info.performer.name,
      reason: 'Uncertainty',
      leftScore: p.leftScore,
      rightScore: p.rightScore
    }))
  });
});

// Selected performers for labeling session
router.post('/select-performers', (req, res) => {
  const { performer_ids } = req.body;
  if (!Array.isArray(performer_ids)) return res.status(400).json({ error: 'performer_ids array required' });

  queries.clearSelectedPerformers.run();
  for (const id of performer_ids) {
    queries.insertSelectedPerformer.run(id);
  }

  res.json({ success: true, count: performer_ids.length });
});

router.get('/selected-performers', (req, res) => {
  const rows = queries.getSelectedPerformers.all();
  res.json({ performer_ids: rows.map(r => r.performer_id) });
});

module.exports = router;
