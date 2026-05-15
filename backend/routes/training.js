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
 * - GET  /api/training/export-zip   — Download training data as ZIP
 * - POST /api/training/push-data    — Push training data to AI server
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const os = require('os');

const { getAiServerUrl } = require('../utils/aiUrl');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

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

    // Performer-level comparison pairs (for Siamese training)
    let performerComparisons = { total: 0, singleDuels: 0, batchPairs: 0 };
    try {
      const pc = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN type = 'performer_rank' THEN 1 ELSE 0 END) as single_duels,
          SUM(CASE WHEN type = 'performer_rank_batch' THEN 1 ELSE 0 END) as batch_pairs
        FROM performer_comparisons
      `).get();
      performerComparisons = { total: pc.total, singleDuels: pc.single_duels, batchPairs: pc.batch_pairs };
    } catch (_) { /* table might not exist yet */ }

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
      performerComparisons,
      readyForTraining: {
        pairwise: pairwise.total_pairs >= 50,
        binary: binaryData.keep >= 20 && binaryData.delete >= 20,
        siamese: performerComparisons.total >= 20
      },
      hardExamples: {
        binary: (db.prepare(`SELECT COUNT(*) as c FROM hard_examples WHERE model_type = 'binary' OR model_type IS NULL`).get() || {c:0}).c,
        pairwise: (db.prepare(`SELECT COUNT(*) as c FROM hard_examples WHERE model_type = 'pairwise'`).get() || {c:0}).c
      }
    });
  } catch (err) {
    console.error('[Training] Data summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/training/performer-stats ────────────────────────
// Per-performer breakdown of training data quality
router.get('/performer-stats', (req, res) => {
  try {
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) return res.json({ performers: [] });
    const basePath = folder.path;
    const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

    // Get all performers from DB
    const performers = db.prepare(`
      SELECT id, name, pics_count, pics_filtered, pics_original_count,
             moved_to_after, ready_to_move, raw_ai_score
      FROM performers ORDER BY name ASC
    `).all();

    // Get pairwise pair counts per performer
    const pairCounts = {};
    const pairRows = db.prepare(`
      SELECT performer_id, COUNT(*) as cnt,
        SUM(CASE WHEN type = 'intra' THEN 1 ELSE 0 END) as intra,
        SUM(CASE WHEN type = 'inter' THEN 1 ELSE 0 END) as inter,
        SUM(CASE WHEN type = 'both_bad' THEN 1 ELSE 0 END) as both_bad
      FROM pairwise_pairs GROUP BY performer_id
    `).all();
    for (const r of pairRows) {
      pairCounts[r.performer_id] = { total: r.cnt, intra: r.intra, inter: r.inter, bothBad: r.both_bad };
    }

    // Get filter action counts per performer (how many images already labeled)
    const filterCounts = {};
    const filterRows = db.prepare(`
      SELECT performer_id,
        SUM(CASE WHEN action = 'keep' THEN 1 ELSE 0 END) as kept,
        SUM(CASE WHEN action = 'delete' THEN 1 ELSE 0 END) as deleted
      FROM filter_actions GROUP BY performer_id
    `).all();
    for (const r of filterRows) {
      filterCounts[r.performer_id] = { kept: r.kept, deleted: r.deleted };
    }

    // Disk scan is optional (slow on network drives) — use ?scan_disk=true
    const scanDisk = req.query.scan_disk === 'true';
    let keepDiskCounts = {}, deleteDiskCounts = {};
    
    if (scanDisk) {
      const afterDir = path.join(basePath, 'after filter performer');
      const trainingDir = path.join(basePath, 'deleted keep for training');
      
      const scanDirCounts = (baseDir) => {
        const counts = {};
        try {
          if (!fs.existsSync(baseDir)) return counts;
          const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'));
          for (const d of dirs) {
            const picsDir = path.join(baseDir, d.name, 'pics');
            try {
              if (fs.existsSync(picsDir)) {
                counts[d.name] = fs.readdirSync(picsDir).filter(f =>
                  imageExts.includes(path.extname(f).toLowerCase())
                ).length;
              }
            } catch (_e) { /* skip */ }
          }
        } catch (_e) { /* skip */ }
        return counts;
      };
      
      keepDiskCounts = scanDirCounts(afterDir);
      deleteDiskCounts = scanDirCounts(trainingDir);
    }

    const result = performers.map(p => {
      const pairs = pairCounts[p.id] || { total: 0, intra: 0, inter: 0, bothBad: 0 };
      const filter = filterCounts[p.id] || { kept: 0, deleted: 0 };
      
      // Disk counts from pre-scan
      const keepOnDisk = keepDiskCounts[p.name] || 0;
      const deleteOnDisk = deleteDiskCounts[p.name] || 0;

      // Real kept count is either DB actions or physical files on disk
      let realKept = Math.max(filter.kept, keepOnDisk);
      let realDeleted = Math.max(filter.deleted, deleteOnDisk);
      
      const isMoved = p.moved_to_after === 1 || p.moved_to_after === true;
      const totalOriginal = p.pics_original_count || p.pics_count || 0;

      // If the performer is in the after folder, we can logically infer the counts 
      // without needing a slow disk scan:
      // - Kept = current pics_count (what's left in their folder)
      // - Deleted = original count minus current count (what was moved to the training folder)
      if (isMoved && !scanDisk) {
        realKept = Math.max(realKept, p.pics_count || 0);
        const inferredDeleted = totalOriginal > (p.pics_count || 0) 
          ? totalOriginal - p.pics_count 
          : 0;
        realDeleted = Math.max(realDeleted, inferredDeleted);
      }
      
      const totalLabeled = realKept + realDeleted + (pairs.total * 2); 
      
      // If moved_to_after or disk matches/exceeds original, it's 100%
      const labelProgress = isMoved || (totalOriginal > 0 && realKept >= totalOriginal) ? 1 :
        (totalOriginal > 0 ? Math.min(1, totalLabeled / totalOriginal) : 0);

      // Data quality score (0-100)
      let quality = 0;
      if (totalLabeled > 0) quality += 20;
      if (totalLabeled >= 50) quality += 15;
      if (totalLabeled >= 200) quality += 15;
      if (pairs.total >= 10) quality += 15;
      if (pairs.total >= 50) quality += 10;
      if (realKept > 0 && realDeleted > 0) quality += 15; // has both classes
      if (keepOnDisk > 0 && deleteOnDisk > 0) quality += 10;

      return {
        id: p.id,
        name: p.name,
        totalImages: totalOriginal,
        movedToAfter: isMoved,
        aiScore: p.raw_ai_score,
        filter: {
          kept: realKept,
          deleted: realDeleted,
          total: totalLabeled,
          progress: Math.round(labelProgress * 100)
        },
        pairwise: pairs,
        disk: { keep: keepOnDisk, delete: deleteOnDisk },
        quality
      };
    });

    // Sort by quality descending, then by name
    result.sort((a, b) => b.quality - a.quality || a.name.localeCompare(b.name));

    res.json({
      performers: result,
      summary: {
        total: result.length,
        withData: result.filter(p => p.quality > 0).length,
        readyForBinary: result.filter(p => p.disk.keep > 0 && p.disk.delete > 0).length,
        readyForPairwise: result.filter(p => p.pairwise.total >= 10).length,
        avgQuality: result.length > 0 ? Math.round(result.reduce((s, p) => s + p.quality, 0) / result.length) : 0
      }
    });
  } catch (err) {
    console.error('[Training] Performer stats error:', err);
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
  const { type = 'pairwise', epochs = 10, batch_size = 16, backbone = 'facebook/dinov2-large', learning_rate, ai_server_url } = req.body;
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
      trainingPayload = { type: 'pairwise', pairs, epochs, batch_size, backbone, learning_rate };
      
      if (req.body.use_hard_examples) {
        try {
          const hard = db.prepare(`SELECT * FROM hard_examples WHERE model_type = 'pairwise'`).all();
          trainingPayload.hard_examples = hard;
        } catch (e) {}
      }

    } else if (['binary', 'context_binary', 'pairwise_siamese_binary', 'performer_ranker', 'ranked_binary', 'ranked_siamese_binary', 'rank_aware_siamese'].includes(type)) {
      const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
      if (!folder) return res.status(400).json({ error: 'No base folder configured' });
      trainingPayload = {
        type,
        base_path: folder.path,
        epochs,
        batch_size,
        backbone,
        learning_rate,
        performer_ratings: collectPerformerRatings()
      };
      
      if (req.body.use_hard_examples) {
        try {
          const hard = db.prepare(`SELECT * FROM hard_examples WHERE model_type = 'binary' OR model_type IS NULL`).all();
          trainingPayload.hard_examples = hard;
        } catch (e) {}
      }

    } else {
      return res.status(400).json({ error: `Unknown training type: ${type}` });
    }

    // Add mining/dedupe flags from body
    trainingPayload.enable_mining = req.body.enable_mining;
    trainingPayload.quantize = req.body.quantize;
    trainingPayload.mining_multiplier = req.body.mining_multiplier || 4;
    trainingPayload.deduplicate = req.body.deduplicate;
    trainingPayload.finetune_start_epoch = req.body.finetune_start_epoch;

    // Synthetic pair count for Siamese Binary training
    if (req.body.synthetic_pairs_per_epoch) {
      trainingPayload.synthetic_pairs_per_epoch = req.body.synthetic_pairs_per_epoch;
    }
    if (req.body.per_performer_pairs !== undefined) {
      trainingPayload.per_performer_pairs = req.body.per_performer_pairs;
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

// ── POST /api/training/test-model ────────────────────────────
// Relay test request with local data to AI server
router.post('/test-model', async (req, res) => {
  const { model_id, sample_size = 100, ai_server_url } = req.body;
  const aiUrl = ai_server_url || getAiServerUrl();

  try {
    const db = req.app.get('db');
    const settings = await db.all('SELECT key, value FROM settings WHERE key = ?', ['base_path']);
    const basePath = settings[0]?.value || '';
    
    if (!basePath) {
      return res.status(400).json({ error: 'Base path not set in settings' });
    }

    const afterDir = path.join(basePath, 'after filter performer');
    const trainingDir = path.join(basePath, 'deleted keep for training');

    const scanImages = (dir) => {
      if (!fs.existsSync(dir)) return [];
      const images = [];
      const performers = fs.readdirSync(dir);
      for (const perf of performers) {
        const perfPath = path.join(dir, perf);
        if (!fs.statSync(perfPath).isDirectory()) continue;
        
        // Check pics folder or root
        let picDir = path.join(perfPath, 'pics');
        if (!fs.existsSync(picDir)) picDir = perfPath;
        
        const files = fs.readdirSync(picDir);
        for (const f of files) {
          if (/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f)) {
            images.push({ path: path.join(picDir, f), performer: perf });
          }
        }
      }
      return images;
    };

    const keepPool = scanImages(afterDir);
    const deletePool = scanImages(trainingDir);

    if (keepPool.length === 0 || deletePool.length === 0) {
      return res.status(400).json({ error: 'Not enough local labeled images found for testing' });
    }

    // Sample
    const sampleCount = Math.min(sample_size / 2, keepPool.length, deletePool.length);
    const sampledKeep = keepPool.sort(() => 0.5 - Math.random()).slice(0, sampleCount);
    const sampledDelete = deletePool.sort(() => 0.5 - Math.random()).slice(0, sampleCount);

    // Encode to base64
    const packageImages = (list, label) => {
      return list.map(img => {
        try {
          const data = fs.readFileSync(img.path);
          const ext = path.extname(img.path).substring(1);
          return {
            data: `data:image/${ext};base64,${data.toString('base64')}`,
            label: label,
            performer: img.performer
          };
        } catch (e) { return null; }
      }).filter(Boolean);
    };

    const payload = {
      model_id,
      images: [
        ...packageImages(sampledKeep, 1),
        ...packageImages(sampledDelete, 0)
      ]
    };

    console.log(`[Training] Sending ${payload.images.length} images to AI server for testing...`);
    const response = await axios.post(`${aiUrl}/test_model`, payload, {
      timeout: 120000 // 2 minute timeout for testing
    });

    res.json(response.data);
  } catch (err) {
    console.error('[Training] Test relay error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/predict-performer-rank ────────────────
// Gather images for a performer and ask AI to predict their star rating
router.post('/predict-performer-rank', async (req, res) => {
  const { performerId, sample_size = 200 } = req.body;
  const aiUrl = getAiServerUrl();

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) return res.status(404).json({ error: 'Performer not found' });

    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    const basePath = folder?.path || '';
    if (!basePath) return res.status(400).json({ error: 'Base path not set' });

    // Find images for this performer
    let perfPath = path.join(basePath, 'before filter performer', performer.name, 'pics');
    if (!fs.existsSync(perfPath)) perfPath = path.join(basePath, 'after filter performer', performer.name, 'pics');
    if (!fs.existsSync(perfPath)) perfPath = path.join(basePath, 'before filter performer', performer.name);
    if (!fs.existsSync(perfPath)) perfPath = path.join(basePath, 'after filter performer', performer.name);

    if (!fs.existsSync(perfPath)) {
      return res.status(404).json({ error: 'Performer images directory not found' });
    }

    const files = fs.readdirSync(perfPath)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort(() => 0.5 - Math.random())
      .slice(0, sample_size);

    if (files.length === 0) {
      return res.status(400).json({ error: 'No images found for this performer' });
    }

    const imagePaths = files.map(f => path.join(perfPath, f));

    // Auto-load ranker if not loaded (consistent with Smart Filtering)
    try {
      const healthRes = await axios.get(`${aiUrl}/health`, { timeout: 5000 });
      if (!healthRes.data.ranker_loaded) {
        console.log(`[Training] Ranker not loaded, auto-loading performer_ranker.pt...`);
        await axios.post(`${aiUrl}/load_model`, { model_id: 'performer_ranker.pt' }, { timeout: 60000 });
      }
    } catch (healthErr) {
      console.warn(`[Training] Ranker health check/load failed: ${healthErr.message}`);
    }

    // Send to AI server
    const response = await axios.post(`${aiUrl}/predict_rank`, {
      images: imagePaths
    }, { timeout: 60000 });

    res.json(response.data);
  } catch (err) {
    console.error('[Training] Rank prediction error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: collect training images ──────────────────────────
function collectTrainingImages(basePath) {
  const afterDir = path.join(basePath, 'after filter performer');
  const trainingDir = path.join(basePath, 'deleted keep for training');

  const scanPerformerDir = (baseDir, label) => {
    const results = [];
    if (!fs.existsSync(baseDir)) return results;
    const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'));
    for (const d of dirs) {
      let picsDir = path.join(baseDir, d.name, 'pics');
      if (!fs.existsSync(picsDir)) picsDir = path.join(baseDir, d.name);
      if (!fs.existsSync(picsDir)) continue;
      const files = fs.readdirSync(picsDir).filter(f =>
        IMAGE_EXTS.includes(path.extname(f).toLowerCase())
      );
      for (const f of files) {
        results.push({
          absPath: path.join(picsDir, f),
          zipPath: `${label}/${d.name}/${f}`,
          label,
          performer: d.name,
          filename: f
        });
      }
    }
    return results;
  };

  const keep = scanPerformerDir(afterDir, 'keep');
  const del = scanPerformerDir(trainingDir, 'delete');
  return { keep, delete: del };
}

// ── Helper: collect performer star ratings ───────────────────
function collectPerformerRatings() {
  const ratings = {};
  try {
    const rows = db.prepare(`
      SELECT p.name, r.manual_star
      FROM performers p
      JOIN ratings r ON r.performer_id = p.id
      WHERE r.manual_star IS NOT NULL
    `).all();
    for (const row of rows) {
      ratings[row.name] = row.manual_star;
    }
  } catch (_) { /* ratings table may not exist */ }
  return ratings;
}


// ── GET /api/training/export-zip ─────────────────────────────
// Download training data as a ZIP file
router.get('/export-zip', async (req, res) => {
  const type = req.query.type || 'binary';
  const saveToDisk = req.query.saveToDisk === 'true';

  try {
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) return res.status(400).json({ error: 'No base folder configured' });

    const images = collectTrainingImages(folder.path);
    const keepCount = images.keep.length;
    const deleteCount = images.delete.length;

    if (keepCount === 0 && deleteCount === 0) {
      return res.status(400).json({ error: 'No training images found' });
    }

    // Build manifest
    const manifest = {
      type,
      created: new Date().toISOString(),
      keep_count: keepCount,
      delete_count: deleteCount,
      total: keepCount + deleteCount,
      performer_ratings: collectPerformerRatings()
    };

    // Include pairwise data
    try {
      const pairs = db.prepare(`
        SELECT winner, loser, performer_id, type FROM pairwise_pairs WHERE type != 'both_bad'
      `).all();
      const pathMap = {};
      for (const img of [...images.keep, ...images.delete]) {
        pathMap[img.absPath] = img.zipPath;
        pathMap[img.absPath.replace(/\\/g, '/')] = img.zipPath;
      }
      manifest.pairwise_pairs = pairs.map(p => ({
        winner: pathMap[p.winner] || pathMap[p.winner?.replace(/\\/g, '/')] || p.winner,
        loser: pathMap[p.loser] || pathMap[p.loser?.replace(/\\/g, '/')] || p.loser,
        performer_id: p.performer_id,
        type: p.type
      }));
      manifest.pairwise_count = pairs.length;
    } catch (_) { manifest.pairwise_pairs = []; manifest.pairwise_count = 0; }

    const zipFilename = `training_data_${type}_${Date.now()}.zip`;
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', err => { throw err; });

    if (saveToDisk) {
      const exportDir = path.join(folder.path, 'training_exports');
      await fs.ensureDir(exportDir);
      const exportPath = path.join(exportDir, zipFilename);
      const output = fs.createWriteStream(exportPath);

      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      for (const img of [...images.keep, ...images.delete]) {
        archive.file(img.absPath, { name: img.zipPath });
      }

      await archive.finalize();
      console.log(`[Training] ZIP saved to disk: ${exportPath}`);
      return res.json({
        success: true,
        message: 'Export completed successfully',
        path: exportPath,
        filename: zipFilename,
        images: keepCount + deleteCount
      });
    } else {
      // Stream ZIP to response
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      archive.pipe(res);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      for (const img of [...images.keep, ...images.delete]) {
        archive.file(img.absPath, { name: img.zipPath });
      }
      await archive.finalize();
      console.log(`[Training] ZIP exported: ${keepCount} keep + ${deleteCount} delete images`);
    }
  } catch (err) {
    console.error('[Training] Export ZIP error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── GET /api/training/export-manifest ──────────────────────────
// Download only the manifest.json
router.get('/export-manifest', async (req, res) => {
  const type = req.query.type || 'binary';
  try {
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) return res.status(400).json({ error: 'No base folder configured' });

    const images = collectTrainingImages(folder.path);
    const manifest = {
      type,
      created: new Date().toISOString(),
      keep_count: images.keep.length,
      delete_count: images.delete.length,
      total: images.keep.length + images.delete.length,
      performer_ratings: collectPerformerRatings()
    };

    // Include pairwise data
    try {
      const pairs = db.prepare(`
        SELECT winner, loser, performer_id, type FROM pairwise_pairs WHERE type != 'both_bad'
      `).all();

      const pathMap = {};
      for (const img of [...images.keep, ...images.delete]) {
        pathMap[img.absPath] = img.zipPath;
        pathMap[img.absPath.replace(/\\/g, '/')] = img.zipPath;
      }

      manifest.pairwise_pairs = pairs.map(p => ({
        winner: pathMap[p.winner] || pathMap[p.winner?.replace(/\\/g, '/')] || p.winner,
        loser: pathMap[p.loser] || pathMap[p.loser?.replace(/\\/g, '/')] || p.loser,
        performer_id: p.performer_id,
        type: p.type
      }));
      manifest.pairwise_count = pairs.length;
    } catch (_) { manifest.pairwise_pairs = []; manifest.pairwise_count = 0; }

    try {
      const actions = db.prepare(`
        SELECT performer_id, action, COUNT(*) as cnt
        FROM filter_actions GROUP BY performer_id, action
      `).all();
      manifest.filter_actions = actions;
    } catch (_) {}

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="training_manifest_${type}_${Date.now()}.json"`);
    res.send(JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.error('[Training] Export manifest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/push-labels ───────────────────────────
// Push only the manifest.json to the AI server
router.post('/push-labels', async (req, res) => {
  const { type = 'binary', ai_server_url } = req.body;
  const aiUrl = ai_server_url || getAiServerUrl();

  try {
    await axios.get(`${aiUrl}/health`, { timeout: 5000 });

    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) return res.status(400).json({ error: 'No base folder configured' });

    const images = collectTrainingImages(folder.path);
    const allImages = [...images.keep, ...images.delete];

    const manifest = {
      type,
      created: new Date().toISOString(),
      keep_count: images.keep.length,
      delete_count: images.delete.length,
      performer_ratings: collectPerformerRatings()
    };

    try {
      const pairs = db.prepare(`
        SELECT winner, loser, performer_id, type FROM pairwise_pairs WHERE type != 'both_bad'
      `).all();
      const pathMap = {};
      for (const img of allImages) {
        pathMap[img.absPath] = img.zipPath;
        pathMap[img.absPath.replace(/\\/g, '/')] = img.zipPath;
      }
      manifest.pairwise_pairs = pairs.map(p => ({
        winner: pathMap[p.winner] || pathMap[p.winner?.replace(/\\/g, '/')] || p.winner,
        loser: pathMap[p.loser] || pathMap[p.loser?.replace(/\\/g, '/')] || p.loser,
        performer_id: p.performer_id,
        type: p.type
      }));
      manifest.pairwise_count = pairs.length;
    } catch (_) { manifest.pairwise_pairs = []; manifest.pairwise_count = 0; }

    const tmpZip = path.join(os.tmpdir(), `labels_push_${Date.now()}.zip`);
    const output = fs.createWriteStream(tmpZip);
    const archive = archiver('zip', { zlib: { level: 1 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      archive.finalize();
    });

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(tmpZip), { filename: 'labels.zip' });
    form.append('type', type);

    const uploadRes = await axios.post(`${aiUrl}/upload_training`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000
    });

    fs.removeSync(tmpZip);

    res.json({
      success: true,
      message: `Pushed manifest with ${manifest.pairwise_count} pairs to AI server`,
      aiResponse: uploadRes.data
    });
  } catch (err) {
    console.error('[Training] Push labels error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/push-data ─────────────────────────────
// Push training data to the AI server
router.post('/push-data', async (req, res) => {
  const { type = 'binary', ai_server_url } = req.body;
  const aiUrl = ai_server_url || getAiServerUrl();

  try {
    // Check AI server is online
    await axios.get(`${aiUrl}/health`, { timeout: 5000 });

    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) return res.status(400).json({ error: 'No base folder configured' });

    const images = collectTrainingImages(folder.path);
    const allImages = [...images.keep, ...images.delete];

    if (allImages.length === 0) {
      return res.status(400).json({ error: 'No training images found' });
    }

    // Build manifest with ALL training data
    const manifest = {
      type,
      created: new Date().toISOString(),
      keep_count: images.keep.length,
      delete_count: images.delete.length,
      performer_ratings: collectPerformerRatings()
    };

    // Always include pairwise data with remapped paths
    try {
      const pairs = db.prepare(`
        SELECT winner, loser, performer_id, type FROM pairwise_pairs WHERE type != 'both_bad'
      `).all();
      const pathMap = {};
      for (const img of allImages) {
        pathMap[img.absPath] = img.zipPath;
        pathMap[img.absPath.replace(/\\/g, '/')] = img.zipPath;
      }
      manifest.pairwise_pairs = pairs.map(p => ({
        winner: pathMap[p.winner] || pathMap[p.winner?.replace(/\\/g, '/')] || p.winner,
        loser: pathMap[p.loser] || pathMap[p.loser?.replace(/\\/g, '/')] || p.loser,
        performer_id: p.performer_id,
        type: p.type
      }));
      manifest.pairwise_count = pairs.length;
    } catch (_) { manifest.pairwise_pairs = []; manifest.pairwise_count = 0; }

    // Create temp ZIP
    const tmpZip = path.join(os.tmpdir(), `training_push_${Date.now()}.zip`);
    const output = fs.createWriteStream(tmpZip);
    const archive = archiver('zip', { zlib: { level: 1 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      for (const img of allImages) {
        archive.file(img.absPath, { name: img.zipPath });
      }
      archive.finalize();
    });

    const zipSize = fs.statSync(tmpZip).size;
    console.log(`[Training] ZIP created: ${(zipSize / 1024 / 1024).toFixed(1)} MB, pushing to ${aiUrl}...`);

    // Upload to AI server
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(tmpZip), { filename: 'training_data.zip' });
    form.append('type', type);

    const uploadRes = await axios.post(`${aiUrl}/upload_training`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 600000 // 10 min for large uploads
    });

    // Cleanup temp file
    fs.removeSync(tmpZip);

    res.json({
      success: true,
      message: `Pushed ${allImages.length} images (${(zipSize / 1024 / 1024).toFixed(1)} MB) to AI server`,
      keep: images.keep.length,
      delete: images.delete.length,
      aiResponse: uploadRes.data
    });
  } catch (err) {
    console.error('[Training] Push error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/training/performer-comparisons-summary ──────────
// Summary stats for performer-level comparison pairs
router.get('/performer-comparisons-summary', (req, res) => {
  try {
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total_pairs,
        COUNT(DISTINCT winner_id) + COUNT(DISTINCT loser_id) as performers_involved,
        SUM(CASE WHEN type = 'performer_rank' THEN 1 ELSE 0 END) as single_duels,
        SUM(CASE WHEN type = 'performer_rank_batch' THEN 1 ELSE 0 END) as batch_pairs,
        SUM(CASE WHEN source = 'group_rate' THEN 1 ELSE 0 END) as from_group_rate,
        SUM(CASE WHEN source = 'smart_compare' THEN 1 ELSE 0 END) as from_smart_compare,
        MIN(created_at) as first_comparison,
        MAX(created_at) as last_comparison
      FROM performer_comparisons
    `).get();

    // Unique performer IDs involved
    const uniquePerformers = db.prepare(`
      SELECT COUNT(DISTINCT pid) as count FROM (
        SELECT winner_id AS pid FROM performer_comparisons
        UNION
        SELECT loser_id AS pid FROM performer_comparisons
      )
    `).get();

    // Top compared performers
    const topPerformers = db.prepare(`
      SELECT p.id, p.name, COUNT(*) as comparison_count
      FROM (
        SELECT winner_id AS pid FROM performer_comparisons
        UNION ALL
        SELECT loser_id AS pid FROM performer_comparisons
      ) AS all_ids
      JOIN performers p ON p.id = all_ids.pid
      GROUP BY p.id
      ORDER BY comparison_count DESC
      LIMIT 10
    `).all();

    res.json({
      ...summary,
      uniquePerformers: uniquePerformers.count,
      topPerformers,
      readyForSiamese: summary.total_pairs >= 20
    });
  } catch (err) {
    console.error('[Training] Performer comparisons summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/export-performer-pairs ────────────────
// Export performer-level comparison pairs for Siamese model training
// These are tagged as 'performer_rank' / 'performer_rank_batch'
// and are distinct from image-level pairwise pairs
router.post('/export-performer-pairs', (req, res) => {
  try {
    const { type, source, limit } = req.body;

    let whereClause = '1=1';
    const params = [];

    if (type) {
      whereClause += ' AND pc.type = ?';
      params.push(type);
    }
    if (source) {
      whereClause += ' AND pc.source = ?';
      params.push(source);
    }

    let limitClause = '';
    if (limit) {
      limitClause = ' LIMIT ?';
      params.push(parseInt(limit, 10));
    }

    const pairs = db.prepare(`
      SELECT
        pc.id,
        pc.winner_id,
        pc.loser_id,
        pc.type,
        pc.source,
        pc.winner_rating_before,
        pc.loser_rating_before,
        pc.winner_rating_after,
        pc.loser_rating_after,
        pc.created_at,
        pw.name AS winner_name,
        pl.name AS loser_name,
        pw.thumbnail AS winner_thumbnail,
        pl.thumbnail AS loser_thumbnail
      FROM performer_comparisons pc
      JOIN performers pw ON pw.id = pc.winner_id
      JOIN performers pl ON pl.id = pc.loser_id
      WHERE ${whereClause}
      ORDER BY pc.created_at DESC
      ${limitClause}
    `).all(...params);

    // Build Siamese-ready training format
    const trainingPairs = pairs.map(p => ({
      winner_id: p.winner_id,
      loser_id: p.loser_id,
      winner_name: p.winner_name,
      loser_name: p.loser_name,
      type: p.type,
      source: p.source,
      rating_gap_before: Math.round((p.winner_rating_before - p.loser_rating_before) * 100) / 100,
      rating_gap_after: Math.round((p.winner_rating_after - p.loser_rating_after) * 100) / 100,
      created_at: p.created_at
    }));

    res.json({
      success: true,
      totalPairs: trainingPairs.length,
      types: {
        performer_rank: pairs.filter(p => p.type === 'performer_rank').length,
        performer_rank_batch: pairs.filter(p => p.type === 'performer_rank_batch').length
      },
      pairs: trainingPairs
    });
  } catch (err) {
    console.error('[Training] Export performer pairs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── AI Server Proxies (to support remote access via Tailscale) ───

// GET /api/training/ai-health
router.get('/ai-health', async (req, res) => {
  const aiUrl = req.query.url || getAiServerUrl();
  try {
    const response = await axios.get(`${aiUrl}/health`, { timeout: 3000 });
    res.json(response.data);
  } catch (err) {
    res.status(503).json({ error: 'AI server unreachable', message: err.message });
  }
});

// GET /api/training/ai-data-status
router.get('/ai-data-status', async (req, res) => {
  const aiUrl = req.query.url || getAiServerUrl();
  try {
    const response = await axios.get(`${aiUrl}/training_data_status`, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    res.status(503).json({ error: 'AI server unreachable', message: err.message });
  }
});

// POST /api/training/ai-load-model
router.post('/ai-load-model', async (req, res) => {
  const { url, model_id } = req.body;
  const aiUrl = url || getAiServerUrl();
  try {
    const response = await axios.post(`${aiUrl}/load_model`, { model_id }, { timeout: 10000 });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load model', message: err.message });
  }
});

// POST /api/training/ai-delete-model
router.post('/ai-delete-model', async (req, res) => {
  const { url, model_id } = req.body;
  const aiUrl = url || getAiServerUrl();
  try {
    const response = await axios.post(`${aiUrl}/delete_model`, { model_id }, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete model', message: err.message });
  }
});

// POST /api/training/predict-ranks-batch
router.post('/predict-ranks-batch', async (req, res) => {
  const { performerIds, ai_server_url } = req.body;
  const aiUrl = ai_server_url || getAiServerUrl();

  if (!performerIds || !Array.isArray(performerIds)) {
    return res.status(400).json({ error: 'performerIds array is required' });
  }

  console.log(`[Training] Batch rank prediction for ${performerIds.length} performers...`);

  try {
    const results = {};
    
    // Auto-load ranker if not loaded
    try {
      const healthRes = await axios.get(`${aiUrl}/health`, { timeout: 5000 });
      if (!healthRes.data.ranker_loaded) {
        console.log(`[Training] Auto-loading ranker for batch prediction...`);
        await axios.post(`${aiUrl}/load_model`, { model_id: 'performer_ranker.pt' }, { timeout: 60000 });
      }
    } catch (e) {
      console.warn(`[Training] Batch health check failed: ${e.message}`);
    }

    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    const basePath = folder?.path || '';
    if (!basePath) throw new Error('No base path configured in folders table');

    await Promise.all(performerIds.map(async (performerId) => {
      try {
        const performer = db.prepare('SELECT name FROM performers WHERE id = ?').get(performerId);
        if (!performer) return;

        let perfPath = path.join(basePath, 'before filter performer', performer.name, 'pics');
        if (!fs.existsSync(perfPath)) perfPath = path.join(basePath, 'after filter performer', performer.name, 'pics');
        if (!fs.existsSync(perfPath)) perfPath = path.join(basePath, 'before filter performer', performer.name);
        if (!fs.existsSync(perfPath)) perfPath = path.join(basePath, 'after filter performer', performer.name);

        if (!fs.existsSync(perfPath)) return;

        const files = fs.readdirSync(perfPath).filter(f => 
          ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(f).toLowerCase())
        ).slice(0, 60); // Increased to 60 for higher accuracy

        if (files.length === 0) return;

        const imagePaths = files.map(f => path.join(perfPath, f));
        
        const response = await axios.post(`${aiUrl}/predict_rank`, {
          images: imagePaths
        }, { timeout: 30000 });
        
        if (response.data.success) {
          results[performerId] = response.data.predicted_rank;
          console.log(`[Training]   ${performer.name}: ${response.data.predicted_rank.toFixed(2)} stars`);
        }
      } catch (err) {
        console.error(`[Training] Failed to predict rank for ${performerId}:`, err.message);
      }
    }));

    console.log(`[Training] Batch prediction complete. Got results for ${Object.keys(results).length} performers.`);
    res.json({ success: true, results });
  } catch (err) {
    console.error('[Training] Batch rank prediction error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
