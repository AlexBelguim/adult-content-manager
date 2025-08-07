const fs = require('fs-extra');
const path = require('path');
const db = require('../db');

class FilterService {
  constructor() {
    this.filterHistory = [];
    this.currentIndex = -1;
  }

  async getFilterableFiles(performerId, type = 'all', sortBy = 'name', sortOrder = 'asc', hideKept = false) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      throw new Error('Performer not found');
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const performerPath = path.join(folder.path, 'before filter performer', performer.name);
    
    let files = [];
    
    if (type === 'all' || type === 'pics') {
      const picsPath = path.join(performerPath, 'pics');
      if (await fs.pathExists(picsPath)) {
        const pics = await this.getFilesFromDirectory(picsPath, 'image');
        files = files.concat(pics);
      }
    }
    
    if (type === 'all' || type === 'vids') {
      const vidsPath = path.join(performerPath, 'vids');
      if (await fs.pathExists(vidsPath)) {
        const vids = await this.getFilesFromDirectory(vidsPath, 'video');
        files = files.concat(vids);
      }
    }
    
    if (type === 'all' || type === 'funscript_vids') {
      const funscriptPath = path.join(performerPath, 'vids', 'funscript');
      if (await fs.pathExists(funscriptPath)) {
        const funscriptVids = await this.getFunscriptVideos(funscriptPath);
        files = files.concat(funscriptVids);
      }
    }
    
    // Filter out kept files if requested
    if (hideKept) {
      const keptFiles = db.prepare('SELECT file_path FROM filter_actions WHERE performer_id = ? AND action = ?').all(performerId, 'keep');
      const keptFilePaths = new Set(keptFiles.map(f => f.file_path));
      files = files.filter(file => !keptFilePaths.has(file.path));
    }
    
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
        case 'funscript_count':
          if (a.type === 'funscript_video' && b.type === 'funscript_video') {
            compareValue = a.funscripts.length - b.funscripts.length;
          } else {
            compareValue = 0;
          }
          break;
        default:
          compareValue = 0;
      }
      
      return sortOrder === 'desc' ? -compareValue : compareValue;
    });
    
    return files;
  }

  async getFilesFromDirectory(dirPath, type) {
    const files = [];
    const contents = await fs.readdir(dirPath);
    
    for (const file of contents) {
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        let isValidType = false;
        
        if (type === 'image' && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          isValidType = true;
        } else if (type === 'video' && ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
          isValidType = true;
        }
        
        if (isValidType) {
          // Check if this file has been filtered
          const filterAction = db.prepare(
            'SELECT action FROM filter_actions WHERE file_path = ? ORDER BY timestamp DESC LIMIT 1'
          ).get(filePath);

          files.push({
            name: file,
            path: filePath,
            type: type,
            size: stat.size,
            modified: stat.mtime.getTime(),
            filtered: filterAction ? filterAction.action : null // 'keep', 'delete', or null
          });
        }
      }
    }
    
    return files;
  }

  async getFunscriptVideos(funscriptPath) {
    const videos = [];
    const contents = await fs.readdir(funscriptPath, { withFileTypes: true });
    
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
        
        // Only include videos that have funscript files
        if (videoFile && funscriptFiles.length > 0) {
          const videoPath = path.join(vidFolderPath, videoFile);
          const stat = await fs.stat(videoPath);
          
          // Check if this video has been filtered
          const filterAction = db.prepare(
            'SELECT action FROM filter_actions WHERE file_path = ? ORDER BY timestamp DESC LIMIT 1'
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
            filtered: filterAction ? filterAction.action : null // 'keep', 'delete', or null
          });
        }
      }
    }
    
    return videos;
  }

  async performFilterAction(performerId, filePath, action, options = {}) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      throw new Error('Performer not found');
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const performerPath = path.join(folder.path, 'before filter performer', performer.name);
    
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
      } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
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

    // Add to history
    this.filterHistory.push(historyEntry);
    this.currentIndex = this.filterHistory.length - 1;

    return result;
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
      } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
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
                ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(path.extname(file).toLowerCase())
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
              ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(path.extname(file).toLowerCase())
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
        ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(path.extname(file).toLowerCase())
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

  getFilterStats(performerId) {
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
          if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
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
                if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
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
    
    return {
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
  }
}

module.exports = new FilterService();