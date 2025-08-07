const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all settings
router.get('/', (req, res) => {
  try {
    const settings = db.prepare('SELECT key, value FROM app_settings').all();
    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = setting.value;
    });
    res.json(settingsObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific setting
router.get('/:key', (req, res) => {
  try {
    const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(req.params.key);
    if (!setting) {
      // Return null value instead of 404 for missing settings
      return res.json({ value: null });
    }
    res.json({ value: setting.value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update or create setting
router.post('/:key', (req, res) => {
  try {
    const { value } = req.body;
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(req.params.key, value);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete setting
router.delete('/:key', (req, res) => {
  try {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(req.params.key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
