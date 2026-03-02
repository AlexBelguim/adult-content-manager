/**
 * Video Analysis Routes
 * Integrates with vision-llm-video service for action timeline detection
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../db');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Video analysis service URL
const VISION_VIDEO_URL = process.env.VISION_VIDEO_URL || 'http://localhost:5003';

// Track the service process
let serviceProcess = null;
let serviceLogs = [];
const MAX_LOGS = 2000;

// Log file path
const servicePath = path.join(__dirname, '..', '..', 'vision-llm-video');
const logFile = path.join(servicePath, 'service.log');

function addLog(data, type = 'info') {
  const lines = data.toString().split('\n');
  lines.forEach(line => {
    // Clean up ANSI codes if present (basic regex)
    let cleanLine = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    // Remove carriage return but keep leading whitespace
    cleanLine = cleanLine.replace(/\r$/, '');
    
    if (cleanLine.trim()) { // Only add if it has content
      serviceLogs.push({
        timestamp: new Date(),
        type,
        message: cleanLine
      });
    }
  });
  if (serviceLogs.length > MAX_LOGS) {
    serviceLogs = serviceLogs.slice(-MAX_LOGS);
  }
}

/**
 * Get saved analysis settings for a video
 */
router.get('/settings', (req, res) => {
  const { videoPath } = req.query;
  if (!videoPath) {
    return res.status(400).send({ error: 'videoPath is required' });
  }
  
  try {
    const row = db.prepare('SELECT * FROM video_analysis_settings WHERE video_path = ?').get(videoPath);
    
    const settings = row ? {
      allowedActions: row.allowed_actions || '',
      windowSize: row.window_size || '',
      preserveExisting: row.preserve_existing === 1
    } : {
      allowedActions: '',
      windowSize: '',
      preserveExisting: true
    };
    
    res.send({ success: true, settings });
  } catch (err) {
    console.error('[Video Analysis] Error loading settings:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * Save analysis settings for a video
 */
router.post('/settings', (req, res) => {
  const { videoPath, allowedActions, windowSize, preserveExisting } = req.body;
  if (!videoPath) {
    return res.status(400).send({ error: 'videoPath is required' });
  }
  
  try {
    const stmt = db.prepare(`
      INSERT INTO video_analysis_settings (video_path, allowed_actions, window_size, preserve_existing, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(video_path) DO UPDATE SET
        allowed_actions = excluded.allowed_actions,
        window_size = excluded.window_size,
        preserve_existing = excluded.preserve_existing,
        updated_at = datetime('now')
    `);
    
    stmt.run(
      videoPath,
      allowedActions || '',
      windowSize || '',
      preserveExisting ? 1 : 0
    );
    
    const settings = {
      allowedActions: allowedActions || '',
      windowSize: windowSize || '',
      preserveExisting: preserveExisting || false
    };
    
    console.log(`[Video Analysis] Saved settings for ${videoPath}:`, settings);
    
    res.send({ success: true, settings });
  } catch (err) {
    console.error('[Video Analysis] Error saving settings:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * Batch check which videos have saved settings
 * Returns a map of videoPath -> hasSettings
 */
router.post('/settings/batch-check', (req, res) => {
  const { videoPaths } = req.body;
  
  if (!videoPaths || !Array.isArray(videoPaths)) {
    return res.status(400).send({ error: 'videoPaths array is required' });
  }
  
  try {
    const results = {};
    
    // Build a single query with placeholders
    if (videoPaths.length > 0) {
      const placeholders = videoPaths.map(() => '?').join(',');
      const rows = db.prepare(`SELECT video_path FROM video_analysis_settings WHERE video_path IN (${placeholders})`).all(...videoPaths);
      
      // Initialize all as false
      videoPaths.forEach(path => {
        results[path] = false;
      });
      
      // Mark those that exist as true
      rows.forEach(row => {
        results[row.video_path] = true;
      });
    }
    
    res.send({ success: true, results });
  } catch (err) {
    console.error('[Video Analysis] Error batch checking settings:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * Get service logs
 */
router.get('/logs', (req, res) => {
  // Prefer reading from log file if it exists (handles manual starts)
  if (fs.existsSync(logFile)) {
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n');
      const logs = lines.map(line => ({
        timestamp: new Date(), // Timestamp not in file, but needed for UI key
        type: 'stdout',
        message: line.replace(/\r$/, '')
      })).filter(l => l.message.trim());
      
      // Return last 2000 lines
      res.send(logs.slice(-2000));
      return;
    } catch (e) {
      console.error('Error reading log file:', e);
    }
  }
  
  // Fallback to memory logs
  res.send(serviceLogs);
});

/**
 * Check if video analysis service is running
 */
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${VISION_VIDEO_URL}/health`, { timeout: 5000 });
    res.send({
      success: true,
      running: true,
      service: response.data,
      url: VISION_VIDEO_URL
    });
  } catch (err) {
    res.send({
      success: true,
      running: false,
      error: 'Video analysis service not running',
      hint: 'Click "Start Service" to launch it',
      url: VISION_VIDEO_URL
    });
  }
});

/**
 * Start the video analysis service
 */
router.post('/start-service', async (req, res) => {
  try {
    // Check if already running
    try {
      await axios.get(`${VISION_VIDEO_URL}/health`, { timeout: 2000 });
      return res.send({ success: true, message: 'Service already running' });
    } catch (e) {
      // Not running, continue to start
    }

    // Path to the vision-llm-video directory
    const servicePath = path.join(__dirname, '..', '..', 'vision-llm-video');
    const batFile = path.join(servicePath, 'start-video-service.bat');
    
    console.log(`[Video Analysis] Starting service from: ${servicePath}`);
    
    if (process.platform === 'win32') {
      // Windows: Start in a new visible terminal window
      // This matches user expectation of "running the bat file"
      // Logs are captured via service.log file which the python script writes to
      const cmd = `start "VisionLLM Service" /D "${servicePath}" "${batFile}"`;
      console.log(`[Video Analysis] Executing: ${cmd}`);
      
      exec(cmd, (error) => {
        if (error) {
          console.error('[Video Analysis] Failed to start service:', error);
          addLog(`Failed to start service: ${error.message}`, 'stderr');
          return res.status(500).send({ error: 'Failed to start service' });
        }
        addLog('Service started in new window', 'info');
        res.send({ success: true, message: 'Service started in new window' });
      });
    } else {
      // Linux/Mac: Spawn as child process (keep existing behavior)
      serviceProcess = spawn(batFile, [], {
        cwd: servicePath,
        shell: true
      });
      
      serviceProcess.stdout.on('data', (data) => addLog(data, 'stdout'));
      serviceProcess.stderr.on('data', (data) => addLog(data, 'stderr'));
      
      serviceProcess.on('close', (code) => {
        addLog(`Service process exited with code ${code}`, 'info');
        serviceProcess = null;
      });
      
      res.send({ success: true, message: 'Service starting...' });
    }
    
  } catch (err) {
    console.error('[Video Analysis] Failed to start service:', err);
    res.status(500).send({ 
      success: false, 
      error: err.message,
      hint: 'Try running start-video-service.bat manually'
    });
  }
});

/**
 * Get supported actions with their detection cues
 * Returns structured list of actions the AI can detect
 */
router.get('/supported-actions', async (req, res) => {
  try {
    const response = await axios.get(`${VISION_VIDEO_URL}/supported-actions`, { timeout: 5000 });
    res.send(response.data);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).send({
        error: 'Video analysis service not running',
        hint: 'Run: cd vision-llm-video && python app.py'
      });
    }
    res.status(500).send({ error: err.message });
  }
});

/**
 * Get available action categories (legacy)
 */
router.get('/categories', async (req, res) => {
  try {
    const response = await axios.get(`${VISION_VIDEO_URL}/categories`, { timeout: 5000 });
    res.send(response.data);
  } catch (err) {
    res.status(503).send({
      error: 'Video analysis service not running',
      hint: 'Run: cd vision-llm-video && python app.py'
    });
  }
});

/**
 * Analyze a video to detect action timeline
 * POST body: { videoPath, sampleInterval?, minSegment? }
 */
router.post('/analyze', async (req, res) => {
  const { videoPath, sampleInterval = 30, minSegment = 10 } = req.body;
  
  if (!videoPath) {
    return res.status(400).send({ error: 'videoPath is required' });
  }

  try {
    console.log(`[Video Analysis] Starting analysis for: ${videoPath}`);
    console.log(`[Video Analysis] Sample interval: ${sampleInterval}s, Min segment: ${minSegment}s`);

    const response = await axios.post(
      `${VISION_VIDEO_URL}/analyze`,
      {
        video_path: videoPath,
        sample_interval: sampleInterval,
        min_segment: minSegment
      },
      { timeout: 1800000 } // 30 minute timeout for long videos
    );

    const result = response.data;
    
    if (result.success) {
      console.log(`[Video Analysis] Completed! Found ${result.segment_count} segments`);
    }

    res.send(result);
  } catch (err) {
    console.error('[Video Analysis] Error:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).send({
        error: 'Video analysis service not running',
        hint: 'Run: cd vision-llm-video && python app.py'
      });
    }
    
    res.status(500).send({
      error: err.response?.data?.error || err.message
    });
  }
});

/**
 * Analyze a single frame from a video
 * POST body: { videoPath, time }
 */
router.post('/analyze-frame', async (req, res) => {
  const { videoPath, time } = req.body;
  
  if (!videoPath || time == null) {
    return res.status(400).send({ error: 'videoPath and time are required' });
  }

  try {
    const response = await axios.post(
      `${VISION_VIDEO_URL}/analyze-frame`,
      {
        video_path: videoPath,
        time: time
      },
      { timeout: 30000 }
    );

    res.send(response.data);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).send({
        error: 'Video analysis service not running',
        hint: 'Run: cd vision-llm-video && python app.py'
      });
    }
    
    res.status(500).send({
      error: err.response?.data?.error || err.message
    });
  }
});

/**
 * Find specific action segments in a video
 * Uses action-specific prompts for better accuracy
 * POST body: { videoPath, action, existingSegments?, minDuration? }
 */
router.post('/find-action', async (req, res) => {
  const { videoPath, action, existingSegments = [], minDuration = 5 } = req.body;
  
  if (!videoPath) {
    return res.status(400).send({ error: 'videoPath is required' });
  }
  if (!action) {
    return res.status(400).send({ error: 'action is required' });
  }

  try {
    console.log(`[Video Analysis] Finding "${action}" segments in: ${videoPath}`);
    
    // Get existing scenes from database to skip those areas
    const existingScenes = db.prepare(`
      SELECT start_time as start, end_time as end, name as action 
      FROM video_scenes 
      WHERE video_path = ?
    `).all(videoPath);

    // Merge with any passed-in segments
    const allExistingSegments = [
      ...existingScenes,
      ...existingSegments
    ];

    console.log(`[Video Analysis] Skipping ${allExistingSegments.length} existing segments`);

    const response = await axios.post(
      `${VISION_VIDEO_URL}/find-action`,
      {
        video_path: videoPath,
        action: action,
        existing_segments: allExistingSegments,
        min_duration: minDuration
      },
      { timeout: 1800000 } // 30 minute timeout for long videos
    );

    const result = response.data;
    
    if (result.success) {
      console.log(`[Video Analysis] Found ${result.segment_count} "${action}" segments`);
    }

    res.send(result);
  } catch (err) {
    console.error('[Video Analysis] Find action error:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).send({
        error: 'Video analysis service not running',
        hint: 'Run: cd vision-llm-video && python app.py'
      });
    }
    
    res.status(500).send({
      error: err.response?.data?.error || err.message
    });
  }
});

/**
 * Find specific action and auto-create scenes from results
 * POST body: { videoPath, action, minDuration?, saveScenes? }
 */
router.post('/find-action-and-create-scenes', async (req, res) => {
  const { videoPath, action, minDuration = 5, saveScenes = true } = req.body;
  
  if (!videoPath || !action) {
    return res.status(400).send({ error: 'videoPath and action are required' });
  }

  try {
    console.log(`[Video Analysis] Finding & creating scenes for "${action}" in: ${videoPath}`);
    
    // Get existing scenes to skip
    const existingScenes = db.prepare(`
      SELECT start_time as start, end_time as end, name as action 
      FROM video_scenes 
      WHERE video_path = ?
    `).all(videoPath);

    const response = await axios.post(
      `${VISION_VIDEO_URL}/find-action`,
      {
        video_path: videoPath,
        action: action,
        existing_segments: existingScenes,
        min_duration: minDuration
      },
      { timeout: 1800000 } // 30 minute timeout for long videos
    );

    const result = response.data;
    
    if (!result.success) {
      return res.status(500).send({ error: result.error || 'Find action failed' });
    }

    const createdScenes = [];

    if (saveScenes && result.segments && result.segments.length > 0) {
      console.log(`[Video Analysis] Creating ${result.segments.length} scenes for "${action}"...`);

      for (const segment of result.segments) {
        const sceneName = segment.action_name || result.action_name || action;
        
        const insertResult = db.prepare(`
          INSERT INTO video_scenes (video_path, name, start_time, end_time, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(videoPath, sceneName, segment.start, segment.end);

        createdScenes.push({
          id: insertResult.lastInsertRowid,
          name: sceneName,
          startTime: segment.start,
          endTime: segment.end,
          duration: segment.duration
        });
      }

      console.log(`[Video Analysis] Created ${createdScenes.length} scenes`);
    }

    res.send({
      success: true,
      action: action,
      actionName: result.action_name,
      segments: result.segments,
      segmentCount: result.segment_count,
      scenesCreated: createdScenes.length,
      scenes: createdScenes
    });

  } catch (err) {
    console.error('[Video Analysis] Error:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).send({
        error: 'Video analysis service not running',
        hint: 'Run: cd vision-llm-video && python app.py'
      });
    }
    
    res.status(500).send({
      error: err.response?.data?.error || err.message
    });
  }
});

/**
 * Analyze video and auto-create scenes from the timeline
 * POST body: { videoPath, sampleInterval?, minSegment?, saveScenes?, preserveExisting? }
 */
router.post('/analyze-and-create-scenes', async (req, res) => {
  const { videoPath, sampleInterval = 30, minSegment = 10, saveScenes = true, allowedActions = [], startTime, endTime, windowSize, preserveExisting = false } = req.body;
  
  if (!videoPath) {
    return res.status(400).send({ error: 'videoPath is required' });
  }

  try {
    console.log(`[Video Analysis] Analyzing video for scene creation: ${videoPath}`);
    if (allowedActions.length > 0) {
      console.log(`[Video Analysis] Restricted to actions: ${allowedActions.join(', ')}`);
    }
    if (startTime !== undefined && endTime !== undefined) {
      console.log(`[Video Analysis] Range: ${startTime}s - ${endTime}s`);
    }
    if (windowSize) {
      console.log(`[Video Analysis] Window Size: ${windowSize}s`);
    }
    if (preserveExisting) {
      console.log(`[Video Analysis] Preserve existing scenes: enabled`);
    }

    // Call the video analysis service
    const response = await axios.post(
      `${VISION_VIDEO_URL}/analyze`,
      {
        video_path: videoPath,
        segment_duration: sampleInterval,
        min_segment: minSegment,
        allowed_actions: allowedActions,
        start_time: startTime,
        end_time: endTime,
        window_size: windowSize
      },
      { timeout: 1800000 } // 30 minute timeout for long videos
    );

    const result = response.data;
    
    // Handle cancellation
    if (result.cancelled) {
      return res.send({
        success: false,
        cancelled: true,
        message: 'Analysis cancelled by user',
        scenesCreated: 0,
        scenes: []
      });
    }
    
    if (!result.success) {
      return res.status(500).send({ error: result.error || 'Analysis failed' });
    }

    const createdScenes = [];

    if (saveScenes && result.segments) {
      console.log(`[Video Analysis] Creating ${result.segments.length} scenes...`);

      // Only delete existing scenes if preserveExisting is false
      if (!preserveExisting) {
        if (startTime === undefined && endTime === undefined) {
          // Full video analysis: Clear all existing auto-generated scenes
          db.prepare(`
            DELETE FROM video_scenes 
            WHERE video_path = ? AND name LIKE '[Auto] %'
          `).run(videoPath);
        } else {
          // Partial analysis: Clear overlapping auto-generated scenes
          // This prevents duplicates when re-analyzing a specific segment
          db.prepare(`
            DELETE FROM video_scenes 
            WHERE video_path = ? 
            AND name LIKE '[Auto] %' 
            AND start_time >= ? 
            AND end_time <= ?
          `).run(videoPath, startTime, endTime);
        }
      }

      // Create a scene for each segment
      for (const segment of result.segments) {
        // Skip "other" segments - only create scenes for detected actions
        if (segment.action === 'other') continue;

        // Get nice action name from ACTIONS dict on Python side
        const actionName = segment.action.charAt(0).toUpperCase() + segment.action.slice(1);
        const sceneName = `[Auto] ${actionName}`;
        
        const insertResult = db.prepare(`
          INSERT INTO video_scenes (video_path, name, start_time, end_time, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(videoPath, sceneName, segment.start, segment.end);

        createdScenes.push({
          id: insertResult.lastInsertRowid,
          name: sceneName,
          startTime: segment.start,
          endTime: segment.end,
          action: segment.action,
          duration: segment.duration
        });
      }

      console.log(`[Video Analysis] Created ${createdScenes.length} scenes`);
    }

    res.send({
      success: true,
      analysis: result,
      scenesCreated: createdScenes.length,
      scenes: createdScenes
    });

  } catch (err) {
    console.error('[Video Analysis] Error:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).send({
        error: 'Video analysis service not running',
        hint: 'Run: cd vision-llm-video && python app.py'
      });
    }
    
    res.status(500).send({
      error: err.response?.data?.error || err.message
    });
  }
});

/**
 * Get cached analysis for a video (if we decide to store results)
 */
router.get('/cached/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  try {
    // Check if we have cached analysis results
    // For now, just return auto-generated scenes as a proxy for analysis
    const scenes = db.prepare(`
      SELECT * FROM video_scenes 
      WHERE video_path LIKE ? AND name LIKE '[Auto] %'
      ORDER BY start_time ASC
    `).all(`%${videoId}%`);

    if (scenes.length === 0) {
      return res.status(404).send({ 
        cached: false, 
        message: 'No cached analysis found' 
      });
    }

    // Convert to timeline format
    const segments = scenes.map(scene => ({
      start: formatTime(scene.start_time),
      end: formatTime(scene.end_time),
      start_sec: scene.start_time,
      end_sec: scene.end_time,
      duration_sec: scene.end_time - scene.start_time,
      action: scene.name.replace('[Auto] ', '')
    }));

    res.send({
      cached: true,
      segments,
      segment_count: segments.length
    });

  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Cancel current analysis
 */
router.post('/cancel-analysis', async (req, res) => {
  try {
    await axios.post(`${VISION_VIDEO_URL}/cancel`);
    res.send({ success: true, message: 'Cancellation requested' });
  } catch (err) {
    console.error('Error cancelling analysis:', err.message);
    res.status(500).send({ error: 'Failed to cancel analysis' });
  }
});

/**
 * Stop the video analysis service
 */
router.post('/stop-service', async (req, res) => {
  let stopped = false;
  
  // 1. Try to kill the process spawned by this backend
  if (serviceProcess) {
    try {
      serviceProcess.kill();
      serviceProcess = null;
      stopped = true;
      addLog('Service stopped by user (spawned process)', 'info');
    } catch (e) {
      console.error('Error killing spawned process:', e);
    }
  }
  
  // 2. Try to kill any process on port 5003 (handles manual starts)
  try {
    const killedPort = await killProcessOnPort(5003);
    if (killedPort) {
      stopped = true;
      addLog('Service stopped by user (port 5003)', 'info');
    }
  } catch (e) {
    console.error('Error killing process on port 5003:', e);
  }
  
  if (stopped) {
    res.send({ success: true, message: 'Service stopped' });
  } else {
    res.send({ success: false, message: 'Service was not running or could not be stopped' });
  }
});

function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' 
      ? `netstat -ano | findstr :${port}` 
      : `lsof -i :${port} -t`;
      
    exec(command, (err, stdout) => {
      if (err || !stdout) {
        resolve(false);
        return;
      }
      
      const lines = stdout.trim().split('\n');
      if (lines.length === 0) {
        resolve(false);
        return;
      }
      
      // Parse PID
      let pid;
      if (process.platform === 'win32') {
        // TCP    0.0.0.0:5003           0.0.0.0:0              LISTENING       12345
        const parts = lines[0].trim().split(/\s+/);
        pid = parts[parts.length - 1];
      } else {
        pid = lines[0].trim();
      }
      
      if (pid && /^\d+$/.test(pid)) {
        const killCmd = process.platform === 'win32' 
          ? `taskkill /PID ${pid} /F` 
          : `kill -9 ${pid}`;
          
        exec(killCmd, (kErr) => {
          resolve(!kErr);
        });
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * Find exact transition point between two actions using binary search
 * POST body: { videoPath, startTime, endTime, label1, label2, originalWindowSize }
 */
router.post('/find-transition-point', async (req, res) => {
  const { videoPath, startTime, endTime, label1, label2, originalWindowSize } = req.body;
  
  if (!videoPath || startTime === undefined || endTime === undefined || !label1 || !label2) {
    return res.status(400).send({ error: 'Missing required parameters' });
  }

  try {
    console.log(`[Video Analysis] Finding transition: ${label1} -> ${label2} (${startTime}s - ${endTime}s)${originalWindowSize ? ` [window: ${originalWindowSize}s]` : ''}`);

    const response = await axios.post(
      `${VISION_VIDEO_URL}/find-transition-point`,
      {
        video_path: videoPath,
        start_time: startTime,
        end_time: endTime,
        label_1: label1,
        label_2: label2,
        original_window_size: originalWindowSize || 0
      },
      { timeout: 60000 } // 1 minute timeout
    );

    res.send(response.data);

  } catch (err) {
    console.error('[Video Analysis] Find transition error:', err.message);
    
    if (err.code === 'ECONNREFUSED') {
      return res.status(503).send({
        error: 'Video analysis service not running',
        hint: 'Run: cd vision-llm-video && python app.py'
      });
    }
    
    res.status(500).send({
      error: err.response?.data?.error || err.message
    });
  }
});

module.exports = router;
