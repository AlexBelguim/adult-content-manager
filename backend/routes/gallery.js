const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');

// Get performer gallery data by name (must come before ID route)
router.get('/performer/:name', async (req, res) => {
  const { name } = req.params;
  const { basePath, sortBy, sortOrder, section } = req.query;
  
  // If basePath is provided, this is a name-based lookup
  if (basePath) {
    try {
      // First get the performer by name and folder path
      const performer = db.prepare(`
        SELECT p.*, f.path as folder_path 
        FROM performers p 
        JOIN folders f ON p.folder_id = f.id
        WHERE p.name = ? AND f.path = ?
      `).get(name, basePath);
      
      if (!performer) {
        return res.status(404).send({ error: 'Performer not found' });
      }
      
      // Check if performer is in "after filter performer" folder (gallery mode)
      const performerPath = path.join(performer.folder_path, 'after filter performer', performer.name);
      
      const galleryData = await getPerformerGalleryData(performerPath, section, sortBy, sortOrder);
      
      res.send({
        performer,
        ...galleryData
      });
    } catch (err) {
      console.error('Error in performer gallery route:', err);
      res.status(500).send({ error: err.message });
    }
  } else {
    // If no basePath, treat as ID-based lookup
    const id = name; // Actually an ID in this case
    try {
      const performer = db.prepare(`
        SELECT p.*, f.path as folder_path 
        FROM performers p 
        JOIN folders f ON p.folder_id = f.id
        WHERE p.id = ?
      `).get(id);
      
      if (!performer) {
        return res.status(404).send({ error: 'Performer not found' });
      }
      
      const performerPath = path.join(performer.folder_path, 'before filter performer', performer.name);
      const galleryData = await getPerformerGalleryData(performerPath, section, sortBy, sortOrder);
      
      res.send({
        performer,
        ...galleryData
      });
    } catch (err) {
      res.status(500).send({ error: err.message });
    }
  }
});

// Legacy endpoint for performer-name (for backward compatibility)
router.get('/performer-name/:name', async (req, res) => {
  const { name } = req.params;
  const { basePath, sortBy, sortOrder, section } = req.query;
  
  try {
    // First get the performer by name and folder path
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.name = ? AND f.path = ?
    `).get(name, basePath);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    // Check if performer is in "after filter performer" folder (gallery mode)
    const performerPath = path.join(performer.folder_path, 'after filter performer', performer.name);
    
    const galleryData = await getPerformerGalleryData(performerPath, section, sortBy, sortOrder);
    
    res.send({
      performer,
      ...galleryData
    });
  } catch (err) {
    console.error('Error in legacy performer-name route:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get content gallery data (genres)
router.get('/content', async (req, res) => {
  const { folderId } = req.query;
  
  try {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
    if (!folder) {
      return res.status(404).send({ error: 'Folder not found' });
    }
    
    const contentPath = path.join(folder.path, 'content');
    const genres = await getContentGalleryData(contentPath);
    
    res.send({ genres });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get genre files
router.get('/genre/:name', async (req, res) => {
  const { name } = req.params;
  const { folderId, basePath, sortBy, sortOrder, section } = req.query;

  try {
    let folder;
    if (basePath) {
      // Use basePath to find the folder
      folder = db.prepare('SELECT * FROM folders WHERE path = ?').get(basePath);
    } else if (folderId) {
      // Use folderId (legacy support)
      folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
    }

    if (!folder) {
      return res.status(404).send({ error: 'Folder not found' });
    }

    const genrePath = path.join(folder.path, 'content', name);
    const galleryData = await getGenreGalleryData(genrePath, section, sortBy, sortOrder);

    // Always include tagged/virtual files in the response
    let virtualCounts = { pics: 0, vids: 0, funscriptVids: 0 };
    const taggedFiles = db.prepare('SELECT file_path, tag FROM file_tags WHERE tag = ?').all(name);
    
    // Also get exported files that have this tag
    console.log('Looking for exported files with tag:', name);
    const exportedFiles = db.prepare(`
      SELECT ef.*, vs.name as scene_name 
      FROM exported_files ef
      LEFT JOIN video_scenes vs ON ef.scene_id = vs.id
      WHERE ef.tags LIKE ?
    `).all(`%"${name}"%`);
    console.log('Found exported files:', exportedFiles.length);
    exportedFiles.forEach(file => {
      console.log('Exported file:', file.file_path, 'tags:', file.tags);
    });
    
    // Process tagged files from file_tags table (exclude exported files)
    const exportedFilePaths = new Set(exportedFiles.map(ef => ef.file_path));
    
    for (const file of taggedFiles) {
      // Skip if this is an exported file (it will be handled separately)
      if (exportedFilePaths.has(file.file_path)) {
        console.log('Skipping exported file in tagged files:', file.file_path);
        continue;
      }
      
      if (!file.file_path.startsWith(genrePath)) {
        try {
          const stat = await fs.stat(file.file_path);
          const ext = path.extname(file.file_path).toLowerCase();
          const fileInfo = {
            name: path.basename(file.file_path),
            size: stat.size,
            modified: stat.mtime,
            url: `/api/files/raw?path=${encodeURIComponent(file.file_path)}`,
            tags: [file.tag],
            virtual: true
          };
          if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
            galleryData.pics.push(fileInfo);
            virtualCounts.pics++;
          } else if ([".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".webm"].includes(ext)) {
            // Check for matching funscript file(s)
            const base = file.file_path.slice(0, -ext.length);
            const dir = path.dirname(file.file_path);
            try {
              const filesInDir = await fs.readdir(dir);
              const matchingFunscripts = filesInDir.filter(f => f.endsWith('.funscript') && (f.startsWith(path.basename(base))));
              if (matchingFunscripts.length > 0) {
                // Add to funscriptVids
                galleryData.funscriptVids.push({
                  name: path.basename(base),
                  path: file.file_path,
                  url: `/api/files/raw?path=${encodeURIComponent(file.file_path)}`,
                  thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(file.file_path)}`,
                  type: 'funscript_video',
                  video: path.basename(file.file_path),
                  funscripts: matchingFunscripts,
                  funscriptCount: matchingFunscripts.length,
                  size: stat.size,
                  modified: stat.mtime,
                  sizeFormatted: formatFileSize(stat.size),
                  tags: [file.tag],
                  virtual: true,
                  missingFunscripts: matchingFunscripts.length === 0 // Flag for frontend styling
                });
                virtualCounts.funscriptVids++;
              } else {
                // Add to vids
                galleryData.vids.push({
                  ...fileInfo,
                  thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(file.file_path)}`
                });
                virtualCounts.vids++;
              }
            } catch (dirError) {
              // Can't read directory, treat as regular video
              galleryData.vids.push({
                ...fileInfo,
                thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(file.file_path)}`
              });
              virtualCounts.vids++;
            }
          }
        } catch (e) {
          // File might not exist anymore, skip
        }
      }
    }
    
    // Process exported files that have this tag
    console.log('Processing', exportedFiles.length, 'exported files for tag:', name);
    for (const expFile of exportedFiles) {
      try {
        // Parse tags from JSON
        let fileTags = [];
        if (expFile.tags) {
          try {
            fileTags = JSON.parse(expFile.tags);
            console.log('Parsed tags for', expFile.file_path, ':', fileTags);
          } catch (e) {
            console.log('Failed to parse tags for', expFile.file_path, ':', expFile.tags);
            fileTags = [];
          }
        }
        
        // Only include if this file actually has the tag we're looking for
        if (!fileTags.includes(name)) {
          console.log('File', expFile.file_path, 'does not have tag', name, 'skipping');
          continue;
        }
        
        console.log('Processing exported file:', expFile.file_path, 'with tag:', name);
        
        // Check if file exists
        if (!await fs.pathExists(expFile.file_path)) {
          console.log('File does not exist:', expFile.file_path);
          continue;
        }
        
        const stat = await fs.stat(expFile.file_path);
        const ext = path.extname(expFile.file_path).toLowerCase();
        
        if ([".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".webm"].includes(ext)) {
          // Use the content_type field to determine categorization
          const isFunscriptContent = expFile.content_type === 'funscript';
          
          console.log('Processing exported file:', expFile.file_path);
          console.log('Content type:', expFile.content_type);
          console.log('Is funscript content:', isFunscriptContent);
          
          if (isFunscriptContent) {
            // Add to funscriptVids
            let funscripts = [];
            
            // First, check if funscript_path is set and exists
            if (expFile.funscript_path && await fs.pathExists(expFile.funscript_path)) {
              funscripts.push(path.basename(expFile.funscript_path));
            }
            
            // Also scan the directory for additional funscript files
            try {
              const fileDir = path.dirname(expFile.file_path);
              const videoBaseName = path.basename(expFile.file_path, ext);
              const filesInDir = await fs.readdir(fileDir);
              
              const additionalFunscripts = filesInDir.filter(f => {
                if (!f.endsWith('.funscript')) return false;
                const fsBaseName = path.basename(f, '.funscript');
                return fsBaseName === videoBaseName || fsBaseName.startsWith(videoBaseName);
              });
              
              // Add any funscripts not already in the list
              for (const fs of additionalFunscripts) {
                if (!funscripts.includes(fs)) {
                  funscripts.push(fs);
                }
              }
            } catch (dirError) {
              console.log('Could not scan directory for additional funscripts:', dirError);
            }
            
            galleryData.funscriptVids.push({
              name: expFile.name || path.basename(expFile.file_path, ext),
              path: expFile.file_path,
              url: `/api/files/raw?path=${encodeURIComponent(expFile.file_path)}`,
              thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(expFile.file_path)}`,
              type: 'funscript_video',
              video: path.basename(expFile.file_path),
              funscripts: funscripts,
              funscriptCount: funscripts.length,
              size: stat.size,
              modified: stat.mtime,
              sizeFormatted: formatFileSize(stat.size),
              tags: fileTags,
              virtual: true,
              exported: true,
              sceneId: expFile.scene_id,
              sceneName: expFile.scene_name,
              contentType: expFile.content_type,
              missingFunscripts: funscripts.length === 0 // Flag for frontend styling
            });
            virtualCounts.funscriptVids++;
            console.log('Added to funscriptVids with', funscripts.length, 'funscripts:', funscripts);
          } else {
            // Add to regular vids
            galleryData.vids.push({
              name: expFile.name || path.basename(expFile.file_path, ext),
              path: expFile.file_path,
              url: `/api/files/raw?path=${encodeURIComponent(expFile.file_path)}`,
              thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(expFile.file_path)}`,
              type: 'video',
              size: stat.size,
              modified: stat.mtime,
              sizeFormatted: formatFileSize(stat.size),
              tags: fileTags,
              virtual: true,
              exported: true,
              sceneId: expFile.scene_id,
              sceneName: expFile.scene_name,
              contentType: expFile.content_type
            });
            virtualCounts.vids++;
            console.log('Added to regular vids');
          }
        }
      } catch (e) {
        console.error('Error processing exported file:', expFile.file_path, e);
        // Skip this file if there's an error
      }
    }

    res.send({
      genre: name,
      ...galleryData,
      virtualCounts
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

async function getPerformerGalleryData(performerPath, section = 'all', sortBy = 'name', sortOrder = 'asc') {
  const data = {
    pics: [],
    vids: [],
    funscriptVids: [],
    totalSizeGB: 0
  };
  
  // Get total folder size if performer path exists
  if (await fs.pathExists(performerPath)) {
    const stats = await getDirectoryStats(performerPath);
    data.totalSizeGB = Math.round(stats.total_size_gb);
  }
  
  if (section === 'all' || section === 'pics') {
    const picsPath = path.join(performerPath, 'pics');
    if (await fs.pathExists(picsPath)) {
      data.pics = await getMediaFiles(picsPath, 'image', sortBy, sortOrder);
    }
  }
  
  if (section === 'all' || section === 'vids') {
    const vidsPath = path.join(performerPath, 'vids');
    if (await fs.pathExists(vidsPath)) {
      data.vids = await getMediaFiles(vidsPath, 'video', sortBy, sortOrder);
    }
  }
  
  if (section === 'all' || section === 'funscript') {
    const funscriptPath = path.join(performerPath, 'vids', 'funscript');
    if (await fs.pathExists(funscriptPath)) {
      data.funscriptVids = await getFunscriptVideos(funscriptPath, sortBy, sortOrder);
    }
  }
  
  return data;
}

async function getGenreGalleryData(genrePath, section = 'all', sortBy = 'name', sortOrder = 'asc') {
  const data = {
    pics: [],
    vids: [],
    funscriptVids: []
  };
  
  // Get all files in the genre folder
  if (section === 'all' || section === 'pics') {
    if (await fs.pathExists(genrePath)) {
      data.pics = await getMediaFiles(genrePath, 'image', sortBy, sortOrder);
    }
  }
  
  if (section === 'all' || section === 'vids') {
    if (await fs.pathExists(genrePath)) {
      data.vids = await getMediaFiles(genrePath, 'video', sortBy, sortOrder);
    }
  }
  
  if (section === 'all' || section === 'funscript') {
    // Look for funscript videos in the genre folder recursively
    if (await fs.pathExists(genrePath)) {
      data.funscriptVids = await getFunscriptVideosRecursive(genrePath, sortBy, sortOrder);
    }
  }
  
  return data;
}

async function getContentGalleryData(contentPath) {
  const genres = [];
  
  try {
    if (await fs.pathExists(contentPath)) {
      const contents = await fs.readdir(contentPath, { withFileTypes: true });
      for (const item of contents) {
        if (item.isDirectory()) {
          if (item.name === '.thumbnails') continue; // skip .thumbnails as a genre
          const genrePath = path.join(contentPath, item.name);
          const stats = await getDirectoryStats(genrePath);
          genres.push({
            name: item.name,
            path: genrePath,
            ...stats
          });
        }
      }
    }
  } catch (error) {
    console.error('Error getting content gallery data:', error);
  }
  
  return genres;
}

async function getGenreFiles(genrePath, sortBy = 'name', sortOrder = 'asc') {
  const files = [];
  
  if (await fs.pathExists(genrePath)) {
    const pics = await getMediaFiles(genrePath, 'image', sortBy, sortOrder);
    const vids = await getMediaFiles(genrePath, 'video', sortBy, sortOrder);
    
    files.push(...pics, ...vids);
  }
  
  return files;
}

async function getMediaFiles(dirPath, type, sortBy = 'name', sortOrder = 'asc') {
  const files = [];
  
  // Recursive function to scan all subdirectories
  async function scanRecursively(currentPath) {
    try {
      const contents = await fs.readdir(currentPath, { withFileTypes: true });
      for (const item of contents) {
        if (item.isDirectory() && item.name === '.thumbnails') continue;
        const itemPath = path.join(currentPath, item.name);
        if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          let isValidType = false;
          if (type === 'image' && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            isValidType = true;
          } else if (type === 'video' && ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
            // Check if this video is in a funscript folder structure
            const isInFunscriptFolder = currentPath.includes(path.join('vids', 'funscript'));
            
            if (isInFunscriptFolder) {
              // Videos in funscript folders should never appear in regular video tab
              isValidType = false;
            } else {
              // Check if this video has associated funscript files
              const videoBaseName = path.basename(item.name, ext);
              const dirContents = await fs.readdir(currentPath);
              const hasFunscriptFiles = dirContents.some(file => {
                const fsBaseName = path.basename(file, '.funscript');
                return file.endsWith('.funscript') && (fsBaseName === videoBaseName || fsBaseName.startsWith(videoBaseName));
              });
              // Only include video if it doesn't have funscript files
              isValidType = !hasFunscriptFiles;
            }
          }
          if (isValidType) {
            const stat = await fs.stat(itemPath);
            files.push({
              name: item.name,
              path: itemPath,
              url: `/api/files/raw?path=${encodeURIComponent(itemPath)}`,
              thumbnail: `/api/files/preview?path=${encodeURIComponent(itemPath)}`,
              type: type,
              size: stat.size,
              modified: stat.mtime.getTime(),
              sizeFormatted: formatFileSize(stat.size)
            });
          }
        } else if (item.isDirectory()) {
          // Recursively scan subdirectories
          await scanRecursively(itemPath);
        }
      }
    } catch (error) {
      console.error('Error scanning directory:', currentPath, error);
    }
  }
  
  await scanRecursively(dirPath);
  
  // Sort files
  files.sort((a, b) => {
    let compareValue = 0;
    
    switch (sortBy) {
      case 'name':
        compareValue = a.name.localeCompare(b.name);
        break;
      case 'size':
        compareValue = a.size - b.size;
        break;
      case 'date':
        compareValue = a.modified - b.modified;
        break;
        default:
          compareValue = 0;
      }
      
      return sortOrder === 'desc' ? -compareValue : compareValue;
    });
  
  return files;
}

async function getFunscriptVideos(funscriptPath, sortBy = 'name', sortOrder = 'asc') {
  const videos = [];
  
  try {
    const contents = await fs.readdir(funscriptPath, { withFileTypes: true });
    
    // First, check if this folder directly contains video and funscript files
    let directVideoFiles = [];
    let directFunscriptFiles = [];
    
    for (const item of contents) {
      if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
          directVideoFiles.push(item.name);
        } else if (ext === '.funscript') {
          directFunscriptFiles.push(item.name);
        }
      }
    }
    
    // If we have direct video files, create entries for them (with or without funscripts)
    if (directVideoFiles.length > 0) {
      for (const videoFile of directVideoFiles) {
        const videoPath = path.join(funscriptPath, videoFile);
        const videoBaseName = path.basename(videoFile, path.extname(videoFile));
        
        // Find matching funscript files
        const matchingFunscripts = directFunscriptFiles.filter(fs => {
          const fsBaseName = path.basename(fs, '.funscript');
          return fsBaseName === videoBaseName || fsBaseName.startsWith(videoBaseName);
        });
        
        // Include the video regardless of whether it has funscripts
        const stat = await fs.stat(videoPath);
        
        videos.push({
          name: videoBaseName,
          path: funscriptPath,
          url: `/api/files/raw?path=${encodeURIComponent(videoPath)}`,
          thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(videoPath)}`,
          type: 'funscript_video',
          video: videoFile,
          funscripts: matchingFunscripts,
          funscriptCount: matchingFunscripts.length,
          size: stat.size,
          modified: stat.mtime.getTime(),
          sizeFormatted: formatFileSize(stat.size),
          missingFunscripts: matchingFunscripts.length === 0 // Flag for frontend styling
        });
      }
    }
    
    // Also check subdirectories (original behavior)
    for (const item of contents) {
      if (item.isDirectory()) {
        const vidFolderPath = path.join(funscriptPath, item.name);
        const vidContents = await fs.readdir(vidFolderPath);
        
        let videoFile = null;
        let funscriptFiles = [];
        
        for (const file of vidContents) {
          const ext = path.extname(file).toLowerCase();
          if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
            videoFile = file;
          } else if (ext === '.funscript') {
            funscriptFiles.push(file);
          }
        }
        
        if (videoFile) {
          const videoPath = path.join(vidFolderPath, videoFile);
          const stat = await fs.stat(videoPath);
          
          videos.push({
            name: item.name,
            path: vidFolderPath,
            url: `/api/files/raw?path=${encodeURIComponent(videoPath)}`,
            thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(videoPath)}`,
            type: 'funscript_video',
            video: videoFile,
            funscripts: funscriptFiles,
            funscriptCount: funscriptFiles.length,
            size: stat.size,
            modified: stat.mtime.getTime(),
            sizeFormatted: formatFileSize(stat.size),
            missingFunscripts: funscriptFiles.length === 0 // Flag for frontend styling
          });
        }
      }
    }
    
    // Sort videos
    videos.sort((a, b) => {
      let compareValue = 0;
      
      switch (sortBy) {
        case 'name':
          compareValue = a.name.localeCompare(b.name);
          break;
        case 'size':
          compareValue = a.size - b.size;
          break;
        case 'date':
          compareValue = a.modified - b.modified;
          break;
        case 'funscript_count':
          compareValue = a.funscriptCount - b.funscriptCount;
          break;
        default:
          compareValue = 0;
      }
      
      return sortOrder === 'desc' ? -compareValue : compareValue;
    });
  } catch (error) {
    console.error('Error getting funscript videos:', error);
  }
  
  return videos;
}

async function getDirectoryStats(dirPath) {
  const stats = { pics_count: 0, vids_count: 0, total_size_gb: 0 };
  
  try {
    const contents = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const item of contents) {
      const itemPath = path.join(dirPath, item.name);
      
      if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        const fileStat = await fs.stat(itemPath);
        stats.total_size_gb += fileStat.size / (1024 * 1024 * 1024);
        
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          stats.pics_count++;
        } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
          stats.vids_count++;
        }
      } else if (item.isDirectory()) {
        const subStats = await getDirectoryStats(itemPath);
        stats.pics_count += subStats.pics_count;
        stats.vids_count += subStats.vids_count;
        stats.total_size_gb += subStats.total_size_gb;
      }
    }
  } catch (error) {
    console.error('Error getting directory stats:', error);
  }
  
  return stats;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Recursive funscript video scanning function
async function getFunscriptVideosRecursive(dirPath, sortBy = 'name', sortOrder = 'asc') {
  const videos = [];
  
  // Recursive function to scan all subdirectories for funscript videos
  async function scanRecursively(currentPath) {
    try {
      const contents = await fs.readdir(currentPath, { withFileTypes: true });
      
      // Check if current directory contains funscript files
      let videoFiles = [];
      let funscriptFiles = [];
      
      for (const item of contents) {
        if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
            videoFiles.push(item.name);
          } else if (ext === '.funscript') {
            funscriptFiles.push(item.name);
          }
        }
      }
      
      // If we have video files in a funscript context, create entries (with or without funscript files)
      if (videoFiles.length > 0) {
        for (const videoFile of videoFiles) {
          const videoPath = path.join(currentPath, videoFile);
          const videoBaseName = path.basename(videoFile, path.extname(videoFile));
          
          // Find matching funscript files
          const matchingFunscripts = funscriptFiles.filter(fs => {
            const fsBaseName = path.basename(fs, '.funscript');
            return fsBaseName === videoBaseName || fsBaseName.startsWith(videoBaseName);
          });
          
          // Include video regardless of whether it has funscripts, but only if we're in a funscript context
          const isInFunscriptContext = currentPath.includes(path.join('vids', 'funscript')) || 
                                     currentPath.includes('funscript') ||
                                     funscriptFiles.length > 0;
          
          if (isInFunscriptContext) {
            const stat = await fs.stat(videoPath);
            
            videos.push({
              name: videoBaseName,
              path: currentPath,
              url: `/api/files/raw?path=${encodeURIComponent(videoPath)}`,
              thumbnail: `/api/files/video-thumbnail?path=${encodeURIComponent(videoPath)}`,
              type: 'funscript_video',
              video: videoFile,
              funscripts: matchingFunscripts,
              funscriptCount: matchingFunscripts.length,
              size: stat.size,
              modified: stat.mtime.getTime(),
              sizeFormatted: formatFileSize(stat.size),
              missingFunscripts: matchingFunscripts.length === 0 // Flag for frontend styling
            });
          }
        }
      }
      
      // Recursively scan subdirectories (but skip .thumbnails)
      for (const item of contents) {
        if (item.isDirectory() && item.name !== '.thumbnails') {
          const subPath = path.join(currentPath, item.name);
          await scanRecursively(subPath);
        }
      }
    } catch (error) {
      console.error('Error scanning directory for funscript videos:', currentPath, error);
    }
  }
  
  await scanRecursively(dirPath);
  
  // Sort videos
  videos.sort((a, b) => {
    let compareValue = 0;
    
    switch (sortBy) {
      case 'name':
        compareValue = a.name.localeCompare(b.name);
        break;
      case 'size':
        compareValue = a.size - b.size;
        break;
      case 'date':
        compareValue = a.modified - b.modified;
        break;
      case 'funscript_count':
        compareValue = a.funscriptCount - b.funscriptCount;
        break;
      default:
        compareValue = 0;
    }
    
    return sortOrder === 'desc' ? -compareValue : compareValue;
  });
  
  return videos;
}

module.exports = router;
// For internal use in content.js, also export the functions
module.exports.getGenreGalleryData = getGenreGalleryData;
module.exports.formatFileSize = formatFileSize;