/**
 * AI Training Hub Routes
 *
 * Proxies training requests to the acm-gpu.
 * Collects training data from the local DB and sends it to the GPU machine.
 *
 * Endpoints:
 * - GET  /api/training/status       — Current training job status (acm-gpu's live run, or the queue's waiting one)
 * - GET  /api/training/data-summary — How much training data is available
 * - POST /api/training/start        — Put a training run in the queue (services/trainingQueue.js): acm-gpu claims it
 * - GET  /api/training/queue        — The training queue: running, waiting, the last that ended
 * - POST /api/training/jobs/:id/cancel | /retry | /bump { dir }, DELETE /api/training/jobs/:id
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
const trainingQueue = require('../services/trainingQueue');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

// The push routes' temp zips: one left by a crash or a restart mid-push is cleared at start-up, once it is an hour old.
const TMP_ZIP = /^(training_push|labels_push)_\d+\.zip$/;
(async () => {
  try {
    const tmp = os.tmpdir();
    for (const name of await fs.readdir(tmp)) {
      if (!TMP_ZIP.test(name)) continue;
      try {
        const file = path.join(tmp, name);
        if (Date.now() - (await fs.stat(file)).mtimeMs > 60 * 60 * 1000) await fs.remove(file);
      } catch (_) { /* best effort */ }
    }
  } catch (_) { /* best effort */ }
})().catch(() => {});

// ── Helper: count the training pictures per performer ────────
// One counter for the data summary and the per-performer disk counts, built from collectTrainingImages so the counts
// follow the same rules as push and export (every IMAGE_EXTS, the performer folder when it has no pics/).
// Kept for PICTURE_TTL per base folder; fresh counts again.
const PICTURE_TTL = 60 * 1000;
const pictureMemo = new Map(); // basePath -> { at, value }
function countTrainingPictures(basePath, { fresh = false } = {}) {
  const memo = pictureMemo.get(basePath);
  if (!fresh && memo && Date.now() - memo.at < PICTURE_TTL) return memo.value;
  const images = collectTrainingImages(basePath);
  const byPerformer = (list) => {
    const counts = {};
    for (const img of list) counts[img.performer] = (counts[img.performer] || 0) + 1;
    return counts;
  };
  const value = { keep: byPerformer(images.keep), delete: byPerformer(images.delete) };
  pictureMemo.set(basePath, { at: Date.now(), value });
  return value;
}

/** a whole number from lo to hi, also from a numeric string; null when it isn't one */
function wholeIn(v, lo, hi) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

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
        SUM(CASE WHEN type = 'both_bad' THEN 1 ELSE 0 END) as both_bad,
        SUM(CASE WHEN source IS NULL THEN 1 ELSE 0 END) as rank_pairs,
        SUM(CASE WHEN source = 'pairwise_db' THEN 1 ELSE 0 END) as imported_pairs,
        SUM(CASE WHEN source = 'pairwise_db' AND type = 'intra' THEN 1 ELSE 0 END) as imported_intra
      FROM pairwise_pairs
    `).get();

    // Pictures: the files in the keep (after filter) and delete (training) folders, per performer too, counted the
    // way push and export collect them (countTrainingPictures). ?fresh=1 counts again.
    // CLIP taste levels: kept performers with their deleted pictures, and delete-only performers, which
    // are disliked or blacklisted. No names: the page only counts them.
    let pictures = { keep: 0, delete: 0, performers: 0 };
    let tastePerformers = [];
    try {
      const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
      if (folder) {
        // {performer folder: pictures}
        const { keep: kept, delete: deleted } = countTrainingPictures(folder.path, { fresh: req.query.fresh === '1' });
        const sum = counts => Object.values(counts).reduce((a, b) => a + b, 0);
        pictures = { keep: sum(kept), delete: sum(deleted), performers: Object.values(deleted).filter(n => n > 0).length };

        const blacklisted = new Set(db.prepare('SELECT name FROM performers WHERE blacklisted = 1').all().map(p => p.name));
        const stars = collectPerformerRatings();
        tastePerformers = [
          ...Object.entries(kept).filter(([, n]) => n)
            .map(([name, n]) => ({ level: 'kept', keep: n, delete: deleted[name] || 0, stars: stars[name] ?? null })),
          ...Object.entries(deleted).filter(([name, n]) => n && !kept[name])
            .map(([name, n]) => ({ level: blacklisted.has(name) ? 'blacklisted' : 'disliked', keep: 0, delete: n, stars: null }))
        ];
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
        rankPairs: pairwise.rank_pairs,
        importedPairs: pairwise.imported_pairs,
        importedIntra: pairwise.imported_intra,
        scoredImages
      },
      pictures,
      taste: { performers: tastePerformers },
      ranking: {
        rankedImages,
      },
      performerComparisons,
      // the CLIP models and K train on the keep and delete pictures, the hand pairs come on top
      readyForTraining: {
        pictures: pictures.keep >= 20 && pictures.delete >= 20
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
    if (!folder) return res.json({ performers: [], basePath: null });
    const basePath = folder.path;

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

    // Disk scan is optional (slow on network drives) — use ?scan_disk=true (and &fresh=1 to count again). The counts
    // are the data summary's (countTrainingPictures), so both follow what push and export take.
    const scanDisk = req.query.scan_disk === 'true';
    let keepDiskCounts = {}, deleteDiskCounts = {};

    if (scanDisk) {
      try {
        const counts = countTrainingPictures(basePath, { fresh: req.query.fresh === '1' });
        keepDiskCounts = counts.keep;
        deleteDiskCounts = counts.delete;
      } catch (_e) { /* skip: no disk counts */ }
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
      basePath,
      summary: {
        total: result.length,
        withData: result.filter(p => p.quality > 0).length,
        // with the disk scan, performers with pictures on both sides; without it, the filter's own counts
        readyForKeepDelete: scanDisk
          ? result.filter(p => p.disk.keep > 0 && p.disk.delete > 0).length
          : result.filter(p => p.filter.kept > 0 && p.filter.deleted > 0).length,
        readyForPairwise: result.filter(p => p.pairwise.total >= 10).length,
        avgQuality: result.length > 0 ? Math.round(result.reduce((s, p) => s + p.quality, 0) / result.length) : 0
      }
    });
  } catch (err) {
    console.error('[Training] Performer stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/training/start ─────────────────────────────────
// A training run into the queue, with everything it trains with collected now. acm-gpu claims it when it's free
// (routes/workers.js), so a second run waits instead of being turned away, and a run asked for while the PC is off
// starts when it's back.
// K's trainer fixes its run (3 epochs, batch 16, acm-gpu trainer.py) and ignores what is sent, so K stores just that.
const K_RUN = { epochs: 3, batch_size: 16 };
router.post('/start', async (req, res) => {
  const { type = 'clip_siamese', use_legacy = true } = req.body;
  if (!trainingQueue.TRAINABLE.includes(type)) return res.status(400).json({ error: `Unknown training type: ${type}` });

  let epochs = K_RUN.epochs, batch_size = K_RUN.batch_size, synthetic = null;
  if (type !== 'clip_keepdelete') {
    const bad = (field, lo, hi) => res.status(400).json({ error: `${field} must be a whole number from ${lo} to ${hi}` });
    epochs = wholeIn(req.body.epochs ?? 10, 1, 50);
    if (epochs === null) return bad('Epochs', 1, 50);
    batch_size = wholeIn(req.body.batch_size ?? 16, 1, 64);
    if (batch_size === null) return bad('Batch size', 1, 64);
    const sp = req.body.synthetic_pairs_per_epoch;
    if (sp !== undefined && sp !== null && sp !== '' && Number(sp) !== 0) {
      synthetic = wholeIn(sp, 100, 5000);
      if (synthetic === null) return bad('Pairs per performer', 100, 5000);
    }
  }

  try {
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) return res.status(400).json({ error: 'No base folder configured' });
    const trainingPayload = { type, base_path: folder.path, epochs, batch_size };

    // CLIP siamese (1st order) also learns from the same-performer hand pairs: Rank images and the pairwise.db import.
    // The trainer drops the legacy sources (this import and its own old labeller file) when use_legacy is off.
    if (type === 'clip_siamese') {
      trainingPayload.pairs = db.prepare(`SELECT winner, loser, source FROM pairwise_pairs WHERE type = 'intra'`).all();
      trainingPayload.use_legacy = use_legacy;
    }

    // CLIP taste (2nd order) takes the hand pairs across performers too, and splits the delete-only
    // performers into disliked and blacklisted
    if (type === 'clip_taste') {
      trainingPayload.pairs = db.prepare(`SELECT winner, loser, source FROM pairwise_pairs WHERE type != 'both_bad'`).all();
      trainingPayload.performer_ratings = collectPerformerRatings();
      trainingPayload.blacklisted_performers = db.prepare('SELECT name FROM performers WHERE blacklisted = 1').all().map(p => p.name);
      trainingPayload.use_legacy = use_legacy;
    }

    // Automatic pairs per performer per epoch for the CLIP models
    if (synthetic) {
      trainingPayload.synthetic_pairs_per_epoch = synthetic;
    }

    const q = trainingQueue.enqueue(trainingPayload);
    res.json({
      success: true,
      queued: true,
      id: q.id,
      ahead: q.ahead,
      message: q.ahead ? `Queued: ${q.label}, after ${q.ahead} other run${q.ahead === 1 ? '' : 's'}` : `Queued: ${q.label}; acm-gpu starts it when it's free`
    });
  } catch (err) {
    console.error('[Training] Start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── the training queue ───────────────────────────────────────
const queueRoute = (fn) => (req, res) => {
  try { res.json(fn(req) ?? { ok: true }); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
};
const jobId = (req) => Number(req.params.id);
router.get('/queue', queueRoute(() => trainingQueue.list()));
router.post('/jobs/:id/cancel', queueRoute((req) => trainingQueue.cancel(jobId(req))));
router.post('/jobs/:id/retry', queueRoute((req) => { trainingQueue.retry(jobId(req)); }));
router.post('/jobs/:id/bump', queueRoute((req) => { trainingQueue.bump(jobId(req), req.body?.dir); }));
router.delete('/jobs/:id', queueRoute((req) => { trainingQueue.remove(jobId(req)); }));

// ── GET /api/training/models ─────────────────────────────────
// List available models on the AI server
// Each answer is kept (app_settings ai_models_snapshot, without the epoch histories), and returned as snapshot when
// acm-gpu doesn't answer, so the page still shows the files and their figures. ?snapshot=1 returns only the snapshot.
const MODELS_SNAPSHOT_KEY = 'ai_models_snapshot';
const SNAPSHOT_KEYS = ['filename', 'type', 'size_mb', 'modified', 'created_at', 'val_acc', 'val_mae', 'samples', 'epochs', 'backbone'];
function readModelsSnapshot() {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MODELS_SNAPSHOT_KEY);
    const snap = row?.value ? JSON.parse(row.value) : null;
    return snap && typeof snap === 'object' && Array.isArray(snap.models) ? snap : null;
  } catch (_) {
    return null;
  }
}
router.get('/models', async (req, res) => {
  // ?snapshot=1: only the kept snapshot, without asking acm-gpu (the page shows it at once when acm-gpu is known to be off)
  if (req.query.snapshot === '1') {
    return res.json({ success: false, online: false, models: [], error: 'Snapshot only', snapshot: readModelsSnapshot() });
  }
  const aiUrl = getAiServerUrl();
  try {
    const response = await axios.get(`${aiUrl}/list_models`, { timeout: 30000 });
    const data = response.data || {};
    const snapshot = {
      at: Date.now(),
      current: data.active_model_file || null,
      models: (Array.isArray(data.models) ? data.models : []).map(m => {
        const out = {};
        for (const k of SNAPSHOT_KEYS) out[k] = m?.[k] ?? null;
        return out;
      })
    };
    try {
      db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(MODELS_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('[Training] Could not keep the models snapshot:', e.message);
    }
    res.json({ ...data, success: true, online: true, at: snapshot.at });
  } catch (err) {
    res.json({ success: false, online: false, models: [], error: err.message, snapshot: readModelsSnapshot() });
  }
});

// ── GET /api/training/status ─────────────────────────────────
// Check if training is running on AI server
// acm-gpu's live run when it's training; otherwise a run waiting in the queue reads as active (phase 'queued'), so the
// dashboard keeps showing it until it has run.
router.get('/status', async (req, res) => {
  const aiUrl = getAiServerUrl();
  const jobs = trainingQueue.list().jobs;
  const waiting = jobs.filter(j => j.status === 'queued');
  const running = jobs.find(j => j.status === 'running');
  const queue = { waiting: waiting.length, running: running ? running.id : null };
  let live = null;
  try {
    live = (await axios.get(`${aiUrl}/training_status`, { timeout: 5000 })).data;
  } catch (err) {
    live = { training: false, error: err.response?.status === 404 ? null : err.message };
  }
  if (live?.active) return res.json({ ...live, queue });
  if (running) return res.json({ ...(running.state || {}), active: true, type: running.type, phase: running.phase || 'starting', message: running.message || 'Starting on acm-gpu', queue });
  if (waiting.length) {
    const next = waiting[0];
    return res.json({ active: true, type: next.type, phase: 'queued', epoch: 0, total_epochs: next.epochs || 0,
      message: `Waiting in the training queue${waiting.length > 1 ? ` (${waiting.length} runs)` : ''}: acm-gpu starts it when it's free`, queue });
  }
  res.json({ ...live, queue });
});

// ── POST /api/training/test-model ────────────────────────────
// Relay test request with local data to AI server
router.post('/test-model', async (req, res) => {
  const { model_id, sample_size = 100 } = req.body;
  const aiUrl = getAiServerUrl();

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

function collectPerformerComparisonCounts() {
  const counts = {};
  try {
    const rows = db.prepare(`
      SELECT p.name, COALESCE(r.comparison_count, 0) AS comparison_count
      FROM performers p
      JOIN ratings r ON r.performer_id = p.id
      WHERE r.manual_star IS NOT NULL
    `).all();
    for (const row of rows) {
      counts[row.name] = row.comparison_count;
    }
  } catch (_) { /* column may not exist on older schemas */ }
  return counts;
}


// ── GET /api/training/export-zip ─────────────────────────────
// Download training data as a ZIP file
router.get('/export-zip', async (req, res) => {
  const type = req.query.type || 'clip_siamese';
  const saveToDisk = req.query.saveToDisk === 'true';
  if (!trainingQueue.TRAINABLE.includes(type)) return res.status(400).json({ error: 'Unknown training type' });

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
      performer_ratings: collectPerformerRatings(),
      performer_comparison_counts: collectPerformerComparisonCounts()
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

    if (saveToDisk) {
      const exportDir = path.join(folder.path, 'training_exports');
      await fs.ensureDir(exportDir);
      const exportPath = path.join(exportDir, zipFilename);
      const output = fs.createWriteStream(exportPath);
      // done only once the file is closed; an archive or a write error ends the request and removes the partial file
      const closed = new Promise((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
      });

      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      for (const img of [...images.keep, ...images.delete]) {
        archive.file(img.absPath, { name: img.zipPath });
      }

      try {
        await Promise.all([closed, archive.finalize()]);
      } catch (err) {
        console.error('[Training] Export ZIP to disk failed:', err.message);
        try { archive.abort(); output.destroy(); } catch (_) { /* already ended */ }
        await fs.remove(exportPath).catch(() => {});
        return res.status(500).json({ error: err.message });
      }
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
      // an archive error ends the request: a cut download once bytes went out, else a 500
      archive.on('error', (err) => {
        console.error('[Training] Export ZIP error:', err.message);
        archive.unpipe(res);
        if (res.headersSent) res.destroy(err);
        else res.status(500).json({ error: err.message });
      });
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
  const type = req.query.type || 'clip_siamese';
  if (!trainingQueue.TRAINABLE.includes(type)) return res.status(400).json({ error: 'Unknown training type' });
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
      performer_ratings: collectPerformerRatings(),
      performer_comparison_counts: collectPerformerComparisonCounts()
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
  const { type = 'clip_siamese' } = req.body;
  const aiUrl = getAiServerUrl();
  let tmpZip = null;

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
      performer_ratings: collectPerformerRatings(),
      performer_comparison_counts: collectPerformerComparisonCounts()
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

    tmpZip = path.join(os.tmpdir(), `labels_push_${Date.now()}.zip`);
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

    res.json({
      success: true,
      message: `Pushed manifest with ${manifest.pairwise_count} pairs to AI server`,
      aiResponse: uploadRes.data
    });
  } catch (err) {
    console.error('[Training] Push labels error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpZip) fs.remove(tmpZip).catch(() => {});
  }
});

// ── POST /api/training/push-data ─────────────────────────────
// Push training data to the AI server
router.post('/push-data', async (req, res) => {
  const { type = 'clip_siamese' } = req.body;
  const aiUrl = getAiServerUrl();
  let tmpZip = null;

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
      performer_ratings: collectPerformerRatings(),
      performer_comparison_counts: collectPerformerComparisonCounts()
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
    tmpZip = path.join(os.tmpdir(), `training_push_${Date.now()}.zip`);
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
  } finally {
    if (tmpZip) fs.remove(tmpZip).catch(() => {});
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
  const aiUrl = getAiServerUrl();
  try {
    const response = await axios.get(`${aiUrl}/health`, { timeout: 3000 });
    res.json(response.data);
  } catch (err) {
    res.status(503).json({ error: 'AI server unreachable', message: err.message });
  }
});

// GET /api/training/ai-data-status
router.get('/ai-data-status', async (req, res) => {
  const aiUrl = getAiServerUrl();
  try {
    const response = await axios.get(`${aiUrl}/training_data_status`, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    res.status(503).json({ error: 'AI server unreachable', message: err.message });
  }
});

// POST /api/training/ai-load-model
// (120 s, as filterService allows for the same call: a model takes a while to load)
const isModelFile = (id) => typeof id === 'string' && id.endsWith('.pt');
router.post('/ai-load-model', async (req, res) => {
  const { model_id } = req.body || {};
  if (!isModelFile(model_id)) return res.status(400).json({ error: 'model_id must name a model file' });
  const aiUrl = getAiServerUrl();
  try {
    const response = await axios.post(`${aiUrl}/load_model`, { model_id }, { timeout: 120000 });
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: 'Failed to load model',
      message: err.response?.data?.message || err.response?.data?.error || err.message
    });
  }
});

// POST /api/training/ai-delete-model
// acm-gpu refuses the loaded file and the P / P2 files itself; the app refuses the K file the filter view uses.
router.post('/ai-delete-model', async (req, res) => {
  const { model_id } = req.body || {};
  if (!isModelFile(model_id)) return res.status(400).json({ error: 'model_id must name a model file' });
  let preferredK = null;
  try {
    preferredK = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('preferred_clip_keepdelete_model')?.value || null;
  } catch (_) { /* no setting */ }
  if (preferredK && model_id === preferredK) {
    const message = 'The filter view uses this file: choose another K file first';
    return res.status(409).json({ error: message, message });
  }
  const aiUrl = getAiServerUrl();
  try {
    const response = await axios.post(`${aiUrl}/delete_model`, { model_id }, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: 'Failed to delete model', message: err.response?.data?.error || err.message });
  }
});

module.exports = router;
