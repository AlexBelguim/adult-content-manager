/**
 * Clear page markup that the broken Leakhaven scraper saved into performer profile fields.
 *
 * Each profile column, alias and scraped tag goes through the cleaner the scrapers now use. Rejected
 * columns are set to NULL, lists keep their clean entries. A performer left with no profile data is
 * marked unscraped, so it shows up again for a fresh scrape.
 *
 * Dry run by default. Usage (in the container):
 *   node backend/scripts/clean_scraped_fields.js           # list what would change
 *   node backend/scripts/clean_scraped_fields.js --apply   # write it
 */
const db = require('../db');
const { PROFILE_TEXT_FIELDS, cleanProfileField, cleanScrapedList } = require('../utils/scraperNormalizer');

const apply = process.argv.includes('--apply');
const textFields = Object.keys(PROFILE_TEXT_FIELDS);
const listFields = ['aliases', 'scraped_tags'];
const short = (v) => {
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 70 ? `${s.slice(0, 70)}… (${s.length} chars)` : s;
};

const performers = db.prepare(`
  SELECT id, name, age, scraped_status, ${[...textFields, ...listFields].join(', ')} FROM performers ORDER BY id
`).all();

const changes = [];
for (const p of performers) {
  const set = {};
  const notes = [];
  for (const f of textFields) {
    if (p[f] !== null && cleanProfileField(f, p[f]) === null) {
      set[f] = null;
      notes.push(`  ${f}: "${short(p[f])}" → empty`);
    }
  }
  for (const f of listFields) {
    if (!p[f]) continue;
    let list;
    try { list = JSON.parse(p[f]); } catch (e) { list = null; }
    const clean = Array.isArray(list) ? cleanScrapedList(list) : [];
    if (!Array.isArray(list) || clean.length !== list.length) {
      set[f] = JSON.stringify(clean);
      notes.push(`  ${f}: ${Array.isArray(list) ? list.length : 'unreadable'} → ${clean.length} kept ${JSON.stringify(clean)}`);
    }
  }
  if (!notes.length) continue;

  const left = { ...p, ...set };
  if (p.scraped_status && left.age === null && textFields.every(f => left[f] === null)) {
    set.scraped_at = null;
    set.scraped_status = null;
    notes.push('  no profile data left → marked unscraped');
  }
  changes.push({ id: p.id, set });
  console.log(`#${p.id} ${p.name}`);
  console.log(notes.join('\n'));
}

console.log(`\n${changes.length} of ${performers.length} performers ${apply ? 'cleaned' : 'would be cleaned (dry run; add --apply to write)'}`);

if (apply) {
  db.transaction(() => {
    for (const { id, set } of changes) {
      const cols = Object.keys(set);
      db.prepare(`UPDATE performers SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map(c => set[c]), id);
    }
  })();
}
