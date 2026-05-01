const express = require('express');
const router = express.Router();
const filterService = require('../services/filterService');

// Get filterable files for a performer
router.get('/files/:performerId', async (req, res) => {
  const { performerId } = req.params;
  const { type, sortBy, sortOrder, hideKept, limit, offset } = req.query;

  try {
    const result = await filterService.getFilterableFiles(
      performerId,
      type || 'all',
      sortBy || 'name',
      sortOrder || 'asc',
      hideKept === 'true',
      limit ? parseInt(limit) : undefined,
      offset ? parseInt(offset) : undefined
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Perform filter action (keep, delete, move_to_funscript)
router.post('/action', async (req, res) => {
  const { performerId, performerName, basePath, filePath, action, options } = req.body;

  try {
    const result = await filterService.performFilterAction(performerId, filePath, action, { ...options, performerName, basePath });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Undo last filter action
router.post('/undo', async (req, res) => {
  try {
    const result = await filterService.undoLastAction();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Manage funscript files
router.post('/funscript', async (req, res) => {
  const { performerId, videoFolder, action, funscriptFile, options } = req.body;

  try {
    const result = await filterService.manageFunscriptFiles(
      performerId,
      videoFolder,
      action,
      funscriptFile,
      options
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Handle video after last funscript deletion
router.post('/video-after-funscript', async (req, res) => {
  const { performerId, videoFolder, keepVideo } = req.body;

  try {
    const result = await filterService.handleVideoAfterLastFunscriptDelete(
      performerId,
      videoFolder,
      keepVideo
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get batch unfiltered counts for all "before" folder performers (fast - database only)
router.get('/stats-batch', (req, res) => {
  try {
    const db = require('../db');

    // Get all "before" folder performers with their counts
    const performers = db.prepare(`
      SELECT 
        id,
        name,
        pics_count,
        vids_count,
        pics_filtered,
        vids_filtered,
        thumbnail
      FROM performers 
      WHERE moved_to_after = 0
    `).all();

    // Calculate unfiltered counts
    const result = performers.map(p => ({
      id: p.id,
      name: p.name,
      thumbnail: p.thumbnail,
      unfiltered_pics: Math.max(0, (p.pics_count || 0) - (p.pics_filtered || 0)),
      unfiltered_vids: Math.max(0, (p.vids_count || 0) - (p.vids_filtered || 0))
    })).filter(p => p.unfiltered_pics > 0 || p.unfiltered_vids > 0);

    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get filter statistics for a performer
router.get('/stats/:performerId', (req, res) => {
  const { performerId } = req.params;

  try {
    const stats = filterService.getFilterStats(performerId);
    res.send(stats);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Phone-specific endpoints
// Keep action for phone interface
router.post('/keep', async (req, res) => {
  const { performerId, itemId, itemType } = req.body;

  try {
    const result = await filterService.performFilterAction(performerId, itemId, 'keep', { itemType });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Delete action for phone interface
router.post('/delete', async (req, res) => {
  const { performerId, itemId, itemType } = req.body;

  try {
    const result = await filterService.performFilterAction(performerId, itemId, 'delete', { itemType });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});


// GET /api/filter/smart-batch/:performerId
router.get('/smart-batch/:performerId', async (req, res) => {
  const { performerId } = req.params;
  const { threshold, modelId } = req.query;

  try {
    const result = await filterService.getSmartBatch(performerId, {
      threshold: threshold ? parseFloat(threshold) : 50.0,
      modelId
    });
    res.send(result);
  } catch (err) {
    console.error('Error in /smart-batch:', err);
    res.status(500).send({ error: err.message });
  }
});

// POST /api/filter/apply-smart-batch
router.post('/apply-smart-batch', async (req, res) => {
  const { performerId, results, performerName, basePath } = req.body;

  try {
    const result = await filterService.applySmartBatch(performerId, results, { performerName, basePath });
    res.send(result);
  } catch (err) {
    console.error('Error in /apply-smart-batch:', err);
    res.status(500).send({ error: err.message });
  }
});

// GET /api/filter/models - Proxy to AI server to list models
router.get('/models', async (req, res) => {
  const AI_URL = process.env.AI_SERVER_URL || 'http://localhost:3344';
  try {
    const axios = require('axios');
    const response = await axios.get(`${AI_URL}/list_models`);
    res.send(response.data);
  } catch (err) {
    res.status(500).send({ error: 'AI Server not reachable', message: err.message });
  }
});

// POST /api/filter/load-model - Proxy to AI server to load a specific model
router.post('/load-model', async (req, res) => {
  const { modelId, ai_server_url } = req.body;
  const AI_URL = ai_server_url || process.env.AI_SERVER_URL || 'http://localhost:3344';
  try {
    const axios = require('axios');
    const response = await axios.post(`${AI_URL}/load_model`, { model_id: modelId });
    res.send(response.data);
  } catch (err) {
    res.status(500).send({ error: 'AI Server not reachable', message: err.message });
  }
});

// POST /api/filter/unload-model - Proxy to AI server to unload current model
router.post('/unload-model', async (req, res) => {
  const { ai_server_url } = req.body;
  const AI_URL = ai_server_url || process.env.AI_SERVER_URL || 'http://localhost:3344';
  try {
    const axios = require('axios');
    const response = await axios.post(`${AI_URL}/unload_model`);
    res.send(response.data);
  } catch (err) {
    res.status(500).send({ error: 'AI Server not reachable', message: err.message });
  }
});

// POST /api/filter/predict-quality - Get quality prediction for a single image
router.post('/predict-quality', async (req, res) => {
  const { imagePath } = req.body;
  try {
    const result = await filterService.predictQuality(imagePath);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// POST /api/filter/proxy-score - Proxy image scoring to AI server
router.post('/proxy-score', async (req, res) => {
  const { images, ai_server_url, app_base_url } = req.body;
  const AI_URL = ai_server_url || process.env.AI_SERVER_URL || 'http://localhost:3344';
  
  // Use provided base URL or determine our own
  const myBaseUrl = app_base_url || `${req.protocol}://${req.headers.host}`;

  try {
    const axios = require('axios');
    const response = await axios.post(`${AI_URL}/score`, { 
      images,
      app_base_url: myBaseUrl
    });
    res.send(response.data);
  } catch (err) {
    res.status(500).send({ error: 'AI Server not reachable', message: err.message });
  }
});

// POST /api/filter/proxy-classify - Proxy image classification to AI server
router.post('/proxy-classify', async (req, res) => {
  const { images, ai_server_url, app_base_url } = req.body;
  const AI_URL = ai_server_url || process.env.AI_SERVER_URL || 'http://localhost:3344';
  
  const myBaseUrl = app_base_url || `${req.protocol}://${req.headers.host}`;

  try {
    const axios = require('axios');
    const response = await axios.post(`${AI_URL}/classify_batch`, { 
      images,
      app_base_url: myBaseUrl
    });
    res.send(response.data);
  } catch (err) {
    res.status(500).send({ error: 'AI Server not reachable', message: err.message });
  }
});

module.exports = router;
