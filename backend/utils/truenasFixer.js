const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { scanPerformerFolderEnhanced } = require('../services/importer');
const PathHelper = require('../utils/pathHelper');

/**
 * TrueNAS Fix Script
 * Addresses file scanning and path issues in TrueNAS environment
 */
class TrueNASFixer {
  constructor() {
    this.fixedPerformers = 0;
    this.errors = [];
    this.logs = [];
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    this.logs.push(logMessage);
  }

  error(message, error = null) {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ERROR: ${message}${error ? ` - ${error.message}` : ''}`;
    console.error(errorMessage);
    this.errors.push(errorMessage);
  }

  /**
   * Fix duplicate funscript folders (Funscript vs funscript)
   */
  async fixDuplicateFunscriptFolders() {
    this.log('Starting funscript folder consolidation...');
    
    try {
      const performers = db.prepare(`
        SELECT p.*, f.path as folder_path 
        FROM performers p 
        JOIN folders f ON p.folder_id = f.id
      `).all();

      for (const performer of performers) {
        const performerPath = PathHelper.getPerformerPath({ path: performer.folder_path }, performer);
        const vidsPath = path.join(performerPath, 'vids');
        
        if (!await PathHelper.safePathExists(vidsPath)) {
          continue;
        }

        // Check for multiple funscript folders
        const possiblePaths = PathHelper.getPossibleFunscriptPaths(vidsPath);
        const existingPaths = [];
        
        for (const possiblePath of possiblePaths) {
          if (await PathHelper.safePathExists(possiblePath)) {
            existingPaths.push(possiblePath);
          }
        }

        // If we have multiple funscript folders, consolidate them
        if (existingPaths.length > 1) {
          this.log(`Found ${existingPaths.length} funscript folders for ${performer.name}`);
          
          const targetPath = path.join(vidsPath, 'funscript'); // Always use lowercase
          const sourcePaths = existingPaths.filter(p => p !== targetPath);

          // Ensure target directory exists
          await PathHelper.safeEnsureDir(targetPath);

          // Move content from other folders to the target
          for (const sourcePath of sourcePaths) {
            try {
              const sourceContents = await fs.readdir(sourcePath, { withFileTypes: true });
              
              for (const item of sourceContents) {
                const sourceItemPath = path.join(sourcePath, item.name);
                const targetItemPath = path.join(targetPath, item.name);
                
                if (await PathHelper.safePathExists(targetItemPath)) {
                  // Handle name conflicts
                  const uniqueName = await this.createUniqueName(targetPath, item.name);
                  const uniqueTargetPath = path.join(targetPath, uniqueName);
                  await fs.move(sourceItemPath, uniqueTargetPath);
                  this.log(`Moved ${item.name} to ${uniqueName} (conflict resolved)`);
                } else {
                  await fs.move(sourceItemPath, targetItemPath);
                  this.log(`Moved ${item.name} to consolidated funscript folder`);
                }
              }

              // Remove empty source folder
              await fs.remove(sourcePath);
              this.log(`Removed duplicate folder: ${sourcePath}`);
            } catch (error) {
              this.error(`Failed to consolidate funscript folder ${sourcePath}`, error);
            }
          }
        }
      }
    } catch (error) {
      this.error('Failed to fix duplicate funscript folders', error);
    }
  }

  /**
   * Refresh all performer stats using enhanced scanning
   */
  async refreshAllPerformerStats() {
    this.log('Refreshing all performer stats with enhanced scanning...');
    
    try {
      const performers = db.prepare(`
        SELECT p.*, f.path as folder_path 
        FROM performers p 
        JOIN folders f ON p.folder_id = f.id
      `).all();

      this.log(`Found ${performers.length} performers to refresh`);

      for (const performer of performers) {
        try {
          const performerPath = PathHelper.getPerformerPath({ path: performer.folder_path }, performer);
          
          if (!await PathHelper.safePathExists(performerPath)) {
            this.log(`Performer folder not found: ${performerPath}`);
            continue;
          }

          this.log(`Scanning performer: ${performer.name} at ${performerPath}`);
          const stats = await scanPerformerFolderEnhanced(performerPath);

          // Update database with new stats
          db.prepare(`
            UPDATE performers 
            SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
                funscript_files_count = ?, total_size_gb = ?,
                pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?
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
            performer.id
          );

          this.log(`Updated stats for ${performer.name}: pics=${stats.pics_count}, vids=${stats.vids_count}, funscript_vids=${stats.funscript_vids_count}`);
          this.fixedPerformers++;
        } catch (error) {
          this.error(`Failed to refresh stats for performer ${performer.name}`, error);
        }
      }
    } catch (error) {
      this.error('Failed to refresh performer stats', error);
    }
  }

  /**
   * Fix file path casing issues
   */
  async fixPathCasing() {
    this.log('Fixing path casing issues...');
    
    try {
      const performers = db.prepare(`
        SELECT p.*, f.path as folder_path 
        FROM performers p 
        JOIN folders f ON p.folder_id = f.id
      `).all();

      for (const performer of performers) {
        const performerPath = PathHelper.getPerformerPath({ path: performer.folder_path }, performer);
        
        if (!await PathHelper.safePathExists(performerPath)) {
          continue;
        }

        // Check and fix pics folder casing
        const picsPath = await PathHelper.findFolderCaseInsensitive(performerPath, 'pics');
        if (picsPath && path.basename(picsPath) !== 'pics') {
          const correctPicsPath = path.join(performerPath, 'pics');
          try {
            await fs.move(picsPath, correctPicsPath);
            this.log(`Fixed pics folder casing for ${performer.name}: ${path.basename(picsPath)} -> pics`);
          } catch (error) {
            this.error(`Failed to fix pics folder casing for ${performer.name}`, error);
          }
        }

        // Check and fix vids folder casing
        const vidsPath = await PathHelper.findFolderCaseInsensitive(performerPath, 'vids');
        if (vidsPath && path.basename(vidsPath) !== 'vids') {
          const correctVidsPath = path.join(performerPath, 'vids');
          try {
            await fs.move(vidsPath, correctVidsPath);
            this.log(`Fixed vids folder casing for ${performer.name}: ${path.basename(vidsPath)} -> vids`);
          } catch (error) {
            this.error(`Failed to fix vids folder casing for ${performer.name}`, error);
          }
        }
      }
    } catch (error) {
      this.error('Failed to fix path casing', error);
    }
  }

  /**
   * Create a unique filename to avoid conflicts
   */
  async createUniqueName(directory, fileName) {
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    let counter = 1;
    let uniqueName = fileName;
    
    while (await PathHelper.safePathExists(path.join(directory, uniqueName))) {
      uniqueName = `${baseName}_${counter}${ext}`;
      counter++;
    }
    
    return uniqueName;
  }

  /**
   * Run all fixes
   */
  async runAllFixes() {
    this.log('Starting TrueNAS fixes...');
    
    await this.fixDuplicateFunscriptFolders();
    await this.fixPathCasing();
    await this.refreshAllPerformerStats();
    
    this.log(`TrueNAS fixes completed. Fixed ${this.fixedPerformers} performers.`);
    
    if (this.errors.length > 0) {
      this.log(`Encountered ${this.errors.length} errors during fixes.`);
      this.errors.forEach(error => console.error(error));
    }

    return {
      fixedPerformers: this.fixedPerformers,
      errors: this.errors,
      logs: this.logs
    };
  }
}

module.exports = TrueNASFixer;
