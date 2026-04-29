const fs = require('fs-extra');
const path = require('path');
const db = require('../db');

// ... (rest of imports)

// ...

/**
 * Permanently delete a file using fs-extra (handles some retries/locks better)
 */
async function permanentDelete(filePath) {
  try {
    // fs-extra's remove is like rm -rf, and doesn't throw if file is missing
    await fs.remove(filePath);
    console.log(`Permanently deleted: ${filePath}`);

    return {
      success: true,
      deletedPath: filePath,
    };
  } catch (error) {
    if (error.code === 'EBUSY') {
      // If fs-extra failed, try one more time with a small delay
      console.warn(`File busy (fs-extra failed), retrying once: ${filePath}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        await fs.remove(filePath);
        return { success: true, deletedPath: filePath };
      } catch (retryErr) {
        console.warn(`File is still busy/locked: ${filePath}`);
        return {
          success: true, // Still success to clear DB
          deletedPath: filePath,
          busy: true,
          warning: 'File was busy/locked'
        };
      }
    }

    console.error('Error permanently deleting file:', error);
    throw error;
  }
}

// Configuration
const CONFIG = {
  quarantinePath: null, // Will be set from app settings
  retentionDays: 30, // Keep quarantined files for 30 days
};

/**
 * Initialize quarantine path from settings
 */
function initQuarantinePath() {
  const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('quarantine_path');
  if (setting) {
    CONFIG.quarantinePath = setting.value;
  } else {
    // Default to a quarantine folder in the app directory
    CONFIG.quarantinePath = path.join(process.cwd(), 'quarantine');
  }
}

/**
 * Get or create quarantine path
 */
async function ensureQuarantinePath() {
  if (!CONFIG.quarantinePath) {
    initQuarantinePath();
  }

  try {
    await fs.mkdir(CONFIG.quarantinePath, { recursive: true });
    return CONFIG.quarantinePath;
  } catch (error) {
    console.error('Error creating quarantine directory:', error);
    throw new Error('Failed to create quarantine directory');
  }
}

/**
 * Move file to quarantine
 * Creates a timestamped subdirectory to organize quarantined files
 */
async function moveToQuarantine(filePath, metadata = {}) {
  try {
    const quarantinePath = await ensureQuarantinePath();

    // Create timestamped subdirectory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantineSubdir = path.join(quarantinePath, timestamp);
    await fs.mkdir(quarantineSubdir, { recursive: true });

    // Preserve directory structure within quarantine
    const fileName = path.basename(filePath);
    const relativePath = metadata.relativePath || fileName;
    const quarantineFilePath = path.join(quarantineSubdir, relativePath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(quarantineFilePath), { recursive: true });

    // Move the file
    await fs.rename(filePath, quarantineFilePath);

    // Store metadata for potential restoration
    const metadataPath = quarantineFilePath + '.metadata.json';
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        originalPath: filePath,
        quarantinedAt: Date.now(),
        ...metadata,
      }, null, 2)
    );

    console.log(`Moved to quarantine: ${filePath} -> ${quarantineFilePath}`);

    return {
      success: true,
      quarantinePath: quarantineFilePath,
      metadataPath,
    };
  } catch (error) {
    console.error('Error moving to quarantine:', error);
    throw error;
  }
}

/**
 * Restore file from quarantine
 */
async function restoreFromQuarantine(quarantineFilePath) {
  try {
    const metadataPath = quarantineFilePath + '.metadata.json';
    const metadataContent = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);

    const originalPath = metadata.originalPath;

    // Ensure original directory exists
    await fs.mkdir(path.dirname(originalPath), { recursive: true });

    // Check if original file already exists
    try {
      await fs.access(originalPath);
      throw new Error('Original file path already exists. Cannot restore.');
    } catch (err) {
      // File doesn't exist, good to restore
    }

    // Restore the file
    await fs.rename(quarantineFilePath, originalPath);

    // Remove metadata file
    await fs.unlink(metadataPath).catch(() => { });

    console.log(`Restored from quarantine: ${quarantineFilePath} -> ${originalPath}`);

    return {
      success: true,
      restoredPath: originalPath,
    };
  } catch (error) {
    console.error('Error restoring from quarantine:', error);
    throw error;
  }
}

/**
 * Permanently delete a file with retry logic for Windows EBUSY/locked files
 */
async function permanentDelete(filePath, maxRetries = 5) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await fs.remove(filePath);
      console.log(`Permanently deleted: ${filePath}`);
      return {
        success: true,
        deletedPath: filePath,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`File already deleted (not found): ${filePath}`);
        return {
          success: true,
          deletedPath: filePath,
          alreadyDeleted: true,
        };
      }

      // If file is busy/locked and we have retries left, wait and retry
      if (error.code === 'EBUSY' && i < maxRetries) {
        const delay = (i + 1) * 200;
        console.warn(`File busy (${filePath}), retrying detection in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // If EBUSY persists, try moving to .trash (fallback method from filterService)
      if (error.code === 'EBUSY') {
        console.warn(`File is still busy/locked after ${maxRetries} retries: ${filePath}. Trying move to .trash...`);
        try {
          const trashPath = path.join(path.dirname(filePath), '.trash', path.basename(filePath));
          await fs.ensureDir(path.dirname(trashPath));
          // Use overwrite: true in case trash already has it
          await fs.move(filePath, trashPath, { overwrite: true });
          console.log(`Moved locked file to trash: ${trashPath}`);
          return {
            success: true,
            deletedPath: filePath,
            movedToTrash: true
          };
        } catch (moveError) {
          console.error('Failed to move locked file to trash:', moveError.message);
          return {
            success: true, // Still success to clear DB (user can manually delete)
            deletedPath: filePath,
            busy: true,
            warning: 'File was busy/locked - failed to delete and failed to move to trash'
          };
        }
      }

      console.error('Error permanently deleting file:', error);
      throw error;
    }
  }
}

/**
 * Process batch commit action
 */
async function commitBatchAction(runId, action, selectedItems) {
  const results = {
    success: [],
    failed: [],
  };

  try {
    // Get run details and items
    const run = db.prepare('SELECT * FROM hash_runs WHERE run_id = ?').get(runId);
    if (!run) {
      throw new Error('Run not found');
    }

    const items = db.prepare(`
      SELECT ri.*, sf.file_path 
      FROM hash_run_items ri
      JOIN performer_file_hashes sf ON ri.file_id_ref = sf.id
      WHERE ri.run_id = ? AND ri.id IN (${selectedItems.map(() => '?').join(',')})
    `).all(runId, ...selectedItems);

    // Process each item
    for (const item of items) {
      try {
        if (action === 'quarantine') {
          const result = await moveToQuarantine(item.file_path, {
            runId,
            itemId: item.id,
            performerId: run.source_performer_id,
            matchType: item.exact_match ? 'exact' : 'perceptual',
            hammingDistance: item.hamming_distance,
          });

          // Clean up ALL references in run items (both as source and candidate)
          db.prepare(`
            DELETE FROM hash_run_items 
            WHERE file_id_ref = ? OR candidate_id = ?
          `).run(item.file_id_ref, item.file_id_ref);

          // DELETE the hash record completely (the kept duplicate's hash covers re-upload detection)
          db.prepare(`
            DELETE FROM performer_file_hashes 
            WHERE id = ?
          `).run(item.file_id_ref);

          results.success.push({
            itemId: item.id,
            filePath: item.file_path,
            quarantinePath: result.quarantinePath,
          });
        } else if (action === 'delete') {
          await permanentDelete(item.file_path);

          // Clean up ALL references in run items (both as source and candidate)
          db.prepare(`
            DELETE FROM hash_run_items 
            WHERE file_id_ref = ? OR candidate_id = ?
          `).run(item.file_id_ref, item.file_id_ref);

          // DELETE the hash record completely (the kept duplicate's hash covers re-upload detection)
          db.prepare(`
            DELETE FROM performer_file_hashes 
            WHERE id = ?
          `).run(item.file_id_ref);

          results.success.push({
            itemId: item.id,
            filePath: item.file_path,
            deleted: true,
          });
        }
      } catch (error) {
        results.failed.push({
          itemId: item.id,
          filePath: item.file_path,
          error: error.message,
        });
      }
    }

    // Recalculate internal_duplicate_count based on remaining run items
    if (run.source_performer_id && results.success.length > 0) {
      const performerId = run.source_performer_id;

      // Count remaining matches across all internal runs for this performer
      const remaining = db.prepare(`
        SELECT COUNT(*) as count FROM hash_run_items hri
        JOIN hash_runs hr ON hri.run_id = hr.run_id
        WHERE hr.source_performer_id = ? 
          AND hr.target_performer_id = ?
          AND (hri.exact_match = 1 OR hri.hamming_distance <= 6)
      `).get(performerId, performerId);

      const newCount = remaining ? remaining.count : 0;

      db.prepare(`
        UPDATE performers 
        SET internal_duplicate_count = ?
        WHERE id = ?
      `).run(newCount, performerId);

      console.log(`Updated internal_duplicate_count for performer ${performerId}: ${newCount}`);

      // Decrement current file counts for each deleted/quarantined file
      // so filter percentages update immediately
      let picsDeleted = 0, vidsDeleted = 0, funscriptVidsDeleted = 0;
      for (const s of results.success) {
        const ext = path.extname(s.filePath).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          picsDeleted++;
        } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
          if (s.filePath.includes(path.join('vids', 'funscript'))) {
            funscriptVidsDeleted++;
          } else {
            vidsDeleted++;
          }
        }
      }

      if (picsDeleted > 0 || vidsDeleted > 0 || funscriptVidsDeleted > 0) {
        db.prepare(`
          UPDATE performers 
          SET pics_count = MAX(0, pics_count - ?),
              vids_count = MAX(0, vids_count - ?),
              funscript_vids_count = MAX(0, funscript_vids_count - ?)
          WHERE id = ?
        `).run(picsDeleted, vidsDeleted, funscriptVidsDeleted, performerId);

        console.log(`Updated file counts for performer ${performerId}: pics -${picsDeleted}, vids -${vidsDeleted}, funscript -${funscriptVidsDeleted}`);
      }
    }

    // Update run metadata with action taken
    const metadata = JSON.parse(run.metadata || '{}');
    metadata.actions = metadata.actions || [];
    metadata.actions.push({
      action,
      timestamp: Date.now(),
      itemCount: selectedItems.length,
      successCount: results.success.length,
      failedCount: results.failed.length,
    });

    db.prepare(`
      UPDATE hash_runs 
      SET metadata = ? 
      WHERE run_id = ?
    `).run(JSON.stringify(metadata), runId);

    return {
      success: true,
      results,
      updatedDuplicateCount: run.source_performer_id ? true : false,
    };
  } catch (error) {
    console.error('Error committing batch action:', error);
    throw error;
  }
}

/**
 * Clean up old quarantined files based on retention policy
 */
async function cleanupOldQuarantineFiles() {
  try {
    const quarantinePath = await ensureQuarantinePath();
    const entries = await fs.readdir(quarantinePath, { withFileTypes: true });

    const now = Date.now();
    const retentionMs = CONFIG.retentionDays * 24 * 60 * 60 * 1000;

    let deletedCount = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(quarantinePath, entry.name);
        const stats = await fs.stat(dirPath);

        // Check if directory is older than retention period
        if (now - stats.mtimeMs > retentionMs) {
          // Delete entire directory
          await fs.rm(dirPath, { recursive: true, force: true });
          deletedCount++;
          console.log(`Deleted old quarantine directory: ${dirPath}`);
        }
      }
    }

    return {
      success: true,
      deletedCount,
    };
  } catch (error) {
    console.error('Error cleaning up quarantine:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * List quarantined files
 */
async function listQuarantinedFiles() {
  try {
    const quarantinePath = await ensureQuarantinePath();
    const entries = await fs.readdir(quarantinePath, { withFileTypes: true });

    const quarantinedFiles = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(quarantinePath, entry.name);

        // Recursively find all files in this quarantine batch
        async function scanDir(dir, baseDir) {
          const items = await fs.readdir(dir, { withFileTypes: true });

          for (const item of items) {
            const fullPath = path.join(dir, item.name);

            if (item.isDirectory()) {
              await scanDir(fullPath, baseDir);
            } else if (!item.name.endsWith('.metadata.json')) {
              // Try to read metadata
              const metadataPath = fullPath + '.metadata.json';
              let metadata = null;

              try {
                const metadataContent = await fs.readFile(metadataPath, 'utf8');
                metadata = JSON.parse(metadataContent);
              } catch (err) {
                // No metadata available
              }

              const stats = await fs.stat(fullPath);

              quarantinedFiles.push({
                quarantinePath: fullPath,
                originalPath: metadata?.originalPath || 'Unknown',
                quarantinedAt: metadata?.quarantinedAt || stats.mtimeMs,
                size: stats.size,
                canRestore: metadata !== null,
                metadata,
              });
            }
          }
        }

        await scanDir(dirPath, dirPath);
      }
    }

    return {
      success: true,
      files: quarantinedFiles,
    };
  } catch (error) {
    console.error('Error listing quarantined files:', error);
    return {
      success: false,
      error: error.message,
      files: [],
    };
  }
}

// Initialize on module load
initQuarantinePath();

module.exports = {
  moveToQuarantine,
  restoreFromQuarantine,
  permanentDelete,
  commitBatchAction,
  cleanupOldQuarantineFiles,
  listQuarantinedFiles,
  CONFIG,
};
