const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { scanPerformerFolder } = require('./fileScanner');

async function importPerformer(performerName, basePath, newName = null, mergeIfExists = false) {
  console.log(`Starting import for performer: ${performerName}, newName: ${newName}, mergeIfExists: ${mergeIfExists}`);
  
  const beforePath = path.join(basePath, 'before filter performer', performerName);
  const finalName = newName || performerName;
  
  if (!await fs.pathExists(beforePath)) {
    console.log(`Performer folder not found: ${beforePath}`);
    throw new Error(`Performer folder not found: ${beforePath}`);
  }
  
  // Check if performer already exists
  const existingPerformer = db.prepare('SELECT * FROM performers WHERE name = ?').get(finalName);
  console.log(`Existing performer check for "${finalName}":`, existingPerformer);
  
  if (existingPerformer && !mergeIfExists) {
    // If existing performer is in "before filter performer" folder (moved_to_after = 0),
    // require merge option since both would be in the same location
    if (existingPerformer.moved_to_after === 0) {
      console.log(`Performer ${finalName} already exists in "before filter performer" and mergeIfExists is false`);
      throw new Error(`Performer ${finalName} already exists in "before filter performer". Use merge option to combine.`);
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
    
    // Check if there's already a folder in "before filter performer" with this name
    if (await fs.pathExists(newFolderPath)) {
      if (!mergeIfExists) {
        throw new Error(`Folder with name ${finalName} already exists in "before filter performer"`);
      }
      // If mergeIfExists is true and there's already a folder, we'll handle the merge
    } else {
      // Safe to rename the folder
      await fs.move(beforePath, newFolderPath);
      performerFolderPath = newFolderPath;
      console.log(`Renamed performer folder: ${performerName} -> ${finalName}`);
    }
  }
  
  // If merging with existing performer that's in "before filter performer", merge files and update stats
  if (existingPerformer && mergeIfExists && existingPerformer.moved_to_after === 0) {
    console.log(`Merging with existing performer in "before filter performer": ${finalName}`);
    return await mergeWithExistingPerformer(existingPerformer, performerFolderPath, basePath);
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
  
  const funscriptPath = path.join(vidsPath, 'funscript');
  
  // Create folders if they don't exist
  await fs.ensureDir(picsPath);
  await fs.ensureDir(vidsPath);
  await fs.ensureDir(funscriptPath);
  
  // Only organize loose files, don't move existing organized files
  await organizePerformerFiles(performerFolderPath, picsPath, vidsPath, funscriptPath);
  
  // Scan for stats
  const stats = await scanPerformerFolder(performerFolderPath);
  
  // Find thumbnail (first image)
  const thumbnail = await findThumbnail(picsPath);
  
  // Get folder ID
  const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
  
  // Insert performer into database
  const result = db.prepare(`
    INSERT INTO performers (
      name, folder_id, thumbnail, pics_count, vids_count, 
      funscript_vids_count, funscript_files_count, total_size_gb,
      pics_original_count, vids_original_count, funscript_vids_original_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    stats.funscript_vids_count
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
      const itemPath = path.join(folderPath, item.name);
      
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
            ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
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
    }
  } catch (error) {
    console.log(`Warning: Could not scan folder ${folderPath}:`, error.message);
  }
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
  getPerformerFiles
};

module.exports = {
  importPerformer,
  getPerformerFiles
};