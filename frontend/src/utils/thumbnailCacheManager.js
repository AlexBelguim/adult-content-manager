/**
 * Image Cache Manager
 * 
 * Builds URLs for the backend .cache folder system.
 * Images are cached on the server in the .cache folder for faster serving.
 */

/**
 * Build the cached image URL (serves raw/original quality from .cache folder)
 * @param {string} sourcePath - Original file path
 * @param {string} basePath - Base content path
 * @param {string} folderType - 'before' or 'after'
 */
export function buildCachedImageUrl(sourcePath, basePath, folderType) {
  return `/api/files/cached-image?path=${encodeURIComponent(sourcePath)}&basePath=${encodeURIComponent(basePath)}&folderType=${folderType}`;
}

/**
 * Get all cached URLs for a performer's images
 * @returns {string[]} Array of cached image URLs
 */
export function getPerformerCachedImageUrls(performer, basePath, folderType) {
  if (!performer.thumbnail_paths) {
    return [];
  }

  let imagePaths;
  try {
    imagePaths = JSON.parse(performer.thumbnail_paths);
  } catch (e) {
    return [];
  }

  if (!Array.isArray(imagePaths)) {
    return [];
  }

  return imagePaths.map(sourcePath =>
    buildCachedImageUrl(sourcePath, basePath, folderType)
  );
}

/**
 * Pre-cache images for a performer (trigger server-side caching)
 */
export async function preCachePerformerImages(performer, basePath, folderType) {
  if (!performer.thumbnail_paths) {
    return { success: false, reason: 'no thumbnail paths' };
  }

  let imagePaths;
  try {
    imagePaths = JSON.parse(performer.thumbnail_paths);
  } catch (e) {
    return { success: false, reason: 'invalid thumbnail paths' };
  }

  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return { success: false, reason: 'empty thumbnail paths' };
  }

  try {
    const response = await fetch('/api/files/pre-cache-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePaths, basePath, folderType })
    });

    if (!response.ok) {
      throw new Error('Failed to pre-cache images');
    }

    return await response.json();
  } catch (error) {
    console.error('Error pre-caching images:', error);
    return { success: false, reason: error.message };
  }
}

/**
 * Invalidate cache for a performer's images on the server
 */
export async function invalidatePerformerCache(performer, basePath, folderType) {
  if (!performer.thumbnail_paths) {
    return { success: false, reason: 'no thumbnail paths' };
  }

  let imagePaths;
  try {
    imagePaths = JSON.parse(performer.thumbnail_paths);
  } catch (e) {
    return { success: false, reason: 'invalid thumbnail paths' };
  }

  try {
    for (const sourcePath of imagePaths) {
      await fetch('/api/files/invalidate-image-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath, basePath, folderType })
      });
    }
    return { success: true };
  } catch (error) {
    console.error('Error invalidating cache:', error);
    return { success: false, reason: error.message };
  }
}

export default {
  buildCachedImageUrl,
  getPerformerCachedImageUrls,
  preCachePerformerImages,
  invalidatePerformerCache
};
