/**
 * Pairwise Routes — Image-level comparison, scoring, and AI proxy
 *
 * Absorbed from the standalone backend-pairwise service.
 * Data lives in app.db (pairwise_pairs, pairwise_image_scores, etc.)
 * Training/inference calls are proxied to the AI Inference App.
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
  insertPair: db.prepare(`
    INSERT INTO pairwise_pairs (performer_id, winner, loser, type) VALUES (?, ?, ?, ?)
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

  upsertInferenceResult: db.prepare(`
    INSERT INTO pairwise_inference_results (performer_id, data, timestamp)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(performer_id) DO UPDATE SET
      data = excluded.data,
      timestamp = CURRENT_TIMESTAMP
  `),
  getInferenceResult: db.prepare(`SELECT * FROM pairwise_inference_results WHERE performer_id = ?`),

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

  const allImages = scanForImages(info.picsPath);
  if (allImages.length < 2) {
    return res.json({ error: 'Not enough images', done: true });
  }

  // Seed scores for new images
  for (const img of allImages) {
    queries.insertScoreIgnore.run(parseInt(performer_id), img, 50, 0);
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

  res.json({
    id: uuidv4(),
    left: swapped ? pick.path2 : pick.path1,
    right: swapped ? pick.path1 : pick.path2,
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

  const pid = parseInt(performer_id);
  queries.insertPair.run(pid, winner, loser, type || 'intra');
  seenPairs.add(pairKey(winner, loser));
  updateScores(pid, winner, loser);

  const pairCount = queries.getPairCountByPerformer.get(pid)?.count || 0;

  // ── Inter-performer ELO propagation ────────────────────────
  // If this was an inter-performer comparison, update performer_rating
  if (type === 'inter' && winner_performer_id && loser_performer_id &&
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
    loserScore: getImageScore(pid, loser)
  });
});

// Both bad
router.post('/both-bad', (req, res) => {
  const { performer_id, left, right } = req.body;

  if (!performer_id || !left || !right) {
    return res.status(400).json({ error: 'performer_id, left, and right are required' });
  }

  const pid = parseInt(performer_id);
  seenPairs.add(pairKey(left, right));

  const s1 = getImageScore(pid, left);
  const s2 = getImageScore(pid, right);
  const d1 = Math.max(5, 20 / (s1.comparisons + 1));
  const d2 = Math.max(5, 20 / (s2.comparisons + 1));

  queries.upsertScore.run(pid, left, Math.max(0, s1.score - d1), s1.comparisons + 1);
  queries.upsertScore.run(pid, right, Math.max(0, s2.score - d2), s2.comparisons + 1);
  queries.insertPair.run(pid, left, right, 'both_bad');

  res.json({ success: true });
});

// Undo last vote for a performer
router.post('/undo', (req, res) => {
  const { performer_id } = req.body;
  if (!performer_id) return res.status(400).json({ error: 'performer_id required' });

  const pid = parseInt(performer_id);
  try {
    const lastPair = db.prepare('SELECT * FROM pairwise_pairs WHERE performer_id = ? ORDER BY id DESC LIMIT 1').get(pid);
    if (!lastPair) return res.status(400).json({ error: 'No vote to undo' });

    const winner = getImageScore(pid, lastPair.winner);
    const loser = getImageScore(pid, lastPair.loser);

    if (winner.comparisons > 0) {
      const wDelta = Math.max(5, 20 / winner.comparisons);
      queries.upsertScore.run(pid, lastPair.winner, winner.score - wDelta, winner.comparisons - 1);
    }
    if (loser.comparisons > 0) {
      const lDelta = Math.max(5, 20 / loser.comparisons);
      queries.upsertScore.run(pid, lastPair.loser, loser.score + lDelta, loser.comparisons - 1);
    }

    db.prepare('DELETE FROM pairwise_pairs WHERE id = ?').run(lastPair.id);
    seenPairs.delete(pairKey(lastPair.winner, lastPair.loser));

    res.json({ success: true, totalPairs: queries.getPairCountByPerformer.get(pid)?.count || 0 });
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

  res.json({
    performer_id: parseInt(performer_id),
    totalComparisons: pairCount,
    totalImages: scores.length,
    images: scores.map(s => ({
      path: s.path,
      score: s.score,
      comparisons: s.comparisons
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

  res.json({
    totalPairs,
    totalScoredImages: totalScores,
    performersWithScores
  });
});

// ═══════════════════════════════════════════════════════════════
// AI INFERENCE PROXY (delegates to AI Inference App)
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

// Run inference on a performer's images
router.post('/run-inference', async (req, res) => {
  const { performer_id, model } = req.body;
  if (!performer_id) return res.status(400).json({ error: 'performer_id required' });

  const info = getPerformerPicsPath(parseInt(performer_id));
  if (!info) return res.status(404).json({ error: 'Performer not found' });

  const allImages = scanForImages(info.picsPath);
  if (allImages.length === 0) return res.status(400).json({ error: 'No images found' });

  const aiUrl = req.body.ai_server_url || AI_SERVER_URL;

  // SSE streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify({ type: 'start', total: allImages.length })}\n\n`);

  const chunkSize = 32;
  let allResults = [];

  try {
    // Auto-load model if needed
    try {
      const healthRes = await axios.get(`${aiUrl}/health`, { timeout: 5000 });
      if (!healthRes.data.model_loaded) {
        res.write(`data: ${JSON.stringify({ type: 'loading', message: 'Loading model...' })}\n\n`);
        await axios.post(`${aiUrl}/load`, { path: model || undefined });
      }
    } catch (_) { /* server might not support /health */ }

    for (let i = 0; i < allImages.length; i += chunkSize) {
      const chunk = allImages.slice(i, i + chunkSize);
      const response = await axios.post(`${aiUrl}/score`, { images: chunk });

      const results = response.data.results || [];
      allResults = allResults.concat(results);

      res.write(`data: ${JSON.stringify({ type: 'progress', current: Math.min(i + chunkSize, allImages.length), total: allImages.length })}\n\n`);
    }

    // Cache results
    queries.upsertInferenceResult.run(parseInt(performer_id), JSON.stringify(allResults));

    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    res.write(`data: ${JSON.stringify({ type: 'done', results: allResults, total: allImages.length })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Pairwise] Inference error:', err.message);
    res.write(`data: ${JSON.stringify({ error: `Inference failed: ${err.message}` })}\n\n`);
    res.end();
  }
});

// Load model on AI server
router.post('/load-model', async (req, res) => {
  const { modelName, ai_server_url } = req.body;
  if (!modelName) return res.status(400).json({ error: 'modelName required' });

  const aiUrl = ai_server_url || AI_SERVER_URL;
  try {
    const response = await axios.post(`${aiUrl}/load`, { path: modelName });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: `Failed to load model: ${err.message}` });
  }
});

// List available models from AI server
router.get('/models', async (req, res) => {
  const aiUrl = req.query.url || AI_SERVER_URL;
  try {
    const response = await axios.get(`${aiUrl}/models`, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    res.json({ models: [], error: err.message });
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
