const path = require('path');
const fs = require('fs-extra');

/**
 * Path helper utilities for TrueNAS and Docker environments
 */
class PathHelper {
  /**
   * Normalize path separators for cross-platform compatibility
   * @param {string} filePath - The path to normalize
   * @returns {string} - Normalized path
   */
  static normalizePath(filePath) {
    return path.normalize(filePath).replace(/\\/g, path.sep);
  }

  /**
   * Find existing folder with case-insensitive matching
   * @param {string} parentPath - Parent directory path
   * @param {string} targetName - Target folder name to find
   * @returns {Promise<string|null>} - Actual folder path or null if not found
   */
  static async findFolderCaseInsensitive(parentPath, targetName) {
    try {
      if (!await fs.pathExists(parentPath)) {
        return null;
      }

      const contents = await fs.readdir(parentPath, { withFileTypes: true });
      const found = contents.find(item => 
        item.isDirectory() && item.name.toLowerCase() === targetName.toLowerCase()
      );

      return found ? path.join(parentPath, found.name) : null;
    } catch (error) {
      console.warn(`Error finding folder ${targetName} in ${parentPath}:`, error.message);
      return null;
    }
  }

  /**
   * Get performer path based on their current location (before or after filter)
   * @param {Object} folder - Folder database record
   * @param {Object} performer - Performer database record
   * @returns {string} - Full path to performer folder
   */
  static getPerformerPath(folder, performer) {
    const folderName = performer.moved_to_after === 1 
      ? 'after filter performer' 
      : 'before filter performer';
    
    return path.join(folder.path, folderName, performer.name);
  }

  /**
   * Safely check if a path exists with error handling
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} - True if path exists, false otherwise
   */
  static async safePathExists(filePath) {
    try {
      return await fs.pathExists(filePath);
    } catch (error) {
      console.warn(`Error checking path existence ${filePath}:`, error.message);
      return false;
    }
  }

  /**
   * Create directory structure with proper error handling
   * @param {string} dirPath - Directory path to create
   * @returns {Promise<boolean>} - True if successful, false otherwise
   */
  static async safeEnsureDir(dirPath) {
    try {
      await fs.ensureDir(dirPath);
      return true;
    } catch (error) {
      console.error(`Error creating directory ${dirPath}:`, error.message);
      return false;
    }
  }

  /**
   * Get all possible funscript folder paths (handles case variations)
   * @param {string} vidsPath - Path to vids folder
   * @returns {string[]} - Array of possible funscript folder paths
   */
  static getPossibleFunscriptPaths(vidsPath) {
    return [
      path.join(vidsPath, 'funscript'),
      path.join(vidsPath, 'Funscript'),
      path.join(vidsPath, 'FUNSCRIPT'),
      path.join(vidsPath, 'FunScript')
    ];
  }

  /**
   * Find the actual funscript folder path (case-insensitive)
   * @param {string} vidsPath - Path to vids folder
   * @returns {Promise<string|null>} - Actual funscript folder path or null
   */
  static async findFunscriptFolder(vidsPath) {
    const possiblePaths = this.getPossibleFunscriptPaths(vidsPath);
    
    for (const possiblePath of possiblePaths) {
      if (await this.safePathExists(possiblePath)) {
        return possiblePath;
      }
    }
    
    return null;
  }

  /**
   * Log path information for debugging
   * @param {string} context - Context description
   * @param {string} filePath - Path to log
   * @param {boolean} exists - Whether path exists
   */
  static logPathInfo(context, filePath, exists = null) {
    const existsInfo = exists !== null ? ` (exists: ${exists})` : '';
    console.log(`[PathHelper] ${context}: ${filePath}${existsInfo}`);
  }
}

module.exports = PathHelper;
