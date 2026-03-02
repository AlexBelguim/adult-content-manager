const path = require('path');

module.exports = {
  // Use environment variable for database path, fallback to local
  dbPath: process.env.DB_PATH || path.join(__dirname, 'app.db'),
  port: process.env.PORT || 3000,
  // Container-friendly paths
  mediaBasePath: process.env.MEDIA_BASE_PATH || path.join(__dirname, '..', 'media'),
  contentBasePath: process.env.CONTENT_BASE_PATH || path.join(__dirname, '..', 'content'),
  dataPath: process.env.DATA_PATH || path.join(__dirname, 'data'),
  
  // Hash deduplication settings
  hashDeduplication: {
    algorithm: process.env.HASH_ALGORITHM || 'sha256', // sha256 or blake3
    perceptualHashSize: parseInt(process.env.PERCEPTUAL_HASH_SIZE) || 8, // 8x8 = 64 bits
    workerConcurrency: parseInt(process.env.HASH_WORKER_CONCURRENCY) || 4,
    videoFramePosition: parseFloat(process.env.VIDEO_FRAME_POSITION) || 0.5, // 0-1 (0.5 = middle)
    runTTLDays: parseInt(process.env.HASH_RUN_TTL_DAYS) || 7,
    quarantinePath: process.env.QUARANTINE_PATH || path.join(__dirname, 'quarantine'),
    quarantineRetentionDays: parseInt(process.env.QUARANTINE_RETENTION_DAYS) || 30,
    defaultHammingThreshold: parseInt(process.env.DEFAULT_HAMMING_THRESHOLD) || 10,
  }
};
