/**
 * Import the hand-made pairs of the old standalone pairwise backend (backend-pairwise/pairwise.db)
 * into pairwise_pairs, marked source = 'pairwise_db' so they stay apart from Rank images pairs.
 *
 * Old paths are Windows paths (Z:\Apps\adultManager\media\<stage>\<performer>\...). A picture may
 * have moved between "after filter performer" and "deleted keep for training" since, so each one is
 * looked up under both. Pairs already in pairwise_pairs (either order) are skipped, so a second run
 * imports nothing.
 *
 * Usage (in the container): node backend/scripts/import_pairwise_db.js /app/data/pairwise.db
 */
const fs = require('fs');
const path = require('path');
const sqlite = require('better-sqlite3');
const db = require('../db');

const STAGES = ['after filter performer', 'deleted keep for training'];

const file = process.argv[2];
if (!file) {
  console.log('Usage: node import_pairwise_db.js <pairwise.db>');
  process.exit(1);
}

const base = db.prepare('SELECT path FROM folders LIMIT 1').get().path;
const performerIds = new Map(db.prepare('SELECT id, name FROM performers').all().map(p => [p.name, p.id]));
const pairKey = (a, b) => [a, b].sort().join('|');
const seen = new Set(db.prepare('SELECT winner, loser FROM pairwise_pairs').all().map(p => pairKey(p.winner, p.loser)));

// The picture's current path, or null
function resolve(oldPath) {
  const parts = oldPath.split('\\');
  const i = parts.findIndex(p => STAGES.includes(p));
  if (i < 0) return null;
  for (const stage of STAGES) {
    const p = path.join(base, stage, ...parts.slice(i + 1));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const old = sqlite(file, { readonly: true });
const rows = old.prepare(`SELECT winner, loser, type, performer, created_at FROM pairs ORDER BY id`).all();
const insert = db.prepare(`
  INSERT INTO pairwise_pairs (performer_id, winner, loser, type, created_at, source) VALUES (?, ?, ?, ?, ?, 'pairwise_db')
`);

const counts = { imported: 0, duplicate: 0, missingPicture: 0, unknownPerformer: 0, otherType: 0 };
db.transaction(() => {
  for (const r of rows) {
    if (r.type !== 'intra' && r.type !== 'inter') { counts.otherType++; continue; }
    const performerId = performerIds.get(r.performer);
    if (!performerId) { counts.unknownPerformer++; continue; }
    const winner = resolve(r.winner), loser = resolve(r.loser);
    if (!winner || !loser) { counts.missingPicture++; continue; }
    const key = pairKey(winner, loser);
    if (seen.has(key)) { counts.duplicate++; continue; }
    seen.add(key);
    insert.run(performerId, winner, loser, r.type, r.created_at);
    counts.imported++;
  }
})();

console.log(`${rows.length} pairs in ${file}:`, counts);
