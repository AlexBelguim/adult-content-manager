const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { scanPerformerFolderEnhanced } = require('./importer');

class FilterService {
  constructor() {
    this.filterHistory = [];
    this.currentIndex = -1;
    this.fileCache = new Map(); // Cache: key = "performerId_type_sortBy_sortOrder_hideKept", value = { files, timestamp }
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.refreshTimeouts = new Map(); // Map to store debounce timeouts for stats refresh
    this.statsCache = new Map(); // Cache for getFilterStats - key = performerId, value = { stats, timestamp }
    this.statsCacheTimeout = 60 * 1000; // 1 minute cache for stats
  }

  async getFilterableFiles(performerId, type = 'all', sortBy = 'name', sortOrder = 'asc', hideKept = false, limit = undefined, offset = 0) {
    const cacheKey = `${performerId}_${type}_${sortBy}_${sortOrder}_${hideKept}`;
    const now = Date.now();

    // Check cache first
    const cached = this.fileCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      console.log(`Using cached file list for ${cacheKey} (${cached.files.length} files)`);

      // Apply pagination to cached results
      const totalCount = cached.files.length;
      if (limit !== undefined) {
        const start = offset || 0;
        const end = start + limit;
        const files = cached.files.slice(start, end);
        console.log(`Returning paginated cached results: ${files.length} files (${start}-${end} of ${totalCount})`);
        return {
          files,
          total: totalCount,
          limit,
          offset: start,
          hasMore: end < totalCount
        };
      }
      return cached.files;
    }

    // Cache miss - scan filesystem
    console.log(`Cache miss for ${cacheKey} - scanning filesystem`);

    // Fetch performer data
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      throw new Error(`Performer not found: ${performerId}`);
    }

    // NEW: Batched Metadata Fetching & DB Cache

    // 1. Fetch File Lists
    let files = [];

    const fetchType = async (fileType, folderName) => {
      // Check DB Cache first
      const cached = db.prepare('SELECT data FROM performer_file_cache WHERE performer_id = ? AND type = ?').get(performerId, fileType);
      if (cached) {
        console.log(`Using cached ${fileType} list from DB`);
        try {
          const items = JSON.parse(cached.data);
          // Ensure items have 'type' property
          return items.map(i => ({ ...i, type: fileType === 'pics' ? 'image' : 'video' }));
        } catch (e) { console.error('Error parsing cached data', e); }
      }

      // Fallback to FS scan
      const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(performer.folder_id);
      let performerPath;
      if (performer.moved_to_after === 1) {
        performerPath = path.join(folder.path, 'after filter performer', performer.name);
      } else {
        performerPath = path.join(folder.path, 'before filter performer', performer.name);
      }

      const dirPath = path.join(performerPath, folderName);
      if (await fs.pathExists(dirPath)) {
        return await this.getFilesFromDirectory(dirPath, fileType === 'pics' ? 'image' : 'video');
      }
      return [];
    };

    if (type === 'all' || type === 'pics') {
      files = files.concat(await fetchType('pics', 'pics'));
    }

    if (type === 'all' || type === 'vids') {
      files = files.concat(await fetchType('vids', 'vids'));
    }

    if (type === 'all' || type === 'funscript_vids') {
      // Funscripts are special, stick to existing logic for now but manual path construction
      const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(performer.folder_id);
      let performerPath = performer.moved_to_after === 1 ?
        path.join(folder.path, 'after filter performer', performer.name) :
        path.join(folder.path, 'before filter performer', performer.name);

      const possibleFunscriptPaths = [
        path.join(performerPath, 'vids', 'funscript'),
        path.join(performerPath, 'vids', 'Funscript')
      ];
      for (const funscriptPath of possibleFunscriptPaths) {
        if (await fs.pathExists(funscriptPath)) {
          files = files.concat(await this.getFunscriptVideos(funscriptPath));
          break;
        }
      }
    }

    // 2. Fetch Metadata in Batch (Optimization)
    // Fetch all filter actions for this performer
    const actions = db.prepare('SELECT file_path, action FROM filter_actions WHERE performer_id = ?').all(performerId);
    const actionMap = new Map(actions.map(a => [a.file_path, a.action]));

    // Fetch all hashes for this performer
    const hashes = db.prepare('SELECT file_path, id FROM performer_file_hashes WHERE performer_id = ?').all(performerId);
    const hashMap = new Map(hashes.map(h => [h.file_path, h.id]));

    // 3. Merge Metadata
    files.forEach(f => {
      f.filtered = actionMap.get(f.path) || null;
      f.hash_id = hashMap.get(f.path) || null;
    });

    console.log(`Total files found: ${files.length}`);

    // Filter out kept files if requested
    if (hideKept) {
      files = files.filter(file => file.filtered !== 'keep');
      console.log(`After filtering kept files: ${files.length} files remaining`);
    }

    // Sort files
    files.sort((a, b) => {
      let compareValue = 0;

      switch (sortBy) {
        case 'name':
          compareValue = a.name.localeCompare(b.name);
          break;
        case 'size':
          compareValue = (a.size || 0) - (b.size || 0);
          break;
        case 'date':
          compareValue = (a.modified || 0) - (b.modified || 0);
          break;
        case 'funscript_count':
          if (a.type === 'funscript_video' && b.type === 'funscript_video') {
            compareValue = (a.funscripts || []).length - (b.funscripts || []).length;
          } else {
            compareValue = 0;
          }
          break;
        default:
          compareValue = 0;
      }

      return sortOrder === 'desc' ? -compareValue : compareValue;
    });

    // Store in cache for future requests
    this.fileCache.set(cacheKey, {
      files: files,
      timestamp: Date.now()
    });
    console.log(`Cached ${files.length} files for ${cacheKey}`);

    // Apply pagination if requested
    const totalCount = files.length;
    if (limit !== undefined) {
      const start = offset || 0;
      const end = start + limit;
      const paginatedFiles = files.slice(start, end);
      return {
        files: paginatedFiles,
        total: totalCount,
        limit,
        offset: start,
        hasMore: end < totalCount
      };
    }

    return files;
  }

  // Clear cache for a specific performer (call after filtering actions)
  clearPerformerCache(performerId) {
    const keysToDelete = [];
    for (const key of this.fileCache.keys()) {
      if (key.startsWith(`${performerId}_`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.fileCache.delete(key));
    console.log(`Cleared cache for performer ${performerId} (${keysToDelete.length} entries)`);
  }

  async getFilesFromDirectory(dirPath, type) {
    // Simplified scanner - no DB queries inside loop
    const files = [];

    try {
      if (!await fs.pathExists(dirPath)) {
        return files;
      }

      const contents = await fs.readdir(dirPath);

      for (const file of contents) {
        if (file.startsWith('.')) continue; // Skip .trash, .thumbnails etc

        const filePath = path.join(dirPath, file);

        try {
          const stat = await fs.stat(filePath);

          if (stat.isFile()) {
            const ext = path.extname(file).toLowerCase();
            let isValidType = false;

            if (type === 'image' && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
              isValidType = true;
            } else if (type === 'video' && ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
              isValidType = true;
            }

            if (isValidType) {
              files.push({
                name: file,
                path: filePath,
                type: type,
                size: stat.size,
                modified: stat.mtime.getTime(),
                // Metadata (filtered, hash_id) is now attached in getFilterableFiles via batch query
                filtered: null,
                hash_id: null
              });
            }
          }
        } catch (statError) {
          // Ignore
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error.message);
    }

    return files;
  }

  async getFunscriptVideos(funscriptPath) {
    const videos = [];

    try {
      if (!await fs.pathExists(funscriptPath)) {
        console.log(`Funscript folder does not exist: ${funscriptPath}`);
        return videos;
      }

      const contents = await fs.readdir(funscriptPath, { withFileTypes: true });
      console.log(`Found ${contents.length} items in funscript folder: ${funscriptPath}`);

      for (const item of contents) {
        // Skip all folders starting with . (system folders like .cache, .thumbnails, .trash, etc.)
        if (item.isDirectory() && item.name.startsWith('.')) {
          continue;
        }

        if (item.isDirectory()) {
          const vidFolderPath = path.join(funscriptPath, item.name);

          try {
            if (await fs.pathExists(vidFolderPath)) {
              const vidContents = await fs.readdir(vidFolderPath);

              let videoFile = null;
              let funscriptFiles = [];

              for (const file of vidContents) {
                const ext = path.extname(file).toLowerCase();
                if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
                  videoFile = file;
                } else if (ext === '.funscript') {
                  funscriptFiles.push(file);
                }
              }

              // Only include videos that have funscript files
              if (videoFile && funscriptFiles.length > 0) {
                const videoPath = path.join(vidFolderPath, videoFile);

                try {
                  const stat = await fs.stat(videoPath);

                  // Check if this video has been filtered
                  const filterAction = db.prepare(
                    'SELECT action FROM filter_actions WHERE file_path = ? ORDER BY timestamp DESC LIMIT 1'
                  ).get(videoPath);

                  // Get hash ID for ML predictions
                  const hashInfo = db.prepare(
                    'SELECT id FROM performer_file_hashes WHERE file_path = ? LIMIT 1'
                  ).get(videoPath);

                  videos.push({
                    name: videoFile, // Show the actual video file name
                    path: videoPath, // Use the actual video file path
                    type: 'funscript_video',
                    folderName: item.name, // Keep folder name for reference
                    funscripts: funscriptFiles,
                    funscriptCount: funscriptFiles.length,
                    size: stat.size,
                    modified: stat.mtime.getTime(),
                    filtered: filterAction ? filterAction.action : null, // 'keep', 'delete', or null
                    hash_id: hashInfo ? hashInfo.id : null // For ML predictions
                  });
                } catch (statError) {
                  console.warn(`Error getting stats for ${videoPath}:`, statError.message);
                }
              }
            }
          } catch (folderError) {
            console.warn(`Error reading funscript subfolder ${vidFolderPath}:`, folderError.message);
          }
        }
      }
    } catch (error) {
      console.error(`Error reading funscript directory ${funscriptPath}:`, error.message);
    }

    return videos;
  }

  async performFilterAction(performerId, filePath, action, options = {}) {
    let performer;
    let performerPath;

    // Try to find performer by ID if it's a valid ID (not temp)
    if (performerId && (!performerId.toString().startsWith('temp_'))) {
      performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    }

    // Fallback: Try to infer performer from filePath if not found yet
    if (!performer && !options.performerName && options.basePath && filePath) {
      try {
        const relativePath = path.relative(options.basePath, filePath);
        const parts = relativePath.split(path.sep);
        // parts[0] should be 'before filter performer' or 'after filter performer'
        // parts[1] should be performer name
        if (parts.length >= 2) {
          const inferredName = parts[1];
          console.log(`Inferred performer name from path: ${inferredName}`);

          // Try to find in DB
          performer = db.prepare('SELECT * FROM performers WHERE name = ?').get(inferredName);

          if (performer) {
            performerId = performer.id;
            console.log(`Found performer in DB: ${performer.name} (${performer.id})`);
          } else {
            options.performerName = inferredName;
            console.log(`Performer not in DB, using name: ${inferredName}`);
          }
        }
      } catch (e) {
        console.warn('Failed to infer performer from path:', e);
      }
    }

    if (performer) {
      const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
      if (performer.moved_to_after === 1) {
        performerPath = path.join(folder.path, 'after filter performer', performer.name);
      } else {
        performerPath = path.join(folder.path, 'before filter performer', performer.name);
      }
    } else if (options.performerName && options.basePath) {
      // Handle temp/new performer
      performerPath = path.join(options.basePath, 'before filter performer', options.performerName);
    } else {
      throw new Error('Performer not found and no fallback provided');
    }

    // Store action for undo
    const historyEntry = {
      performerId,
      filePath,
      action,
      timestamp: Date.now(),
      originalPath: filePath
    };

    let result;

    switch (action) {
      case 'keep':
        result = await this.keepFile(filePath, options);
        break;
      case 'delete':
        result = await this.deleteFile(filePath, options);
        break;
      case 'move_to_funscript':
        result = await this.moveToFunscript(filePath, performerPath, options);
        break;
      default:
        throw new Error('Invalid action');
    }

    // Determine file type based on extension and path
    const getFileType = (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        return 'image';
      } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
        // Check if this is a funscript video by looking at the path
        if (filePath.includes(path.join('vids', 'funscript'))) {
          return 'funscript_video';
        }
        return 'video';
      } else if (ext === '.funscript') {
        return 'funscript';
      }
      return 'unknown';
    };

    const fileType = getFileType(filePath);

    console.log(`Filter action debug:`, {
      performerId,
      filePath,
      action,
      fileType,
      pathContainsFunscript: filePath.includes(path.join('vids', 'funscript'))
    });

    // Save action to database
    db.prepare(`
      INSERT INTO filter_actions (performer_id, file_path, file_type, action)
      VALUES (?, ?, ?, ?)
    `).run(performerId, filePath, fileType, action);

    // Update performer's filtered counts
    if (performer) {
      if (fileType === 'image') {
        db.prepare('UPDATE performers SET pics_filtered = pics_filtered + 1 WHERE id = ?').run(performerId);
        console.log(`Updated pics_filtered for performer ${performerId}`);
      } else if (fileType === 'video') {
        db.prepare('UPDATE performers SET vids_filtered = vids_filtered + 1 WHERE id = ?').run(performerId);
        console.log(`Updated vids_filtered for performer ${performerId}`);
      } else if (fileType === 'funscript_video') {
        db.prepare('UPDATE performers SET funscript_vids_filtered = funscript_vids_filtered + 1 WHERE id = ?').run(performerId);
        console.log(`Updated funscript_vids_filtered for performer ${performerId}`);
      } else if (fileType === 'funscript') {
        db.prepare('UPDATE performers SET funscript_vids_filtered = funscript_vids_filtered + 1 WHERE id = ?').run(performerId);
        console.log(`Updated funscript_vids_filtered for performer ${performerId} (funscript file)`);
      }
    }

    // Clear cache for this performer since files have changed
    this.clearPerformerCache(performerId);

    // Add to history
    this.filterHistory.push(historyEntry);
    this.currentIndex = this.filterHistory.length - 1;

    // Schedule stats refresh (debounced)
    if (performerId) {
      this.scheduleStatsRefresh(performerId);
    }

    return result;
  }

  scheduleStatsRefresh(performerId) {
    if (this.refreshTimeouts.has(performerId)) {
      clearTimeout(this.refreshTimeouts.get(performerId));
    }

    const timeout = setTimeout(async () => {
      this.refreshTimeouts.delete(performerId);
      try {
        console.log(`Triggering debounced stats refresh for performer ${performerId}`);
        const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
        if (performer) {
          const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
          let performerPath;
          if (performer.moved_to_after === 1) {
            performerPath = path.join(folder.path, 'after filter performer', performer.name);
          } else {
            performerPath = path.join(folder.path, 'before filter performer', performer.name);
          }

          const stats = await scanPerformerFolderEnhanced(performerPath);

          const picsPath = path.join(performerPath, 'pics');
          const vidsPath = path.join(performerPath, 'vids');
          const funscriptPath = path.join(vidsPath, 'funscript');
          const now = new Date().toISOString();

          db.prepare(`
              UPDATE performers 
              SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
                  funscript_files_count = ?, total_size_gb = ?,
                  last_scan_date = ?, cached_pics_path = ?, cached_vids_path = ?, cached_funscript_path = ?
              WHERE id = ?
            `).run(
            stats.pics_count,
            stats.vids_count,
            stats.funscript_vids_count,
            stats.funscript_files_count,
            stats.total_size_gb,
            now,
            picsPath,
            vidsPath,
            funscriptPath,
            performerId
          );

          // Only set original counts if they are currently 0 or NULL (first-time baseline)
          const current = db.prepare('SELECT pics_original_count, vids_original_count, funscript_vids_original_count FROM performers WHERE id = ?').get(performerId);
          if (current && (!current.pics_original_count && !current.vids_original_count && !current.funscript_vids_original_count)) {
            db.prepare(`
              UPDATE performers 
              SET pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?
              WHERE id = ?
            `).run(stats.pics_count, stats.vids_count, stats.funscript_vids_count, performerId);
          }
          console.log(`Stats refreshed for performer ${performer.name}`);
        }
      } catch (err) {
        console.error(`Error refreshing stats for performer ${performerId}:`, err);
      }
    }, 2000); // 2 seconds debounce

    this.refreshTimeouts.set(performerId, timeout);
  }

  async keepFile(filePath, options = {}) {
    // File stays in place, just mark as kept
    return { success: true, message: 'File kept' };
  }

  async deleteFile(filePath, options = {}) {
    // Move to trash or delete permanently
    const backupPath = path.join(path.dirname(filePath), '.trash', path.basename(filePath));
    await fs.ensureDir(path.dirname(backupPath));
    await fs.move(filePath, backupPath);

    // Mark file as deleted in hash database
    db.prepare(`
      UPDATE performer_file_hashes 
      SET deleted_flag = 1 
      WHERE file_path = ?
    `).run(filePath);

    return { success: true, message: 'File deleted', backupPath };
  }

  async moveToFunscript(filePath, performerPath, options = {}) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const funscriptPath = path.join(performerPath, 'vids', 'funscript', fileName);

    await fs.ensureDir(funscriptPath);
    await fs.move(filePath, path.join(funscriptPath, path.basename(filePath)));

    return { success: true, message: 'File moved to funscript folder', newPath: funscriptPath };
  }

  async undoLastAction() {
    if (this.currentIndex < 0) {
      throw new Error('No action to undo');
    }

    const action = this.filterHistory[this.currentIndex];

    // Implement undo logic based on action type
    switch (action.action) {
      case 'delete':
        // Restore from trash
        const backupPath = path.join(path.dirname(action.filePath), '.trash', path.basename(action.filePath));
        if (await fs.pathExists(backupPath)) {
          await fs.move(backupPath, action.filePath);

          // Restore deleted_flag to 0 in hash database
          db.prepare(`
            UPDATE performer_file_hashes 
            SET deleted_flag = 0 
            WHERE file_path = ?
          `).run(action.filePath);
        }
        break;
      case 'move_to_funscript':
        // Move back to original location
        // This would need more complex logic to track the move
        break;
    }

    // Remove the action from database
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ? AND file_path = ? ORDER BY id DESC LIMIT 1')
      .run(action.performerId, action.filePath);

    // Decrement performer's filtered counts
    const getFileType = (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        return 'image';
      } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
        // Check if this is a funscript video by looking at the path
        if (filePath.includes(path.join('vids', 'funscript'))) {
          return 'funscript_video';
        }
        return 'video';
      } else if (ext === '.funscript') {
        return 'funscript';
      }
      return 'unknown';
    };

    const fileType = getFileType(action.filePath);
    if (fileType === 'image') {
      db.prepare('UPDATE performers SET pics_filtered = pics_filtered - 1 WHERE id = ? AND pics_filtered > 0').run(action.performerId);
    } else if (fileType === 'video') {
      db.prepare('UPDATE performers SET vids_filtered = vids_filtered - 1 WHERE id = ? AND vids_filtered > 0').run(action.performerId);
    } else if (fileType === 'funscript_video') {
      db.prepare('UPDATE performers SET funscript_vids_filtered = funscript_vids_filtered - 1 WHERE id = ? AND funscript_vids_filtered > 0').run(action.performerId);
    } else if (fileType === 'funscript') {
      db.prepare('UPDATE performers SET funscript_vids_filtered = funscript_vids_filtered - 1 WHERE id = ? AND funscript_vids_filtered > 0').run(action.performerId);
    }

    this.currentIndex--;
    return { success: true, message: 'Action undone' };
  }

  async manageFunscriptFiles(performerId, videoFolder, funscriptAction, funscriptFile = null, options = {}) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      throw new Error('Performer not found');
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const performerPath = path.join(folder.path, 'before filter performer', performer.name);
    const funscriptPath = path.join(performerPath, 'vids', 'funscript', videoFolder);

    if (!await fs.pathExists(funscriptPath)) {
      throw new Error('Funscript folder not found');
    }

    const contents = await fs.readdir(funscriptPath);
    const funscriptFiles = contents.filter(file => path.extname(file).toLowerCase() === '.funscript');

    switch (funscriptAction) {
      case 'keep':
        if (funscriptFile) {
          // Keep specific funscript file
          return { success: true, message: `Kept ${funscriptFile}` };
        } else {
          // Keep all funscript files
          return { success: true, message: 'Kept all funscript files' };
        }

      case 'delete':
        if (funscriptFile) {
          // Delete specific funscript file
          const filePath = path.join(funscriptPath, funscriptFile);
          await fs.remove(filePath);

          // Check if this was the last funscript file
          const remainingFunscripts = contents.filter(file =>
            path.extname(file).toLowerCase() === '.funscript' && file !== funscriptFile
          );

          if (remainingFunscripts.length === 0) {
            // This was the last funscript, prompt user for video action
            return {
              success: true,
              message: `Deleted ${funscriptFile}`,
              lastFunscript: true,
              videoFile: contents.find(file =>
                ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(path.extname(file).toLowerCase())
              )
            };
          }

          return { success: true, message: `Deleted ${funscriptFile}` };
        } else {
          // Delete all funscript files
          for (const file of funscriptFiles) {
            await fs.remove(path.join(funscriptPath, file));
          }
          return {
            success: true,
            message: 'Deleted all funscript files',
            lastFunscript: true,
            videoFile: contents.find(file =>
              ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(path.extname(file).toLowerCase())
            )
          };
        }

      case 'rename':
        if (funscriptFile && options.newName) {
          const oldPath = path.join(funscriptPath, funscriptFile);
          const newPath = path.join(funscriptPath, options.newName);
          await fs.rename(oldPath, newPath);
          return { success: true, message: `Renamed ${funscriptFile} to ${options.newName}` };
        } else {
          throw new Error('Funscript file and new name required for rename');
        }

      default:
        throw new Error('Invalid funscript action');
    }
  }

  async handleVideoAfterLastFunscriptDelete(performerId, videoFolder, keepVideo = false) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const performerPath = path.join(folder.path, 'before filter performer', performer.name);
    const funscriptPath = path.join(performerPath, 'vids', 'funscript', videoFolder);

    if (keepVideo) {
      // Move video to regular vids folder
      const contents = await fs.readdir(funscriptPath);
      const videoFile = contents.find(file =>
        ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(path.extname(file).toLowerCase())
      );

      if (videoFile) {
        const videoPath = path.join(funscriptPath, videoFile);
        const newVideoPath = path.join(performerPath, 'vids', videoFile);
        await fs.move(videoPath, newVideoPath);
      }
    }

    // Remove the funscript folder
    await fs.remove(funscriptPath);

    return { success: true, message: keepVideo ? 'Video kept and moved to vids folder' : 'Video deleted' };
  }

  // Clear stats cache for a performer (call after filter actions)
  clearStatsCache(performerId) {
    this.statsCache.delete(performerId);
  }

  // Fast version: uses database-cached counts instead of file system scans
  getFilterStatsFast(performerId) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      return {
        total: 0, kept: 0, deleted: 0, completion: 100,
        picsCompletion: 100, vidsCompletion: 100, funscriptCompletion: 100
      };
    }

    // Use ORIGINAL counts as the denominator (baseline from import time)
    // Current counts change when duplicates are deleted, but original stays fixed
    const picsOriginal = performer.pics_original_count || performer.pics_count || 0;
    const vidsOriginal = performer.vids_original_count || performer.vids_count || 0;
    const funscriptOriginal = performer.funscript_vids_original_count || performer.funscript_vids_count || 0;

    // Current counts (may be lower than original after duplicate deletion)
    const picsCurrent = performer.pics_count || 0;
    const vidsCurrent = performer.vids_count || 0;
    const funscriptCurrent = performer.funscript_vids_count || 0;
    
    const picsFiltered = performer.pics_filtered || 0;
    const vidsFiltered = performer.vids_filtered || 0;
    const funscriptFiltered = performer.funscript_vids_filtered || 0;

    const totalOriginal = picsOriginal + vidsOriginal + funscriptOriginal;
    const totalFiltered = picsFiltered + vidsFiltered + funscriptFiltered;

    const picsCompletion = picsOriginal === 0 ? 100 : Math.round((picsFiltered / picsOriginal) * 100);
    const vidsCompletion = vidsOriginal === 0 ? 100 : Math.round((vidsFiltered / vidsOriginal) * 100);
    const funscriptCompletion = funscriptOriginal === 0 ? 100 : Math.round((funscriptFiltered / funscriptOriginal) * 100);
    const overallCompletion = totalOriginal === 0 ? 100 : Math.round((totalFiltered / totalOriginal) * 100);

    return {
      total: totalOriginal,
      processed: totalFiltered,
      remaining: totalOriginal - totalFiltered,
      completion: overallCompletion,
      picsTotal: picsOriginal, picsProcessed: picsFiltered, picsCompletion,
      vidsTotal: vidsOriginal, vidsProcessed: vidsFiltered, vidsCompletion,
      funscriptTotal: funscriptOriginal, funscriptProcessed: funscriptFiltered, funscriptCompletion
    };
  }

  getFilterStats(performerId, useCache = true) {
    // Check cache first
    if (useCache) {
      const cached = this.statsCache.get(performerId);
      if (cached && (Date.now() - cached.timestamp) < this.statsCacheTimeout) {
        return cached.stats;
      }
    }
    
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      return {
        total: 0, kept: 0, deleted: 0, completion: 100,
        picsCompletion: 100, vidsCompletion: 100, funscriptCompletion: 100
      };
    }

    // Get files that have been filtered (have any action)
    const filteredFiles = db.prepare(
      'SELECT DISTINCT file_path FROM filter_actions WHERE performer_id = ?'
    ).all(performerId);
    const filteredFilePaths = new Set(filteredFiles.map(f => f.file_path));

    // Count files by type using database queries (synchronous)
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const performerPath = path.join(folder.path, 'before filter performer', performer.name);

    let picsTotal = 0, picsFiltered = 0;
    let vidsTotal = 0, vidsFiltered = 0;
    let funscriptTotal = 0, funscriptFiltered = 0;

    // Count pics
    const picsPath = path.join(performerPath, 'pics');
    if (fs.existsSync(picsPath)) {
      try {
        const pics = fs.readdirSync(picsPath);
        pics.forEach(file => {
          const ext = path.extname(file).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            picsTotal++;
            const filePath = path.join(picsPath, file);
            if (filteredFilePaths.has(filePath)) {
              picsFiltered++;
            }
          }
        });
      } catch (err) {
        console.log('Error reading pics directory:', err.message);
      }
    }

    // Count regular videos
    const vidsPath = path.join(performerPath, 'vids');
    if (fs.existsSync(vidsPath)) {
      try {
        const vids = fs.readdirSync(vidsPath);
        vids.forEach(file => {
          const ext = path.extname(file).toLowerCase();
          if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
            vidsTotal++;
            const filePath = path.join(vidsPath, file);
            if (filteredFilePaths.has(filePath)) {
              vidsFiltered++;
            }
          }
        });
      } catch (err) {
        console.log('Error reading vids directory:', err.message);
      }
    }

    // Count funscript videos
    const funscriptPath = path.join(performerPath, 'vids', 'funscript');
    if (fs.existsSync(funscriptPath)) {
      try {
        const folders = fs.readdirSync(funscriptPath, { withFileTypes: true });
        folders.forEach(item => {
          if (item.isDirectory()) {
            const vidFolderPath = path.join(funscriptPath, item.name);
            try {
              const contents = fs.readdirSync(vidFolderPath);
              let hasVideo = false;
              let hasFunscript = false;
              let videoFile = null;

              contents.forEach(file => {
                const ext = path.extname(file).toLowerCase();
                if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
                  hasVideo = true;
                  videoFile = file;
                } else if (ext === '.funscript') {
                  hasFunscript = true;
                }
              });

              // Only count if both video and funscript exist
              if (hasVideo && hasFunscript && videoFile) {
                funscriptTotal++;
                const videoPath = path.join(vidFolderPath, videoFile);
                if (filteredFilePaths.has(videoPath)) {
                  funscriptFiltered++;
                }
              }
            } catch (err) {
              console.log('Error reading funscript folder:', vidFolderPath, err.message);
            }
          }
        });
      } catch (err) {
        console.log('Error reading funscript directory:', err.message);
      }
    }

    const totalFiles = picsTotal + vidsTotal + funscriptTotal;
    const totalFiltered = picsFiltered + vidsFiltered + funscriptFiltered;

    // Calculate percentages - if 0 files of a type, show 100% completion
    const picsCompletion = picsTotal === 0 ? 100 : Math.round((picsFiltered / picsTotal) * 100);
    const vidsCompletion = vidsTotal === 0 ? 100 : Math.round((vidsFiltered / vidsTotal) * 100);
    const funscriptCompletion = funscriptTotal === 0 ? 100 : Math.round((funscriptFiltered / funscriptTotal) * 100);
    const overallCompletion = totalFiles === 0 ? 100 : Math.round((totalFiltered / totalFiles) * 100);

    // Get action counts for detailed stats
    const keepActions = db.prepare('SELECT COUNT(*) as count FROM filter_actions WHERE performer_id = ? AND action = ?').get(performerId, 'keep');
    const deleteActions = db.prepare('SELECT COUNT(*) as count FROM filter_actions WHERE performer_id = ? AND action = ?').get(performerId, 'delete');
    const moveActions = db.prepare('SELECT COUNT(*) as count FROM filter_actions WHERE performer_id = ? AND action = ?').get(performerId, 'move_to_funscript');

    const stats = {
      total: totalFiles,
      kept: keepActions.count,
      deleted: deleteActions.count,
      moved: moveActions.count,
      processed: totalFiltered,
      remaining: totalFiles - totalFiltered,
      completion: overallCompletion,

      // Individual type progress
      picsTotal: picsTotal,
      picsProcessed: picsFiltered,
      picsCompletion: picsCompletion,

      vidsTotal: vidsTotal,
      vidsProcessed: vidsFiltered,
      vidsCompletion: vidsCompletion,

      funscriptTotal: funscriptTotal,
      funscriptProcessed: funscriptFiltered,
      funscriptCompletion: funscriptCompletion
    };
    
    // Store in cache
    this.statsCache.set(performerId, { stats, timestamp: Date.now() });
    
    return stats;
  }
}

module.exports = new FilterService();