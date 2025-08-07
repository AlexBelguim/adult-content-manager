const express = require('express');
const router = express.Router();
const handyService = require('../services/handy');

// Connect to Handy
router.post('/connect', async (req, res) => {
  const { connectionKey } = req.body;
  
  try {
    const result = await handyService.connect(connectionKey);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Disconnect from Handy
router.post('/disconnect', (req, res) => {
  try {
    const result = handyService.disconnect();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Load a funscript
router.post('/load-script', async (req, res) => {
  const { funscriptPath } = req.body;
  
  try {
    const result = await handyService.loadFunscript(funscriptPath);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Sync to position
router.post('/sync', async (req, res) => {
  const { positionMs } = req.body;
  
  try {
    const result = await handyService.syncToPosition(positionMs);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Play
router.post('/play', async (req, res) => {
  try {
    const result = await handyService.play();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Pause
router.post('/pause', async (req, res) => {
  try {
    const result = await handyService.pause();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Stop
router.post('/stop', async (req, res) => {
  try {
    const result = await handyService.stop();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get status
router.get('/status', (req, res) => {
  try {
    const status = handyService.getStatus();
    res.send(status);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get available funscripts for a performer
router.get('/scripts/:performerId', async (req, res) => {
  const { performerId } = req.params;
  
  try {
    const scripts = await handyService.getAvailableFunscripts(performerId);
    res.send(scripts);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;