/**
 * Health & Diagnostics Routes
 *
 * Single endpoint that returns comprehensive system health:
 * - Database integrity (table sizes, orphaned records)
 * - AI Inference server connectivity
 * - Disk usage per performer
 * - Pairwise labeling coverage
 * - Rating coverage
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const { getAiServerUrl } = require('../utils/aiUrl');

// ── GET /api/health ─────────────────────────────────────────
router.get('/', async (req, res) => {
  const startTime = Date.now();

  try {
    // ── Database table sizes ──────────────────────────────
    const tables = [
      'performers', 'folders', 'filter_actions', 'tags',
      'performer_file_hashes', 'hash_runs',
      'ratings', 'content_items', 'content_clip_embeddings',
      'pairwise_pairs', 'pairwise_image_scores', 'pairwise_inference_results'
    ];

    const dbStats = {};
    for (const table of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        dbStats[table] = row.count;
      } catch (_) {
        dbStats[table] = -1; // Table doesn't exist
      }
    }

    // ── Performer health ─────────────────────────────────
    const performerCount = dbStats.performers;
    const withRatings = db.prepare('SELECT COUNT(*) as c FROM ratings WHERE manual_star IS NOT NULL').get().c;
    const withPairwise = db.prepare('SELECT COUNT(DISTINCT performer_id) as c FROM pairwise_image_scores').get().c;
    const withHashes = db.prepare('SELECT COUNT(DISTINCT performer_id) as c FROM performer_file_hashes').get().c;
    const blacklisted = db.prepare('SELECT COUNT(*) as c FROM performers WHERE blacklisted = 1').get().c;
    const inBefore = db.prepare('SELECT COUNT(*) as c FROM performers WHERE moved_to_after = 0 AND blacklisted != 1').get().c;
    const inAfter = db.prepare('SELECT COUNT(*) as c FROM performers WHERE moved_to_after = 1').get().c;

    // ── Orphan detection ─────────────────────────────────
    const orphanedRatings = db.prepare(`
      SELECT COUNT(*) as c FROM ratings r
      WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = r.performer_id)
    `).get().c;

    const orphanedHashes = db.prepare(`
      SELECT COUNT(*) as c FROM performer_file_hashes h
      WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = h.performer_id)
    `).get().c;

    const orphanedPairwise = db.prepare(`
      SELECT COUNT(*) as c FROM pairwise_image_scores s
      WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = s.performer_id)
    `).get().c;

    const orphanedFilterActions = db.prepare(`
      SELECT COUNT(*) as c FROM filter_actions fa
      WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = fa.performer_id)
    `).get().c;

    // ── Pairwise labeling coverage ───────────────────────
    const pairwiseStats = db.prepare(`
      SELECT
        COUNT(*) as total_pairs,
        COUNT(DISTINCT performer_id) as performers_labeled,
        AVG(CASE WHEN type = 'intra' THEN 1 ELSE 0 END) * 100 as intra_pct
      FROM pairwise_pairs
    `).get();

    const totalScoredImages = db.prepare('SELECT COUNT(*) as c FROM pairwise_image_scores').get().c;
    const avgComparisons = db.prepare('SELECT AVG(comparisons) as avg FROM pairwise_image_scores WHERE comparisons > 0').get().avg;

    // ── Rating distribution ──────────────────────────────
    const ratingDistribution = db.prepare(`
      SELECT
        CASE
          WHEN manual_star <= 1 THEN '0-1'
          WHEN manual_star <= 2 THEN '1-2'
          WHEN manual_star <= 3 THEN '2-3'
          WHEN manual_star <= 4 THEN '3-4'
          ELSE '4-5'
        END as bucket,
        COUNT(*) as count
      FROM ratings
      WHERE manual_star IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `).all();

    // ── Disk stats ───────────────────────────────────────
    let diskStats = null;
    try {
      const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
      if (folder) {
        const basePath = folder.path;
        const beforePath = path.join(basePath, 'before filter performer');
        const afterPath = path.join(basePath, 'after filter performer');
        const trainingPath = path.join(basePath, 'deleted keep for training');

        const dirSize = async (dir) => {
          if (!await fs.pathExists(dir)) return { exists: false, performers: 0 };
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
          return { exists: true, performers: dirs.length };
        };

        const [beforeStats, afterStats, trainingStats] = await Promise.all([
          dirSize(beforePath), dirSize(afterPath), dirSize(trainingPath)
        ]);

        diskStats = {
          basePath,
          beforeFilter: beforeStats,
          afterFilter: afterStats,
          trainingData: trainingStats
        };
      }
    } catch (err) {
      diskStats = { error: err.message };
    }

    // ── AI Server connectivity ───────────────────────────
    const aiUrl = getAiServerUrl();
    let aiServerHealth = { online: false };
    try {
      const response = await axios.get(`${aiUrl}/health`, { timeout: 3000 });
      aiServerHealth = {
        online: true,
        url: aiUrl,
        device: response.data.device,
        modelLoaded: response.data.model_loaded,
        modelName: response.data.model_name,
        vram: response.data.vram_allocated
      };
    } catch (_) {
      aiServerHealth = { online: false, url: aiUrl };
    }

    // ── Schema version ───────────────────────────────────
    let schemaVersion = 0;
    try {
      const row = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get();
      schemaVersion = row?.v || 0;
    } catch (_) {}

    // ── Build response ───────────────────────────────────
    const issues = [];
    if (orphanedRatings > 0) issues.push({ type: 'orphan', table: 'ratings', count: orphanedRatings });
    if (orphanedHashes > 0) issues.push({ type: 'orphan', table: 'performer_file_hashes', count: orphanedHashes });
    if (orphanedPairwise > 0) issues.push({ type: 'orphan', table: 'pairwise_image_scores', count: orphanedPairwise });
    if (orphanedFilterActions > 0) issues.push({ type: 'orphan', table: 'filter_actions', count: orphanedFilterActions });
    if (!aiServerHealth.online) issues.push({ type: 'service', service: 'ai_inference', message: 'AI server is offline' });

    res.json({
      status: issues.length === 0 ? 'healthy' : 'issues_found',
      schemaVersion,
      durationMs: Date.now() - startTime,
      database: {
        tableSizes: dbStats,
        orphanedRecords: { ratings: orphanedRatings, hashes: orphanedHashes, pairwise: orphanedPairwise, filterActions: orphanedFilterActions }
      },
      performers: {
        total: performerCount,
        inBefore,
        inAfter,
        blacklisted,
        withRatings,
        withPairwise,
        withHashes,
        ratingCoverage: performerCount > 0 ? Math.round((withRatings / performerCount) * 100) : 0,
        pairwiseCoverage: performerCount > 0 ? Math.round((withPairwise / performerCount) * 100) : 0
      },
      pairwise: {
        totalPairs: pairwiseStats.total_pairs,
        performersLabeled: pairwiseStats.performers_labeled,
        totalScoredImages,
        avgComparisonsPerImage: avgComparisons ? Math.round(avgComparisons * 10) / 10 : 0,
        intraPct: pairwiseStats.intra_pct ? Math.round(pairwiseStats.intra_pct) : 0
      },
      ratings: {
        total: withRatings,
        distribution: ratingDistribution
      },
      disk: diskStats,
      aiServer: aiServerHealth,
      issues
    });
  } catch (err) {
    console.error('[Health] Error:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── POST /api/health/cleanup ─────────────────────────────────
// Remove orphaned records from all tables
router.post('/cleanup', (req, res) => {
  try {
    const results = {};

    results.ratings = db.prepare(`
      DELETE FROM ratings WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = ratings.performer_id)
    `).run().changes;

    results.hashes = db.prepare(`
      DELETE FROM performer_file_hashes WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = performer_file_hashes.performer_id)
    `).run().changes;

    results.pairwiseScores = db.prepare(`
      DELETE FROM pairwise_image_scores WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = pairwise_image_scores.performer_id)
    `).run().changes;

    results.pairwisePairs = db.prepare(`
      DELETE FROM pairwise_pairs WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = pairwise_pairs.performer_id)
    `).run().changes;

    results.filterActions = db.prepare(`
      DELETE FROM filter_actions WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = filter_actions.performer_id)
    `).run().changes;

    results.tags = db.prepare(`
      DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM performers p WHERE p.id = tags.performer_id)
    `).run().changes;

    const totalCleaned = Object.values(results).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      message: `Cleaned ${totalCleaned} orphaned records`,
      cleaned: results
    });
  } catch (err) {
    console.error('[Health] Cleanup error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
