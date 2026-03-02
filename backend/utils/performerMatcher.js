const db = require('../db');

/**
 * Normalize a name for case-insensitive, whitespace-tolerant matching
 */
function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, '');
}

/**
 * Find a performer by name or aliases (case-insensitive)
 * @param {string} name - Performer name to search for
 * @param {Array|string} aliases - Aliases to check (can be JSON string or array)
 * @param {number|null} movedToAfter - Filter by moved_to_after flag (0, 1, or null for any)
 * @returns {Object|null} - Matching performer or null
 */
function findPerformerByNameOrAlias(name, aliases = [], movedToAfter = null) {
  // Parse aliases if string
  let aliasList = [];
  if (typeof aliases === 'string') {
    try {
      aliasList = JSON.parse(aliases || '[]');
    } catch (e) {
      aliasList = [];
    }
  } else if (Array.isArray(aliases)) {
    aliasList = aliases;
  }

  // Normalize all names for comparison
  const normalizedName = normalizeName(name);
  const normalizedAliases = aliasList.map(normalizeName).filter(a => a);

  // Get all performers to check against
  let query = 'SELECT * FROM performers';
  const params = [];

  if (movedToAfter !== null) {
    query += ' WHERE moved_to_after = ?';
    params.push(movedToAfter);
  }

  const allPerformers = db.prepare(query).all(...params);

  // Check each performer
  for (const performer of allPerformers) {
    const performerNormalizedName = normalizeName(performer.name);

    // Parse performer's aliases
    let performerAliases = [];
    if (performer.aliases) {
      try {
        performerAliases = JSON.parse(performer.aliases);
      } catch (e) {
        performerAliases = [];
      }
    }
    const performerNormalizedAliases = performerAliases.map(normalizeName).filter(a => a);

    // Check if any name/alias matches
    const allNamesToCheck = [normalizedName, ...normalizedAliases];
    const performerNames = [performerNormalizedName, ...performerNormalizedAliases];

    for (const checkName of allNamesToCheck) {
      if (performerNames.includes(checkName)) {
        return performer;
      }
    }
  }

  return null;
}

/**
 * Find all performers matching a name or aliases
 * @param {string} name - Performer name to search for
 * @param {Array|string} aliases - Aliases to check
 * @returns {Array} - Array of matching performers
 */
function findAllPerformersByNameOrAlias(name, aliases = []) {
  // Parse aliases if string
  let aliasList = [];
  if (typeof aliases === 'string') {
    try {
      aliasList = JSON.parse(aliases || '[]');
    } catch (e) {
      aliasList = [];
    }
  } else if (Array.isArray(aliases)) {
    aliasList = aliases;
  }

  // Normalize all names for comparison
  const normalizedName = normalizeName(name);
  const normalizedAliases = aliasList.map(normalizeName).filter(a => a);

  // Get all performers
  const allPerformers = db.prepare('SELECT * FROM performers').all();

  const matches = [];

  // Check each performer
  for (const performer of allPerformers) {
    const performerNormalizedName = normalizeName(performer.name);

    // Parse performer's aliases
    let performerAliases = [];
    if (performer.aliases) {
      try {
        performerAliases = JSON.parse(performer.aliases);
      } catch (e) {
        performerAliases = [];
      }
    }
    const performerNormalizedAliases = performerAliases.map(normalizeName).filter(a => a);

    // Check if any name/alias matches
    const allNamesToCheck = [normalizedName, ...normalizedAliases];
    const performerNames = [performerNormalizedName, ...performerNormalizedAliases];

    for (const checkName of allNamesToCheck) {
      if (performerNames.includes(checkName)) {
        matches.push(performer);
        break; // Don't add same performer multiple times
      }
    }
  }

  return matches;
}

/**
 * Find fuzzy matches for a performer name (ignoring numbers, spaces, special chars)
 * @param {string} name - Base name to check
 * @param {number} excludeId - ID to exclude (self)
 * @returns {Array} - List of potential matches
 */
function findFuzzyMatches(name, excludeId = null) {
  if (!name) return [];

  // Strict fuzzy normalization: remove digits, non-alpha, lowercase
  const normalizeFuzzy = (str) => {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z]/g, '');
  };

  const targetFuzzy = normalizeFuzzy(name);
  if (targetFuzzy.length < 3) return []; // Too short to be safe

  // Get all performers
  let query = 'SELECT * FROM performers';
  const allPerformers = db.prepare(query).all();

  const matches = [];

  for (const p of allPerformers) {
    if (excludeId && p.id === parseInt(excludeId)) continue;

    const pFuzzy = normalizeFuzzy(p.name);

    // Check main name
    if (pFuzzy && (pFuzzy === targetFuzzy)) {
      matches.push(p);
      continue;
    }

    // Also check aliases
    if (p.aliases) {
      try {
        const aliases = JSON.parse(p.aliases);
        if (Array.isArray(aliases)) {
          for (const alias of aliases) {
            if (normalizeFuzzy(alias) === targetFuzzy) {
              matches.push(p);
              break;
            }
          }
        }
      } catch (e) { }
    }
  }

  return matches;
}

module.exports = {
  normalizeName,
  findPerformerByNameOrAlias,
  findAllPerformersByNameOrAlias,
  findFuzzyMatches
};
