const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { findPerformerByNameOrAlias } = require('../utils/performerMatcher');

class MergerService {
  async checkPerformerExists(performerName, basePath, location = 'after') {
    const locationPath = location === 'after' ? 'after filter performer' : 'before filter performer';
    const performerPath = path.join(basePath, locationPath, performerName);
    return await fs.pathExists(performerPath);
  }

  async movePerformerToAfter(performerId, keepCurrentThumbnail = true) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      throw new Error('Performer not found');
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);

    // Check both possible source locations for the performer folder
    const beforePath = path.join(folder.path, 'before filter performer', performer.name);
    const afterPath = path.join(folder.path, 'after filter performer', performer.name);

    let sourcePath = null;

    // Determine where the performer folder actually is
    if (await fs.pathExists(beforePath)) {
      sourcePath = beforePath;
    } else if (await fs.pathExists(afterPath)) {
      // Performer is already in after filter folder
      if (performer.moved_to_after === 1) {
        return {
          success: true,
          message: `Performer ${performer.name} is already in after filter folder`,
          newPath: afterPath
        };
      } else {
        // Folder is in after but database says it's not - update database
        db.prepare('UPDATE performers SET moved_to_after = 1 WHERE id = ?').run(performerId);
        return {
          success: true,
          message: `Performer ${performer.name} database updated to match folder location`,
          newPath: afterPath
        };
      }
    } else {
      throw new Error(`Performer folder not found in either "before filter performer" or "after filter performer": ${performer.name}`);
    }

    const destPath = afterPath;

    // Check if destination already exists by name OR aliases (case-insensitive)
    let existingAfterPerformer = null;
    if (await fs.pathExists(destPath)) {
      console.log(`Destination folder already exists. Checking for matching performer by name/alias...`);

      // Find existing performer by name or aliases
      existingAfterPerformer = findPerformerByNameOrAlias(performer.name, performer.aliases, 1);

      if (existingAfterPerformer) {
        console.log(`Found matching performer in after: ID ${existingAfterPerformer.id}, merging...`);

        // Merge the "before filter performer" content into the existing "after filter performer"
        await this.mergeDirectory(
          path.join(sourcePath, 'pics'),
          path.join(destPath, 'pics')
        );
        await this.mergeDirectory(
          path.join(sourcePath, 'vids'),
          path.join(destPath, 'vids')
        );

        // Merge hash databases - update paths from before to after, then update performer_id
        console.log(`Merging hash databases from performer ${performerId} to ${existingAfterPerformer.id}...`);
        const hashUpdateResult = db.prepare(`
          UPDATE performer_file_hashes 
          SET file_path = REPLACE(file_path, 'before filter performer', 'after filter performer')
          WHERE performer_id = ? AND file_path LIKE '%before filter performer%'
        `).run(performerId);
        console.log(`Updated ${hashUpdateResult.changes} hash file paths`);

        const hashMergeResult = db.prepare(`
          UPDATE performer_file_hashes 
          SET performer_id = ? 
          WHERE performer_id = ?
        `).run(existingAfterPerformer.id, performerId);
        console.log(`Merged ${hashMergeResult.changes} hash records`);

        // Remove the source folder after successful merge
        try {
          await fs.remove(sourcePath);
        } catch (err) {
          console.log(`Warning: Could not remove source folder ${sourcePath}: ${err.message}`);
        }

        // Remove the "before filter performer" database record since it's now merged
        db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(performerId);
        db.prepare('DELETE FROM tags WHERE performer_id = ?').run(performerId);

        // Cleanup other references to avoid FK constraint errors
        // 1. Hash Runs
        db.prepare('DELETE FROM hash_runs WHERE source_performer_id = ? OR target_performer_id = ?').run(performerId, performerId);

        // 2. Content Items and Embeddings
        // First delete embeddings for items belonging to this performer
        db.prepare('DELETE FROM content_clip_embeddings WHERE content_item_id IN (SELECT id FROM content_items WHERE performer_id = ?)').run(performerId);
        // Then delete the content items (this will cascade to ml_predictions)
        db.prepare('DELETE FROM content_items WHERE performer_id = ?').run(performerId);

        db.prepare('DELETE FROM performers WHERE id = ?').run(performerId);

        // Update the existing "after filter performer" stats
        const stats = await this.updatePerformerStats(existingAfterPerformer.id, destPath);

        return {
          success: true,
          message: `Performer ${performer.name} merged with existing after filter performer`,
          newPath: destPath,
          merged: true,
          stats
        };
      } else {
        // Folder exists but no database record - this shouldn't happen, but handle it
        throw new Error('Destination folder exists but no database record found. Manual cleanup required.');
      }
    }

    // Move the entire performer folder (normal case - no existing performer in after)
    try {
      await fs.move(sourcePath, destPath, { overwrite: true });
      console.log(`Moved performer folder: ${sourcePath} -> ${destPath}`);
    } catch (err) {
      throw new Error(`Failed to move performer folder: ${err.message}`);
    }

    // Update database and always clear filter actions since "after" represents final filtered state
    db.prepare('UPDATE performers SET moved_to_after = 1 WHERE id = ?').run(performerId);

    // Update file paths in hash database
    const hashUpdateResult = db.prepare(`
      UPDATE performer_file_hashes 
      SET file_path = REPLACE(file_path, 'before filter performer', 'after filter performer')
      WHERE performer_id = ? AND file_path LIKE '%before filter performer%'
    `).run(performerId);
    console.log(`Updated ${hashUpdateResult.changes} hash file paths`);

    // Delete all filter actions - they're no longer needed in "after filter performer"
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(performerId);
    console.log(`Cleared filter actions for performer ID ${performerId} - moved to final state`);

    return {
      success: true,
      message: `Performer ${performer.name} moved to after filter folder`,
      newPath: destPath
    };
  }

  async updatePerformerStats(performerId, performerPath) {
    const { scanPerformerFolder } = require('./fileScanner');
    const stats = await scanPerformerFolder(performerPath);

    db.prepare(`
      UPDATE performers 
      SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
          funscript_files_count = ?, total_size_gb = ?
      WHERE id = ?
    `).run(
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      stats.funscript_files_count,
      stats.total_size_gb,
      performerId
    );

    return stats;
  }

  async mergePerformers(performerId, options = {}) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      throw new Error('Performer not found');
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const sourcePath = path.join(folder.path, 'before filter performer', performer.name);
    const destPath = path.join(folder.path, 'after filter performer', performer.name);

    if (!await fs.pathExists(destPath)) {
      throw new Error('Destination performer does not exist');
    }

    // Merge pics
    await this.mergeDirectory(
      path.join(sourcePath, 'pics'),
      path.join(destPath, 'pics')
    );

    // Merge vids
    await this.mergeDirectory(
      path.join(sourcePath, 'vids'),
      path.join(destPath, 'vids')
    );

    // Merge funscript folders
    await this.mergeFunscriptFolders(
      path.join(sourcePath, 'vids', 'funscript'),
      path.join(destPath, 'vids', 'funscript')
    );

    // Handle thumbnail
    if (!options.keepCurrentThumbnail) {
      const sourceThumbnail = await this.findThumbnail(path.join(sourcePath, 'pics'));
      if (sourceThumbnail) {
        db.prepare('UPDATE performers SET thumbnail = ? WHERE id = ?').run(sourceThumbnail, performerId);
      }
    }

    // Remove source folder
    try {
      await fs.remove(sourcePath);
    } catch (err) {
      console.log(`Warning: Could not remove source folder ${sourcePath}: ${err.message}`);
    }

    // Update database
    db.prepare('UPDATE performers SET moved_to_after = 1 WHERE id = ?').run(performerId);

    // Update file paths in hash database
    db.prepare(`
      UPDATE performer_file_hashes 
      SET file_path = REPLACE(file_path, 'before filter performer', 'after filter performer')
      WHERE performer_id = ? AND file_path LIKE '%before filter performer%'
    `).run(performerId);

    return {
      success: true,
      message: `Performer ${performer.name} merged with existing performer in after folder`,
      mergedPath: destPath
    };
  }

  async mergeDirectory(sourceDir, destDir) {
    if (!await fs.pathExists(sourceDir)) {
      return;
    }

    await fs.ensureDir(destDir);
    const contents = await fs.readdir(sourceDir);

    for (const item of contents) {
      // Skip and try to delete Thumbs.db files
      if (item.toLowerCase() === 'thumbs.db') {
        try {
          await fs.remove(path.join(sourceDir, item));
        } catch (err) {
          console.log(`Ignored Thumbs.db deletion error: ${err.message}`);
        }
        continue;
      }

      const sourcePath = path.join(sourceDir, item);
      const destPath = path.join(destDir, item);

      if (await fs.pathExists(destPath)) {
        // File exists, create unique name
        const uniqueName = await this.createUniqueName(destDir, item);
        const uniqueDestPath = path.join(destDir, uniqueName);
        try {
          await fs.move(sourcePath, uniqueDestPath, { overwrite: true });
        } catch (err) {
          console.log(`Warning: Could not move ${item} to unique path:`, err.message);
        }
      } else {
        // No conflict, move normally
        try {
          await fs.move(sourcePath, destPath, { overwrite: true });
        } catch (err) {
          console.log(`Warning: Could not move ${item}:`, err.message);
        }
      }
    }
  }

  async mergeFunscriptFolders(sourceDir, destDir) {
    if (!await fs.pathExists(sourceDir)) {
      return;
    }

    await fs.ensureDir(destDir);
    const contents = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const item of contents) {
      if (item.isDirectory()) {
        const sourcePath = path.join(sourceDir, item.name);
        const destPath = path.join(destDir, item.name);

        if (await fs.pathExists(destPath)) {
          // Funscript folder exists, merge contents
          await this.mergeDirectory(sourcePath, destPath);
        } else {
          // No conflict, move normally
          try {
            await fs.move(sourcePath, destPath, { overwrite: true });
          } catch (err) {
            console.log(`Warning: Could not move directory ${item.name}:`, err.message);
          }
        }
      }
    }
  }

  async createUniqueName(dir, fileName) {
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    let counter = 1;
    let uniqueName = fileName;

    while (await fs.pathExists(path.join(dir, uniqueName))) {
      uniqueName = `${baseName}_${counter}${ext}`;
      counter++;
    }

    return uniqueName;
  }

  async findThumbnail(picsPath) {
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

  async mergeImportedPerformer(performerName, basePath, options = {}) {
    const beforePath = path.join(basePath, 'before filter performer', performerName);
    const afterPath = path.join(basePath, 'after filter performer', performerName);

    if (!await fs.pathExists(beforePath)) {
      throw new Error('Source performer not found');
    }

    if (!await fs.pathExists(afterPath)) {
      throw new Error('Destination performer not found');
    }

    // Merge the folders
    await this.mergeDirectory(
      path.join(beforePath, 'pics'),
      path.join(afterPath, 'pics')
    );

    await this.mergeDirectory(
      path.join(beforePath, 'vids'),
      path.join(afterPath, 'vids')
    );

    await this.mergeFunscriptFolders(
      path.join(beforePath, 'vids', 'funscript'),
      path.join(afterPath, 'vids', 'funscript')
    );

    // Remove source folder
    await fs.remove(beforePath);

    return {
      success: true,
      message: `Performer ${performerName} merged with existing performer`,
      mergedPath: afterPath
    };
  }

  async deletePerformerData(performerId, deleteFromSystem = false) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
      throw new Error('Performer not found');
    }

    // Only allow deletion of performers that are in "after filter performer" state
    if (performer.moved_to_after !== 1) {
      throw new Error('Can only delete performers from "after filter performer" folder');
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);

    // Only delete from "after filter performer" folder
    const afterPath = path.join(folder.path, 'after filter performer', performer.name);

    if (deleteFromSystem) {
      // Delete the folder from "after filter performer" location
      if (await fs.pathExists(afterPath)) {
        console.log(`Deleting performer folder from after filter: ${afterPath}`);
        await fs.remove(afterPath);
      }
    }

    // Remove from database - this completely removes the performer record
    // so it can be re-imported fresh without any moved_to_after conflicts
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(performerId);
    db.prepare('DELETE FROM tags WHERE performer_id = ?').run(performerId);
    db.prepare('DELETE FROM performers WHERE id = ?').run(performerId);

    return {
      success: true,
      message: `Performer ${performer.name} deleted completely`,
      deletedFromSystem: deleteFromSystem
    };
  }

  async getPerformerReadyToMove(folderId) {
    const performers = db.prepare(`
      SELECT * FROM performers 
      WHERE folder_id = ? 
      AND pics_filtered = 1 
      AND vids_filtered = 1 
      AND funscript_vids_filtered = 1
      AND moved_to_after = 0
    `).all(folderId);

    return performers;
  }

  async markPerformerFilteringComplete(performerId, type) {
    const validTypes = ['pics', 'vids', 'funscript_vids'];
    if (!validTypes.includes(type)) {
      throw new Error('Invalid filtering type');
    }

    const column = `${type}_filtered`;
    db.prepare(`UPDATE performers SET ${column} = 1 WHERE id = ?`).run(performerId);

    // Check if all filtering is complete
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (performer.pics_filtered && performer.vids_filtered && performer.funscript_vids_filtered) {
      db.prepare('UPDATE performers SET ready_to_move = 1 WHERE id = ?').run(performerId);
    }

    return {
      success: true,
      message: `${type} filtering marked as complete`,
      readyToMove: performer.pics_filtered && performer.vids_filtered && performer.funscript_vids_filtered
    };
  }

  async mergePerformers(sourceId, targetId) {
    const source = db.prepare('SELECT * FROM performers WHERE id = ?').get(sourceId);
    const target = db.prepare('SELECT * FROM performers WHERE id = ?').get(targetId);

    if (!source || !target) throw new Error('Source or Target performer not found');

    // Determine paths
    const getPath = (p) => {
      const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(p.folder_id);
      const type = p.moved_to_after === 1 ? 'after filter performer' : 'before filter performer';
      return path.join(folder.path, type, p.name);
    };

    const sourcePath = getPath(source);
    const targetPath = getPath(target);

    if (!await fs.pathExists(sourcePath)) throw new Error('Source folder not found: ' + sourcePath);
    await fs.ensureDir(targetPath);
    await fs.ensureDir(path.join(targetPath, 'pics'));
    await fs.ensureDir(path.join(targetPath, 'vids'));
    await fs.ensureDir(path.join(targetPath, 'vids', 'funscript'));

    // Merge
    await this.mergeDirectory(path.join(sourcePath, 'pics'), path.join(targetPath, 'pics'));
    await this.mergeDirectory(path.join(sourcePath, 'vids'), path.join(targetPath, 'vids'));
    await this.mergeDirectory(path.join(sourcePath, 'vids', 'funscript'), path.join(targetPath, 'vids', 'funscript'));

    // Cleanup Source
    await fs.remove(sourcePath);

    // Delete Source DB
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(sourceId);
    db.prepare('DELETE FROM tags WHERE performer_id = ?').run(sourceId);
    db.prepare('DELETE FROM performers WHERE id = ?').run(sourceId);

    return { success: true, targetPath };
  }
}

module.exports = new MergerService();