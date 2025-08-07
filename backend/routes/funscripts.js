const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Get available funscripts for a video file
router.get('/', (req, res) => {
  try {
    const { file } = req.query;
    if (!file) {
      return res.status(400).send({ error: 'File parameter required' });
    }

    const videoDir = path.dirname(file);
    const videoName = path.basename(file, path.extname(file));
    
    // Look for .funscript files with matching names
    const files = fs.readdirSync(videoDir);
    const funscripts = files
      .filter(f => f.endsWith('.funscript') && f.startsWith(videoName))
      .map(f => ({
        name: f,
        path: path.join(videoDir, f)
      }));

    res.send({ funscripts });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Upload funscript to Handy device
router.post('/upload', async (req, res) => {
  try {
    const { videoFile, funscriptFile, isHandyConnected } = req.body;
    
    // Check if frontend connection status is valid
    if (isHandyConnected === false) {
      return res.status(400).send({ error: 'Not connected to Handy device' });
    }
    
    // Validate that the files exist
    const fs = require('fs');
    if (!fs.existsSync(funscriptFile)) {
      return res.status(404).send({ error: 'Funscript file not found' });
    }
    
    // Return success - frontend will handle the actual Handy upload
    res.send({ 
      success: true, 
      message: 'Files validated, ready for Handy upload',
      funscriptFile: funscriptFile,
      videoFile: videoFile
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Keep funscript (move to approved location)
router.post('/keep', (req, res) => {
  try {
    const { scriptPath } = req.body;
    
    // Implementation depends on your folder structure
    // For now, just mark as successful
    console.log('Keeping funscript:', scriptPath);
    
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Delete funscript
router.delete('/delete', (req, res) => {
  try {
    const { scriptPath } = req.body;
    
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
      console.log('Deleted funscript:', scriptPath);
    }
    
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
