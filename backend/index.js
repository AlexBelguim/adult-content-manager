const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const cors = require('cors');

const app = express();
// Use PORT environment variable or default to 3000
const port = process.env.PORT || 4069;

// Debug request timing
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 500) {
      console.log(`[SLOW REQUEST] ${req.method} ${req.url} took ${duration}ms`);
    }
  });
  next();
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Increase timeout for large file uploads (30 minutes)
app.use((req, res, next) => {
  req.setTimeout(30 * 60 * 1000); // 30 minutes
  res.setTimeout(30 * 60 * 1000);
  next();
});

// Add global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

app.use(express.static(path.join(__dirname, '../frontend/build'))); // Serve React build

// Health check endpoint for container
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Optional auth middleware (enabled when APP_SECRET env var is set)
app.use(require('./middleware/auth'));

// Routes with error handling
app.use('/api/folders', require('./routes/folders'));
app.use('/api/performers', require('./routes/performers'));
app.use('/api/content', require('./routes/content'));
app.use('/api/filter', require('./routes/filter'));
app.use('/api/gallery', require('./routes/gallery'));
app.use('/api/handy', require('./routes/handy'));
app.use('/api/files', require('./routes/files'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/shortcuts', require('./routes/shortcuts'));
app.use('/api/license', require('./routes/license'));
app.use('/api/admin', require('./routes/admin'));

app.use('/api/tags', require('./routes/tags'));
app.use('/api/funscripts', require('./routes/funscripts'));
app.use('/api/scenes', require('./routes/scenes'));
app.use('/api/truenas', require('./routes/truenas'));
app.use('/api/mobile', require('./routes/mobile')); // Mobile app API
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/hashes', require('./routes/hashes')); // Hash deduplication
// app.use('/api/clip', require('./routes/clip')); // CLIP embeddings -- REMOVED
// app.use('/api/ml', require('./routes/ml')); // ML predictions -- REMOVED
// app.use('/api/ml-training', require('./routes/ml-training')); // ML training for vision models -- REMOVED
app.use('/api/performer-management', require('./routes/performer-management')); // Comprehensive performer management
app.use('/api/video-analysis', require('./routes/video-analysis')); // Video action timeline analysis
app.use('/api/ranking', require('./routes/ranking')); // ELO ranking for preference learning
app.use('/api/upload-queue', require('./routes/uploadQueue')); // Upload queue management
app.use('/api/encode', require('./routes/encode')); // Media optimization (H.265/WebP conversion)
app.use('/api/pairwise', require('./routes/pairwise')); // Pairwise image comparison & AI labeling
app.use('/api/health', require('./routes/health')); // System health & diagnostics
app.use('/api/training', require('./routes/training')); // AI training hub proxy

// Fallback to React
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

// Global error handler for multer and other errors
app.use((err, req, res, next) => {
  console.error('Express error handler caught:', err.message);
  console.error('Error stack:', err.stack);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: 'Too many files' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field' });
  }

  res.status(500).json({ error: err.message || 'Internal server error' });
});

const http = require('http');
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Adjust in production
    methods: ["GET", "POST"]
  }
});

// Pass io to routes if needed, or set up handlers here
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Example: Client requests sync
  socket.on('request_sync', async () => {
    // Trigger a sync calculation or send latest data
    // For now, just acknowledge
    socket.emit('sync_status', { status: 'ok', timestamp: Date.now() });
  });
});


server.listen(port, '0.0.0.0', async () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Cleanup: Remove any performers with names starting with '.' (like .cache, .thumbnails)
  try {
    const db = require('./db');
    const deleted = db.prepare("DELETE FROM performers WHERE name LIKE '.%'").run();
    if (deleted.changes > 0) {
      console.log(`Cleaned up ${deleted.changes} hidden folder entries from performers table`);
    }

    // Create .cache folders for all registered base paths
    const folders = db.prepare('SELECT path FROM folders').all();
    for (const folder of folders) {
      const beforeCachePath = path.join(folder.path, 'before filter performer', '.cache');
      const afterCachePath = path.join(folder.path, 'after filter performer', '.cache');

      await fs.ensureDir(beforeCachePath);
      await fs.ensureDir(afterCachePath);
    }
    if (folders.length > 0) {
      console.log(`Ensured .cache folders exist for ${folders.length} base path(s)`);
    }
  } catch (error) {
    console.error('Error during startup cleanup:', error.message);
  }

  // Browser auto-open disabled
  // if (process.env.NODE_ENV !== 'production' && !process.env.CONTAINER) {
  //   try {
  //     const open = (await import('open')).default;
  //     await open(`http://localhost:${port}`);
  //   } catch (error) {
  //     console.log('Could not open browser automatically:', error.message);
  //   }
  // }
});