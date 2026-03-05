const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const { calculateSize } = require('../services/stats'); // Assume extended stats
const { scanDirectory } = require('../services/fileScanner');
const db = require('../db');

// In-memory cache for genres list
let genresCache = null;
let genresCacheTime = 0;
const GENRES_CACHE_TTL = 60 * 1000; // 1 minute cache

router.get('/genres', async (req, res) => {
  const { basePath, fast } = req.query;
  const contentPath = path.join(basePath, 'content');
  const startTime = Date.now();

  try {
    // Check cache first
    const cacheKey = `genres_${basePath}`;
    if (genresCache && genresCache.basePath === basePath && (Date.now() - genresCacheTime) < GENRES_CACHE_TTL) {
      console.log(`[genres] Returning cached data (${Date.now() - startTime}ms)`);
      return res.send(genresCache.data);
    }

    const genres = await fs.readdir(contentPath, { withFileTypes: true });
    const data = [];

    // Fast mode: just get folder names and basic counts from DB if available
    // Avoid expensive file system scans
    for (const genre of genres.filter(g => g.isDirectory())) {
      const genrePath = path.join(contentPath, genre.name);

      // Get counts from database cache if available
      const dbCounts = db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM file_tags WHERE tag = ?) as tagged_count
      `).get(genre.name);

      // Recursive directory scan for origin counts
      let originCounts = { pics: 0, vids: 0, funscripts: 0 };
      async function countFilesRecursive(dirPath) {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              await countFilesRecursive(fullPath);
            } else {
              const ext = path.extname(entry.name).toLowerCase();
              if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                originCounts.pics++;
              } else if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'].includes(ext)) {
                originCounts.vids++;
              } else if (ext === '.funscript') {
                originCounts.funscripts++;
              }
            }
          }
        } catch (e) {
          // Skip if can't read
        }
      }
      await countFilesRecursive(genrePath);

      // Get virtual counts from database (fast)
      const virtualCounts = { pics: 0, vids: 0, funscripts: 0 };
      const taggedFiles = db.prepare('SELECT file_path FROM file_tags WHERE tag = ?').all(genre.name);
      for (const file of taggedFiles) {
        if (!file.file_path.startsWith(genrePath)) {
          const ext = path.extname(file.file_path).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            virtualCounts.pics++;
          } else if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'].includes(ext)) {
            virtualCounts.vids++;
          }
        }
      }

      // Get exported files count (fast)
      const exportedCount = db.prepare(`
        SELECT COUNT(*) as count FROM exported_files WHERE tags LIKE ?
      `).get(`%"${genre.name}"%`);
      virtualCounts.vids += exportedCount?.count || 0;

      data.push({
        name: genre.name,
        pics: originCounts.pics + virtualCounts.pics,
        vids: originCounts.vids + virtualCounts.vids,
        funscripts: originCounts.funscripts + virtualCounts.funscripts,
        size: '0', // Skip size calculation in fast mode
        originCounts,
        virtualCounts
      });
    }

    // Cache the result
    genresCache = { basePath, data };
    genresCacheTime = Date.now();

    console.log(`[genres] Completed in ${Date.now() - startTime}ms for ${data.length} genres`);
    res.send(data);
  } catch (err) {
    console.error('Error in /genres:', err);
    res.status(500).send({ error: err.message });
  }
});

// Helper to get tags for a file
const getFileTags = (filePath) => {
  try {
    const rows = require('../db').prepare('SELECT tag FROM file_tags WHERE file_path = ?').all(filePath);
    return rows.map(r => r.tag);
  } catch (e) {
    return [];
  }
};

router.get('/genre/:genreName', async (req, res) => {
  try {
    const { genreName } = req.params;
    const { basePath } = req.query;
    if (!basePath) {
      return res.status(400).json({ error: 'basePath query parameter is required' });
    }
    const genrePath = path.join(basePath, 'content', genreName);
    if (!(await fs.pathExists(genrePath))) {
      return res.status(404).json({ error: 'Genre not found' });
    }
    const pics = [];
    const vids = [];
    async function scanGenreFolder(folderPath) {
      const files = await fs.readdir(folderPath);
      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          const ext = path.extname(file).toLowerCase();
          const fileInfo = {
            name: file,
            size: stat.size,
            modified: stat.mtime,
            url: `/api/files/raw?path=${encodeURIComponent(filePath)}`,
            tags: getFileTags(filePath)
          };
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            pics.push(fileInfo);
          } else if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'].includes(ext)) {
            vids.push({
              ...fileInfo,
              thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(filePath)}`
            });
          }
        } else if (stat.isDirectory()) {
          await scanGenreFolder(filePath);
        }
      }
    }
    await scanGenreFolder(genrePath);
    res.json({ pics, vids });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;