const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const cors = require('cors');

const app = express();
// Use PORT environment variable or default to 3000
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

app.use('/api/tags', require('./routes/tags'));
app.use('/api/funscripts', require('./routes/funscripts'));
app.use('/api/scenes', require('./routes/scenes'));

// Fallback to React
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Only open browser in development mode and not in container
  if (process.env.NODE_ENV !== 'production' && !process.env.CONTAINER) {
    try {
      const open = (await import('open')).default;
      await open(`http://localhost:${port}`);
    } catch (error) {
      console.log('Could not open browser automatically:', error.message);
    }
  }
});