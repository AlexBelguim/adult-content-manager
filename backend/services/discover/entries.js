/**
 * A performer as the profile page knows her from Discover (discover_entries): a record of her own there (site "discover"), or,
 * with merged_into, what Discover added to a record the page already had. routes/profile.js reads them with its collection;
 * verdicts.js writes them.
 */
const db = require('../../db');

const LISTS = ['aliases', 'links', 'sources', 'members', 'pictures'];
const parse = (row) => row && {
  ...row,
  ...Object.fromEntries(LISTS.map((k) => [k, row[k] ? JSON.parse(row[k]) : []])),
  profile: row.profile ? JSON.parse(row.profile) : null,
  was_verdict: row.was_verdict ? JSON.parse(row.was_verdict) : null,
};

const all = () => db.prepare('SELECT * FROM discover_entries').all().map(parse);
const byKey = (key) => parse(db.prepare('SELECT * FROM discover_entries WHERE key = ?').get(key));
const bySlug = (slug) => parse(db.prepare('SELECT * FROM discover_entries WHERE slug = ?').get(slug));
/** The entry holding one of these finds: a performer's key can change when a combine makes another member her first */
const byMembers = (members) => all().find((e) => (members || []).some((m) => e.members.includes(m))) || null;

/** Saves an entry: a new one without id, else by id. Returns it as stored. */
function save(e) {
  const at = new Date().toISOString();
  const row = {
    slug: e.slug, key: e.key ?? null, origin: e.origin || 'scanner', merged_into: e.merged_into ?? null, library_id: e.library_id ?? null, was_verdict: e.was_verdict ? JSON.stringify(e.was_verdict) : null,
    name: e.name ?? null, profile: e.profile ? JSON.stringify(e.profile) : null, status: e.status || 'undecided', update_mark: e.update_mark ?? null,
    best_score: e.best_score ?? null, pool_score: e.pool_score ?? null, decided_at: e.decided_at ?? null, updated_at: at,
    ...Object.fromEntries(LISTS.map((k) => [k, JSON.stringify(e[k] || [])])),
  };
  if (e.id) {
    db.prepare(`UPDATE discover_entries SET slug = @slug, key = @key, origin = @origin, merged_into = @merged_into, library_id = @library_id, was_verdict = @was_verdict, name = @name,
      aliases = @aliases, links = @links, sources = @sources, profile = @profile, members = @members, pictures = @pictures, status = @status,
      update_mark = @update_mark, best_score = @best_score, pool_score = @pool_score, decided_at = @decided_at, updated_at = @updated_at WHERE id = @id`).run({ ...row, id: e.id });
    return parse(db.prepare('SELECT * FROM discover_entries WHERE id = ?').get(e.id));
  }
  const r = db.prepare(`INSERT INTO discover_entries (slug, key, origin, merged_into, library_id, was_verdict, name, aliases, links, sources, profile, members, pictures, status,
      update_mark, best_score, pool_score, decided_at, created_at, updated_at)
    VALUES (@slug, @key, @origin, @merged_into, @library_id, @was_verdict, @name, @aliases, @links, @sources, @profile, @members, @pictures, @status,
      @update_mark, @best_score, @pool_score, @decided_at, @updated_at, @updated_at)`).run(row);
  return parse(db.prepare('SELECT * FROM discover_entries WHERE id = ?').get(r.lastInsertRowid));
}

/** The scrape shape's profile fields as the profile page's records have them */
function fieldsOf(profile) {
  const p = profile?.profile || {}, born = /^(\d{4})/.exec(p.born || '');
  return {
    hair_color: p.hair_color ?? null, eye_color: p.eye_color ?? null, ethnicity: p.ethnicity ?? null, body_type: p.body_type ?? null,
    cup: p.measurements_cup ?? null, birth_year: born ? Number(born[1]) : null, tattoos: p.tattoos ?? null,
    boobs: /natural/i.test(p.measurements_cup || '') ? 'real' : /fake|enhanced/i.test(p.measurements_cup || '') ? 'fake' : null,
  };
}

/** An entry as a record of the profile page's collection */
const record = (e) => ({
  site: 'discover', slug: e.slug, name: e.name || e.slug, url: e.links[0] || '', pictures: e.pictures, fields: fieldsOf(e.profile),
  aliases: e.aliases, links: e.links, sources: e.sources, origin: e.origin, origin_at: e.updated_at, update_mark: e.update_mark, best_score: e.best_score, pool_score: e.pool_score,
});

module.exports = { all, byKey, bySlug, byMembers, save, record };
