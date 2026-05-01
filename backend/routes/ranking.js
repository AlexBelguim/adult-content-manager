/**
 * Ranking routes for ELO-based image preference learning.
 * 
 * Provides endpoints for:
 * - Selecting performers for ranking sessions
 * - Getting batches of images to rank
 * - Submitting rankings and updating ELO scores
 * - Exporting training data
 * - Manual ELO adjustments
 * 
 * Image sources:
 * - Keep images: from "after filter performer/" folder
 * - Delete images: from "deleted keep for training/" folder
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

/**
 * Recursively get all images from a folder
 * Skips folders that start with '.' (like .cache, .thumbnails, etc.)
 */
function getImagesFromFolder(folderPath) {
  const images = [];
  if (!fs.existsSync(folderPath)) return images;
  
  function scanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden folders/files starting with '.'
        if (entry.name.startsWith('.')) continue;
        
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
          images.push(fullPath);
        }
      }
    } catch (err) {
      console.error(`Error scanning ${dir}:`, err.message);
    }
  }
  
  scanDir(folderPath);
  return images;
}

/**
 * Extract performer name from image path
 * Assumes structure like: basePath/after filter performer/PerformerName/image.jpg
 * or: basePath/deleted keep for training/PerformerName/image.jpg
 */
function getPerformerFromPath(imagePath, basePath) {
  const relativePath = imagePath.replace(basePath, '').replace(/^[\\\/]/, '');
  const parts = relativePath.split(/[\\\/]/);
  // parts[0] = "after filter performer" or "deleted keep for training"
  // parts[1] = performer name (or subfolder)
  return parts.length >= 2 ? parts[1] : 'Unknown';
}

// Initialize ranking tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ranking_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      image_paths TEXT NOT NULL,
      rankings TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_elo_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_path TEXT UNIQUE NOT NULL,
      performer_id INTEGER,
      elo_score REAL DEFAULT 1500,
      comparison_count INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      manual_adjustment REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (performer_id) REFERENCES performers(id)
    )
  `);
} catch (e) {
  // Tables might already exist
}

/**
 * GET /api/ranking/performers
 * Get performers with ranking coverage stats
 * Scans "after filter performer/" for keep images and "deleted keep for training/" for delete images
 */
router.get('/performers', (req, res) => {
  try {
    // Get base path from folders table
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) {
      return res.json([]);
    }
    const basePath = folder.path;
    
    const keepFolder = path.join(basePath, 'after filter performer');
    const deleteFolder = path.join(basePath, 'deleted keep for training');
    
    // Get all performer folders from both directories
    const performerStats = new Map();
    
    // Scan keep folder
    if (fs.existsSync(keepFolder)) {
      const keepPerformers = fs.readdirSync(keepFolder, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name);
      
      for (const name of keepPerformers) {
        const images = getImagesFromFolder(path.join(keepFolder, name));
        if (!performerStats.has(name)) {
          performerStats.set(name, { name, keep_images: 0, delete_images: 0 });
        }
        performerStats.get(name).keep_images = images.length;
      }
    }
    
    // Scan delete folder
    if (fs.existsSync(deleteFolder)) {
      const deletePerformers = fs.readdirSync(deleteFolder, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name);
      
      for (const name of deletePerformers) {
        const images = getImagesFromFolder(path.join(deleteFolder, name));
        if (!performerStats.has(name)) {
          performerStats.set(name, { name, keep_images: 0, delete_images: 0 });
        }
        performerStats.get(name).delete_images = images.length;
      }
    }
    
    // Get ELO stats from database
    const eloStats = db.prepare(`
      SELECT 
        performer_id,
        COUNT(*) as ranked_images,
        AVG(comparison_count) as avg_comparisons,
        AVG(elo_score) as avg_score
      FROM image_elo_scores
      GROUP BY performer_id
    `).all();
    
    const eloByPerformer = new Map();
    for (const stat of eloStats) {
      // Try to match by performer_id
      const performer = db.prepare('SELECT name FROM performers WHERE id = ?').get(stat.performer_id);
      if (performer) {
        eloByPerformer.set(performer.name, stat);
      }
    }
    
    // Build final list
    const performers = [];
    for (const [name, stats] of performerStats) {
      const total = stats.keep_images + stats.delete_images;
      if (total === 0) continue;
      
      const elo = eloByPerformer.get(name) || { ranked_images: 0, avg_comparisons: 0, avg_score: 1500 };
      
      // Get performer ID from database if exists
      const dbPerformer = db.prepare('SELECT id FROM performers WHERE name = ?').get(name);
      
      performers.push({
        id: dbPerformer?.id || name, // Use name as ID if not in database
        name,
        keep_images: stats.keep_images,
        delete_images: stats.delete_images,
        total_images: total,
        ranked_images: elo.ranked_images || 0,
        avg_comparisons: Math.round((elo.avg_comparisons || 0) * 10) / 10,
        avg_score: Math.round(elo.avg_score || 1500),
        coverage: Math.round(((elo.ranked_images || 0) / total) * 100),
        needsMoreRanking: (elo.avg_comparisons || 0) < 3 || (elo.ranked_images || 0) < total * 0.5
      });
    }
    
    performers.sort((a, b) => a.name.localeCompare(b.name));
    res.json(performers);
  } catch (err) {
    console.error('Error getting performers:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ranking/batch
 * Get a batch of 5 images for ranking
 * Scans "after filter performer/" and "deleted keep for training/" folders
 */
router.post('/batch', (req, res) => {
  try {
    const { performerIds } = req.body; // These can be names or IDs
    
    if (!performerIds || performerIds.length === 0) {
      return res.status(400).json({ error: 'No performers selected' });
    }
    
    // Get base path
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    if (!folder) {
      return res.status(400).json({ error: 'No base folder configured' });
    }
    const basePath = folder.path;
    
    const keepFolder = path.join(basePath, 'after filter performer');
    const deleteFolder = path.join(basePath, 'deleted keep for training');
    
    // Convert IDs to names if needed
    const performerNames = performerIds.map(id => {
      if (typeof id === 'string' && isNaN(parseInt(id))) {
        return id; // Already a name
      }
      const performer = db.prepare('SELECT name FROM performers WHERE id = ?').get(id);
      return performer?.name || id;
    });
    
    // Collect all images for selected performers
    const allImages = [];
    
    for (const performerName of performerNames) {
      // Get performer ID for database lookups
      const dbPerformer = db.prepare('SELECT id FROM performers WHERE name = ?').get(performerName);
      const performerId = dbPerformer?.id || null;
      
      // Scan keep folder
      const keepPath = path.join(keepFolder, performerName);
      if (fs.existsSync(keepPath)) {
        const images = getImagesFromFolder(keepPath);
        for (const imgPath of images) {
          const elo = db.prepare('SELECT elo_score, comparison_count FROM image_elo_scores WHERE image_path = ?').get(imgPath);
          allImages.push({
            path: imgPath,
            performer_id: performerId,
            performerName,
            currentScore: elo?.elo_score || 1500,
            comparisonCount: elo?.comparison_count || 0,
            type: 'keep'
          });
        }
      }
      
      // Scan delete folder
      const deletePath = path.join(deleteFolder, performerName);
      if (fs.existsSync(deletePath)) {
        const images = getImagesFromFolder(deletePath);
        for (const imgPath of images) {
          const elo = db.prepare('SELECT elo_score, comparison_count FROM image_elo_scores WHERE image_path = ?').get(imgPath);
          allImages.push({
            path: imgPath,
            performer_id: performerId,
            performerName,
            currentScore: elo?.elo_score || 1500,
            comparisonCount: elo?.comparison_count || 0,
            type: 'delete'
          });
        }
      }
    }
    
    if (allImages.length < 5) {
      return res.status(400).json({ 
        error: `Not enough images (found ${allImages.length}, need 5)` 
      });
    }
    
    // Prioritize less-compared images with randomness
    const sorted = allImages.sort((a, b) => {
      const compDiff = a.comparisonCount - b.comparisonCount;
      const random = (Math.random() - 0.5) * 5;
      return compDiff + random;
    });
    
    // Take top 5 and shuffle
    const selected = sorted.slice(0, 5);
    shuffleArray(selected);
    
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    res.json({
      batchId,
      images: selected,
      totalAvailable: allImages.length
    });
  } catch (err) {
    console.error('Error getting batch:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ranking/submit
 * Submit rankings for a batch
 */
router.post('/submit', (req, res) => {
  try {
    const { batchId, rankings } = req.body;
    
    if (!rankings || rankings.length !== 5) {
      return res.status(400).json({ error: 'Expected exactly 5 ranked images' });
    }
    
    const imagePaths = rankings.map(r => r.path);
    
    // Save comparison
    db.prepare(`
      INSERT INTO ranking_comparisons (batch_id, image_paths, rankings)
      VALUES (?, ?, ?)
    `).run(batchId, JSON.stringify(imagePaths), JSON.stringify(rankings));
    
    // Update ELO scores
    updateEloScores(rankings);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error submitting rankings:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ranking/stats
 * Get ranking statistics
 */
router.get('/stats', (req, res) => {
  try {
    const totalBatches = db.prepare(
      `SELECT COUNT(*) as count FROM ranking_comparisons`
    ).get();
    
    const totalImages = db.prepare(
      `SELECT COUNT(*) as count FROM image_elo_scores WHERE comparison_count > 0`
    ).get();
    
    const avgComparisons = db.prepare(
      `SELECT AVG(comparison_count) as avg FROM image_elo_scores WHERE comparison_count > 0`
    ).get();
    
    res.json({
      totalBatches: totalBatches.count,
      totalRankedImages: totalImages.count,
      avgComparisonsPerImage: Math.round((avgComparisons.avg || 0) * 10) / 10,
      totalPairwiseComparisons: totalBatches.count * 10 // 5 images = 10 pairs
    });
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ranking/leaderboard
 * Get top-ranked images
 */
router.get('/leaderboard', (req, res) => {
  try {
    const { limit = 50, performerId } = req.query;
    
    let query = `
      SELECT 
        ies.image_path,
        ies.elo_score,
        ies.comparison_count,
        ies.wins,
        ies.losses,
        ies.manual_adjustment,
        ies.performer_id,
        p.name as performer_name
      FROM image_elo_scores ies
      LEFT JOIN performers p ON p.id = ies.performer_id
      WHERE ies.comparison_count > 0
    `;
    
    const params = [];
    if (performerId) {
      query += ` AND ies.performer_id = ?`;
      params.push(performerId);
    }
    
    query += ` ORDER BY ies.elo_score DESC LIMIT ?`;
    params.push(parseInt(limit));
    
    const leaderboard = db.prepare(query).all(...params);
    res.json(leaderboard);
  } catch (err) {
    console.error('Error getting leaderboard:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ranking/distribution
 * Get score distribution for visualization
 */
router.get('/distribution', (req, res) => {
  try {
    const scores = db.prepare(`
      SELECT elo_score, performer_id
      FROM image_elo_scores 
      WHERE comparison_count > 0
    `).all();
    
    // Create histogram
    const bucketSize = 50;
    const distribution = {};
    
    for (const s of scores) {
      const bucket = Math.floor(s.elo_score / bucketSize) * bucketSize;
      distribution[bucket] = (distribution[bucket] || 0) + 1;
    }
    
    // Per-performer stats
    const performerStats = db.prepare(`
      SELECT 
        p.id,
        p.name,
        COUNT(ies.id) as ranked_count,
        AVG(ies.elo_score) as avg_score,
        MIN(ies.elo_score) as min_score,
        MAX(ies.elo_score) as max_score
      FROM performers p
      JOIN image_elo_scores ies ON ies.performer_id = p.id
      WHERE ies.comparison_count > 0
      GROUP BY p.id
      ORDER BY avg_score DESC
    `).all();
    
    res.json({
      distribution: Object.entries(distribution).map(([bucket, count]) => ({
        bucket: parseInt(bucket),
        count
      })).sort((a, b) => a.bucket - b.bucket),
      performerStats,
      totalScored: scores.length
    });
  } catch (err) {
    console.error('Error getting distribution:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ranking/adjust-elo
 * Manually adjust ELO score for an image
 */
router.post('/adjust-elo', (req, res) => {
  try {
    const { imagePath, newScore } = req.body;
    
    if (typeof newScore !== 'number' || newScore < 0 || newScore > 3000) {
      return res.status(400).json({ error: 'Score must be between 0 and 3000' });
    }
    
    // Get current score
    const current = db.prepare(
      `SELECT elo_score FROM image_elo_scores WHERE image_path = ?`
    ).get(imagePath);
    
    const oldScore = current?.elo_score || 1500;
    const adjustment = newScore - oldScore;
    
    db.prepare(`
      INSERT INTO image_elo_scores (image_path, elo_score, manual_adjustment, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(image_path) DO UPDATE SET
        elo_score = ?,
        manual_adjustment = manual_adjustment + ?,
        updated_at = CURRENT_TIMESTAMP
    `).run(imagePath, newScore, adjustment, newScore, adjustment);
    
    res.json({ success: true, oldScore, newScore, adjustment });
  } catch (err) {
    console.error('Error adjusting ELO:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ranking/export
 * Export training data for ML model
 * Includes keep/delete labels from folder structure
 */
router.get('/export', (req, res) => {
  try {
    // Get base path
    const folder = db.prepare('SELECT path FROM folders LIMIT 1').get();
    const basePath = folder?.path || '';
    
    const comparisons = db.prepare(
      `SELECT * FROM ranking_comparisons ORDER BY created_at`
    ).all();
    
    const scores = db.prepare(`
      SELECT ies.*, p.name as performer_name
      FROM image_elo_scores ies
      LEFT JOIN performers p ON p.id = ies.performer_id
      WHERE ies.comparison_count > 0
      ORDER BY ies.elo_score DESC
    `).all();
    
    // Determine keep/delete type based on path
    const enrichedScores = scores.map(s => {
      let label = 'unknown';
      if (s.image_path.includes('after filter performer')) {
        label = 'keep';
      } else if (s.image_path.includes('deleted keep for training')) {
        label = 'delete';
      }
      return { ...s, label };
    });
    
    // Generate pairwise comparisons for training
    const pairwiseComparisons = [];
    
    for (const comp of comparisons) {
      const rankings = JSON.parse(comp.rankings);
      
      for (let i = 0; i < rankings.length; i++) {
        for (let j = i + 1; j < rankings.length; j++) {
          const imgA = rankings[i];
          const imgB = rankings[j];
          
          // Determine labels
          const labelA = imgA.path.includes('after filter performer') ? 'keep' : 
                         imgA.path.includes('deleted keep for training') ? 'delete' : 'unknown';
          const labelB = imgB.path.includes('after filter performer') ? 'keep' : 
                         imgB.path.includes('deleted keep for training') ? 'delete' : 'unknown';
          
          if (imgA.rank < imgB.rank) {
            pairwiseComparisons.push({
              preferred: imgA.path,
              preferred_label: labelA,
              rejected: imgB.path,
              rejected_label: labelB,
              margin: imgB.rank - imgA.rank
            });
          } else if (imgA.rank > imgB.rank) {
            pairwiseComparisons.push({
              preferred: imgB.path,
              preferred_label: labelB,
              rejected: imgA.path,
              rejected_label: labelA,
              margin: imgA.rank - imgB.rank
            });
          }
        }
      }
    }
    
    res.json({
      pairwiseComparisons,
      imageScores: enrichedScores,
      totalBatches: comparisons.length,
      totalPairs: pairwiseComparisons.length,
      keepImages: enrichedScores.filter(s => s.label === 'keep').length,
      deleteImages: enrichedScores.filter(s => s.label === 'delete').length,
      exportedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error exporting data:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper functions

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function updateEloScores(rankings) {
  const K = 32;
  
  // Ensure all images have records
  for (const r of rankings) {
    // Try to get performer_id from various sources
    let performerId = r.performer_id || null;
    
    if (!performerId) {
      // Try content_items
      const item = db.prepare(
        `SELECT performer_id FROM content_items WHERE file_path = ?`
      ).get(r.path);
      performerId = item?.performer_id || null;
    }
    
    if (!performerId && r.performerName) {
      // Try to look up by name
      const performer = db.prepare(
        `SELECT id FROM performers WHERE name = ?`
      ).get(r.performerName);
      performerId = performer?.id || null;
    }
    
    db.prepare(`
      INSERT OR IGNORE INTO image_elo_scores 
      (image_path, performer_id, elo_score, comparison_count, wins, losses)
      VALUES (?, ?, 1500, 0, 0, 0)
    `).run(r.path, performerId);
  }
  
  // Get current scores
  const scores = {};
  for (const r of rankings) {
    const row = db.prepare(
      `SELECT elo_score FROM image_elo_scores WHERE image_path = ?`
    ).get(r.path);
    scores[r.path] = row?.elo_score || 1500;
  }
  
  // Calculate new scores
  const newScores = { ...scores };
  const wins = {};
  const losses = {};
  
  for (const r of rankings) {
    wins[r.path] = 0;
    losses[r.path] = 0;
  }
  
  // Pairwise comparisons
  for (let i = 0; i < rankings.length; i++) {
    for (let j = i + 1; j < rankings.length; j++) {
      const a = rankings[i];
      const b = rankings[j];
      
      const expectedA = 1 / (1 + Math.pow(10, (scores[b.path] - scores[a.path]) / 400));
      const expectedB = 1 - expectedA;
      
      let actualA, actualB;
      if (a.rank < b.rank) {
        actualA = 1; actualB = 0;
        wins[a.path]++;
        losses[b.path]++;
      } else if (a.rank > b.rank) {
        actualA = 0; actualB = 1;
        wins[b.path]++;
        losses[a.path]++;
      } else {
        actualA = 0.5; actualB = 0.5;
      }
      
      newScores[a.path] += K * (actualA - expectedA);
      newScores[b.path] += K * (actualB - expectedB);
    }
  }
  
  // Update database
  // Each image was compared against (rankings.length - 1) other images in this batch
  const pairsPerImage = rankings.length - 1;
  for (const r of rankings) {
    db.prepare(`
      UPDATE image_elo_scores 
      SET elo_score = ?, 
          comparison_count = comparison_count + ?, 
          wins = wins + ?,
          losses = losses + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE image_path = ?
    `).run(newScores[r.path], pairsPerImage, wins[r.path], losses[r.path], r.path);
  }
}

module.exports = router;
