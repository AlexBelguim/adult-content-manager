const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const { calculateSize } = require('../services/stats'); // Assume extended stats
const { scanDirectory } = require('../services/fileScanner');

router.get('/genres', async (req, res) => {
  const { basePath } = req.query;
  const contentPath = path.join(basePath, 'content');
  const genres = await fs.readdir(contentPath, { withFileTypes: true });
  const data = [];
const { getGenreGalleryData, formatFileSize } = require('./gallery');
  // Use the same logic as /gallery/genre/:name?includeTagged=true for each genre
  for (const genre of genres.filter(g => g.isDirectory())) {
    const genrePath = path.join(contentPath, genre.name);
    // Call getGenreGalleryData to get origin files
    const galleryData = await getGenreGalleryData(genrePath, 'all', 'name', 'asc');
    // Count origin files
    const originCounts = {
      pics: galleryData.pics ? galleryData.pics.length : 0,
      vids: galleryData.vids ? galleryData.vids.length : 0,
      funscripts: galleryData.funscriptVids ? galleryData.funscriptVids.length : 0
    };
    // Now count virtual/tagged files (not in this genre folder)
    let virtualCounts = { pics: 0, vids: 0, funscripts: 0 };
    const db = require('../db');
    const taggedFiles = db.prepare('SELECT file_path, tag FROM file_tags WHERE tag = ?').all(genre.name);
    
    // Also get exported files that have this tag
    const taggedExportedFiles = db.prepare(`
      SELECT ef.*, vs.name as scene_name 
      FROM exported_files ef
      LEFT JOIN video_scenes vs ON ef.scene_id = vs.id
      WHERE ef.tags LIKE ?
    `).all(`%"${genre.name}"%`);
    
    // Create a set of exported file paths to exclude from regular tagged file processing
    const exportedFilePaths = new Set(taggedExportedFiles.map(ef => ef.file_path));
    
    for (const file of taggedFiles) {
      if (!file.file_path.startsWith(genrePath)) {
        // Skip if this is an exported file (it will be handled separately)
        if (exportedFilePaths.has(file.file_path)) {
          continue;
        }
        
        try {
          const stat = await fs.stat(file.file_path);
          const ext = path.extname(file.file_path).toLowerCase();
          if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
            virtualCounts.pics++;
          } else if ([".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".webm"].includes(ext)) {
            // Check for matching funscript file(s)
            const base = file.file_path.slice(0, -ext.length);
            const dir = path.dirname(file.file_path);
            try {
              const filesInDir = await fs.readdir(dir);
              const matchingFunscripts = filesInDir.filter(f => f.endsWith('.funscript') && (f.startsWith(path.basename(base))));
              if (matchingFunscripts.length > 0) {
                virtualCounts.funscripts++;
              } else {
                virtualCounts.vids++;
              }
            } catch (dirError) {
              // Can't read directory, treat as regular video
              virtualCounts.vids++;
            }
          }
        } catch (e) {}
      }
    }

    
    for (const expFile of taggedExportedFiles) {
      try {
        // Parse tags from JSON
        let fileTags = [];
        if (expFile.tags) {
          try {
            fileTags = JSON.parse(expFile.tags);
          } catch (e) {
            fileTags = [];
          }
        }
        
        // Only count if this file actually has the tag we're looking for
        if (!fileTags.includes(genre.name)) {
          continue;
        }
        
        // Check if file exists
        if (!await fs.pathExists(expFile.file_path)) {
          continue;
        }
        
        const ext = path.extname(expFile.file_path).toLowerCase();
        if ([".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".webm"].includes(ext)) {
          // Use the content_type field to determine categorization
          if (expFile.content_type === 'funscript') {
            virtualCounts.funscripts++;
          } else {
            virtualCounts.vids++;
          }
        }
      } catch (e) {
        // Skip files with errors
      }
    }
    // Calculate total size (origin only)
    let size = 0;
    try {
      const { calculateSize } = require('../services/stats');
      size = await calculateSize(genrePath);
    } catch (e) {}
    data.push({
      name: genre.name,
      pics: originCounts.pics + virtualCounts.pics,
      vids: originCounts.vids + virtualCounts.vids,
      funscripts: originCounts.funscripts + virtualCounts.funscripts,
      size: (size / 1e9).toFixed(2),
      originCounts,
      virtualCounts
    });
  }
  res.send(data);
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