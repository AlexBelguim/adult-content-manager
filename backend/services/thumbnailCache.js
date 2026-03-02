const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

/**
 * Image Cache Service
 * Caches original images in .cache folder for faster serving
 * NO resizing - copies the original file as-is
 */

// Simple concurrency queue to prevent flooding the thread pool/NAS
class Queue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  process() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    this.running++;
    const { fn, resolve, reject } = this.queue.shift();

    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.running--;
        this.process();
      });
  }
}

// 2 Concurrent copy operations max (conservative for NAS)
const copyQueue = new Queue(2);

/**
 * Generate a cache key hash from file path
 */
function getCacheKey(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex');
}

/**
 * Get the .cache folder path for a performer folder (before or after)
 * @param {string} basePath - The base path (e.g., D:\content)
 * @param {string} folderType - 'before' or 'after'
 * @returns {string} The .cache folder path
 */
function getCacheFolderPath(basePath, folderType) {
  const folderName = folderType === 'before' ? 'before filter performer' : 'after filter performer';
  return path.join(basePath, folderName, '.cache');
}

/**
 * Get cached file path for a source image (preserves original extension)
 * @param {string} sourcePath - Original image path
 * @param {string} basePath - Base path for the content
 * @param {string} folderType - 'before' or 'after'
 * @returns {string} Path where cached file should be stored
 */
function getCachedFilePath(sourcePath, basePath, folderType) {
  const cacheFolder = getCacheFolderPath(basePath, folderType);
  const cacheKey = getCacheKey(sourcePath);
  const ext = path.extname(sourcePath).toLowerCase() || '.jpg';
  return path.join(cacheFolder, `${cacheKey}${ext}`);
}

/**
 * Check if cached file exists and is up to date
 * @param {string} sourcePath - Original image path
 * @param {string} cachePath - Cached file path
 * @returns {Promise<{valid: boolean, sourceModTime: number|null, cacheModTime: number|null}>}
 */
async function isCacheValid(sourcePath, cachePath) {
  try {
    const [sourceExists, cacheExists] = await Promise.all([
      fs.pathExists(sourcePath),
      fs.pathExists(cachePath)
    ]);

    if (!sourceExists) {
      return { valid: false, sourceModTime: null, cacheModTime: null };
    }

    if (!cacheExists) {
      return { valid: false, sourceModTime: null, cacheModTime: null };
    }

    const [sourceStats, cacheStats] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(cachePath)
    ]);

    const sourceModTime = sourceStats.mtimeMs;
    const cacheModTime = cacheStats.mtimeMs;

    // Cache is valid if it's newer than source
    return {
      valid: cacheModTime > sourceModTime,
      sourceModTime,
      cacheModTime
    };
  } catch (error) {
    console.error('Error checking cache validity:', error);
    return { valid: false, sourceModTime: null, cacheModTime: null };
  }
}

/**
 * Copy source file to cache (no resizing, keeps original quality)
 * @param {string} sourcePath - Original image path
 * @param {string} cachePath - Where to save the cached file
 */
async function copyToCache(sourcePath, cachePath) {
  return copyQueue.add(async () => {
    try {
      // Ensure cache directory exists
      await fs.ensureDir(path.dirname(cachePath));
      // Copy the original file as-is
      await fs.copy(sourcePath, cachePath);
    } catch (error) {
      console.error('Error copying to cache:', error);
      throw error;
    }
  });
}

/**
 * Get a cached file path, copying if needed
 * @param {string} sourcePath - Original image path
 * @param {string} basePath - Base content path
 * @param {string} folderType - 'before' or 'after'
 * @returns {Promise<{cachePath: string, fromCache: boolean, cacheKey: string, modTime: number}>}
 */
async function getCachedFile(sourcePath, basePath, folderType) {
  const cachePath = getCachedFilePath(sourcePath, basePath, folderType);
  const cacheKey = getCacheKey(sourcePath);

  const cacheCheck = await isCacheValid(sourcePath, cachePath);

  if (cacheCheck.valid) {
    // Return cached version path
    return {
      cachePath,
      fromCache: true,
      cacheKey,
      modTime: cacheCheck.cacheModTime
    };
  }

  // Copy to cache
  await copyToCache(sourcePath, cachePath);
  const stats = await fs.stat(cachePath);

  return {
    cachePath,
    fromCache: false,
    cacheKey,
    modTime: stats.mtimeMs
  };
}

/**
 * Invalidate cache for a specific source file
 * @param {string} sourcePath - Original image path
 * @param {string} basePath - Base content path
 * @param {string} folderType - 'before' or 'after'
 */
async function invalidateCache(sourcePath, basePath, folderType) {
  try {
    const cachePath = getCachedFilePath(sourcePath, basePath, folderType);
    if (await fs.pathExists(cachePath)) {
      await fs.remove(cachePath);
    }
  } catch (error) {
    console.error('Error invalidating cache:', error);
  }
}

/**
 * Get cache metadata for a performer's images
 * @param {string[]} imagePaths - Array of source image paths
 * @param {string} basePath - Base content path
 * @param {string} folderType - 'before' or 'after'
 * @returns {Promise<Object>} Cache metadata for each image
 */
async function getImageCacheMeta(imagePaths, basePath, folderType) {
  const metadata = {};

  for (const sourcePath of imagePaths) {
    const cacheKey = getCacheKey(sourcePath);
    const cachePath = getCachedFilePath(sourcePath, basePath, folderType);
    const cacheCheck = await isCacheValid(sourcePath, cachePath);

    metadata[cacheKey] = {
      sourcePath,
      cacheKey,
      cachePath,
      valid: cacheCheck.valid,
      sourceModTime: cacheCheck.sourceModTime,
      cacheModTime: cacheCheck.cacheModTime
    };
  }

  return metadata;
}

/**
 * Pre-cache images for a performer (copies originals to .cache)
 * @param {string[]} imagePaths - Array of source image paths
 * @param {string} basePath - Base content path
 * @param {string} folderType - 'before' or 'after'
 */
async function preCacheImages(imagePaths, basePath, folderType) {
  const results = [];

  for (const sourcePath of imagePaths) {
    try {
      const result = await getCachedFile(sourcePath, basePath, folderType);
      results.push({
        sourcePath,
        cachePath: result.cachePath,
        cacheKey: result.cacheKey,
        fromCache: result.fromCache,
        modTime: result.modTime
      });
    } catch (error) {
      console.error(`Failed to cache image ${sourcePath}:`, error);
      results.push({
        sourcePath,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Clean up orphaned cache files
 * @param {string} basePath - Base content path
 * @param {string} folderType - 'before' or 'after'
 */
async function cleanupOrphanedCache(basePath, folderType) {
  const cacheFolder = getCacheFolderPath(basePath, folderType);

  if (!await fs.pathExists(cacheFolder)) {
    return { cleaned: 0 };
  }

  const cacheFiles = await fs.readdir(cacheFolder);
  return {
    cacheFolder,
    fileCount: cacheFiles.length
  };
}

module.exports = {
  getCacheKey,
  getCacheFolderPath,
  getCachedFilePath,
  isCacheValid,
  copyToCache,
  getCachedFile,
  invalidateCache,
  getImageCacheMeta,
  preCacheImages,
  cleanupOrphanedCache
};
