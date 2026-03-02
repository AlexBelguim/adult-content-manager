const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');
const { findAllPerformersByNameOrAlias, normalizeName } = require('../utils/performerMatcher');

/**
 * Handle trash folder - either move contents to training or permanently delete
 */
async function handleTrashFolder(trashFolderPath, performerName, basePath, fileType) {
  const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('save_deleted_for_training');
  const saveForTraining = setting && setting.value === 'true';
  
  console.log(`handleTrashFolder: folder=${trashFolderPath}, performer=${performerName}, type=${fileType}, saveForTraining=${saveForTraining}`);
  
  try {
    if (!await fs.pathExists(trashFolderPath)) {
      return { saved: false, count: 0 };
    }
    
    const files = await fs.readdir(trashFolderPath);
    
    if (saveForTraining && files.length > 0) {
      // Move entire contents to training folder
      const trainingBasePath = path.join(basePath, 'deleted keep for training', performerName);
      const destFolder = path.join(trainingBasePath, fileType === 'video' ? 'vids' : 'pics');
      
      await fs.ensureDir(destFolder);
      
      // Move each file
      for (const file of files) {
        const sourcePath = path.join(trashFolderPath, file);
        const destPath = path.join(destFolder, file);
        await fs.move(sourcePath, destPath, { overwrite: true });
      }
      
      console.log(`Saved ${files.length} files for training: ${destFolder}`);
      
      // Remove empty trash folder
      await fs.remove(trashFolderPath);
      
      return { saved: true, count: files.length };
    } else {
      // Permanently delete the entire trash folder
      await fs.remove(trashFolderPath);
      console.log(`Permanently deleted trash folder: ${trashFolderPath} (${files.length} files)`);
      
      return { saved: false, count: files.length };
    }
  } catch (err) {
    console.error('Error handling trash folder:', err);
    throw err;
  }
}

/**
 * Helper function to calculate actual upload timestamp from relative time string
 * @param {string} checkDate - ISO date string when the check was performed
 * @param {string} relativeTime - Relative time string like "10 days ago", "2 hours ago"
 * @returns {number} Unix timestamp in milliseconds of the actual upload date
 */
function calculateUploadTimestamp(checkDate, relativeTime) {
  if (!checkDate || !relativeTime) return null;
  
  const checkTimestamp = new Date(checkDate).getTime();
  
  // Parse the relative time string
  const match = relativeTime.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return checkTimestamp; // If can't parse, assume it's current
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  let offsetMs = 0;
  switch (unit) {
    case 'minute': offsetMs = value * 60 * 1000; break;
    case 'hour': offsetMs = value * 60 * 60 * 1000; break;
    case 'day': offsetMs = value * 24 * 60 * 60 * 1000; break;
    case 'week': offsetMs = value * 7 * 24 * 60 * 60 * 1000; break;
    case 'month': offsetMs = value * 30 * 24 * 60 * 60 * 1000; break; // Approximate
    case 'year': offsetMs = value * 365 * 24 * 60 * 60 * 1000; break; // Approximate
    default: return checkTimestamp;
  }
  
  return checkTimestamp - offsetMs;
}

/**
 * Helper function to delete folder with retry logic for locked files
 */
async function deleteFolderWithRetry(folderPath, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fs.remove(folderPath);
      return { success: true };
    } catch (err) {
      if (err.code === 'EBUSY' && attempt < maxRetries) {
        console.log(`Attempt ${attempt} failed for ${folderPath}, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      // If it's the last attempt or not EBUSY error, throw it
      throw err;
    }
  }
}

/**
 * GET /api/performer-management/all
 * Get comprehensive data on all performers with location, hash status, scrape status, duplicates
 */
router.get('/all', async (req, res) => {
  try {
    // Get all performers with folder paths (exclude hidden folders like .cache)
    const performers = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.name NOT LIKE '.%'
    `).all();
    
    // Enhance each performer with additional metadata
    const enhancedPerformers = await Promise.all(performers.map(async (performer) => {
      // Determine location
      let location = 'unknown';
      let folderExists = false;
      let actualPath = null;
      const isEmpty = (performer.pics_count || 0) + (performer.vids_count || 0) + (performer.funscript_vids_count || 0) === 0;
      
      // Check if blacklisted first
      if (performer.blacklisted === 1) {
        location = 'blacklisted';
      } else if (performer.folder_path && performer.name) {
        const beforePath = path.join(performer.folder_path, 'before filter performer', performer.name);
        const afterPath = path.join(performer.folder_path, 'after filter performer', performer.name);
        
        const beforeExists = await fs.pathExists(beforePath);
        const afterExists = await fs.pathExists(afterPath);
        
        // If moved_to_after is 1, prefer "after" location even if both folders exist
        if (performer.moved_to_after === 1 && afterExists) {
          location = 'after';
          folderExists = true;
          actualPath = afterPath;
        } else if (beforeExists) {
          location = 'before';
          folderExists = true;
          actualPath = beforePath;
        } else if (afterExists) {
          location = 'after';
          folderExists = true;
          actualPath = afterPath;
        } else {
          location = 'missing-or-empty';
        }
        
        // Override to missing-or-empty if empty
        if (isEmpty && folderExists) {
          location = 'missing-or-empty';
        }
      } else {
        location = 'missing-or-empty';
      }
      
      // Get hash database info
      const hashInfo = db.prepare(`
        SELECT 
          COUNT(*) as file_count,
          MAX(seen_at) as last_updated,
          SUM(CASE WHEN exact_hash IS NOT NULL THEN 1 ELSE 0 END) as exact_hash_count,
          SUM(CASE WHEN perceptual_hash IS NOT NULL THEN 1 ELSE 0 END) as perceptual_hash_count,
          SUM(CASE WHEN deleted_flag = 1 THEN 1 ELSE 0 END) as deleted_count
        FROM performer_file_hashes
        WHERE performer_id = ?
      `).get(performer.id);
      
      const hasHashDB = hashInfo && hashInfo.file_count > 0;
      
      // Check if scraped
      const hasScrapedData = !!(
        performer.scraped_at ||
        performer.age ||
        performer.born ||
        performer.height ||
        performer.ethnicity
      );
      
      // Get filter action stats
      const filterStats = db.prepare(`
        SELECT 
          COUNT(*) as total_actions,
          SUM(CASE WHEN action = 'keep' THEN 1 ELSE 0 END) as kept,
          SUM(CASE WHEN action = 'delete' THEN 1 ELSE 0 END) as deleted
        FROM filter_actions
        WHERE performer_id = ?
      `).get(performer.id);
      
      // Get tags count
      const tagCount = db.prepare(`
        SELECT COUNT(*) as count FROM tags WHERE performer_id = ?
      `).get(performer.id).count;
      
      // Parse aliases if they exist
      let aliases = [];
      if (performer.aliases) {
        try {
          aliases = JSON.parse(performer.aliases);
        } catch (e) {
          aliases = [];
        }
      }
      
      // Calculate filtering progress
      const picsProgress = performer.pics_count > 0 
        ? Math.round((performer.pics_filtered / performer.pics_count) * 100) 
        : 0;
      const vidsProgress = performer.vids_count > 0 
        ? Math.round((performer.vids_filtered / performer.vids_count) * 100) 
        : 0;
      const funscriptProgress = performer.funscript_vids_count > 0 
        ? Math.round((performer.funscript_vids_filtered / performer.funscript_vids_count) * 100) 
        : 0;
      
      return {
        ...performer,
        location,
        folderExists,
        actualPath,
        isEmpty,
        hasHashDB,
        hashStats: {
          fileCount: hashInfo?.file_count || 0,
          exactHashCount: hashInfo?.exact_hash_count || 0,
          perceptualHashCount: hashInfo?.perceptual_hash_count || 0,
          deletedCount: hashInfo?.deleted_count || 0,
          lastUpdated: hashInfo?.last_updated 
            ? new Date(hashInfo.last_updated * 1000).toISOString() 
            : null
        },
        hasScrapedData,
        scrapedAt: performer.scraped_at,
        filterStats: {
          totalActions: filterStats?.total_actions || 0,
          kept: filterStats?.kept || 0,
          deleted: filterStats?.deleted || 0
        },
        tagCount,
        aliases,
        filteringProgress: {
          pics: picsProgress,
          vids: vidsProgress,
          funscript: funscriptProgress,
          overall: Math.round((picsProgress + vidsProgress + funscriptProgress) / 3)
        },
        leakshavenUpdate: {
          lastCheckDate: performer.last_leakshaven_check_date,
          lastUpdateTime: performer.last_leakshaven_update_time,
          searchName: performer.leakshaven_search_name,
          acknowledged: performer.leakshaven_update_acknowledged === 1,
          error: performer.leakshaven_check_error
        }
      };
    }));
    
    // Find duplicates (same name/alias, different IDs)
    const duplicateGroups = {};
    enhancedPerformers.forEach(performer => {
      const normalizedKey = normalizeName(performer.name);
      if (!duplicateGroups[normalizedKey]) {
        duplicateGroups[normalizedKey] = [];
      }
      duplicateGroups[normalizedKey].push(performer);
    });
    
    // Mark duplicates
    enhancedPerformers.forEach(performer => {
      const normalizedKey = normalizeName(performer.name);
      const group = duplicateGroups[normalizedKey];
      performer.hasDuplicates = group.length > 1;
      performer.duplicateIds = group.filter(p => p.id !== performer.id).map(p => p.id);
    });
    
    // Group performers by location
    const grouped = {
      before: enhancedPerformers.filter(p => p.location === 'before'),
      after: enhancedPerformers.filter(p => p.location === 'after'),
      'missing-or-empty': enhancedPerformers.filter(p => p.location === 'missing-or-empty'),
      blacklisted: enhancedPerformers.filter(p => p.location === 'blacklisted')
    };
    
    res.send({
      success: true,
      performers: enhancedPerformers,
      grouped,
      summary: {
        total: enhancedPerformers.length,
        before: grouped.before.length,
        after: grouped.after.length,
        missingOrEmpty: grouped['missing-or-empty'].length,
        blacklisted: grouped.blacklisted.length,
        withHashDB: enhancedPerformers.filter(p => p.hasHashDB).length,
        scraped: enhancedPerformers.filter(p => p.hasScrapedData).length
      }
    });
  } catch (err) {
    console.error('Error getting performer management data:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/performer-management/:id/folder-only
 * Delete folder but keep all database records
 */
router.delete('/:id/folder-only', async (req, res) => {
  try {
    const { id } = req.params;
    
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    const deletedFolders = [];
    
    // Delete folders from filesystem
    if (performer.folder_path && performer.name) {
      const beforePath = path.join(performer.folder_path, 'before filter performer', performer.name);
      const afterPath = path.join(performer.folder_path, 'after filter performer', performer.name);
      const trashPath = path.join(performer.folder_path, 'trash', performer.name);
      
      if (await fs.pathExists(beforePath)) {
        try {
          await deleteFolderWithRetry(beforePath);
          deletedFolders.push(beforePath);
        } catch (err) {
          console.error('Error deleting before folder:', err);
          return res.status(500).send({ 
            error: `Failed to delete folder (file may be open in another program): ${err.message}`,
            path: beforePath 
          });
        }
      }
      
      if (await fs.pathExists(afterPath)) {
        try {
          await deleteFolderWithRetry(afterPath);
          deletedFolders.push(afterPath);
        } catch (err) {
          console.error('Error deleting after folder:', err);
          return res.status(500).send({ 
            error: `Failed to delete folder (file may be open in another program): ${err.message}`,
            path: afterPath 
          });
        }
      }
      
      if (await fs.pathExists(trashPath)) {
        try {
          // Handle trash folders
          const trashFolders = [
            { path: path.join(trashPath, 'pics', '.trash'), type: 'image' },
            { path: path.join(trashPath, 'vids', '.trash'), type: 'video' },
            { path: path.join(trashPath, 'vids', 'funscript', '.trash'), type: 'funscript' }
          ];
          
          for (const trashFolder of trashFolders) {
            await handleTrashFolder(trashFolder.path, performer.name, performer.folder_path, trashFolder.type);
          }
          
          // Remove parent trash folder if it still exists and is empty
          if (await fs.pathExists(trashPath)) {
            await deleteFolderWithRetry(trashPath);
          }
          deletedFolders.push(trashPath);
        } catch (err) {
          console.error('Error handling trash folder:', err);
          console.warn('Could not delete trash folder, continuing...');
        }
      }
    }
    
    // Clear thumbnail (no longer valid)
    db.prepare('UPDATE performers SET thumbnail = NULL WHERE id = ?').run(id);
    
    res.send({
      success: true,
      message: `Deleted folders for "${performer.name}", kept all database records`,
      deletedFolders
    });
  } catch (err) {
    console.error('Error deleting folder only:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/performer-management/:id/before-cleanup
 * Clean up before folder for performers in after (merge hash DBs)
 */
router.delete('/:id/before-cleanup', async (req, res) => {
  try {
    const { id } = req.params;
    
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    // Only allow for performers in "after" or with moved_to_after = 1
    if (performer.moved_to_after !== 1) {
      return res.status(400).send({ 
        error: 'This action is only for performers in "after filter performer" folder' 
      });
    }
    
    const deletedItems = [];
    
    // Delete before folder and trash with retry logic
    if (performer.folder_path && performer.name) {
      const beforePath = path.join(performer.folder_path, 'before filter performer', performer.name);
      const trashPath = path.join(performer.folder_path, 'trash', performer.name);
      
      if (await fs.pathExists(beforePath)) {
        try {
          await deleteFolderWithRetry(beforePath);
          deletedItems.push(beforePath);
        } catch (err) {
          console.error('Error deleting before folder:', err);
          return res.status(500).send({ 
            error: `Failed to delete folder (file may be open in another program): ${err.message}. Please close any programs accessing these files and try again.`,
            path: beforePath 
          });
        }
      }
      
      if (await fs.pathExists(trashPath)) {
        try {
          // Handle trash folders
          const trashFolders = [
            { path: path.join(trashPath, 'pics', '.trash'), type: 'image' },
            { path: path.join(trashPath, 'vids', '.trash'), type: 'video' },
            { path: path.join(trashPath, 'vids', 'funscript', '.trash'), type: 'funscript' }
          ];
          
          for (const trashFolder of trashFolders) {
            await handleTrashFolder(trashFolder.path, performer.name, performer.folder_path, trashFolder.type);
          }
          
          // Remove parent trash folder if it still exists
          if (await fs.pathExists(trashPath)) {
            await deleteFolderWithRetry(trashPath);
          }
          deletedItems.push(trashPath);
        } catch (err) {
          console.error('Error handling trash folder:', err);
          console.warn('Could not delete trash folder, continuing...');
        }
      }
    }
    
    // Update hash DB file paths (before → after) if any exist
    const hashCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM performer_file_hashes 
      WHERE performer_id = ? AND file_path LIKE '%before filter performer%'
    `).get(id);
    
    if (hashCount.count > 0) {
      db.prepare(`
        UPDATE performer_file_hashes 
        SET file_path = REPLACE(file_path, 'before filter performer', 'after filter performer')
        WHERE performer_id = ? AND file_path LIKE '%before filter performer%'
      `).run(id);
    }
    
    // Delete old filter actions and tags (from before state)
    const filterActionsDeleted = db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    const tagsDeleted = db.prepare('DELETE FROM tags WHERE performer_id = ?').run(id);
    
    res.send({
      success: true,
      message: `Cleaned up before folder for "${performer.name}"`,
      deletedFolders: deletedItems,
      hashPathsUpdated: hashCount.count,
      filterActionsDeleted: filterActionsDeleted.changes,
      tagsDeleted: tagsDeleted.changes
    });
  } catch (err) {
    console.error('Error cleaning up before folder:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/blacklist
 * Blacklist a performer (prevents re-import, keeps hash DB)
 */
router.post('/:id/blacklist', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    const deletedFolders = [];
    
    // Delete folders with retry logic
    if (performer.folder_path && performer.name) {
      const beforePath = path.join(performer.folder_path, 'before filter performer', performer.name);
      const afterPath = path.join(performer.folder_path, 'after filter performer', performer.name);
      const trashPath = path.join(performer.folder_path, 'trash', performer.name);
      
      if (await fs.pathExists(beforePath)) {
        try {
          await deleteFolderWithRetry(beforePath);
          deletedFolders.push(beforePath);
        } catch (err) {
          console.error('Error deleting before folder:', err);
          return res.status(500).send({ 
            error: `Failed to delete folder (file may be open in another program): ${err.message}. Please close any programs accessing these files and try again.`,
            path: beforePath 
          });
        }
      }
      
      if (await fs.pathExists(afterPath)) {
        try {
          await deleteFolderWithRetry(afterPath);
          deletedFolders.push(afterPath);
        } catch (err) {
          console.error('Error deleting after folder:', err);
          return res.status(500).send({ 
            error: `Failed to delete folder (file may be open in another program): ${err.message}. Please close any programs accessing these files and try again.`,
            path: afterPath 
          });
        }
      }
      
      if (await fs.pathExists(trashPath)) {
        try {
          // Handle trash folders
          const trashFolders = [
            { path: path.join(trashPath, 'pics', '.trash'), type: 'image' },
            { path: path.join(trashPath, 'vids', '.trash'), type: 'video' },
            { path: path.join(trashPath, 'vids', 'funscript', '.trash'), type: 'funscript' }
          ];
          
          for (const trashFolder of trashFolders) {
            await handleTrashFolder(trashFolder.path, performer.name, performer.folder_path, trashFolder.type);
          }
          
          // Remove parent trash folder if it still exists
          if (await fs.pathExists(trashPath)) {
            await deleteFolderWithRetry(trashPath);
          }
          deletedFolders.push(trashPath);
        } catch (err) {
          console.error('Error handling trash folder:', err);
          console.warn('Could not delete trash folder, continuing...');
        }
      }
    }
    
    // Delete filter actions, tags, thumbnail
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE performer_id = ?').run(id);
    
    // Mark as blacklisted (keep performer record, hash DB, scraped data, name, aliases)
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE performers 
      SET blacklisted = 1,
          blacklist_reason = ?,
          blacklist_date = ?,
          thumbnail = NULL,
          moved_to_after = 0,
          pics_count = 0,
          vids_count = 0,
          funscript_vids_count = 0,
          funscript_files_count = 0,
          total_size_gb = 0
      WHERE id = ?
    `).run(reason || null, now, id);
    
    res.send({
      success: true,
      message: `Blacklisted "${performer.name}"`,
      reason: reason || null,
      deletedFolders,
      keptData: ['name', 'aliases', 'hash_db', 'scraped_data']
    });
  } catch (err) {
    console.error('Error blacklisting performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/unblacklist
 * Remove blacklist status
 */
router.post('/:id/unblacklist', async (req, res) => {
  try {
    const { id } = req.params;
    
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    if (performer.blacklisted !== 1) {
      return res.status(400).send({ error: 'Performer is not blacklisted' });
    }
    
    // Remove blacklist
    db.prepare(`
      UPDATE performers 
      SET blacklisted = 0,
          blacklist_reason = NULL,
          blacklist_date = NULL
      WHERE id = ?
    `).run(id);
    
    res.send({
      success: true,
      message: `Removed blacklist for "${performer.name}"`
    });
  } catch (err) {
    console.error('Error unblacklisting performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/performer-management/:id/complete
 * Completely delete a performer - all files and all database records
 */
router.delete('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    const deletedItems = {
      folders: [],
      databaseRecords: {
        filterActions: 0,
        tags: 0,
        fileHashes: 0,
        hashRuns: 0,
        performer: 0
      }
    };
    
    // Delete folders from filesystem
    if (performer.folder_path && performer.name) {
      const beforePath = path.join(performer.folder_path, 'before filter performer', performer.name);
      const afterPath = path.join(performer.folder_path, 'after filter performer', performer.name);
      const trashPath = path.join(performer.folder_path, 'trash', performer.name);
      
      if (await fs.pathExists(beforePath)) {
        try {
          await deleteFolderWithRetry(beforePath);
          deletedItems.folders.push(beforePath);
        } catch (err) {
          console.error('Error deleting performer folder:', err);
          return res.status(500).send({ 
            error: `Failed to delete folder (file may be open in another program): ${err.message}. Please close any programs accessing these files and try again.`,
            path: beforePath 
          });
        }
      }
      
      if (await fs.pathExists(afterPath)) {
        try {
          await deleteFolderWithRetry(afterPath);
          deletedItems.folders.push(afterPath);
        } catch (err) {
          console.error('Error deleting performer folder:', err);
          return res.status(500).send({ 
            error: `Failed to delete folder (file may be open in another program): ${err.message}. Please close any programs accessing these files and try again.`,
            path: afterPath 
          });
        }
      }
      
      if (await fs.pathExists(trashPath)) {
        try {
          // Handle trash folders
          const trashFolders = [
            { path: path.join(trashPath, 'pics', '.trash'), type: 'image' },
            { path: path.join(trashPath, 'vids', '.trash'), type: 'video' },
            { path: path.join(trashPath, 'vids', 'funscript', '.trash'), type: 'funscript' }
          ];
          
          for (const trashFolder of trashFolders) {
            await handleTrashFolder(trashFolder.path, performer.name, performer.folder_path, trashFolder.type);
          }
          
          // Remove parent trash folder if it still exists
          if (await fs.pathExists(trashPath)) {
            await deleteFolderWithRetry(trashPath);
          }
          deletedItems.folders.push(trashPath);
        } catch (err) {
          console.error('Error handling trash folder:', err);
          console.warn('Could not delete trash folder, continuing...');
        }
      }
    }
    
    // Delete all database records in correct order (respecting foreign keys)
    
    // 1. Delete hash_run_items that reference this performer's file hashes
    const hashRunItemsResult = db.prepare(`
      DELETE FROM hash_run_items 
      WHERE file_id_ref IN (SELECT id FROM performer_file_hashes WHERE performer_id = ?)
         OR candidate_id IN (SELECT id FROM performer_file_hashes WHERE performer_id = ?)
    `).run(id, id);
    deletedItems.databaseRecords.hashRunItems = hashRunItemsResult.changes;
    
    // 2. Delete filter actions
    const filterActionsResult = db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    deletedItems.databaseRecords.filterActions = filterActionsResult.changes;
    
    // 3. Delete tags
    const tagsResult = db.prepare('DELETE FROM tags WHERE performer_id = ?').run(id);
    deletedItems.databaseRecords.tags = tagsResult.changes;
    
    // 4. Delete file hashes
    const hashesResult = db.prepare('DELETE FROM performer_file_hashes WHERE performer_id = ?').run(id);
    deletedItems.databaseRecords.fileHashes = hashesResult.changes;
    
    // 5. Delete hash runs
    const hashRunsResult = db.prepare(
      'DELETE FROM hash_runs WHERE source_performer_id = ? OR target_performer_id = ?'
    ).run(id, id);
    deletedItems.databaseRecords.hashRuns = hashRunsResult.changes;
    
    // 6. Finally delete the performer
    const performerResult = db.prepare('DELETE FROM performers WHERE id = ?').run(id);
    deletedItems.databaseRecords.performer = performerResult.changes;
    
    res.send({
      success: true,
      message: `Performer "${performer.name}" completely deleted`,
      performerName: performer.name,
      deletedItems
    });
  } catch (err) {
    console.error('Error deleting performer completely:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/rescan
 * Rescan a performer folder and update stats
 */
router.post('/:id/rescan', async (req, res) => {
  try {
    const { id } = req.params;
    
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    // Determine performer path
    let performerPath = null;
    if (performer.folder_path && performer.name) {
      const beforePath = path.join(performer.folder_path, 'before filter performer', performer.name);
      const afterPath = path.join(performer.folder_path, 'after filter performer', performer.name);
      
      if (await fs.pathExists(beforePath)) {
        performerPath = beforePath;
      } else if (await fs.pathExists(afterPath)) {
        performerPath = afterPath;
      }
    }
    
    if (!performerPath) {
      return res.status(404).send({ error: 'Performer folder not found' });
    }
    
    // Scan the folder
    const { scanPerformerFolderEnhanced } = require('../services/importer');
    const stats = await scanPerformerFolderEnhanced(performerPath);
    
    // Update database
    const now = new Date().toISOString();
    const picsPath = path.join(performerPath, 'pics');
    const vidsPath = path.join(performerPath, 'vids');
    const funscriptPath = path.join(vidsPath, 'funscript');
    
    db.prepare(`
      UPDATE performers 
      SET pics_count = ?, 
          vids_count = ?, 
          funscript_vids_count = ?, 
          funscript_files_count = ?, 
          total_size_gb = ?,
          pics_original_count = ?, 
          vids_original_count = ?, 
          funscript_vids_original_count = ?,
          last_scan_date = ?, 
          cached_pics_path = ?, 
          cached_vids_path = ?, 
          cached_funscript_path = ?
      WHERE id = ?
    `).run(
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      stats.funscript_files_count,
      stats.total_size_gb,
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      now,
      picsPath,
      vidsPath,
      funscriptPath,
      id
    );
    
    res.send({
      success: true,
      message: 'Performer rescanned',
      stats
    });
  } catch (err) {
    console.error('Error rescanning performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/check-updates
 * Check all scraped performers for new content on leakshaven
 */
router.post('/check-updates', async (req, res) => {
  try {
    const { performerIds } = req.body; // Optional: check specific performers, otherwise check all
    
    // Get performers to check (either specific IDs or all with scraped data and not blacklisted)
    let performers;
    if (performerIds && performerIds.length > 0) {
      const placeholders = performerIds.map(() => '?').join(',');
      performers = db.prepare(`
        SELECT id, name, aliases 
        FROM performers 
        WHERE id IN (${placeholders}) AND blacklisted = 0 AND moved_to_after = 1
      `).all(...performerIds);
    } else {
      // Check all performers that are in "after" folder (moved_to_after = 1) with aliases or scraped data
      performers = db.prepare(`
        SELECT id, name, aliases 
        FROM performers 
        WHERE blacklisted = 0 
          AND moved_to_after = 1
          AND (aliases IS NOT NULL OR scraped_at IS NOT NULL)
      `).all();
    }
    
    console.log(`Checking ${performers.length} performers for updates...`);
    
    const results = {
      total: performers.length,
      checked: 0,
      updated: 0,
      errors: 0,
      newUpdates: 0,
      results: []
    };
    
    const { checkLeakshavenUpdates } = require('../services/scraperService');
    
    // Check each performer
    for (const performer of performers) {
      const checkDate = new Date().toISOString();
      
      try {
        // Parse aliases
        let aliases = [];
        if (performer.aliases) {
          try {
            aliases = JSON.parse(performer.aliases);
          } catch (e) {
            aliases = [];
          }
        }
        
        // Use saved working alias if available (from previous scrape)
        const workingAlias = performer.leakshaven_alias || null;
        
        // Check for updates
        const updateInfo = await checkLeakshavenUpdates(performer.name, aliases, workingAlias);
        
        // Get previous update time to detect changes
        const previousData = db.prepare(`
          SELECT last_leakshaven_update_time, last_leakshaven_check_date, leakshaven_update_acknowledged 
          FROM performers 
          WHERE id = ?
        `).get(performer.id);
        
        // Calculate actual upload timestamps to properly detect new content
        const currentUploadTimestamp = calculateUploadTimestamp(checkDate, updateInfo.lastUpdateTime);
        let previousUploadTimestamp = null;
        
        if (previousData?.last_leakshaven_update_time && previousData?.last_leakshaven_check_date) {
          previousUploadTimestamp = calculateUploadTimestamp(
            previousData.last_leakshaven_check_date, 
            previousData.last_leakshaven_update_time
          );
        }
        
        // New update = current upload is NEWER (later timestamp) than previous
        const hasNewUpdate = previousUploadTimestamp === null || currentUploadTimestamp > previousUploadTimestamp;
        
        // Update database
        db.prepare(`
          UPDATE performers 
          SET last_leakshaven_check_date = ?,
              last_leakshaven_update_time = ?,
              leakshaven_search_name = ?,
              leakshaven_update_acknowledged = ?,
              leakshaven_check_error = NULL
          WHERE id = ?
        `).run(
          checkDate,
          updateInfo.lastUpdateTime,
          updateInfo.searchName,
          hasNewUpdate ? 0 : (previousData?.leakshaven_update_acknowledged || 0), // Reset acknowledged if new
          performer.id
        );
        
        results.checked++;
        if (updateInfo.lastUpdateTime) {
          results.updated++;
          if (hasNewUpdate && previousData?.last_leakshaven_update_time) {
            results.newUpdates++;
          }
        }
        
        results.results.push({
          id: performer.id,
          name: performer.name,
          success: true,
          updateTime: updateInfo.lastUpdateTime,
          searchName: updateInfo.searchName,
          isNew: hasNewUpdate && previousData?.last_leakshaven_update_time !== null
        });
        
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Error checking ${performer.name}:`, error.message);
        
        // Store error in database
        db.prepare(`
          UPDATE performers 
          SET last_leakshaven_check_date = ?,
              leakshaven_check_error = ?
          WHERE id = ?
        `).run(checkDate, error.message, performer.id);
        
        results.checked++;
        results.errors++;
        
        results.results.push({
          id: performer.id,
          name: performer.name,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log('Check updates complete:', results);
    
    res.send({
      success: true,
      message: `Checked ${results.checked} performers, found ${results.newUpdates} new updates`,
      summary: {
        total: results.total,
        checked: results.checked,
        updated: results.updated,
        newUpdates: results.newUpdates,
        errors: results.errors
      },
      results: results.results
    });
  } catch (err) {
    console.error('Error checking for updates:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/acknowledge-update
 * Mark a performer's leakshaven update as seen/acknowledged
 */
router.post('/:id/acknowledge-update', async (req, res) => {
  try {
    const { id } = req.params;
    
    const performer = db.prepare('SELECT name FROM performers WHERE id = ?').get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    db.prepare(`
      UPDATE performers 
      SET leakshaven_update_acknowledged = 1
      WHERE id = ?
    `).run(id);
    
    res.send({
      success: true,
      message: `Acknowledged update for "${performer.name}"`
    });
  } catch (err) {
    console.error('Error acknowledging update:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/rename
 * Rename a performer and optionally rename their folder
 */
router.post('/:id/rename', async (req, res) => {
  try {
    const { id } = req.params;
    const { newName, renameFolder } = req.body;
    
    if (!newName || !newName.trim()) {
      return res.status(400).send({ error: 'New name is required' });
    }
    
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);
    
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    
    const oldName = performer.name;
    const trimmedNewName = newName.trim();
    
    // Check if name already exists
    const existing = db.prepare('SELECT id FROM performers WHERE name = ? AND id != ?').get(trimmedNewName, id);
    if (existing) {
      return res.status(400).send({ error: `Performer with name "${trimmedNewName}" already exists` });
    }
    
    const renamedFolders = [];
    
    // Rename folders if requested
    if (renameFolder && performer.folder_path && oldName) {
      const fs = require('fs-extra');
      const path = require('path');
      
      const beforeOldPath = path.join(performer.folder_path, 'before filter performer', oldName);
      const beforeNewPath = path.join(performer.folder_path, 'before filter performer', trimmedNewName);
      const afterOldPath = path.join(performer.folder_path, 'after filter performer', oldName);
      const afterNewPath = path.join(performer.folder_path, 'after filter performer', trimmedNewName);
      const trashOldPath = path.join(performer.folder_path, 'trash', oldName);
      const trashNewPath = path.join(performer.folder_path, 'trash', trimmedNewName);
      
      // Rename before folder
      if (await fs.pathExists(beforeOldPath)) {
        await fs.move(beforeOldPath, beforeNewPath);
        renamedFolders.push({ from: beforeOldPath, to: beforeNewPath });
      }
      
      // Rename after folder
      if (await fs.pathExists(afterOldPath)) {
        await fs.move(afterOldPath, afterNewPath);
        renamedFolders.push({ from: afterOldPath, to: afterNewPath });
      }
      
      // Rename trash folder
      if (await fs.pathExists(trashOldPath)) {
        await fs.move(trashOldPath, trashNewPath);
        renamedFolders.push({ from: trashOldPath, to: trashNewPath });
      }
      
      // Update cached paths in database
      if (performer.cached_pics_path) {
        const newPicsPath = performer.cached_pics_path.replace(oldName, trimmedNewName);
        db.prepare('UPDATE performers SET cached_pics_path = ? WHERE id = ?').run(newPicsPath, id);
      }
      if (performer.cached_vids_path) {
        const newVidsPath = performer.cached_vids_path.replace(oldName, trimmedNewName);
        db.prepare('UPDATE performers SET cached_vids_path = ? WHERE id = ?').run(newVidsPath, id);
      }
      if (performer.cached_funscript_path) {
        const newFunscriptPath = performer.cached_funscript_path.replace(oldName, trimmedNewName);
        db.prepare('UPDATE performers SET cached_funscript_path = ? WHERE id = ?').run(newFunscriptPath, id);
      }
      
      // Update thumbnail path if it contains the old name
      if (performer.thumbnail && performer.thumbnail.includes(oldName)) {
        const newThumbnail = performer.thumbnail.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), trimmedNewName);
        db.prepare('UPDATE performers SET thumbnail = ? WHERE id = ?').run(newThumbnail, id);
      }
      
      // Update thumbnail_paths if it contains the old name
      if (performer.thumbnail_paths) {
        try {
          const thumbnailPaths = JSON.parse(performer.thumbnail_paths);
          const updatedPaths = thumbnailPaths.map(path => 
            path.includes(oldName) ? path.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), trimmedNewName) : path
          );
          db.prepare('UPDATE performers SET thumbnail_paths = ? WHERE id = ?').run(JSON.stringify(updatedPaths), id);
        } catch (e) {
          console.error('Error updating thumbnail_paths:', e);
        }
      }
      
      // Update file_path in filter_actions table
      const filterActions = db.prepare('SELECT id, file_path FROM filter_actions WHERE performer_id = ?').all(id);
      for (const action of filterActions) {
        if (action.file_path && action.file_path.includes(oldName)) {
          const newFilePath = action.file_path.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), trimmedNewName);
          db.prepare('UPDATE filter_actions SET file_path = ? WHERE id = ?').run(newFilePath, action.id);
        }
      }
      
      // Update file_path in performer_file_hashes table
      const fileHashes = db.prepare('SELECT id, file_path FROM performer_file_hashes WHERE performer_id = ?').all(id);
      for (const hash of fileHashes) {
        if (hash.file_path && hash.file_path.includes(oldName)) {
          const newFilePath = hash.file_path.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), trimmedNewName);
          db.prepare('UPDATE performer_file_hashes SET file_path = ? WHERE id = ?').run(newFilePath, hash.id);
        }
      }
    }
    
    // Update performer name in database
    db.prepare('UPDATE performers SET name = ? WHERE id = ?').run(trimmedNewName, id);
    
    res.send({
      success: true,
      message: `Renamed performer from "${oldName}" to "${trimmedNewName}"`,
      oldName,
      newName: trimmedNewName,
      renamedFolders
    });
  } catch (err) {
    console.error('Error renaming performer:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
