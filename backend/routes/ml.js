const express = require('express');
const router = express.Router();
const db = require('../db');
const mlService = require('../services/mlService');

/**
 * GET /api/ml/training-stats
 * Get training data statistics
 */
router.get('/training-stats', (req, res) => {
  try {
    const { includedPerformers } = req.query;
    const included = includedPerformers ? JSON.parse(includedPerformers) : [];
    
    const stats = mlService.getTrainingDataStats(included);
    res.send({ success: true, stats });
  } catch (err) {
    console.error('Error getting training stats:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/performer-stats
 * Get per-performer training data statistics
 */
router.get('/performer-stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT 
        p.id,
        p.name,
        COUNT(DISTINCT CASE WHEN fa.action IS NOT NULL THEN ci.id END) as total_samples,
        SUM(CASE WHEN fa.action = 'delete' THEN 1 ELSE 0 END) as deleted_samples,
        SUM(CASE WHEN fa.action = 'keep' THEN 1 ELSE 0 END) as kept_samples,
        COUNT(DISTINCT CASE WHEN cce.clip_embedding IS NOT NULL THEN ci.id END) as files_with_clip,
        COUNT(DISTINCT CASE WHEN ci.file_type = 'image' AND cce.clip_embedding IS NOT NULL THEN ci.id END) as image_clips,
        COUNT(DISTINCT CASE WHEN ci.file_type = 'video' AND cce.clip_embedding IS NOT NULL THEN ci.id END) as video_clips,
        SUM(CASE WHEN ci.file_type = 'image' AND fa.action IS NOT NULL THEN 1 ELSE 0 END) as image_samples,
        SUM(CASE WHEN ci.file_type = 'video' AND fa.action IS NOT NULL THEN 1 ELSE 0 END) as video_samples,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN fa.action IS NOT NULL THEN ci.id END) > 0 THEN 
            CAST(SUM(CASE WHEN fa.action = 'delete' THEN 1 ELSE 0 END) AS REAL) / COUNT(DISTINCT CASE WHEN fa.action IS NOT NULL THEN ci.id END) * 100
          ELSE 0 
        END as balance
      FROM performers p
      JOIN content_items ci ON p.id = ci.performer_id
      JOIN content_clip_embeddings cce ON ci.id = cce.content_item_id
      LEFT JOIN filter_actions fa ON ci.file_path = fa.file_path
      GROUP BY p.id, p.name
      HAVING files_with_clip > 0
      ORDER BY total_samples DESC, balance DESC
    `).all();
    
    res.send({ success: true, stats });
  } catch (err) {
    console.error('Error getting performer stats:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/included-performers
 * Get list of performers included in training
 */
router.get('/included-performers', (req, res) => {
  try {
    const included = db.prepare(`
      SELECT 
        ip.*,
        p.name as performer_name
      FROM ml_included_performers ip
      JOIN performers p ON ip.performer_id = p.id
    `).all();
    
    res.send({ success: true, included });
  } catch (err) {
    console.error('Error getting included performers:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/include-performer
 * Include a performer in training
 */
router.post('/include-performer', (req, res) => {
  try {
    const { performerId, modelType = 'both' } = req.body;
    
    db.prepare(`
      INSERT OR REPLACE INTO ml_included_performers (performer_id, model_type)
      VALUES (?, ?)
    `).run(performerId, modelType);
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error including performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/ml/include-performer/:id
 * Remove performer from inclusion list (exclude them from all model types)
 */
router.delete('/include-performer/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    db.prepare('DELETE FROM ml_included_performers WHERE performer_id = ?').run(id);
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error removing performer inclusion:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/ml/include-performer/:id/:modelType
 * Remove performer from specific model type
 */
router.delete('/include-performer/:id/:modelType', (req, res) => {
  try {
    const { id, modelType } = req.params;
    
    db.prepare('DELETE FROM ml_included_performers WHERE performer_id = ? AND model_type = ?')
      .run(id, modelType);
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error removing performer from model type:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/ml/include-performer/:id/:modelType
 * Remove performer from specific model type
 */
router.delete('/include-performer/:id/:modelType', (req, res) => {
  try {
    const { id, modelType } = req.params;
    
    db.prepare('DELETE FROM ml_included_performers WHERE performer_id = ? AND model_type = ?')
      .run(id, modelType);
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error removing performer from model type:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/models
 * Get all ML models
 */
router.get('/models', (req, res) => {
  try {
    const models = mlService.getAllModels();
    res.send({ success: true, models });
  } catch (err) {
    console.error('Error getting models:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/models/active
 * Get active model
 */
router.get('/models/active', (req, res) => {
  try {
    const model = mlService.getActiveModel();
    res.send({ success: true, model });
  } catch (err) {
    console.error('Error getting active model:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/models/:id/activate
 * Set a model as active
 */
router.post('/models/:id/activate', (req, res) => {
  try {
    const { id } = req.params;
    const model = mlService.setActiveModel(id);
    res.send({ success: true, model });
  } catch (err) {
    console.error('Error activating model:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/ml/models/:id
 * Delete a model
 */
router.delete('/models/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await mlService.deleteModel(id);
    res.send({ success: true });
  } catch (err) {
    console.error('Error deleting model:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/train
 * Start training a new model
 */
router.post('/train', async (req, res) => {
  try {
    const { basePath } = req.body;
    
    if (!basePath) {
      return res.status(400).send({ error: 'basePath is required' });
    }
    
    // Get included performers
    const included = db.prepare('SELECT performer_id FROM ml_included_performers').all();
    const includedIds = included.map(e => e.performer_id);
    
    // Start training
    const result = await mlService.startTraining(basePath, includedIds);
    
    res.send({ 
      success: true, 
      jobId: result.jobId,
      modelId: result.modelId,
      message: 'Training started'
    });
  } catch (err) {
    console.error('Error starting training:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/training-job/:jobId
 * Get training job status
 */
router.get('/training-job/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = mlService.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).send({ error: 'Job not found' });
    }
    
    res.send({ success: true, job });
  } catch (err) {
    console.error('Error getting job status:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/predict/:performerId
 * Generate predictions for a performer
 */
router.post('/predict/:performerId', async (req, res) => {
  try {
    const { performerId } = req.params;
    const { modelId } = req.body;
    
    const predictions = await mlService.generatePredictions(
      parseInt(performerId), 
      modelId
    );
    
    res.send({ success: true, predictions });
  } catch (err) {
    console.error('Error generating predictions:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/predictions/:performerId
 * Get cached predictions for a performer
 */
router.get('/predictions/:performerId', async (req, res) => {
  try {
    const { performerId } = req.params;
    const { modelId } = req.query;
    
    const predictions = await mlService.getPredictions(
      parseInt(performerId),
      modelId
    );
    
    res.send({ success: true, predictions });
  } catch (err) {
    console.error('Error getting predictions:', err);
    res.status(500).send({ error: err.message });
  }
});

// ============================================
// ML Batch State Persistence Endpoints
// ============================================

/**
 * GET /api/ml/batch-state/:performerId
 * Get saved batch state for a performer
 */
router.get('/batch-state/:performerId', (req, res) => {
  try {
    const { performerId } = req.params;
    
    const state = db.prepare(`
      SELECT * FROM ml_batch_state 
      WHERE performer_id = ? AND status = 'in_progress'
    `).get(parseInt(performerId));
    
    if (!state) {
      return res.send({ success: true, state: null });
    }
    
    res.send({ 
      success: true, 
      state: {
        ...state,
        batch_state: state.batch_state ? JSON.parse(state.batch_state) : null,
        settings: state.settings ? JSON.parse(state.settings) : null
      }
    });
  } catch (err) {
    console.error('Error getting batch state:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/batch-state-by-name/:performerName
 * Get saved batch state for a performer by name (for temp performers)
 */
router.get('/batch-state-by-name/:performerName', (req, res) => {
  try {
    const { performerName } = req.params;
    
    const state = db.prepare(`
      SELECT * FROM ml_batch_state 
      WHERE performer_name = ? AND status = 'in_progress'
    `).get(performerName);
    
    if (!state) {
      return res.send({ success: true, state: null });
    }
    
    res.send({ 
      success: true, 
      state: {
        ...state,
        batch_state: state.batch_state ? JSON.parse(state.batch_state) : null,
        settings: state.settings ? JSON.parse(state.settings) : null
      }
    });
  } catch (err) {
    console.error('Error getting batch state by name:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/batch-state
 * Save batch state for a performer
 */
router.post('/batch-state', (req, res) => {
  try {
    const { performerId, performerName, batchState, settings } = req.body;
    
    if (!performerName && !performerId) {
      return res.status(400).send({ error: 'performerId or performerName is required' });
    }
    
    const batchStateJson = JSON.stringify(batchState);
    const settingsJson = JSON.stringify(settings || {});
    
    if (performerId) {
      db.prepare(`
        INSERT INTO ml_batch_state (performer_id, performer_name, batch_state, settings, updated_at, status)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'in_progress')
        ON CONFLICT(performer_id) DO UPDATE SET
          batch_state = excluded.batch_state,
          settings = excluded.settings,
          updated_at = CURRENT_TIMESTAMP,
          status = 'in_progress'
      `).run(performerId, performerName || null, batchStateJson, settingsJson);
    } else {
      // For temp performers without ID, use name-based upsert
      const existing = db.prepare(`
        SELECT id FROM ml_batch_state WHERE performer_name = ?
      `).get(performerName);
      
      if (existing) {
        db.prepare(`
          UPDATE ml_batch_state 
          SET batch_state = ?, settings = ?, updated_at = CURRENT_TIMESTAMP, status = 'in_progress'
          WHERE performer_name = ?
        `).run(batchStateJson, settingsJson, performerName);
      } else {
        db.prepare(`
          INSERT INTO ml_batch_state (performer_name, batch_state, settings, status)
          VALUES (?, ?, ?, 'in_progress')
        `).run(performerName, batchStateJson, settingsJson);
      }
    }
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error saving batch state:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/ml/batch-state/:performerId
 * Clear batch state for a performer (called after Apply)
 */
router.delete('/batch-state/:performerId', (req, res) => {
  try {
    const { performerId } = req.params;
    
    db.prepare(`
      UPDATE ml_batch_state 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE performer_id = ?
    `).run(parseInt(performerId));
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error clearing batch state:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/ml/batch-state-by-name/:performerName
 * Clear batch state for a temp performer by name
 */
router.delete('/batch-state-by-name/:performerName', (req, res) => {
  try {
    const { performerName } = req.params;
    
    db.prepare(`
      UPDATE ml_batch_state 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE performer_name = ?
    `).run(performerName);
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error clearing batch state by name:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/all-batch-states
 * Get all in-progress batch states (for recovery UI)
 */
router.get('/all-batch-states', (req, res) => {
  try {
    const states = db.prepare(`
      SELECT 
        bs.*,
        p.name as db_performer_name,
        p.thumbnail
      FROM ml_batch_state bs
      LEFT JOIN performers p ON bs.performer_id = p.id
      WHERE bs.status = 'in_progress'
      ORDER BY bs.updated_at DESC
    `).all();
    
    const parsed = states.map(s => ({
      ...s,
      batch_state: s.batch_state ? JSON.parse(s.batch_state) : null,
      settings: s.settings ? JSON.parse(s.settings) : null,
      name: s.db_performer_name || s.performer_name
    }));
    
    res.send({ success: true, states: parsed });
  } catch (err) {
    console.error('Error getting all batch states:', err);
    res.status(500).send({ error: err.message });
  }
});

// ============================================
// ML Batch Settings Endpoints
// ============================================

/**
 * GET /api/ml/batch-settings
 * Get all batch settings
 */
router.get('/batch-settings', (req, res) => {
  try {
    const settings = db.prepare(`SELECT key, value FROM ml_batch_settings`).all();
    const result = {};
    settings.forEach(s => {
      try {
        result[s.key] = JSON.parse(s.value);
      } catch {
        result[s.key] = s.value;
      }
    });
    
    // Set defaults if not present
    if (result.batchSize === undefined) result.batchSize = 4;
    if (result.concurrency === undefined) result.concurrency = 1;
    if (result.secureMode === undefined) result.secureMode = false;
    
    res.send({ success: true, settings: result });
  } catch (err) {
    console.error('Error getting batch settings:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/batch-settings
 * Save batch settings
 */
router.post('/batch-settings', (req, res) => {
  try {
    const { batchSize, concurrency, secureMode } = req.body;
    
    const upsert = db.prepare(`
      INSERT INTO ml_batch_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    
    if (batchSize !== undefined) {
      upsert.run('batchSize', JSON.stringify(batchSize));
    }
    if (concurrency !== undefined) {
      upsert.run('concurrency', JSON.stringify(concurrency));
    }
    if (secureMode !== undefined) {
      upsert.run('secureMode', JSON.stringify(secureMode));
    }
    
    res.send({ success: true });
  } catch (err) {
    console.error('Error saving batch settings:', err);
    res.status(500).send({ error: err.message });
  }
});

// ============================================
// Model Selection Endpoints
// ============================================

/**
 * GET /api/ml/available-models
 * Get list of available ML models (standard and ELO)
 */
router.get('/available-models', async (req, res) => {
  try {
    const models = [
      {
        id: 'standard',
        name: 'Standard Model',
        description: 'Base vision model for keep/delete decisions',
        endpoint: process.env.VISION_SERVICE_URL || 'http://localhost:8000',
        status: 'unknown'
      },
      {
        id: 'elo',
        name: 'ELO Preference Model',
        description: 'Unified model trained with ELO rankings (0-100 score)',
        endpoint: process.env.ELO_SERVICE_URL || 'http://localhost:8001',
        status: 'unknown'
      }
    ];
    
    // Check health of each model
    const axios = require('axios');
    for (const model of models) {
      try {
        const response = await axios.get(`${model.endpoint}/health`, { timeout: 2000 });
        model.status = response.data.status || 'healthy';
        model.details = response.data;
      } catch (err) {
        model.status = 'offline';
      }
    }
    
    res.send({ success: true, models });
  } catch (err) {
    console.error('Error getting available models:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/analyze
 * Analyze image(s) with selected model
 */
router.post('/analyze', async (req, res) => {
  try {
    const { imagePath, imagePaths, modelType = 'standard', threshold } = req.body;
    
    const axios = require('axios');
    const paths = imagePaths || [imagePath];
    
    // Select endpoint based on model type
    let endpoint;
    if (modelType === 'elo') {
      endpoint = process.env.ELO_SERVICE_URL || 'http://localhost:8001';
    } else {
      endpoint = process.env.VISION_SERVICE_URL || 'http://localhost:8000';
    }
    
    // Call appropriate endpoint
    if (paths.length === 1) {
      const response = await axios.post(`${endpoint}/analyze`, {
        image_path: paths[0],
        threshold
      }, { timeout: 30000 });
      
      res.send({ success: true, result: response.data, modelType });
    } else {
      const response = await axios.post(`${endpoint}/analyze-batch`, {
        image_paths: paths,
        threshold
      }, { timeout: 60000 });
      
      res.send({ success: true, results: response.data.results, modelType });
    }
  } catch (err) {
    console.error('Error analyzing with model:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/ml/elo-config
 * Get ELO model configuration (threshold, tiers)
 */
router.get('/elo-config', async (req, res) => {
  try {
    const axios = require('axios');
    const endpoint = process.env.ELO_SERVICE_URL || 'http://localhost:8001';
    
    const response = await axios.get(`${endpoint}/config`, { timeout: 5000 });
    res.send({ success: true, config: response.data });
  } catch (err) {
    console.error('Error getting ELO config:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/ml/elo-config/threshold
 * Update ELO model threshold
 */
router.post('/elo-config/threshold', async (req, res) => {
  try {
    const { threshold } = req.body;
    
    const axios = require('axios');
    const endpoint = process.env.ELO_SERVICE_URL || 'http://localhost:8001';
    
    const response = await axios.post(`${endpoint}/config/threshold`, { threshold }, { timeout: 5000 });
    res.send({ success: true, ...response.data });
  } catch (err) {
    console.error('Error updating ELO threshold:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
