const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
const db = require('../db');

// Import findThumbnail from importer
async function findThumbnail(picsPath) {
  try {
    if (!await fs.pathExists(picsPath)) return null;
    const pics = await fs.readdir(picsPath);
    const imageFile = pics.find(file => 
      ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file).toLowerCase())
    );
    return imageFile ? path.join(picsPath, imageFile) : null;
  } catch (error) {
    return null;
  }
}

// Watcher for new performers
function setupWatcher(basePath, onNew) {
  const beforePath = path.join(basePath, 'before filter performer');
  const watcher = chokidar.watch(beforePath, {
    persistent: true,
    ignoreInitial: true, // Don't trigger for existing folders on startup
    depth: 1 // Only watch direct subdirectories
  });
  
  // Watch for new directories being added
  watcher.on('addDir', (dir) => {
    const performerName = path.basename(dir);
    // Skip folders starting with . (like .cache, .thumbnails, etc.)
    if (performerName.startsWith('.')) return;
    if (path.dirname(dir) === beforePath) {
      // Check if this performer is not currently in "before filter performer" state in database
      // This will detect: 1) Completely new performers, 2) Performers moved back from "after filter"
      const existingPerformer = db.prepare('SELECT * FROM performers WHERE name = ? AND moved_to_after = 0').get(performerName);
      if (!existingPerformer) {
        console.log(`New performer detected: ${performerName} (new or moved back from after filter)`);
        onNew(performerName);
      }
    }
  });
  
  return watcher;
}

async function validateAndCreateStructure(basePath) {
  const requiredSubs = ['before filter performer', 'content', 'after filter performer', 'before upload'];
  for (const sub of requiredSubs) {
    const subPath = path.join(basePath, sub);
    if (!await fs.pathExists(subPath)) {
      await fs.mkdir(subPath, { recursive: true });
    }
  }
  return true;
}

async function scanBeforeFolder(basePath) {
  const beforePath = path.join(basePath, 'before filter performer');
  if (!await fs.pathExists(beforePath)) return [];
  
  const performers = await fs.readdir(beforePath, { withFileTypes: true });
  const newPerformers = [];
  
  for (const performer of performers) {
    // Skip folders starting with . (like .cache, .thumbnails, etc.)
    if (performer.isDirectory() && !performer.name.startsWith('.')) {
      // Check for existing performer that is currently in "before filter performer" state
      // If performer was deleted via trash icon, there will be no database record
      // If performer was moved to "after filter performer", moved_to_after will be 1
      // Only exclude if performer exists AND is currently in before filter state (moved_to_after = 0)
      const existingPerformer = db.prepare('SELECT * FROM performers WHERE name = ? AND moved_to_after = 0').get(performer.name);
      if (!existingPerformer) {
        const performerPath = path.join(beforePath, performer.name);
        const stats = await scanPerformerFolder(performerPath);
        newPerformers.push({
          name: performer.name,
          path: performerPath,
          stats
        });
      }
    }
  }
  
  return newPerformers;
}

async function scanBeforeUploadFolder(basePath) {
  const uploadPath = path.join(basePath, 'before upload');
  if (!await fs.pathExists(uploadPath)) return [];

  const entries = await fs.readdir(uploadPath, { withFileTypes: true });
  const performers = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const performerPath = path.join(uploadPath, entry.name);
    const stats = await scanPerformerFolder(performerPath);
    performers.push({
      name: entry.name,
      path: performerPath,
      stats
    });
  }

  return performers;
}

async function scanAfterFolder(basePath) {
  const afterPath = path.join(basePath, 'after filter performer');
  if (!await fs.pathExists(afterPath)) return [];
  
  const performers = await fs.readdir(afterPath, { withFileTypes: true });
  const existingPerformers = [];
  
  for (const performer of performers) {
    // Skip folders starting with . (like .cache, .thumbnails, etc.)
    if (performer.isDirectory() && !performer.name.startsWith('.')) {
      const existingPerformer = db.prepare('SELECT * FROM performers WHERE name = ? AND moved_to_after = 1').get(performer.name);
      if (!existingPerformer) {
        const performerPath = path.join(afterPath, performer.name);
        const stats = await scanPerformerFolder(performerPath);
        
        // Find thumbnail (first image)
        const picsPath = path.join(performerPath, 'pics');
        const thumbnail = await findThumbnail(picsPath);
        
        // Get folder ID
        const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
        
        // Import the performer as already moved to after
        const result = db.prepare(`
          INSERT INTO performers (
            name, folder_id, thumbnail, pics_count, vids_count, 
            funscript_vids_count, funscript_files_count, total_size_gb,
            pics_original_count, vids_original_count, funscript_vids_original_count,
            moved_to_after, ready_to_move
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
        `).run(
          performer.name,
          folder.id,
          thumbnail,
          stats.pics_count,
          stats.vids_count,
          stats.funscript_vids_count,
          stats.funscript_files_count,
          stats.total_size_gb,
          stats.pics_count,
          stats.vids_count,
          stats.funscript_vids_count
        );
        
        existingPerformers.push({
          name: performer.name,
          path: performerPath,
          stats,
          id: result.lastInsertRowid
        });
      }
    }
  }
  
  return existingPerformers;
}

async function scanPerformerFolder(performerPath) {
  console.log('scanPerformerFolder called with path:', performerPath);
  
  const stats = {
    pics_count: 0,
    vids_count: 0,
    funscript_vids_count: 0,
    funscript_files_count: 0,
    total_size_gb: 0
  };
  
  try {
    // Check if performer folder exists
    if (!await fs.pathExists(performerPath)) {
      console.log('Performer folder does not exist:', performerPath);
      return stats;
    }

    const contents = await fs.readdir(performerPath, { withFileTypes: true });
    console.log('Contents in performer folder:', contents.map(c => c.name));
    
    for (const item of contents) {
      if (item.isDirectory() && (item.name === '.thumbnails' || item.name === '.thumbnail' || item.name === '.trash' || item.name === '.cache')) continue;
      const itemPath = path.join(performerPath, item.name);
      console.log('Processing item:', item.name, 'isDirectory:', item.isDirectory());
      
      try {
        if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          const fileStat = await fs.stat(itemPath);
          stats.total_size_gb += fileStat.size / (1024 * 1024 * 1024);
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            stats.pics_count++;
          } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
            stats.vids_count++;
          }
        } else if (item.isDirectory()) {
          const dirStats = await scanDirectory(itemPath);
          stats.pics_count += dirStats.pics_count;
          stats.vids_count += dirStats.vids_count;
          stats.total_size_gb += dirStats.total_size_gb;
          stats.funscript_vids_count += dirStats.funscript_vids_count;
          stats.funscript_files_count += dirStats.funscript_files_count;
        }
      } catch (itemError) {
        console.warn(`Error processing item ${item.name}:`, itemError.message);
        // Continue processing other items even if one fails
      }
    }
  } catch (error) {
    console.error('Error scanning performer folder:', error);
  }
  
  console.log('Final stats for performer:', stats);
  return stats;
}

async function scanDirectory(dirPath) {
  const stats = { pics_count: 0, vids_count: 0, total_size_gb: 0, funscript_vids_count: 0, funscript_files_count: 0 };
  
  try {
    // Check if directory exists
    if (!await fs.pathExists(dirPath)) {
      console.log('Directory does not exist:', dirPath);
      return stats;
    }

    const contents = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const item of contents) {
      if (item.isDirectory() && (item.name === '.thumbnails' || item.name === '.thumbnail' || item.name === '.trash' || item.name === '.cache')) continue;
      const itemPath = path.join(dirPath, item.name);
      
      try {
        if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          const fileStat = await fs.stat(itemPath);
          stats.total_size_gb += fileStat.size / (1024 * 1024 * 1024);
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            stats.pics_count++;
          } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
            stats.vids_count++;
          }
        } else if (item.isDirectory()) {
          // Check if this is a funscript folder (case-insensitive)
          if (item.name.toLowerCase().includes('funscript')) {
            console.log('Found funscript folder in scanDirectory:', itemPath);
            const funscriptStats = await scanFunscriptFolder(itemPath);
            console.log('Funscript folder stats from scanDirectory:', funscriptStats);
            stats.funscript_vids_count += funscriptStats.vids_count;
            stats.funscript_files_count += funscriptStats.funscript_files_count;
            // Also add funscript videos to regular video count
            stats.vids_count += funscriptStats.vids_count;
          } else {
            const subStats = await scanDirectory(itemPath);
            stats.pics_count += subStats.pics_count;
            stats.vids_count += subStats.vids_count;
            stats.total_size_gb += subStats.total_size_gb;
            stats.funscript_vids_count += subStats.funscript_vids_count;
            stats.funscript_files_count += subStats.funscript_files_count;
          }
        }
      } catch (itemError) {
        console.warn(`Error processing item ${item.name} in ${dirPath}:`, itemError.message);
        // Continue processing other items even if one fails
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', dirPath, error);
  }
  
  console.log('scanDirectory stats for', dirPath, ':', stats);
  return stats;
}

async function scanFunscriptFolder(funscriptPath) {
  console.log('scanFunscriptFolder called with:', funscriptPath);
  const stats = { vids_count: 0, funscript_files_count: 0 };
  
  try {
    // Check if funscript folder exists
    if (!await fs.pathExists(funscriptPath)) {
      console.log('Funscript folder does not exist:', funscriptPath);
      return stats;
    }

    const contents = await fs.readdir(funscriptPath, { withFileTypes: true });
    console.log('Contents in funscript folder:', contents.map(c => c.name));
    
    for (const item of contents) {
      if (item.isDirectory() && (item.name === '.thumbnails' || item.name === '.thumbnail' || item.name === '.trash' || item.name === '.cache')) continue;
      
      try {
        if (item.isDirectory()) {
          const vidFolderPath = path.join(funscriptPath, item.name);
          console.log('Processing subfolder:', vidFolderPath);
          
          if (await fs.pathExists(vidFolderPath)) {
            const vidContents = await fs.readdir(vidFolderPath);
            console.log('Contents in subfolder:', vidContents);
            let hasVideo = false;
            let funscriptCount = 0;
            
            for (const file of vidContents) {
              const ext = path.extname(file).toLowerCase();
              if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
                hasVideo = true;
                console.log('Found video file:', file);
              } else if (ext === '.funscript') {
                funscriptCount++;
                console.log('Found funscript file:', file);
              }
            }
            
            if (hasVideo && funscriptCount > 0) {
              stats.vids_count++;
              stats.funscript_files_count += funscriptCount;
              console.log('Added to stats - hasVideo:', hasVideo, 'funscriptCount:', funscriptCount);
            }
          }
        }
      } catch (itemError) {
        console.warn(`Error processing subfolder ${item.name}:`, itemError.message);
        // Continue processing other items even if one fails
      }
    }
  } catch (error) {
    console.error('Error scanning funscript folder:', error);
  }
  
  console.log('Final funscript stats:', stats);
  return stats;
}

async function scanContentFolder(basePath) {
  const contentPath = path.join(basePath, 'content');
  const genres = [];
  
  try {
    if (await fs.pathExists(contentPath)) {
      const contents = await fs.readdir(contentPath, { withFileTypes: true });
      
      for (const item of contents) {
        if (item.isDirectory()) {
          const genrePath = path.join(contentPath, item.name);
          const stats = await scanDirectory(genrePath);
          genres.push({
            name: item.name,
            path: genrePath,
            stats
          });
        }
      }
    }
  } catch (error) {
    console.error('Error scanning content folder:', error);
  }
  
  return genres;
}

// Detect orphaned performers - performers in DB but folders don't exist
async function scanOrphanedPerformers(basePath) {
  const orphanedPerformers = [];
  
  try {
    // Get folder ID for this base path
    const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
    if (!folder) return orphanedPerformers;
    
    // Get all performers for this folder
    const performers = db.prepare('SELECT * FROM performers WHERE folder_id = ?').all(folder.id);
    
    const beforePath = path.join(basePath, 'before filter performer');
    const afterPath = path.join(basePath, 'after filter performer');
    
    for (const performer of performers) {
      let expectedPath;
      let location;
      
      if (performer.moved_to_after === 1) {
        expectedPath = path.join(afterPath, performer.name);
        location = 'after filter performer';
      } else {
        expectedPath = path.join(beforePath, performer.name);
        location = 'before filter performer';
      }
      
      // Check if the expected folder exists
      if (!await fs.pathExists(expectedPath)) {
        // Check if performer is blacklisted or has hash data (kept for ML training)
        const isBlacklisted = performer.blacklisted === 1;
        const hashCount = db.prepare('SELECT COUNT(*) as count FROM performer_file_hashes WHERE performer_id = ?')
          .get(performer.id)?.count || 0;
        
        // Skip this performer if blacklisted or has hash data (intentionally kept for ML)
        if (isBlacklisted || hashCount > 0) {
          console.log(`Skipping orphan check for ${performer.name}: ${isBlacklisted ? 'blacklisted' : `has ${hashCount} hash records for ML training`}`);
          continue;
        }
        
        orphanedPerformers.push({
          id: performer.id,
          name: performer.name,
          location: location,
          expectedPath: expectedPath,
          moved_to_after: performer.moved_to_after
        });
      }
    }
  } catch (error) {
    console.error('Error scanning for orphaned performers:', error);
  }
  
  return orphanedPerformers;
}

module.exports = { 
  validateAndCreateStructure, 
  scanBeforeFolder, 
  scanAfterFolder,
  scanBeforeUploadFolder,
  scanPerformerFolder,
  scanDirectory,
  scanContentFolder,
  scanOrphanedPerformers,
  setupWatcher 
};