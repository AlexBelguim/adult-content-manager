const fs = require('fs-extra');

const BEFORE_FOLDER = 'before filter performer';
const AFTER_FOLDER = 'after filter performer';

/**
 * Return a path that exists on disk for a stored media path.
 *
 * Stored paths can go stale when a performer folder moves between the
 * "before" and "after" filter folders. If the exact path is missing, try the
 * same path in the other folder before giving up.
 *
 * @returns {Promise<string|null>} existing path, or null when neither exists
 */
async function resolveMediaPath(filePath) {
  if (!filePath) return null;
  if (await fs.pathExists(filePath)) return filePath;

  let alternate = null;
  if (filePath.includes(BEFORE_FOLDER)) {
    alternate = filePath.replace(BEFORE_FOLDER, AFTER_FOLDER);
  } else if (filePath.includes(AFTER_FOLDER)) {
    alternate = filePath.replace(AFTER_FOLDER, BEFORE_FOLDER);
  }
  if (alternate && await fs.pathExists(alternate)) return alternate;
  return null;
}

module.exports = { resolveMediaPath };
