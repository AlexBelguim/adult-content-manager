const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');

/**
 * Get video duration in seconds using ffprobe
 * @param {string} videoPath - Path to the video file
 * @returns {Promise<number>} Duration in seconds
 */
async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    try {
      const ffprobePath = require('ffprobe-static').path;
      const ffprobe = spawn(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath
      ]);
      
      let output = '';
      let errorOutput = '';
      
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      ffprobe.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          if (!isNaN(duration) && duration > 0) {
            resolve(duration);
          } else {
            reject(new Error('Could not parse duration'));
          }
        } else {
          reject(new Error(`ffprobe exited with code ${code}: ${errorOutput}`));
        }
      });
      
      ffprobe.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      // Fallback to ffmpeg if ffprobe-static not available
      const ffmpeg = spawn(ffmpegPath, [
        '-i', videoPath,
        '-f', 'null',
        '-'
      ]);
      
      let duration = 0;
      
      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (match) {
          duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
        }
      });
      
      ffmpeg.on('close', (code) => {
        if (duration > 0) {
          resolve(duration);
        } else {
          reject(new Error('Could not determine video duration'));
        }
      });
      
      ffmpeg.on('error', (err) => {
        reject(err);
      });
    }
  });
}

/**
 * Format duration in seconds to human readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "2:34" or "1:02:45")
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get durations for multiple videos (with caching potential)
 * @param {string[]} videoPaths - Array of video file paths
 * @returns {Promise<Object>} Map of path -> duration
 */
async function getVideoDurations(videoPaths) {
  const results = {};
  
  // Process in parallel with limit
  const BATCH_SIZE = 5;
  for (let i = 0; i < videoPaths.length; i += BATCH_SIZE) {
    const batch = videoPaths.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (videoPath) => {
        try {
          const duration = await getVideoDuration(videoPath);
          return { path: videoPath, duration };
        } catch (err) {
          return { path: videoPath, duration: null, error: err.message };
        }
      })
    );
    
    batchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        results[result.value.path] = result.value.duration;
      }
    });
  }
  
  return results;
}

module.exports = {
  getVideoDuration,
  getVideoDurations,
  formatDuration
};
