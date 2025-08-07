const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Get scenes for a video
router.get('/video', async (req, res) => {
  const { path: videoPath } = req.query;
  
  if (!videoPath) {
    return res.status(400).send({ error: 'Video path is required' });
  }

  try {
    const scenes = db.prepare(`
      SELECT * FROM video_scenes 
      WHERE video_path = ? 
      ORDER BY start_time ASC
    `).all(videoPath);

    // Parse tags for each scene and convert column names to camelCase
    scenes.forEach(scene => {
      // Convert database column names to camelCase for frontend
      scene.startTime = scene.start_time;
      scene.endTime = scene.end_time;
      scene.funscriptPath = scene.funscript_path;
      delete scene.start_time;
      delete scene.end_time;
      delete scene.funscript_path;
    });

    res.send({ scenes });
  } catch (err) {
    console.error('Error fetching scenes:', err);
    res.status(500).send({ error: err.message });
  }
});

// Save a new scene
router.post('/save', async (req, res) => {
  const { videoPath, scene } = req.body;
  
  if (!videoPath || !scene) {
    return res.status(400).send({ error: 'Video path and scene data are required' });
  }

  if (!scene.name || scene.startTime == null || scene.endTime == null) {
    return res.status(400).send({ error: 'Scene name, start time, and end time are required' });
  }

  if (scene.startTime >= scene.endTime) {
    return res.status(400).send({ error: 'Start time must be before end time' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO video_scenes (video_path, name, start_time, end_time, funscript_path, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(videoPath, scene.name, scene.startTime, scene.endTime, scene.funscriptPath || null);

    res.send({ success: true, sceneId: result.lastInsertRowid });
  } catch (err) {
    console.error('Error saving scene:', err);
    res.status(500).send({ error: err.message });
  }
});

// Update an existing scene
router.put('/update', async (req, res) => {
  const { sceneId, scene } = req.body;
  
  if (!sceneId || !scene) {
    return res.status(400).send({ error: 'Scene ID and scene data are required' });
  }

  if (!scene.name || scene.startTime == null || scene.endTime == null) {
    return res.status(400).send({ error: 'Scene name, start time, and end time are required' });
  }

  if (scene.startTime >= scene.endTime) {
    return res.status(400).send({ error: 'Start time must be before end time' });
  }

  try {
    // Get the current scene to get video path for tag updates
    const currentScene = db.prepare('SELECT video_path FROM video_scenes WHERE id = ?').get(sceneId);
    if (!currentScene) {
      return res.status(404).send({ error: 'Scene not found' });
    }

    db.prepare(`
      UPDATE video_scenes 
      SET name = ?, start_time = ?, end_time = ?, funscript_path = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(scene.name, scene.startTime, scene.endTime, scene.funscriptPath || null, sceneId);

    res.send({ success: true });
  } catch (err) {
    console.error('Error updating scene:', err);
    res.status(500).send({ error: err.message });
  }
});

// Delete a scene
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).send({ error: 'Scene ID is required' });
  }

  try {
    const result = db.prepare('DELETE FROM video_scenes WHERE id = ?').run(id);
    
    if (result.changes === 0) {
      return res.status(404).send({ error: 'Scene not found' });
    }

    res.send({ success: true });
  } catch (err) {
    console.error('Error deleting scene:', err);
    res.status(500).send({ error: err.message });
  }
});

// Export scene as physical file
router.post('/export', async (req, res) => {
  const { videoPath, sceneId, options = {} } = req.body;
  
  if (!videoPath || !sceneId) {
    return res.status(400).send({ error: 'Video path and scene ID are required' });
  }

  try {
    // Get scene details
    const scene = db.prepare('SELECT * FROM video_scenes WHERE id = ?').get(sceneId);
    if (!scene) {
      return res.status(404).send({ error: 'Scene not found' });
    }

    // Check if video file exists
    if (!await fs.pathExists(videoPath)) {
      return res.status(404).send({ error: 'Video file not found' });
    }

    // Create scenes directory structure
    const videoDir = path.dirname(videoPath);
    const videoBaseName = path.basename(videoPath, path.extname(videoPath));
    
    // Find the genre root directory
    const parts = videoPath.split(path.sep);
    const contentIdx = parts.findIndex(p => p.toLowerCase() === 'content');
    let genreRoot = videoDir;
    if (contentIdx !== -1 && parts.length > contentIdx + 1) {
      genreRoot = parts.slice(0, contentIdx + 2).join(path.sep);
    }

    const thumbnailsDir = path.join(genreRoot, '.thumbnails');
    const scenesDir = path.join(thumbnailsDir, 'scenes');
    await fs.ensureDir(scenesDir);

    // Create output filename
    const sceneFileName = `${videoBaseName}_scene_${scene.id}_${scene.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')}`;
    
    // If funscript option is enabled, create funscript folder structure
    let funscriptOutputDir = null;
    let finalOutputPath = path.join(scenesDir, `${sceneFileName}.mp4`);
    
    if (options.createFunscriptFolder) {
      funscriptOutputDir = path.join(scenesDir, 'funscript', sceneFileName);
      await fs.ensureDir(funscriptOutputDir);
      // When creating funscript folder, put the video file directly there
      finalOutputPath = path.join(funscriptOutputDir, `${sceneFileName}.mp4`);
    }

    // Use FFmpeg to extract the scene directly to the final location
    await new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-ss', scene.start_time.toString(),
        '-t', (scene.end_time - scene.start_time).toString(),
        '-c', 'copy', // Copy streams without re-encoding for speed
        '-avoid_negative_ts', 'make_zero',
        '-y', // Overwrite output file
        finalOutputPath
      ];

      console.log('Running FFmpeg with args:', args);
      
      const ffmpegProcess = spawn(ffmpegPath, args);
      
      ffmpegProcess.stderr.on('data', (data) => {
        console.log('FFmpeg stderr:', data.toString());
      });
      
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      ffmpegProcess.on('error', (err) => {
        reject(err);
      });
    });

    // If funscript folder option is enabled, process the funscript file
    if (funscriptOutputDir && options.includeFunscript) {
      const funscriptPath = path.join(path.dirname(videoPath), `${videoBaseName}.funscript`);
      if (await fs.pathExists(funscriptPath)) {
        const funscriptOutputPath = path.join(funscriptOutputDir, `${sceneFileName}.funscript`);
        
        // Read and adjust funscript timing
        try {
          const funscriptContent = await fs.readJson(funscriptPath);
          if (funscriptContent.actions && Array.isArray(funscriptContent.actions)) {
            // Filter and adjust actions for the scene timeframe
            const sceneStartMs = scene.start_time * 1000;
            const sceneEndMs = scene.end_time * 1000;
            
            const adjustedActions = funscriptContent.actions
              .filter(action => action.at >= sceneStartMs && action.at <= sceneEndMs)
              .map(action => ({
                ...action,
                at: action.at - sceneStartMs // Adjust timing to start from 0
              }));
            
            const adjustedFunscript = {
              ...funscriptContent,
              actions: adjustedActions
            };
            
            await fs.writeJson(funscriptOutputPath, adjustedFunscript, { spaces: 2 });
          }
        } catch (funscriptError) {
          console.error('Error processing funscript:', funscriptError);
          // Continue without funscript if there's an error
        }
      }
    }

    // Update scene record with export path
    db.prepare(`
      UPDATE video_scenes 
      SET export_path = ?, exported_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(finalOutputPath, sceneId);

    // Determine content type based on export options
    const contentType = options.createFunscriptFolder ? 'funscript' : 'video';

    // Create exported file record
    const exportedFileResult = db.prepare(`
      INSERT INTO exported_files (original_video_path, scene_id, file_path, funscript_path, name, tags, content_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      videoPath, 
      sceneId, 
      finalOutputPath, 
      funscriptOutputDir && options.includeFunscript ? path.join(funscriptOutputDir, `${sceneFileName}.funscript`) : null,
      sceneFileName,
      JSON.stringify([]), // No tags initially
      contentType
    );

    res.send({ 
      success: true, 
      exportPath: finalOutputPath,
      funscriptPath: funscriptOutputDir,
      exportedFileId: exportedFileResult.lastInsertRowid
    });
  } catch (err) {
    console.error('Error exporting scene:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get exported files for a video
router.get('/exported-files', async (req, res) => {
  const { path: videoPath } = req.query;
  
  if (!videoPath) {
    return res.status(400).send({ error: 'Video path is required' });
  }

  try {
    const exportedFiles = db.prepare(`
      SELECT ef.*, vs.name as scene_name, vs.start_time, vs.end_time 
      FROM exported_files ef
      LEFT JOIN video_scenes vs ON ef.scene_id = vs.id
      WHERE ef.original_video_path = ?
      ORDER BY ef.created_at DESC
    `).all(videoPath);

    // Parse tags and check if files still exist
    for (let file of exportedFiles) {
      if (file.tags) {
        try {
          file.tags = JSON.parse(file.tags);
        } catch (e) {
          file.tags = [];
        }
      } else {
        file.tags = [];
      }
      
      // Check if file still exists
      file.exists = await fs.pathExists(file.file_path);
      
      // Get file size if it exists
      if (file.exists && !file.file_size) {
        try {
          const stats = await fs.stat(file.file_path);
          file.file_size = stats.size;
          // Update database with file size
          db.prepare('UPDATE exported_files SET file_size = ? WHERE id = ?').run(stats.size, file.id);
        } catch (e) {
          // Ignore if we can't get stats
        }
      }
      
      // Count funscript files if this was exported as a funscript scene
      file.funscriptCount = 0;
      if (file.content_type === 'funscript' && file.exists) {
        try {
          const fileDir = path.dirname(file.file_path);
          const files = await fs.readdir(fileDir);
          const funscriptFiles = files.filter(f => f.endsWith('.funscript'));
          file.funscriptCount = funscriptFiles.length;
          console.log(`Found ${file.funscriptCount} funscript files for exported scene: ${file.name}`);
        } catch (e) {
          console.error('Error counting funscript files for', file.name, ':', e);
          // Keep funscriptCount as 0 if there's an error
        }
      }
    }

    res.send({ exportedFiles });
  } catch (err) {
    console.error('Error fetching exported files:', err);
    res.status(500).send({ error: err.message });
  }
});

// Update exported file tags
router.put('/exported-file/:id/tags', async (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;
  
  console.log('Updating exported file tags:');
  console.log('- File ID:', id);
  console.log('- Tags:', tags);
  
  if (!id || !Array.isArray(tags)) {
    return res.status(400).send({ error: 'File ID and tags array are required' });
  }

  try {
    const tagsJson = JSON.stringify(tags);
    
    console.log('- Tags JSON:', tagsJson);
    
    const updateResult = db.prepare(`
      UPDATE exported_files 
      SET tags = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(tagsJson, id);
    
    console.log('- Update result:', updateResult);

    // Also add tags to file_tags table for genre visibility
    const exportedFile = db.prepare('SELECT file_path FROM exported_files WHERE id = ?').get(id);
    console.log('- Exported file:', exportedFile);
    
    if (exportedFile) {
      // Remove old tags for this file
      const deleteResult = db.prepare('DELETE FROM file_tags WHERE file_path = ?').run(exportedFile.file_path);
      console.log('- Deleted old tags:', deleteResult.changes);
      
      // Add new tags
      if (tags.length > 0) {
        const insertTag = db.prepare('INSERT OR IGNORE INTO file_tags (file_path, tag) VALUES (?, ?)');
        tags.forEach(tag => {
          const insertResult = insertTag.run(exportedFile.file_path, tag);
          console.log(`- Added tag "${tag}":`, insertResult);
        });
      }
    }

    res.send({ success: true });
  } catch (err) {
    console.error('Error updating exported file tags:', err);
    res.status(500).send({ error: err.message });
  }
});

// Delete exported file record and physical files
router.delete('/exported-file/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).send({ error: 'File ID is required' });
  }

  try {
    // Get file path before deletion for tag cleanup
    const file = db.prepare('SELECT file_path, funscript_path FROM exported_files WHERE id = ?').get(id);
    let fileDeleted = false;
    let funscriptDeleted = false;
    let folderDeleted = false;
    
    if (file && file.file_path) {
      try {
        // Check if this file is in a funscript folder structure
        const fileDir = path.dirname(file.file_path);
        const parentDir = path.dirname(fileDir);
        const funscriptFolderName = path.basename(fileDir);
        const isFunscriptFolder = parentDir.endsWith(path.join('.thumbnails', 'scenes', 'funscript'));
        
        // Delete the main video file
        await fs.remove(file.file_path);
        fileDeleted = true;
        console.log('Deleted exported video file:', file.file_path);
        
        // Delete funscript file if it exists
        if (file.funscript_path) {
          try {
            await fs.remove(file.funscript_path);
            funscriptDeleted = true;
            console.log('Deleted funscript file:', file.funscript_path);
          } catch (e) {
            console.error('Failed to delete funscript file:', file.funscript_path, e);
          }
        }
        
        // If this was in a funscript folder, delete the entire folder
        if (isFunscriptFolder) {
          try {
            // Delete the entire funscript folder and all its contents
            await fs.remove(fileDir);
            folderDeleted = true;
            console.log('Deleted funscript folder and all contents:', fileDir);
          } catch (e) {
            console.error('Failed to delete funscript folder:', fileDir, e);
          }
        }
      } catch (e) {
        console.error('Failed to delete exported file from disk:', file.file_path, e);
      }
    }
    
    // Remove database record
    const result = db.prepare('DELETE FROM exported_files WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).send({ error: 'Exported file not found' });
    }
    
    // Remove tags from file_tags table
    if (file) {
      db.prepare('DELETE FROM file_tags WHERE file_path = ?').run(file.file_path);
    }
    
    res.send({ success: true, fileDeleted, funscriptDeleted, folderDeleted });
  } catch (err) {
    console.error('Error deleting exported file record:', err);
    res.status(500).send({ error: err.message });
  }
});

// Cut scene(s) from original video file
router.post('/cut', async (req, res) => {
  const { videoPath, sceneId, sceneIds } = req.body;
  
  // Support both single scene and multiple scenes
  let scenesToCut = [];
  if (sceneIds && Array.isArray(sceneIds)) {
    scenesToCut = sceneIds;
  } else if (sceneId) {
    scenesToCut = [sceneId];
  } else {
    return res.status(400).send({ error: 'Video path and scene ID(s) are required' });
  }

  try {
    // Get all scenes to cut and validate they exist
    const scenes = [];
    for (const id of scenesToCut) {
      const scene = db.prepare('SELECT * FROM video_scenes WHERE id = ?').get(id);
      if (!scene) {
        return res.status(404).send({ error: `Scene with ID ${id} not found` });
      }
      scenes.push(scene);
    }

    // Sort scenes by start time (earliest first) for proper cutting order
    scenes.sort((a, b) => a.start_time - b.start_time);

    // Check if video file exists
    if (!await fs.pathExists(videoPath)) {
      return res.status(404).send({ error: 'Video file not found' });
    }

    const sceneNames = scenes.map(s => s.name).join(', ');
    console.log(`Cutting ${scenes.length} scene(s): ${sceneNames}`);
    
    // Create backup of original file
    const videoDir = path.dirname(videoPath);
    const videoExt = path.extname(videoPath);
    const videoBaseName = path.basename(videoPath, videoExt);
    const backupPath = path.join(videoDir, `${videoBaseName}_backup_${Date.now()}${videoExt}`);
    
    console.log('Creating backup:', backupPath);
    await fs.copy(videoPath, backupPath);

    // Create temporary files for processing
    const tempDir = path.join(videoDir, '.temp_cut');
    await fs.ensureDir(tempDir);
    
    let currentInputPath = videoPath;
    let totalRemovedDuration = 0;

    try {
      // Get video duration first
      const getVideoDuration = (inputPath) => {
        return new Promise((resolve, reject) => {
          const args = [
            '-i', inputPath,
            '-f', 'null',
            '-'
          ];

          const ffmpegProcess = spawn(ffmpegPath, args);
          let duration = 0;
          
          ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (match) {
              duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
            }
          });
          
          ffmpegProcess.on('close', (code) => {
            if (duration > 0) {
              resolve(duration);
            } else {
              reject(new Error('Could not determine video duration'));
            }
          });
          
          ffmpegProcess.on('error', (err) => {
            reject(err);
          });
        });
      };

      const totalDuration = await getVideoDuration(videoPath);
      console.log('Total video duration:', totalDuration);

      // Process each scene cut sequentially (from earliest to latest)
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        // Adjust scene times based on previously removed content
        const adjustedStartTime = scene.start_time - totalRemovedDuration;
        const adjustedEndTime = scene.end_time - totalRemovedDuration;
        const sceneDuration = adjustedEndTime - adjustedStartTime;
        
        console.log(`Processing scene ${i + 1}/${scenes.length}: "${scene.name}" (${adjustedStartTime}s - ${adjustedEndTime}s)`);
        
        const part1Path = path.join(tempDir, `part1_${i}${videoExt}`);
        const part2Path = path.join(tempDir, `part2_${i}${videoExt}`);
        const outputPath = path.join(tempDir, `output_${i}${videoExt}`);

        // Extract part before the scene (if exists)
        if (adjustedStartTime > 0) {
          console.log(`Extracting part 1: 0 to ${adjustedStartTime}`);
          await new Promise((resolve, reject) => {
            const args = [
              '-i', currentInputPath,
              '-t', adjustedStartTime.toString(),
              '-c', 'copy',
              '-avoid_negative_ts', 'make_zero',
              '-y',
              part1Path
            ];

            const ffmpegProcess = spawn(ffmpegPath, args);
            
            ffmpegProcess.stderr.on('data', (data) => {
              console.log('FFmpeg part1 stderr:', data.toString());
            });
            
            ffmpegProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`FFmpeg part1 exited with code ${code}`));
              }
            });
            
            ffmpegProcess.on('error', (err) => {
              reject(err);
            });
          });
        }

        // Get current duration for this iteration
        const currentDuration = await getVideoDuration(currentInputPath);
        
        // Extract part after the scene (if exists)
        if (adjustedEndTime < currentDuration) {
          console.log(`Extracting part 2: from ${adjustedEndTime} to end`);
          await new Promise((resolve, reject) => {
            const args = [
              '-i', currentInputPath,
              '-ss', adjustedEndTime.toString(),
              '-c', 'copy',
              '-avoid_negative_ts', 'make_zero',
              '-y',
              part2Path
            ];

            const ffmpegProcess = spawn(ffmpegPath, args);
            
            ffmpegProcess.stderr.on('data', (data) => {
              console.log('FFmpeg part2 stderr:', data.toString());
            });
            
            ffmpegProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`FFmpeg part2 exited with code ${code}`));
              }
            });
            
            ffmpegProcess.on('error', (err) => {
              reject(err);
            });
          });
        }

        // Combine the parts
        const part1Exists = await fs.pathExists(part1Path);
        const part2Exists = await fs.pathExists(part2Path);

        if (part1Exists && part2Exists) {
          console.log('Combining both parts');
          const concatListPath = path.join(tempDir, `filelist_${i}.txt`);
          const concatContent = `file '${part1Path}'\nfile '${part2Path}'`;
          await fs.writeFile(concatListPath, concatContent);

          await new Promise((resolve, reject) => {
            const args = [
              '-f', 'concat',
              '-safe', '0',
              '-i', concatListPath,
              '-c', 'copy',
              '-y',
              outputPath
            ];

            const ffmpegProcess = spawn(ffmpegPath, args);
            
            ffmpegProcess.stderr.on('data', (data) => {
              console.log('FFmpeg concat stderr:', data.toString());
            });
            
            ffmpegProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`FFmpeg concat exited with code ${code}`));
              }
            });
            
            ffmpegProcess.on('error', (err) => {
              reject(err);
            });
          });
        } else if (part1Exists) {
          console.log('Only part 1 exists, using it as output');
          await fs.copy(part1Path, outputPath);
        } else if (part2Exists) {
          console.log('Only part 2 exists, using it as output');
          await fs.copy(part2Path, outputPath);
        } else {
          throw new Error(`No parts to combine for scene "${scene.name}" - this would result in an empty file`);
        }

        // Update input for next iteration
        currentInputPath = outputPath;
        totalRemovedDuration += sceneDuration;
        
        // Clean up intermediate files
        if (part1Exists) await fs.remove(part1Path);
        if (part2Exists) await fs.remove(part2Path);
        
        console.log(`Scene "${scene.name}" cut successfully. Total removed duration: ${totalRemovedDuration}s`);
      }

      // Replace original file with the final cut version
      console.log('Replacing original file with final cut version');
      await fs.move(currentInputPath, videoPath, { overwrite: true });

      console.log('Total removed duration:', totalRemovedDuration, 'seconds');

      // Update all scenes that start after the first cut scene
      const earliestCutTime = Math.min(...scenes.map(s => s.start_time));
      console.log('Updating subsequent scene timestamps after time:', earliestCutTime);
      
      const subsequentScenes = db.prepare(`
        SELECT * FROM video_scenes 
        WHERE video_path = ? AND start_time > ?
        ORDER BY start_time ASC
      `).all(videoPath, earliestCutTime);

      for (const subsequentScene of subsequentScenes) {
        const newStartTime = subsequentScene.start_time - totalRemovedDuration;
        const newEndTime = subsequentScene.end_time - totalRemovedDuration;
        
        console.log(`Updating scene ${subsequentScene.id}: ${subsequentScene.start_time}-${subsequentScene.end_time} -> ${newStartTime}-${newEndTime}`);
        
        db.prepare(`
          UPDATE video_scenes 
          SET start_time = ?, end_time = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newStartTime, newEndTime, subsequentScene.id);
      }

      // Delete all cut scenes from database
      console.log('Deleting cut scenes from database');
      for (const scene of scenes) {
        db.prepare('DELETE FROM video_scenes WHERE id = ?').run(scene.id);
      }

      // Update any exported files that were based on subsequent scenes
      console.log('Updating exported files for subsequent scenes');
      for (const subsequentScene of subsequentScenes) {
        db.prepare(`
          UPDATE exported_files 
          SET updated_at = CURRENT_TIMESTAMP
          WHERE scene_id = ?
        `).run(subsequentScene.id);
      }

      // Process funscript file if it exists
      const funscriptPath = path.join(videoDir, `${videoBaseName}.funscript`);
      if (await fs.pathExists(funscriptPath)) {
        console.log('Processing funscript file');
        try {
          const funscriptContent = await fs.readJson(funscriptPath);
          if (funscriptContent.actions && Array.isArray(funscriptContent.actions)) {
            let adjustedActions = [...funscriptContent.actions];
            let cumulativeRemovedDuration = 0;

            // Process each cut scene in order
            for (const scene of scenes) {
              const sceneStartMs = (scene.start_time - cumulativeRemovedDuration) * 1000;
              const sceneEndMs = (scene.end_time - cumulativeRemovedDuration) * 1000;
              const sceneDurationMs = (scene.end_time - scene.start_time) * 1000;

              // Remove actions within the current cut scene and adjust subsequent actions
              adjustedActions = adjustedActions
                .filter(action => action.at < sceneStartMs || action.at > sceneEndMs)
                .map(action => {
                  if (action.at > sceneEndMs) {
                    return {
                      ...action,
                      at: action.at - sceneDurationMs
                    };
                  }
                  return action;
                });

              cumulativeRemovedDuration += (scene.end_time - scene.start_time);
            }

            const adjustedFunscript = {
              ...funscriptContent,
              actions: adjustedActions
            };

            // Backup original funscript
            const funscriptBackupPath = path.join(videoDir, `${videoBaseName}_backup_${Date.now()}.funscript`);
            await fs.copy(funscriptPath, funscriptBackupPath);
            
            // Write adjusted funscript
            await fs.writeJson(funscriptPath, adjustedFunscript, { spaces: 2 });
            console.log('Funscript updated with', adjustedActions.length, 'actions');
          }
        } catch (funscriptError) {
          console.error('Error processing funscript:', funscriptError);
          // Continue without failing the whole operation
        }
      }

      // Delete backup file after successful operation
      console.log('Deleting backup file after successful cut');
      try {
        await fs.remove(backupPath);
        console.log('Backup file deleted successfully');
      } catch (backupError) {
        console.error('Failed to delete backup file:', backupError);
        // Don't fail the operation if backup deletion fails
      }

      res.send({ 
        success: true, 
        removedDuration: totalRemovedDuration,
        updatedScenes: subsequentScenes.length,
        cutScenes: scenes.length,
        message: `${scenes.length} scene(s) "${sceneNames}" have been cut from the video. ${subsequentScenes.length} subsequent scenes have been adjusted. Total duration removed: ${totalRemovedDuration.toFixed(2)}s`
      });

    } finally {
      // Clean up temporary files
      try {
        await fs.remove(tempDir);
        console.log('Cleaned up temporary files');
      } catch (e) {
        console.error('Failed to clean up temp files:', e);
      }
    }

  } catch (err) {
    console.error('Error cutting scene(s):', err);
    
    // If there was an error and backup exists, offer to restore
    const videoDir = path.dirname(videoPath);
    const videoExt = path.extname(videoPath);
    const videoBaseName = path.basename(videoPath, videoExt);
    const possibleBackups = await fs.readdir(videoDir).then(files => 
      files.filter(f => f.startsWith(`${videoBaseName}_backup_`) && f.endsWith(videoExt))
    ).catch(() => []);
    
    let errorMessage = err.message;
    if (possibleBackups.length > 0) {
      errorMessage += `. Backup files are available: ${possibleBackups.join(', ')}`;
    }
    
    res.status(500).send({ error: errorMessage });
  }
});

// Get available funscripts for a video file (for scene manager)
router.get('/video/funscripts', async (req, res) => {
  try {
    const { videoPath } = req.query;
    
    if (!videoPath) {
      return res.status(400).send({ error: 'Video path is required' });
    }

    const videoDir = path.dirname(videoPath);
    const videoName = path.basename(videoPath, path.extname(videoPath));
    
    // Look for .funscript files with matching names
    const files = await fs.readdir(videoDir);
    const funscripts = files
      .filter(f => f.endsWith('.funscript') && f.startsWith(videoName))
      .map(f => ({
        name: f,
        path: path.join(videoDir, f)
      }));

    res.send({ funscripts });
  } catch (err) {
    console.error('Error getting funscripts for video:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get available funscripts for a scene's video
router.get('/scene/:sceneId/funscripts', async (req, res) => {
  try {
    const { sceneId } = req.params;
    
    // Get scene from database
    const scene = db.prepare('SELECT * FROM video_scenes WHERE id = ?').get(sceneId);
    if (!scene) {
      return res.status(404).send({ error: 'Scene not found' });
    }

    const videoDir = path.dirname(scene.video_path);
    const videoName = path.basename(scene.video_path, path.extname(scene.video_path));
    
    // Look for .funscript files with matching names
    const files = await fs.readdir(videoDir);
    const funscripts = files
      .filter(f => f.endsWith('.funscript') && f.startsWith(videoName))
      .map(f => ({
        name: f,
        path: path.join(videoDir, f)
      }));

    res.send({ 
      funscripts,
      currentFunscript: scene.funscript_path || null
    });
  } catch (err) {
    console.error('Error getting funscripts for scene:', err);
    res.status(500).send({ error: err.message });
  }
});

// Assign funscript to scene
router.post('/scene/:sceneId/assign-funscript', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const { funscriptPath } = req.body;
    
    // Validate scene exists
    const scene = db.prepare('SELECT * FROM video_scenes WHERE id = ?').get(sceneId);
    if (!scene) {
      return res.status(404).send({ error: 'Scene not found' });
    }

    // Validate funscript file exists if provided
    if (funscriptPath && !await fs.pathExists(funscriptPath)) {
      return res.status(404).send({ error: 'Funscript file not found' });
    }
    
    // Store funscript assignment in database
    db.prepare('UPDATE video_scenes SET funscript_path = ? WHERE id = ?')
      .run(funscriptPath, sceneId);
    
    console.log(`Assigned funscript to scene ${sceneId}:`, funscriptPath);
    res.send({ success: true, message: 'Funscript assigned to scene' });
  } catch (err) {
    console.error('Error assigning funscript to scene:', err);
    res.status(500).send({ error: err.message });
  }
});

// Remove funscript assignment from scene
router.delete('/scene/:sceneId/funscript', async (req, res) => {
  try {
    const { sceneId } = req.params;
    
    // Validate scene exists
    const scene = db.prepare('SELECT * FROM video_scenes WHERE id = ?').get(sceneId);
    if (!scene) {
      return res.status(404).send({ error: 'Scene not found' });
    }
    
    // Remove funscript assignment
    db.prepare('UPDATE video_scenes SET funscript_path = NULL WHERE id = ?')
      .run(sceneId);
    
    console.log(`Removed funscript assignment from scene ${sceneId}`);
    res.send({ success: true, message: 'Funscript assignment removed' });
  } catch (err) {
    console.error('Error removing funscript assignment:', err);
    res.status(500).send({ error: err.message });
  }
});

// Auto-upload funscript when scene is accessed (for playback)
router.post('/scene/:sceneId/play', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const { isHandyConnected } = req.body;
    
    // Get scene with assigned funscript
    const scene = db.prepare('SELECT * FROM video_scenes WHERE id = ?').get(sceneId);
    
    if (!scene) {
      return res.status(404).send({ error: 'Scene not found' });
    }

    // Check if scene has an assigned funscript and Handy is connected
    if (scene.funscript_path && isHandyConnected) {
      // Validate funscript file still exists
      if (await fs.pathExists(scene.funscript_path)) {
        res.send({ 
          success: true,
          autoUpload: {
            videoFile: scene.video_path,
            funscriptFile: scene.funscript_path,
            sceneName: scene.name
          }
        });
      } else {
        console.warn(`Scene ${sceneId} has assigned funscript that no longer exists: ${scene.funscript_path}`);
        res.send({ 
          success: true,
          warning: 'Assigned funscript file no longer exists'
        });
      }
    } else {
      res.send({ success: true });
    }
  } catch (err) {
    console.error('Error preparing scene for playback:', err);
    res.status(500).send({ error: err.message });
  }
});

// Move video to funscript folder with correct structure
router.post('/video/move-to-funscript', async (req, res) => {
  try {
    const { videoPath, targetGenre, copyExportedFunscripts } = req.body;
    
    if (!videoPath) {
      return res.status(400).send({ error: 'Video path is required' });
    }
    
    // Validate video file exists
    if (!await fs.pathExists(videoPath)) {
      return res.status(404).send({ error: 'Video file not found' });
    }
    
    const videoDir = path.dirname(videoPath);
    const videoFileName = path.basename(videoPath);
    const videoName = path.basename(videoPath, path.extname(videoPath));
    
    // Determine target directory structure
    let targetDir;
    if (targetGenre) {
      // Moving to content/genre structure
      const parts = videoPath.split(path.sep);
      const contentIdx = parts.findIndex(p => p.toLowerCase() === 'content');
      if (contentIdx !== -1) {
        const basePath = parts.slice(0, contentIdx + 1).join(path.sep);
        targetDir = path.join(basePath, targetGenre, 'funscript', videoName);
      } else {
        return res.status(400).send({ error: 'Cannot determine content folder structure' });
      }
    } else {
      // Moving within same directory structure to funscript subfolder
      targetDir = path.join(videoDir, 'funscript', videoName);
    }
    
    await fs.ensureDir(targetDir);
    const targetVideoPath = path.join(targetDir, videoFileName);
    
    let copiedFunscriptsCount = 0;
    
    // Get exported files with funscripts BEFORE moving the video (while the database still has the old path)
    if (copyExportedFunscripts) {
      try {
        console.log('Copying exported funscripts for video:', videoPath);
        
        // Get all exported files for this video
        const allExportedFiles = db.prepare(`
          SELECT * FROM exported_files 
          WHERE original_video_path = ?
        `).all(videoPath);
        
        console.log(`Found ${allExportedFiles.length} exported files to check for funscripts`);
        
        for (const exportedFile of allExportedFiles) {
          console.log(`Processing exported file: ${exportedFile.name}`);
          console.log(`  file_path: ${exportedFile.file_path}`);
          console.log(`  funscript_path: ${exportedFile.funscript_path || 'NULL'}`);
          
          let funscriptPath = null;
          
          // Check if there's a funscript_path in the database
          if (exportedFile.funscript_path && await fs.pathExists(exportedFile.funscript_path)) {
            funscriptPath = exportedFile.funscript_path;
            console.log(`  Using database funscript_path: ${funscriptPath}`);
          } else {
            // Look for funscript file with same name as the exported video file
            const exportedFileDir = path.dirname(exportedFile.file_path);
            const exportedFileName = path.basename(exportedFile.file_path, path.extname(exportedFile.file_path));
            const possibleFunscriptPath = path.join(exportedFileDir, `${exportedFileName}.funscript`);
            
            if (await fs.pathExists(possibleFunscriptPath)) {
              funscriptPath = possibleFunscriptPath;
              console.log(`  Found funscript file by convention: ${funscriptPath}`);
            } else {
              console.log(`  No funscript file found at: ${possibleFunscriptPath}`);
            }
          }
          
          if (funscriptPath) {
            const funscriptFileName = path.basename(funscriptPath);
            const targetFunscriptPath = path.join(targetDir, funscriptFileName);
            
            console.log(`Attempting to copy: ${funscriptPath} -> ${targetFunscriptPath}`);
            
            // Only copy if the target doesn't already exist (avoid duplicates)
            if (!await fs.pathExists(targetFunscriptPath)) {
              await fs.copy(funscriptPath, targetFunscriptPath);
              console.log(`✅ Successfully copied exported funscript from ${funscriptPath} to ${targetFunscriptPath}`);
              copiedFunscriptsCount++;
            } else {
              console.log(`⚠️ Skipped copying ${funscriptFileName} - already exists in target directory`);
            }
          }
        }
        
        console.log(`Total funscripts copied: ${copiedFunscriptsCount}`);
      } catch (copyError) {
        console.error('Error copying exported funscripts:', copyError);
        // Don't fail the whole operation if funscript copying fails
      }
    }
    
    // Move video file
    await fs.move(videoPath, targetVideoPath);
    console.log(`Moved video from ${videoPath} to ${targetVideoPath}`);
    
    // Move any associated funscript files
    const originalFiles = await fs.readdir(videoDir);
    const funscriptFiles = originalFiles.filter(f => 
      f.endsWith('.funscript') && f.startsWith(videoName)
    );
    
    for (const funscriptFile of funscriptFiles) {
      const originalFunscriptPath = path.join(videoDir, funscriptFile);
      const targetFunscriptPath = path.join(targetDir, funscriptFile);
      await fs.move(originalFunscriptPath, targetFunscriptPath);
      console.log(`Moved funscript from ${originalFunscriptPath} to ${targetFunscriptPath}`);
    }
    
    // Update database records
    await updateVideoPathsInDatabase(videoPath, targetVideoPath, targetDir);
    
    res.send({ 
      success: true, 
      message: 'Video moved to funscript folder',
      newVideoPath: targetVideoPath,
      newDirectory: targetDir,
      funscriptsCopied: copiedFunscriptsCount
    });
    
  } catch (err) {
    console.error('Error moving video to funscript folder:', err);
    res.status(500).send({ error: err.message });
  }
});

// Move video back from funscript folder to regular location
router.post('/video/move-from-funscript', async (req, res) => {
  try {
    const { videoPath, targetLocation } = req.body;
    
    if (!videoPath) {
      return res.status(400).send({ error: 'Video path is required' });
    }
    
    // Validate video file exists
    if (!await fs.pathExists(videoPath)) {
      return res.status(404).send({ error: 'Video file not found' });
    }
    
    const videoDir = path.dirname(videoPath);
    const videoFileName = path.basename(videoPath);
    const videoName = path.basename(videoPath, path.extname(videoPath));
    
    // Determine target directory
    let targetDir;
    if (targetLocation) {
      targetDir = targetLocation;
    } else {
      // Move back to parent directory (remove the funscript/videoName structure)
      const parts = videoPath.split(path.sep);
      const funscriptIdx = parts.findIndex(p => p.toLowerCase() === 'funscript');
      if (funscriptIdx !== -1 && funscriptIdx >= 2) {
        targetDir = parts.slice(0, funscriptIdx).join(path.sep);
      } else {
        return res.status(400).send({ error: 'Cannot determine target location' });
      }
    }
    
    await fs.ensureDir(targetDir);
    const targetVideoPath = path.join(targetDir, videoFileName);
    
    // Check if target already exists
    if (await fs.pathExists(targetVideoPath)) {
      return res.status(400).send({ error: 'Target video file already exists' });
    }
    
    // Move video file
    await fs.move(videoPath, targetVideoPath);
    console.log(`Moved video from ${videoPath} to ${targetVideoPath}`);
    
    // Move any associated funscript files to the same directory
    const funscriptFiles = await fs.readdir(videoDir);
    const associatedFunscripts = funscriptFiles.filter(f => 
      f.endsWith('.funscript') && f.startsWith(videoName)
    );
    
    for (const funscriptFile of associatedFunscripts) {
      const originalFunscriptPath = path.join(videoDir, funscriptFile);
      const targetFunscriptPath = path.join(targetDir, funscriptFile);
      
      // Check if funscript target already exists
      if (!await fs.pathExists(targetFunscriptPath)) {
        await fs.move(originalFunscriptPath, targetFunscriptPath);
        console.log(`Moved funscript from ${originalFunscriptPath} to ${targetFunscriptPath}`);
      }
    }
    
    // Delete any funscript files in the target root folder that match the video name
    try {
      const targetRootFiles = await fs.readdir(targetDir);
      const rootFunscriptsToDelete = targetRootFiles.filter(f => 
        f.endsWith('.funscript') && f.startsWith(videoName)
      );
      
      for (const funscriptFile of rootFunscriptsToDelete) {
        const funscriptToDelete = path.join(targetDir, funscriptFile);
        await fs.remove(funscriptToDelete);
        console.log(`Deleted root funscript file: ${funscriptToDelete}`);
      }
      
      if (rootFunscriptsToDelete.length > 0) {
        console.log(`Deleted ${rootFunscriptsToDelete.length} funscript files from root folder`);
      }
    } catch (e) {
      console.error('Error deleting root funscript files:', e);
      // Don't fail the operation if funscript deletion fails
    }
    
    // Remove empty funscript folder if it's empty
    try {
      const remainingFiles = await fs.readdir(videoDir);
      if (remainingFiles.length === 0) {
        await fs.rmdir(videoDir);
        console.log(`Removed empty funscript folder: ${videoDir}`);
      }
    } catch (e) {
      // Folder not empty or other error, ignore
    }
    
    // Update database records
    await updateVideoPathsInDatabase(videoPath, targetVideoPath, targetDir);
    
    res.send({ 
      success: true, 
      message: 'Video moved from funscript folder',
      newVideoPath: targetVideoPath,
      newDirectory: targetDir
    });
    
  } catch (err) {
    console.error('Error moving video from funscript folder:', err);
    res.status(500).send({ error: err.message });
  }
});

// Helper function to update all database references when video path changes
async function updateVideoPathsInDatabase(oldVideoPath, newVideoPath, newDir) {
  try {
    // Update video_scenes table
    const scenesResult = db.prepare(`
      UPDATE video_scenes 
      SET video_path = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE video_path = ?
    `).run(newVideoPath, oldVideoPath);
    console.log(`Updated ${scenesResult.changes} scene records`);
    
    // Update funscript_path in video_scenes if it was in the same directory
    const oldDir = path.dirname(oldVideoPath);
    const videoName = path.basename(oldVideoPath, path.extname(oldVideoPath));
    
    const scenesWithFunscripts = db.prepare(`
      SELECT id, funscript_path FROM video_scenes 
      WHERE video_path = ? AND funscript_path IS NOT NULL
    `).all(newVideoPath);
    
    for (const scene of scenesWithFunscripts) {
      if (scene.funscript_path && scene.funscript_path.startsWith(oldDir)) {
        // Update funscript path to new location
        const funscriptFileName = path.basename(scene.funscript_path);
        const newFunscriptPath = path.join(newDir, funscriptFileName);
        
        db.prepare(`
          UPDATE video_scenes 
          SET funscript_path = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(newFunscriptPath, scene.id);
        
        console.log(`Updated funscript path for scene ${scene.id}: ${scene.funscript_path} -> ${newFunscriptPath}`);
      }
    }
    
    // Update exported_files table
    const exportedResult = db.prepare(`
      UPDATE exported_files 
      SET original_video_path = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE original_video_path = ?
    `).run(newVideoPath, oldVideoPath);
    console.log(`Updated ${exportedResult.changes} exported file records`);
    
    // Update funscript_path in exported_files if it was in the same directory
    const exportedWithFunscripts = db.prepare(`
      SELECT id, funscript_path FROM exported_files 
      WHERE original_video_path = ? AND funscript_path IS NOT NULL
    `).all(newVideoPath);
    
    for (const exported of exportedWithFunscripts) {
      if (exported.funscript_path && exported.funscript_path.startsWith(oldDir)) {
        const funscriptFileName = path.basename(exported.funscript_path);
        const newFunscriptPath = path.join(newDir, funscriptFileName);
        
        db.prepare(`
          UPDATE exported_files 
          SET funscript_path = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(newFunscriptPath, exported.id);
        
        console.log(`Updated funscript path for exported file ${exported.id}: ${exported.funscript_path} -> ${newFunscriptPath}`);
      }
    }
    
  } catch (err) {
    console.error('Error updating database paths:', err);
    throw err;
  }
}

module.exports = router;