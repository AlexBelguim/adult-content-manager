/**
 * Which performers the app already has: names, the Leakhaven search name / alias and the model in the Leakhaven link all
 * count, and the aliases that are full names ("Ariana Lu"; a first name like "Emma" is shared by too many), compared
 * without case, spaces or punctuation.
 */
const db = require('../../db');
const { safeDecode } = require('./links');

const normalize = (name) => String(name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** A full name: two or more words with letters in them, and nothing but letters, digits and name punctuation */
const fullName = (s) => typeof s === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} .'_-]*$/u.test(s.trim()) && s.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 2;

const ADDED_KEY = 'libraryNames';

/** normalized name → library performer id, as Add performer on Discover wrote them */
function addedNames() {
  try {
    const r = db.prepare('SELECT value FROM discover_settings WHERE key = ?').get(ADDED_KEY);
    const v = r ? JSON.parse(r.value) : null;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

/** Add performer: her Discover names count as the new performer's from now on */
function rememberLibraryNames(names, performerId) {
  const next = { ...addedNames() };
  for (const name of names) { const key = normalize(name); if (key) next[key] = Number(performerId); }
  db.prepare('INSERT INTO discover_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(ADDED_KEY, JSON.stringify(next));
}

function loadLibrary() {
  const known = new Map();   // normalized name → library performer
  const rows = db.prepare('SELECT id, name, aliases, leakshaven_search_name, leakshaven_alias, leakshaven_url FROM performers').all();
  for (const row of rows) {
    let aliases = [];
    try { aliases = JSON.parse(row.aliases || '[]'); } catch { aliases = String(row.aliases || '').split(','); }
    const fromLink = String(row.leakshaven_url || '').match(/\/model\/([^/?#]+)/);
    const names = [
      row.name, row.leakshaven_search_name, row.leakshaven_alias, fromLink && safeDecode(fromLink[1]),
      ...(Array.isArray(aliases) ? aliases : []).map((a) => String(a || '').trim()).filter(fullName),
    ];
    for (const name of names) {
      const key = normalize(name);
      if (key && !known.has(key)) known.set(key, row);
    }
  }
  // the names Add performer linked to a performer it made (her Discover name), whatever their length
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [key, id] of Object.entries(addedNames())) {
    if (key && !known.has(key) && byId.has(id)) known.set(key, byId.get(id));
  }
  const lookup = (names) => names.map(normalize).filter(Boolean).map((k) => known.get(k)).find(Boolean) || null;
  return { size: rows.length, find: (...names) => lookup(names)?.name || null, performer: (...names) => lookup(names) };
}

module.exports = { normalize, fullName, loadLibrary, rememberLibraryNames };
