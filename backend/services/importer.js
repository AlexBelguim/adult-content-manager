const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { scanPerformerFolder } = require('./fileScanner');
const { execSync } = require('child_process');
const os = require('os');
const { findPerformerByNameOrAlias } = require('../utils/performerMatcher');

async function importPerformer(performerName, basePath, newName = null, mergeIfExists = false) {
  console.log(`Starting import for performer: ${performerName}, newName: ${newName}, mergeIfExists: ${mergeIfExists}`);
  
  const beforePath = path.join(basePath, 'before filter performer', performerName);
  const finalName = newName || performerName;
  
  if (!await fs.pathExists(beforePath)) {
    console.log(`Performer folder not found: ${beforePath}`);
    throw new Error(`Performer folder not found: ${beforePath}`);
  }
  
  // Check if performer is blacklisted (by name or aliases)
  const blacklistedPerformer = db.prepare('SELECT * FROM performers WHERE blacklisted = 1 AND name = ?').get(finalName);
  
  if (blacklistedPerformer) {
    const formatDate = (dateStr) => dateStr ? new Date(dateStr).toLocaleDateString() : 'Unknown';
    throw new Error(
      `Performer "${finalName}" is blacklisted and cannot be imported.\n\n` +
      `Reason: ${blacklistedPerformer.blacklist_reason || 'No reason provided'}\n` +
      `Blacklisted on: ${formatDate(blacklistedPerformer.blacklist_date)}\n\n` +
      `To import this performer, go to Performer Management and unblacklist them first.`
    );
  }
  
  // Check if performer already exists
  const existingPerformer = db.prepare('SELECT * FROM performers WHERE name = ?').get(finalName);
  console.log(`Existing performer check for "${finalName}":`, existingPerformer);
  
  if (existingPerformer) {
    // If existing performer is in "before filter performer" folder (moved_to_after = 0),
    // auto-merge to combine content
    if (existingPerformer.moved_to_after === 0) {
      console.log(`Performer ${finalName} already exists in "before filter performer". Auto-merging...`);
      return await mergeWithExistingPerformer(existingPerformer, performerFolderPath, basePath);
    }
    
    // If existing performer is in "after filter performer" folder (moved_to_after = 1),
    // allow import to "before filter performer" for new content filtering
    if (existingPerformer.moved_to_after === 1) {
      console.log(`Performer ${finalName} exists in "after filter performer". Allowing import to "before filter performer" for new content.`);
      // Continue with normal import - this will create a new database record
      // The existing "after" performer will remain separate until merge during move-to-after
    }
  }
  
  // Rename the folder if a new name is provided
  let performerFolderPath = beforePath;
  if (newName && newName !== performerName) {
    console.log(`Renaming performer from ${performerName} to ${newName}`);
    const newFolderPath = path.join(basePath, 'before filter performer', finalName);
    
    console.log(`Checking if new folder path exists: ${newFolderPath}`);
    // Check if there's already a folder in "before filter performer" with this name
    if (await fs.pathExists(newFolderPath)) {
      if (!mergeIfExists) {
        throw new Error(`Folder with name ${finalName} already exists in "before filter performer"`);
      }
      // If mergeIfExists is true and there's already a folder, we'll handle the merge
      console.log(`New folder already exists, will merge: ${newFolderPath}`);
    } else {
      // Safe to rename the folder
      console.log(`Renaming folder from ${beforePath} to ${newFolderPath}`);
      try {
        // Retry mechanism for EPERM errors (folder locked by another process)
        const maxRetries = 3;
        let lastError;
        let renamed = false;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Force close any open handles by adding a small delay
            if (attempt > 1) {
              console.log(`Retry attempt ${attempt}/${maxRetries} after ${attempt * 500}ms delay...`);
              await new Promise(resolve => setTimeout(resolve, attempt * 500));
            }
            
            // Try Node.js rename first
            await fs.rename(beforePath, newFolderPath);
            performerFolderPath = newFolderPath;
            console.log(`Successfully renamed performer folder: ${performerName} -> ${finalName}`);
            console.log(`Updated performerFolderPath to: ${performerFolderPath}`);
            renamed = true;
            break; // Success, exit retry loop
          } catch (err) {
            lastError = err;
            console.error(`Attempt ${attempt} failed:`, err.message);
          }
        }
        
        // If all retries failed, try Python script for forceful rename
        if (!renamed) {
          console.log('All rename attempts failed. Attempting forceful rename using Python script...');
          try {
            const pythonScript = path.join(__dirname, '..', 'scripts', 'force_rename.py');
            const pythonCmd = `python "${pythonScript}" "${beforePath}" "${newFolderPath}"`;
            console.log('Running:', pythonCmd);
            
            const result = execSync(pythonCmd, { 
              encoding: 'utf8',
              stdio: 'pipe',
              windowsHide: true,
              timeout: 60000 // 60 second timeout
            });
            
            console.log('Python script output:', result);
            
            // Verify the rename succeeded
            if (await fs.pathExists(newFolderPath) && !await fs.pathExists(beforePath)) {
              performerFolderPath = newFolderPath;
              console.log(`Successfully renamed performer folder using Python: ${performerName} -> ${finalName}`);
              renamed = true;
            } else {
              throw new Error('Python script completed but folder was not renamed');
            }
          } catch (pythonErr) {
            console.error('Python forceful rename also failed:', pythonErr);
            
            // Extract stderr if available
            let errorDetail = lastError.message;
            if (pythonErr.stderr) {
              errorDetail = pythonErr.stderr.toString();
            }
            
            throw new Error(
              `Failed to rename performer folder: The folder "${performerName}" is locked and cannot be moved.\n\n` +
              `Please:\n` +
              `1. Close ALL File Explorer windows showing this folder\n` +
              `2. Close any video players or image viewers\n` +
              `3. Wait a few seconds and try again\n\n` +
              `Technical details: ${errorDetail}`
            );
          }
        }
        
        if (!renamed) {
          throw lastError;
        }
      } catch (error) {
        console.error('Failed to rename folder:', error);
        
        // Provide more helpful error message
        if (error.code === 'EPERM' || error.message.includes('EPERM') || error.message.includes('PermissionError')) {
          throw new Error(
            `Failed to rename performer folder: The folder "${performerName}" is currently in use.\n\n` +
            `Please:\n` +
            `1. Close any File Explorer windows\n` +
            `2. Close any media players or image viewers\n` +
            `3. Wait a few seconds and try again\n\n` +
            `Technical details: ${error.message}`
          );
        }
        
        throw new Error(`Failed to rename performer folder: ${error.message}`);
      }
    }
  }
  
  // Check for existing folders (case-insensitive)
  const contents = await fs.readdir(performerFolderPath, { withFileTypes: true });
  let picsPath, vidsPath;
  
  // Find existing pics folder (case-insensitive)
  const picsFolder = contents.find(item => 
    item.isDirectory() && item.name.toLowerCase() === 'pics'
  );
  picsPath = picsFolder ? 
    path.join(performerFolderPath, picsFolder.name) : 
    path.join(performerFolderPath, 'pics');
  
  // Find existing vids folder (case-insensitive)
  const vidsFolder = contents.find(item => 
    item.isDirectory() && item.name.toLowerCase() === 'vids'
  );
  vidsPath = vidsFolder ? 
    path.join(performerFolderPath, vidsFolder.name) : 
    path.join(performerFolderPath, 'vids');
  
  // Always use lowercase 'funscript' to prevent duplicate folder creation
  const funscriptPath = path.join(vidsPath, 'funscript');
  
  // Create folders if they don't exist
  await fs.ensureDir(picsPath);
  await fs.ensureDir(vidsPath);
  await fs.ensureDir(funscriptPath);
  
  // Only organize loose files, don't move existing organized files
  await organizePerformerFiles(performerFolderPath, picsPath, vidsPath, funscriptPath);
  
  // Scan for stats using enhanced scanning method that works like import modal
  console.log(`About to scan performer folder for stats: ${performerFolderPath}`);
  console.log(`Folder exists check:`, await fs.pathExists(performerFolderPath));
  const stats = await scanPerformerFolderEnhanced(performerFolderPath);
  console.log(`Scan completed, stats:`, stats);
  
  // Find thumbnail (first image)
  const thumbnail = await findThumbnail(picsPath);
  
  // Get folder ID
  const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
  
  // Cache the folder paths for faster future loads
  const now = new Date().toISOString();
  
  // Insert performer into database with cached paths
  const result = db.prepare(`
    INSERT INTO performers (
      name, folder_id, thumbnail, pics_count, vids_count, 
      funscript_vids_count, funscript_files_count, total_size_gb,
      pics_original_count, vids_original_count, funscript_vids_original_count,
      last_scan_date, cached_pics_path, cached_vids_path, cached_funscript_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    finalName,
    folder.id,
    thumbnail,
    stats.pics_count,
    stats.vids_count,
    stats.funscript_vids_count,
    stats.funscript_files_count,
    stats.total_size_gb,
    stats.pics_count,      // Set original counts same as current counts at import time
    stats.vids_count,      
    stats.funscript_vids_count,
    now,
    picsPath,
    vidsPath,
    funscriptPath
  );
  
  return {
    id: result.lastInsertRowid,
    name: finalName,
    ...stats,
    thumbnail
  };
}

async function organizePerformerFiles(performerPath, picsPath, vidsPath, funscriptPath) {
  const contents = await fs.readdir(performerPath, { withFileTypes: true });
  
  for (const item of contents) {
    // Skip existing directory structures (case-insensitive)
    if (item.isDirectory() && 
        (item.name.toLowerCase() === 'pics' || 
         item.name.toLowerCase() === 'vids')) {
      continue;
    }
    
    const itemPath = path.join(performerPath, item.name);
    
    if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        // Move loose images to pics folder
        const newPath = path.join(picsPath, item.name);
        try {
          await fs.move(itemPath, newPath, { overwrite: true });
          console.log(`Organized image: ${item.name} -> pics folder`);
        } catch (err) {
          console.log(`Warning: Could not move ${item.name} to pics folder:`, err.message);
        }
      } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
        // Move loose videos to vids folder
        const newPath = path.join(vidsPath, item.name);
        try {
          await fs.move(itemPath, newPath, { overwrite: true });
          console.log(`Organized video: ${item.name} -> vids folder`);
        } catch (err) {
          console.log(`Warning: Could not move ${item.name} to vids folder:`, err.message);
        }
      } else if (ext === '.funscript') {
        // Move loose funscripts to funscript folder
        const newPath = path.join(funscriptPath, item.name);
        try {
          await fs.move(itemPath, newPath, { overwrite: true });
          console.log(`Organized funscript: ${item.name} -> funscript folder`);
        } catch (err) {
          console.log(`Warning: Could not move ${item.name} to funscript folder:`, err.message);
        }
      }
    } else if (item.isDirectory()) {
      // Only process subdirectories that aren't the main pics/vids folders
      await organizeDirectoryFiles(itemPath, picsPath, vidsPath, funscriptPath);
    }
  }
}

async function organizeDirectoryFiles(dirPath, picsPath, vidsPath, funscriptPath) {
  const contents = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const item of contents) {
    const itemPath = path.join(dirPath, item.name);
    
    if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        const newPath = path.join(picsPath, item.name);
        try {
          await fs.move(itemPath, newPath, { overwrite: true });
        } catch (err) {
          console.log(`Warning: Could not move ${item.name} to pics folder:`, err.message);
        }
      } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
        const newPath = path.join(vidsPath, item.name);
        try {
          await fs.move(itemPath, newPath, { overwrite: true });
        } catch (err) {
          console.log(`Warning: Could not move ${item.name} to vids folder:`, err.message);
        }
      } else if (ext === '.funscript') {
        const newPath = path.join(funscriptPath, item.name);
        try {
          await fs.move(itemPath, newPath, { overwrite: true });
        } catch (err) {
          console.log(`Warning: Could not move ${item.name} to funscript folder:`, err.message);
        }
      }
    } else if (item.isDirectory()) {
      // Check if this is a funscript video folder
      const subContents = await fs.readdir(itemPath);
      let hasVideo = false;
      let hasFunscript = false;
      
      for (const subFile of subContents) {
        const subExt = path.extname(subFile).toLowerCase();
        if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(subExt)) {
          hasVideo = true;
        } else if (subExt === '.funscript') {
          hasFunscript = true;
        }
      }
      
      if (hasVideo && hasFunscript) {
        // Move entire folder to funscript folder
        const newPath = path.join(funscriptPath, item.name);
        try {
          await fs.move(itemPath, newPath, { overwrite: true });
        } catch (err) {
          console.log(`Warning: Could not move folder ${item.name} to funscript folder:`, err.message);
        }
      } else {
        // Recursively organize
        await organizeDirectoryFiles(itemPath, picsPath, vidsPath, funscriptPath);
      }
    }
  }
  
  // Remove empty directory
  try {
    await fs.rmdir(dirPath);
  } catch (error) {
    // Directory not empty or doesn't exist, ignore
  }
}

async function findThumbnail(picsPath) {
  try {
    const pics = await fs.readdir(picsPath);
    const imageFile = pics.find(file => 
      ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file).toLowerCase())
    );
    return imageFile ? path.join(picsPath, imageFile) : null;
  } catch (error) {
    return null;
  }
}

async function getPerformerFiles(performerName, basePath, type = 'all') {
  const beforePath = path.join(basePath, 'before filter performer', performerName);
  const files = [];
  
  // Recursively scan the entire performer folder for all files
  await scanFolderForFiles(beforePath, files, type);
  
  return files;
}

async function scanFolderForFiles(folderPath, files, type, currentDepth = 0) {
  if (!await fs.pathExists(folderPath) || currentDepth > 10) return;
  
  try {
    const contents = await fs.readdir(folderPath, { withFileTypes: true });
    
    for (const item of contents) {
      // Skip system folders
      if (item.isDirectory() && 
          (item.name === '.thumbnails' || item.name === '.thumbnail' || item.name === '.trash')) {
        continue;
      }
      
      const itemPath = path.join(folderPath, item.name);
      
      try {
        if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          const stat = await fs.stat(itemPath);
          
          // Check for image files
          if ((type === 'all' || type === 'pics') && 
              ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            files.push({
              name: item.name,
              path: itemPath,
              type: 'image',
              size: stat.size
            });
          }
          
          // Check for video files
          if ((type === 'all' || type === 'vids') && 
              ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
            files.push({
              name: item.name,
              path: itemPath,
              type: 'video',
              size: stat.size
            });
          }
          
          // Check for funscript files
          if ((type === 'all' || type === 'funscript') && ext === '.funscript') {
            files.push({
              name: item.name,
              path: itemPath,
              type: 'funscript',
              size: stat.size
            });
          }
        } else if (item.isDirectory()) {
          // Recursively scan subdirectories
          await scanFolderForFiles(itemPath, files, type, currentDepth + 1);
        }
      } catch (itemError) {
        console.warn(`Warning: Could not scan item ${item.name}:`, itemError.message);
        // Continue processing other items even if one fails
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not scan folder ${folderPath}:`, error.message);
  }
}

// Enhanced scanPerformerFolder that uses the same scanning method as import modal
async function scanPerformerFolderEnhanced(performerPath) {
  console.log('scanPerformerFolderEnhanced called with path:', performerPath);
  
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

    const files = [];
    await scanFolderForFiles(performerPath, files, 'all');
    
    // Count files by type
    for (const file of files) {
      stats.total_size_gb += file.size / (1024 * 1024 * 1024);
      
      if (file.type === 'image') {
        stats.pics_count++;
      } else if (file.type === 'video') {
        // Check if this is a funscript video (in funscript folder)
        if (file.path.includes(path.sep + 'funscript' + path.sep) || 
            file.path.includes(path.sep + 'Funscript' + path.sep)) {
          stats.funscript_vids_count++;
          // Also count funscript videos in regular video count
          stats.vids_count++;
        } else {
          stats.vids_count++;
        }
      } else if (file.type === 'funscript') {
        stats.funscript_files_count++;
      }
    }

    console.log(`Enhanced scan found ${files.length} total files in ${performerPath}`);
  } catch (error) {
    console.error('Error in enhanced performer folder scan:', error);
  }
  
  console.log('Enhanced scan stats for performer:', stats);
  return stats;
}

async function mergeWithExistingPerformer(existingPerformer, sourceFolderPath, basePath) {
  // Check if source folder exists
  if (!await fs.pathExists(sourceFolderPath)) {
    throw new Error(`Source folder not found: ${sourceFolderPath}`);
  }
  
  // Get existing performer's folder structure
  const existingFolderPath = path.join(basePath, 'before filter performer', existingPerformer.name);
  
  // If the source folder is different from existing, merge them
  if (sourceFolderPath !== existingFolderPath) {
    await mergePerformerFolders(sourceFolderPath, existingFolderPath);
    
    // Remove the source folder after merging
    if (await fs.pathExists(sourceFolderPath)) {
      await fs.remove(sourceFolderPath);
    }
  }
  
  // Rescan and update stats for the existing performer
  const updatedStats = await scanPerformerFolder(existingFolderPath);
  
  // Find new thumbnail if needed
  const picsPath = path.join(existingFolderPath, 'pics');
  const thumbnail = await findThumbnail(picsPath) || existingPerformer.thumbnail;
  
  // Update performer stats in database
  db.prepare(`
    UPDATE performers SET 
      pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
      funscript_files_count = ?, total_size_gb = ?, thumbnail = ?
    WHERE id = ?
  `).run(
    updatedStats.pics_count,
    updatedStats.vids_count,
    updatedStats.funscript_vids_count,
    updatedStats.funscript_files_count,
    updatedStats.total_size_gb,
    thumbnail,
    existingPerformer.id
  );
  
  return {
    id: existingPerformer.id,
    name: existingPerformer.name,
    ...updatedStats,
    thumbnail,
    merged: true
  };
}

async function mergePerformerFolders(sourcePath, destPath) {
  // Ensure destination folder structure exists
  const destPicsPath = path.join(destPath, 'pics');
  const destVidsPath = path.join(destPath, 'vids');
  const destFunscriptPath = path.join(destVidsPath, 'funscript');
  
  await fs.ensureDir(destPicsPath);
  await fs.ensureDir(destVidsPath);
  await fs.ensureDir(destFunscriptPath);
  
  // Merge pics folder
  const sourcePicsPath = path.join(sourcePath, 'pics');
  if (await fs.pathExists(sourcePicsPath)) {
    await mergeDirectory(sourcePicsPath, destPicsPath);
  }
  
  // Merge vids folder
  const sourceVidsPath = path.join(sourcePath, 'vids');
  if (await fs.pathExists(sourceVidsPath)) {
    await mergeDirectory(sourceVidsPath, destVidsPath);
  }
  
  // Merge loose files in root
  const sourceContents = await fs.readdir(sourcePath, { withFileTypes: true });
  for (const item of sourceContents) {
    if (item.isFile()) {
      const sourceFilePath = path.join(sourcePath, item.name);
      const destFilePath = path.join(destPath, item.name);
      
      if (await fs.pathExists(destFilePath)) {
        // Create unique name if file exists
        const uniqueName = await createUniqueName(destPath, item.name);
        const uniqueDestPath = path.join(destPath, uniqueName);
        try {
          await fs.move(sourceFilePath, uniqueDestPath);
          console.log(`Merged file with unique name: ${item.name} -> ${uniqueName}`);
        } catch (err) {
          console.log(`Warning: Could not merge file ${item.name}:`, err.message);
        }
      } else {
        try {
          await fs.move(sourceFilePath, destFilePath);
          console.log(`Merged file: ${item.name}`);
        } catch (err) {
          console.log(`Warning: Could not merge file ${item.name}:`, err.message);
        }
      }
    }
  }
}

async function mergeDirectory(sourceDir, destDir) {
  if (!await fs.pathExists(sourceDir)) {
    return;
  }
  
  const contents = await fs.readdir(sourceDir);
  
  for (const item of contents) {
    const sourcePath = path.join(sourceDir, item);
    const destPath = path.join(destDir, item);
    
    if (await fs.pathExists(destPath)) {
      // File exists, create unique name
      const uniqueName = await createUniqueName(destDir, item);
      const uniqueDestPath = path.join(destDir, uniqueName);
      try {
        await fs.move(sourcePath, uniqueDestPath);
        console.log(`Merged with unique name: ${item} -> ${uniqueName}`);
      } catch (err) {
        console.log(`Warning: Could not merge ${item}:`, err.message);
      }
    } else {
      try {
        await fs.move(sourcePath, destPath);
        console.log(`Merged: ${item}`);
      } catch (err) {
        console.log(`Warning: Could not merge ${item}:`, err.message);
      }
    }
  }
}

async function createUniqueName(directory, fileName) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let counter = 1;
  let uniqueName = fileName;
  
  while (await fs.pathExists(path.join(directory, uniqueName))) {
    uniqueName = `${baseName}_${counter}${ext}`;
    counter++;
  }
  
  return uniqueName;
}

module.exports = {
  importPerformer,
  getPerformerFiles,
  scanPerformerFolderEnhanced
};