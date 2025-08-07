const express = require('express');
const router = express.Router();
const filterService = require('../services/filterService');

// Get filterable files for a performer
router.get('/files/:performerId', async (req, res) => {
  const { performerId } = req.params;
  const { type, sortBy, sortOrder, hideKept } = req.query;
  
  try {
    const files = await filterService.getFilterableFiles(
      performerId, 
      type || 'all', 
      sortBy || 'name', 
      sortOrder || 'asc',
      hideKept === 'true'
    );
    res.send(files);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Perform filter action (keep, delete, move_to_funscript)
router.post('/action', async (req, res) => {
  const { performerId, filePath, action, options } = req.body;
  
  try {
    const result = await filterService.performFilterAction(performerId, filePath, action, options);
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

module.exports = router;