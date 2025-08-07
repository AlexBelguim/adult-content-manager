const path = require('path');

module.exports = {
  // Use environment variable for database path, fallback to local
  dbPath: process.env.DB_PATH || path.join(__dirname, 'app.db'),
  port: process.env.PORT || 3000,
  // Container-friendly paths
  mediaBasePath: process.env.MEDIA_BASE_PATH || path.join(__dirname, '..', 'media'),
  contentBasePath: process.env.CONTENT_BASE_PATH || path.join(__dirname, '..', 'content'),
  dataPath: process.env.DATA_PATH || path.join(__dirname, 'data')
};