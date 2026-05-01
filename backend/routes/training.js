/**
 * AI Training Hub Routes
 *
 * Proxies training requests to the AI Inference App.
 * Collects training data from the local DB and sends it to the GPU machine.
 *
 * Endpoints:
 * - GET  /api/training/status       — Current training job status
 * - GET  /api/training/data-summary — How much training data is available
 * - POST /api/training/export-pairs — Export pairwise data for training
 * - POST /api/training/export-binary — Export binary (keep/delete) data
 * - POST /api/training/start        — Trigger training on AI server
 * - GET  /api/training/models       — List available models on AI server
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const { getAiServerUrl } = require('../utils/aiUrl');

// ── GET /api/training/data-summary ───────────────────────────
// Summary of all available training data
router.get('/data-summary', (req, res) => {
  try {
    const pairwise = db.prepare(`
      SELECT
        COUNT(*) as total_pairs,
        COUNT(DISTINCT performer_id) as performers,
        SUM(CASE WHEN type = 'intra' THEN 1 ELSE 0 END) as intra_pairs,
        SUM(CASE WHEN type = 'inter' THEN 1 ELSE 0 END) as inter_pairs,
        SUM(CASE WHEN type = 'both_bad' THEN 1 ELSE 0 END) as both_bad
      FROM pairwise_pairs
    `).get();

    // Binary data: count files in training folder
    let binaryData = { keep: 0, delete: 0, performers: 0 };
    try {
      const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
      if (folder) {
        const trainingPath = path.join(folder.path, 'deleted keep for training');
        const afterPath = path.join(folder.path, 'after filter performer');

        // Count delete images from training folder
        if (fs.existsSync(trainingPath)) {
          const dirs = fs.readdirSync(trainingPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'));
          let deleteCount = 0;
          for (const dir of dirs) {
            const picsDir = path.join(trainingPath, dir.name, 'pics');
            if (fs.existsSync(picsDir)) {
              deleteCount += fs.readdirSync(picsDir).filter(f =>
                ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase())
              ).length;
            }
          }
          binaryData.delete = deleteCount;
          binaryData.performers = dirs.length;
        }

        // Count keep images from after filter folder
        if (fs.existsSync(afterPath)) {
          const dirs = fs.readdirSync(afterPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'));
          let keepCount = 0;
          for (const dir of dirs) {
            const picsDir = path.join(afterPath, dir.name, 'pics');
            if (fs.existsSync(picsDir)) {
              keepCount += fs.readdirSync(picsDir).filter(f =>
                ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase())
              ).length;
            }
          }
          binaryData.keep = keepCount;
        }
      }
    } catch (_) { /* non-critical */ }

    const scoredImages = db.prepare('SELECT COUNT(*) as c FROM pairwise_image_scores').get().c;
    const rankedImages = db.prepare('SELECT COUNT(*) as c FROM image_elo_scores WHERE comparison_count > 0').get().c;

    res.json({
      pairwise: {
        totalPairs: pairwise.total_pairs,
        performers: pairwise.performers,
        intraPairs: pairwise.intra_pairs,
        interPairs: pairwise.inter_pairs,
        bothBad: pairwise.both_bad,
        scoredImages
      },
      binary: binaryData,
      ranking: {
        rankedImages,
      },
      readyForTraining: {
        pairwise: pairwise.total_pairs >= 50,
        binary: binaryData.keep >= 20 && binaryData.delete >= 20
      }
    });
  } catch (err) {
    console.error('[Training] Data summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/export-pairs ──────────────────────────
// Export pairwise training data (winner/loser paths)
router.post('/export-pairs', (req, res) => {
  try {
    const { performer_ids } = req.body;

    let pairs;
    if (performer_ids && performer_ids.length > 0) {
      const placeholders = performer_ids.map(() => '?').join(',');
      pairs = db.prepare(`
        SELECT winner, loser, performer_id, type
        FROM pairwise_pairs
        WHERE performer_id IN (${placeholders})
        ORDER BY created_at DESC
      `).all(...performer_ids);
    } else {
      pairs = db.prepare(`
        SELECT winner, loser, performer_id, type
        FROM pairwise_pairs
        ORDER BY created_at DESC
      `).all();
    }

    // Transform to training format
    const trainingData = pairs
      .filter(p => p.type !== 'both_bad') // Exclude "both bad" for preference training
      .map(p => ({
        winner: p.winner,
        loser: p.loser,
        performer_id: p.performer_id
      }));

    res.json({
      success: true,
      totalPairs: trainingData.length,
      pairs: trainingData
    });
  } catch (err) {
    console.error('[Training] Export pairs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/export-binary ─────────────────────────
// Export binary classification data (keep/delete paths)
router.post('/export-binary', async (req, res) => {
  try {
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) return res.status(400).json({ error: 'No base folder configured' });

    const basePath = folder.path;
    const trainingPath = path.join(basePath, 'deleted keep for training');
    const afterPath = path.join(basePath, 'after filter performer');
    const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

    const scanImages = (dir) => {
      const images = [];
      if (!fs.existsSync(dir)) return images;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          images.push(...scanImages(full));
        } else if (entry.isFile() && imageExts.includes(path.extname(entry.name).toLowerCase())) {
          images.push(full);
        }
      }
      return images;
    };

    const keepImages = fs.existsSync(afterPath)
      ? fs.readdirSync(afterPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .flatMap(d => scanImages(path.join(afterPath, d.name, 'pics')).map(p => ({ path: p, label: 'keep', performer: d.name })))
      : [];

    const deleteImages = fs.existsSync(trainingPath)
      ? fs.readdirSync(trainingPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .flatMap(d => scanImages(path.join(trainingPath, d.name, 'pics')).map(p => ({ path: p, label: 'delete', performer: d.name })))
      : [];

    res.json({
      success: true,
      keep: keepImages.length,
      delete: deleteImages.length,
      total: keepImages.length + deleteImages.length,
      data: [...keepImages, ...deleteImages]
    });
  } catch (err) {
    console.error('[Training] Export binary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/start ─────────────────────────────────
// Trigger training on the AI Inference App
router.post('/start', async (req, res) => {
  const { type = 'pairwise', epochs = 10, learning_rate, ai_server_url } = req.body;
  const aiUrl = ai_server_url || getAiServerUrl();

  try {
    // Check AI server is online
    const healthRes = await axios.get(`${aiUrl}/health`, { timeout: 5000 });
    if (healthRes.data.status !== 'ok') {
      return res.status(503).json({ error: 'AI server is not healthy' });
    }

    // Collect training data
    let trainingPayload;
    if (type === 'pairwise') {
      const pairs = db.prepare(`
        SELECT winner, loser, performer_id FROM pairwise_pairs WHERE type != 'both_bad'
      `).all();
      trainingPayload = { type: 'pairwise', pairs, epochs, learning_rate };
    } else if (type === 'binary') {
      // Delegate to export-binary and forward
      const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
      if (!folder) return res.status(400).json({ error: 'No base folder configured' });
      trainingPayload = {
        type: 'binary',
        base_path: folder.path,
        epochs,
        learning_rate
      };
    } else {
      return res.status(400).json({ error: `Unknown training type: ${type}` });
    }

    // Send to AI server
    const response = await axios.post(`${aiUrl}/train`, trainingPayload, {
      timeout: 300000 // 5 minute timeout for training
    });

    res.json({
      success: true,
      message: `Training job started (${type})`,
      aiResponse: response.data
    });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'AI server is offline', url: aiUrl });
    }
    console.error('[Training] Start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/training/models ─────────────────────────────────
// List available models on the AI server
router.get('/models', async (req, res) => {
  const aiUrl = req.query.url || getAiServerUrl();
  try {
    const response = await axios.get(`${aiUrl}/list_models`, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    res.json({ success: false, models: [], error: err.message });
  }
});

// ── GET /api/training/status ─────────────────────────────────
// Check if training is running on AI server
router.get('/status', async (req, res) => {
  const aiUrl = req.query.url || getAiServerUrl();
  try {
    const response = await axios.get(`${aiUrl}/training_status`, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    if (err.response?.status === 404) {
      return res.json({ training: false, message: 'No training endpoint (idle)' });
    }
    res.json({ training: false, error: err.message });
  }
});

module.exports = router;
