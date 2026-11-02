/**
 * Which performers the app already has: names, aliases, the Leakhaven search name / alias and the model in the Leakhaven
 * link all count, compared without case, spaces or punctuation.
 */
const db = require('../../db');

const normalize = (name) => String(name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function loadLibrary() {
  const known = new Map();   // normalized name → library performer
  const rows = db.prepare('SELECT id, name, aliases, leakshaven_search_name, leakshaven_alias, leakshaven_url FROM performers').all();
  for (const row of rows) {
    let aliases = [];
    try { aliases = JSON.parse(row.aliases || '[]'); } catch { aliases = String(row.aliases || '').split(','); }
    const fromLink = String(row.leakshaven_url || '').match(/\/model\/([^/?#]+)/);
    const names = [row.name, row.leakshaven_search_name, row.leakshaven_alias, fromLink && decodeURIComponent(fromLink[1]), ...(Array.isArray(aliases) ? aliases : [])];
    for (const name of names) {
      const key = normalize(name);
      if (key && !known.has(key)) known.set(key, row);
    }
  }
  const lookup = (names) => names.map(normalize).filter(Boolean).map((k) => known.get(k)).find(Boolean) || null;
  return { size: rows.length, find: (...names) => lookup(names)?.name || null, performer: (...names) => lookup(names) };
}

module.exports = { normalize, loadLibrary };
