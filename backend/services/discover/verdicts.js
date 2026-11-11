/**
 * What Discover decides, on the profile page. The Discover page's buttons go through events.js to applyEvent here; the same
 * contract is open as POST /api/discovery/performers (routes/discovery.js).
 *
 *   POST /api/discovery/performers      Content-Type: application/json
 *   {
 *     "source": "keep-scanner", "event": "keep" | "delete" | "update" | "upload" | "undecide",
 *     "update": null | "red" | "green",            // update: found again after delete (red) or keep/checked (green)
 *     "key": "<member key>",                       // stable id of the performer on Discover (her first find)
 *     "members": ["<type>:<site>:<id>", …],        // every find of her
 *     "new_finds": [ … ],
 *     "name": "…", "aliases": [ … ], "links": [ … ], "sources": [ … ],
 *     "profile": { …the app's scrape shape: profile fields, aliases, tags, socials… } | null,
 *     "pictures": [ { "name", "type", "data": "<base64>" }, … ]   // over HTTP only the bytes; URLs only in this server's own events
 *     "best_score": 0-100, "pool_score": 0-100 | null, "decided_at": "<iso>",
 *     "verdict": "keep" | "delete" | "superwrong" | null   // keep / delete: the training verdict; superwrong: a delete P got
 *   }                                                       // badly wrong; null on an update
 *
 *   She is looked up, in this order: by "key" (or one of "members": an entry Discover made before), by name and aliases, by her
 *   Leakhaven link and socials. Then:
 *   - nobody: a new performer on the profile page, kept or deleted as the event says;
 *   - the entry Discover made: as the event says (an update marks it red / green);
 *   - a performer the app already had (the profile page's collection, or the library): merged, never overwritten: the
 *     aliases, links and pictures she lacks are added; and she is set to undecided whatever the event. Her verdict there is
 *     kept in the entry (was_verdict). She is decided on the profile page, under its "From Discover" sort.
 *   - event "upload": under its own "Uploaded" sort. Undecided without a verdict; with "verdict" keep / delete (Send with
 *     verdict on the Upload tab) a new one, or the entry an earlier send made, is kept or deleted as a Keep / Delete is, a
 *     training verdict too. Merged into a performer the app had, it is undecided whatever the verdict, as above.
 *   - event "undecide" (Put back, or an Undo, on Discover): only an entry Discover made itself goes back to undecided and loses
 *     the verdict Discover gave it; a merged or library one is left as it is (it is decided on the profile page). Nobody known:
 *     nothing happens ("none").
 *   A merge moves her verdict on the profile page into the entry (was_verdict) the first time only: a verdict given there
 *   later is the profile page's own and stays.
 *
 *   Keep and Delete are training data for P: the verdict goes where the profile page's do, with source "discover", in
 *   Discover's current round (profile page → Training data), and her pictures with the profile collection's, where P's
 *   trainer reads them (GET /api/profile/full).
 *
 *   → 200 { "result": "created" | "updated" | "merged" | "unchanged" | "none", "performer_id": <id> | null, "status": "kept" | "deleted" | "undecided" }
 *
 * local: pictures come from this server's cache ("files", paths as stored), or from the URLs of its own events, for
 * events.js. Only there: over HTTP a caller can't name a file on this server nor make it fetch a URL, only send the bytes.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { abs } = require('./paths');
const { loadLibrary, normalize } = require('./library');
const { safeDecode } = require('./links');
const { warn } = require('./runLog');
const entries = require('./entries');

const EVENTS = ['keep', 'delete', 'update', 'upload', 'undecide'];
const VERDICTS = ['keep', 'delete', 'superwrong'];
const MAX_PICTURES = 40;
const MAX_PICTURE_BYTES = 25 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

const bad = (message) => Object.assign(new Error(message), { status: 400 });
// required here: routes/profile.js needs this folder's entries.js
const page = () => require('../../routes/profile').collection;

/** A file name for a performer, unique among the entries */
function newSlug(name, key) {
  const base = normalize(name).slice(0, 60) || 'performer';
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 6);
  return entries.bySlug(base) ? `${base}-${hash}` : base;
}

/** The Leakhaven model in a link, as a name to look for */
function leakhavenName(link) {
  const m = /leakshaven\.com\/(?:model\/|\?q=)([^/?#&]+)/i.exec(String(link || ''));
  return m ? safeDecode(m[1]) : null;
}

const accounts = (profile) => Object.entries(profile?.socials || {}).filter(([n]) => n === 'onlyfans' || n === 'fansly').map(([, url]) => String(url).toLowerCase().replace(/\/+$/, ''));

/** Who she is on the profile page: { entry } for an entry of Discover's own, { record: 'site/slug' } for one it had, { library } for a library performer, or nothing */
function lookUp(p, records) {
  const names = [p.name, ...(p.aliases || [])].filter(Boolean);
  const wanted = new Set(names.map(normalize).filter(Boolean));
  for (const [key, r] of records) {
    if (!wanted.has(normalize(r.name))) continue;
    if (r.site !== 'discover') return { record: key };
    return { entry: entries.bySlug(r.slug) };
  }
  const library = loadLibrary().performer(...names, ...(p.links || []).map(leakhavenName).filter(Boolean));
  if (library) return { library };
  const mine = accounts(p.profile);
  const same = mine.length ? entries.all().find((e) => accounts(e.profile).some((a) => mine.includes(a))) : null;
  return same ? { entry: same } : {};
}

async function fetchPicture(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !EXT[type]) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length <= MAX_PICTURE_BYTES ? { bytes, ext: EXT[type] } : null;
  } catch (err) {
    warn(`  picture ${url}: ${err.message}`);
    return null;
  }
}

/** The pictures of an event as { bytes, ext }. A URL is only fetched for this server's own events (local). */
async function picturesOf(p, local) {
  const out = [];
  if (local) {
    for (const f of (p.files || []).slice(0, MAX_PICTURES)) {
      const file = abs(f);
      if (fs.existsSync(file)) out.push({ bytes: fs.readFileSync(file), ext: path.extname(file).slice(1).toLowerCase() || 'jpg' });
    }
    if (out.length) return out;
  }
  for (const pic of (p.pictures || []).slice(0, MAX_PICTURES)) {
    if (typeof pic === 'string') {
      if (!local) continue;
      const got = await fetchPicture(pic);
      if (got) out.push(got);
    } else if (EXT[pic?.type] && pic.data) {
      const bytes = Buffer.from(pic.data, 'base64');
      if (bytes.length && bytes.length <= MAX_PICTURE_BYTES) out.push({ bytes, ext: EXT[pic.type] });
    }
  }
  return out;
}

/** Writes the pictures into dir, each by its content, so a picture sent twice is one file. Returns the new file names. */
function writePictures(dir, prefix, pictures) {
  fs.mkdirSync(dir, { recursive: true });
  const names = [];
  for (const { bytes, ext } of pictures) {
    const name = `${prefix}${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}.${ext}`;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
    names.push(name);
  }
  return names;
}

const union = (a, b) => [...new Set([...(a || []), ...(b || [])].filter(Boolean))];

/** Her verdict in the labels, by the profile page's rule: a new or changed verdict goes into the current round */
function setVerdict(lab, key, verdict, current) {
  const old = lab[key], same = old && old.verdict === verdict;
  lab[key] = { verdict, reasons: same ? old.reasons : [], note: same ? old.note : '', at: page().stamp(), round: same ? (old.round || 1) : current, source: 'discover' };
}

async function applyEvent(p, { local = false } = {}) {
  if (!EVENTS.includes(p?.event)) throw bad(`event: ${EVENTS.join(', ')}`);
  if (!p.key || typeof p.key !== 'string') throw bad('key: the performer\'s id on Discover');
  if (p.event !== 'upload' && !p.name) throw bad('name is required');
  if (p.verdict != null && !VERDICTS.includes(p.verdict)) throw bad(`verdict: ${VERDICTS.join(', ')} or null`);

  const { records, labels, saveLabels, current, DATA } = page();
  const known = entries.byKey(p.key) || entries.byMembers(p.members);
  if (p.event === 'undecide') return undecide(known, { labels, saveLabels });
  const recs = records();
  const found = known ? { entry: known } : lookUp(p, recs);
  const pictures = await picturesOf(p, local);
  const origin = p.event === 'upload' ? 'upload' : 'scanner';
  const merging = !!(found.record || found.library || found.entry?.merged_into || found.entry?.library_id);

  // An entry for her, new or as she was, with what this event brings; nothing she has is overwritten
  let e = found.entry || { slug: newSlug(p.name || p.key, p.key), key: p.key, origin, status: 'undecided', merged_into: found.record || null, library_id: found.library?.id ?? null };
  const target = e.merged_into;
  const [site, slug] = target ? target.split('/') : ['discover', e.slug];
  const dir = path.join(DATA, site, slug);
  const added = writePictures(dir, target ? 'd' : '', pictures);
  e = {
    ...e,
    name: e.name || p.name || null,
    aliases: union(e.aliases, p.aliases), links: union(e.links, p.links), sources: union(e.sources, p.sources), members: union(e.members, p.members),
    pictures: union(e.pictures, added), profile: e.profile || p.profile || null,
    best_score: Math.max(e.best_score ?? -1, p.best_score ?? -1) >= 0 ? Math.max(e.best_score ?? -1, p.best_score ?? -1) : null,
    pool_score: p.pool_score ?? e.pool_score ?? null, decided_at: p.decided_at || new Date().toISOString(),
  };

  const lab = labels();
  const labelKey = `${site}/${slug}`;
  let status = e.status;
  if (p.event === 'upload') e.origin = 'upload';
  if (merging || (p.event === 'upload' && !p.verdict)) {
    // decided on the profile page, not here: what she had there goes, and is kept in the entry
    status = 'undecided';
    const twin = recs.get(labelKey)?.babepedia_slug && `babepedia/${recs.get(labelKey).babepedia_slug}`;
    // only the first time: a verdict given on the profile page after that is its own
    if (!found.entry) {
      for (const k of [labelKey, twin]) {
        if (k && lab[k]) { e.was_verdict ||= lab[k]; delete lab[k]; }
      }
    } else if (!merging && found.entry.origin === 'upload' && lab[labelKey]?.source === 'discover') {
      // an upload's own entry, sent undecided after a send with a verdict: that verdict goes, as a Put back takes it
      delete lab[labelKey];
    }
    e.update_mark = null;
  } else if (p.event === 'update') {
    e.update_mark = p.update === 'red' || p.update === 'green' ? p.update : null;
  } else {
    // keep / delete, or an upload sent with its verdict
    const verdict = p.event === 'upload' ? p.verdict : p.verdict || p.event;
    status = verdict === 'keep' ? 'kept' : 'deleted';
    e.update_mark = null;
    setVerdict(lab, labelKey, verdict, current());
  }
  e.status = status;
  const saved = entries.save(e);
  saveLabels(lab);
  return {
    result: found.entry && !merging ? 'updated' : merging ? 'merged' : 'created',
    performer_id: saved.library_id ?? saved.id,
    status,
  };
}

/** Put back on Discover: her own entry undecided again, without the verdict Discover gave it. No pictures are read. */
function undecide(known, { labels, saveLabels }) {
  if (!known) return { result: 'none', performer_id: null, status: 'undecided' };
  if (known.merged_into || known.library_id) return { result: 'unchanged', performer_id: known.library_id ?? known.id, status: known.status };
  const lab = labels();
  const labelKey = `discover/${known.slug}`;
  if (lab[labelKey]?.source === 'discover') delete lab[labelKey];
  const saved = entries.save({ ...known, status: 'undecided', update_mark: null, decided_at: new Date().toISOString() });
  saveLabels(lab);
  return { result: 'updated', performer_id: saved.id, status: 'undecided' };
}

module.exports = { applyEvent };
