/**
 * Performer Management's model: pure functions, no React. The page (pages/PerformerManagementPageNew.js), its rows
 * (PerformerRow: rowActions, rowFlags), the Library's pairs (libraryPairs), the Duplicates view (duplicateSections) and
 * the detail panel all read the views, filters, sorts, actions and their disabled reasons from here, so a row and its
 * detail never disagree about what can be done and why not.
 *
 * Rows come from GET /api/performer-management/all (and GET /:id). A record's own folder is `actualPath` (never a
 * twin's); `twinIds` are her other records of the same name under the same library folder; `expectedPath` is where her
 * folder should be.
 *
 * Action = { key, label, disabled: reason | null, busy, busyLabel?, danger?, to?, href? }. A link carries `to` (in-app)
 * or `href` (another site) and is rendered as a link, never passed to run().
 * Ctx = { view, filter, byId, job(id), pendingOf(id), checkingId, hashBusy(id, otherId?), unlabelled(p) } (buildCtx).
 *
 * The one React part: performerViews(), the sidebar's View list of the page and of the hash results page.
 */
import React from 'react';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import UpdateIcon from '@mui/icons-material/Update';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

export const VIEWS = [
  { id: 'library', label: 'Library' },
  { id: 'updates', label: 'Updates' },
  { id: 'duplicates', label: 'Duplicates' }
];

export const FILTERS = {
  library: [
    { id: 'all', label: 'All' },
    { id: 'before', label: 'Before' },
    { id: 'after', label: 'After' },
    { id: 'missing', label: 'Missing' },
    { id: 'blacklisted', label: 'Blacklisted' }
  ],
  updates: [
    { id: 'linked', label: 'Linked' },
    { id: 'new', label: 'New' },
    { id: 'failed', label: 'Check failed' },
    { id: 'unchecked', label: 'Not checked' },
    { id: 'nolink', label: 'No link' }
  ],
  // the Duplicates view: hash duplicates only, in two sections (DuplicatesView.js); a tile per section. Before/After
  // pairs are on the Library (libraryPairs)
  duplicates: [
    { id: 'all', label: 'Needs attention' },
    { id: 'own', label: 'Duplicates in her files' },
    { id: 'nohash', label: 'No hash database' }
  ]
};

export const SORTS = {
  library: [
    { id: 'name', label: 'Name, A to Z' },
    { id: 'name-desc', label: 'Name, Z to A' },
    { id: 'size', label: 'Size, largest first' },
    { id: 'size-asc', label: 'Size, smallest first' }
  ],
  updates: [
    { id: 'newest', label: 'Newest upload first' },
    { id: 'name', label: 'Name, A to Z' },
    { id: 'size', label: 'Size, largest first' }
  ],
  duplicates: [
    { id: 'name', label: 'Name, A to Z' },
    { id: 'size', label: 'Size, largest first' },
    { id: 'hashed', label: 'Hash files, most first' }
  ]
};

/** The busy word of each action that runs a request from the row (pendingOf(id).label). */
export const BUSY_WORDS = {
  rename: 'Renaming…',
  rescan: 'Rescanning…',
  'mark-seen': 'Marking…',
  'check-now': 'Checking…',
  unblacklist: 'Unblacklisting…',
  'move-after': 'Moving…',
  'merge-pair': 'Moving…',
  'move-before': 'Moving…',
  'hash-check': 'Checking…',
  'hash-compare-twin': 'Checking…'
};

export const resolveView = (v) => (VIEWS.some(x => x.id === v) ? v : VIEWS[0].id);
export const resolveFilter = (view, f) => {
  const list = FILTERS[resolveView(view)];
  return list.some(x => x.id === f) ? f : list[0].id;
};
export const resolveSort = (view, s) => {
  const list = SORTS[resolveView(view)];
  return list.some(x => x.id === s) ? s : list[0].id;
};

// ── facts of one row ─────────────────────────────────────────
const isBlacklisted = (p) => p.blacklisted === 1 || p.location === 'blacklisted';
const hasFolder = (p) => !!p.folderExists && !!p.actualPath;
const counts = (p) => ({ pics: p.pics_count || 0, vids: p.vids_count || 0, scripted: p.funscript_vids_count || 0 });

/** 'before' | 'after': where her record is. By location; for an empty, missing or blacklisted record by her folder's path, else by moved_to_after. */
export function sideOf(p) {
  if (p.location === 'before' || p.location === 'after') return p.location;
  const m = /[\\/](after|before) filter performer[\\/][^\\/]+[\\/]?$/i.exec(p.actualPath || '');
  if (m) return m[1].toLowerCase();
  return p.moved_to_after === 1 ? 'after' : 'before';
}

export function locationWord(p) {
  if (isBlacklisted(p)) return 'Blacklisted';
  if (p.location === 'before') return 'Before';
  if (p.location === 'after') return 'After';
  return p.folderExists ? 'Empty' : 'Missing';
}

const TONE = { Before: 'var(--warn)', After: 'var(--ok)', Missing: 'var(--bad)', Empty: 'var(--bad)', Blacklisted: 'var(--muted)' };
export const locationTone = (p) => TONE[locationWord(p)];

/** Where she stands on Leakhaven: none | unchecked | failed | new | current */
export function leakhavenState(p) {
  const upd = p.leakshavenUpdate || {};
  if (!upd.url) return 'none';
  if (upd.error) return 'failed';
  if (!upd.lastCheckDate) return 'unchecked';
  return upd.newestUpload && !upd.acknowledged ? 'new' : 'current';
}

/** Her twin in the other location (Before <-> After), or null. */
export function twinOf(p, ctx) {
  if (!p || !Array.isArray(p.twinIds) || !p.twinIds.length || !ctx?.byId) return null;
  const home = p.location === 'before' || p.location === 'after' ? p.location : sideOf(p);
  const other = home === 'before' ? 'after' : 'before';
  for (const id of p.twinIds) {
    const r = ctx.byId.get(id);
    if (r && r.location === other) return r;
  }
  return null;
}

/**
 * Her other record on that side ('after' | 'before') whose folder is on disk, whatever its location word (an Empty
 * record counts): the record the server's move-to-after merges her into, or the Before folder that blocks a move back.
 */
export function folderTwinOn(p, side, ctx) {
  if (!p || !Array.isArray(p.twinIds) || !ctx?.byId) return null;
  for (const id of p.twinIds) {
    const r = ctx.byId.get(id);
    if (r && r.folderExists && sideOf(r) === side) return r;
  }
  return null;
}

/** Her first other record of the same name (any location), or null. */
function anyTwin(p, ctx) {
  if (!Array.isArray(p.twinIds) || !ctx?.byId) return null;
  for (const id of p.twinIds) {
    const r = ctx.byId.get(id);
    if (r) return r;
  }
  return null;
}

/**
 * Her Before record with a record in After: one pair, counted and listed by its Before record. Both ways: the After
 * record's own Before twin must be this one, so two Before records of one name never share her After record.
 */
const isPair = (p, ctx) => {
  if (p?.location !== 'before') return false;
  const after = twinOf(p, ctx);
  return after?.location === 'after' && twinOf(after, ctx)?.id === p.id;
};
/** Her latest check of her own files left duplicates open. */
const hasOwnDuplicates = (p) => !!p.hasHashDB && (Number(p.internal_duplicate_count) || 0) > 0;

/** The pair her record belongs to, { key, before, after }, or null: a Before record and her After twin, either way. */
export function pairOf(p, ctx) {
  if (!p) return null;
  if (isPair(p, ctx)) return { key: `pair-${p.id}`, before: p, after: twinOf(p, ctx) };
  if (p.location !== 'after') return null;
  const before = twinOf(p, ctx);
  // her Before twin's own After twin must be this record (two After records of one name: the other one pairs)
  if (!before || !isPair(before, ctx) || twinOf(before, ctx)?.id !== p.id) return null;
  return { key: `pair-${before.id}`, before, after: p };
}

/**
 * The Library's rows (already filtered, searched and sorted) split in two: pairs [{ key, before, after }], every pair
 * of which EITHER record is in the rows, whole (its other record comes from ctx.byId), in the order of its first record;
 * and rest, the rows in no pair. A pair's records are never in rest.
 */
export function libraryPairs(rows, ctx) {
  const pairs = [];
  const seen = new Set();
  const inPair = new Set();
  for (const p of rows || []) {
    const x = pairOf(p, ctx);
    if (!x) continue;
    inPair.add(p.id);
    if (seen.has(x.key)) continue;
    seen.add(x.key);
    inPair.add(x.before.id).add(x.after.id);
    pairs.push(x);
  }
  return { pairs, rest: (rows || []).filter(p => !inPair.has(p.id)) };
}

/** The Duplicates view's sections from its rows (already filtered, searched and sorted): own (open duplicates in her own files), nohash. */
export function duplicateSections(rows) {
  const own = [];
  const nohash = [];
  for (const p of rows || []) {
    if (hasOwnDuplicates(p)) own.push(p);
    if (!p.hasHashDB) nohash.push(p);
  }
  return { own, nohash };
}

export const newCount = (list) => (list || []).filter(p => !isBlacklisted(p) && leakhavenState(p) === 'new').length;

/** Build missing: with a folder, not blacklisted, no hash database, not queued. */
export const missingHashList = (list, ctx) => (list || []).filter(p => !isBlacklisted(p) && p.folderExists && !p.hasHashDB && !ctx?.job?.(p.id));

// ── formatting ───────────────────────────────────────────────
/** A Date from an ISO string, an SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) or epoch seconds/ms; null when it does not parse. */
export function parseDate(v) {
  if (v == null || v === '') return null;
  let d;
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else {
    const s = String(v).trim();
    d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

export const thumbUrl = (p) => (p?.thumbnail ? `/api/files/preview?path=${encodeURIComponent(p.thumbnail)}` : undefined);
export const rawUrl = (p) => (p?.thumbnail ? `/api/files/raw?path=${encodeURIComponent(p.thumbnail)}` : undefined);

/** 'before filter performer/Lina Soto' from an absolute path: the last two segments. */
export function relPath(abs) {
  if (!abs) return '';
  return String(abs).split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
}

export function formatSize(gb) {
  const n = Number(gb);
  if (!n || n <= 0) return '0 GB';
  if (n < 0.05) return '<0.1 GB';
  return `${n.toFixed(1)} GB`;
}

export const formatNumber = (n) => Number(n || 0).toLocaleString('en-GB');

// fixed month names: newer browsers write 'Sept' for en-GB
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '3 Nov 2026' (local date) */
export function formatDay(iso) {
  const d = parseDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** '10 Nov 2026, 09:12' */
export function formatDayTime(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return `${formatDay(d.toISOString())}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** 'today', 'yesterday', '3 days ago', '2 months ago', '1 year ago' */
export function timeAgo(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} month${m === 1 ? '' : 's'} ago`;
  }
  const y = Math.floor(days / 365);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

/** Whole years from `born` when it parses as a date, else the stored age (or null). */
export function ageOf(p) {
  const born = p?.born ? new Date(String(p.born).split(' (')[0]) : null;
  if (born && !Number.isNaN(born.getTime())) {
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age--;
    if (age > 0 && age < 120) return age;
  }
  return p?.age ? Number(p.age) : null;
}

/** The link as text: without its scheme and decoded; the raw URL when it does not decode. */
export function decodeLink(url) {
  if (!url) return '';
  try {
    return decodeURIComponent(String(url).replace(/^https?:\/\//i, ''));
  } catch (e) {
    return String(url);
  }
}

const plural = (n, word, many = `${word}s`) => `${formatNumber(n)} ${n === 1 ? word : many}`;

// ── views, filters, sorts ────────────────────────────────────
const UNIVERSE = {
  library: () => true,
  updates: (p) => !isBlacklisted(p),
  duplicates: (p) => !isBlacklisted(p) && !!p.folderExists
};

const TESTS = {
  library: {
    all: () => true,
    before: (p) => !isBlacklisted(p) && p.location === 'before',
    after: (p) => !isBlacklisted(p) && p.location === 'after',
    missing: (p) => !isBlacklisted(p) && p.location === 'missing-or-empty',
    blacklisted: (p) => isBlacklisted(p)
  },
  updates: {
    linked: (p) => leakhavenState(p) !== 'none',
    new: (p) => leakhavenState(p) === 'new',
    failed: (p) => leakhavenState(p) === 'failed',
    unchecked: (p) => leakhavenState(p) === 'unchecked',
    nolink: (p) => leakhavenState(p) === 'none'
  },
  duplicates: {
    all: (p) => hasOwnDuplicates(p) || !p.hasHashDB,
    own: (p) => hasOwnDuplicates(p),
    nohash: (p) => !p.hasHashDB
  }
};

const cmpName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
const tie = (a, b) => cmpName(a, b) || (a.id - b.id);
const size = (p) => Number(p.total_size_gb) || 0;
const newest = (p) => parseDate(p.leakshavenUpdate?.newestUpload)?.getTime() ?? null;

const SORTERS = {
  name: (a, b) => tie(a, b),
  'name-desc': (a, b) => cmpName(b, a) || (a.id - b.id),
  size: (a, b) => (size(b) - size(a)) || tie(a, b),
  'size-asc': (a, b) => (size(a) - size(b)) || tie(a, b),
  hashed: (a, b) => ((b.hashStats?.fileCount || 0) - (a.hashStats?.fileCount || 0)) || tie(a, b),
  newest: (a, b) => {
    const x = newest(a);
    const y = newest(b);
    if (x == null && y == null) return tie(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (y - x) || tie(a, b);
  }
};

const matches = (p, q) => {
  if (!q) return true;
  if (String(p.name || '').toLowerCase().includes(q)) return true;
  return Array.isArray(p.aliases) && p.aliases.some(a => String(a).toLowerCase().includes(q));
};

export function universeCount(list, view, ctx) {
  const inUniverse = UNIVERSE[resolveView(view)];
  return (list || []).filter(p => inUniverse(p, ctx)).length;
}

/** Per filter of the view: how many of her universe pass it (before search). */
export function filterCounts(list, view, ctx) {
  const v = resolveView(view);
  const inUniverse = UNIVERSE[v];
  const out = {};
  for (const f of FILTERS[v]) out[f.id] = 0;
  for (const p of list || []) {
    if (!inUniverse(p, ctx)) continue;
    for (const f of FILTERS[v]) if (TESTS[v][f.id](p, ctx)) out[f.id]++;
  }
  return out;
}

/** The rows shown: universe ∩ filter ∩ search, sorted. */
export function viewList(list, { view, filter, sort, q }, ctx) {
  const v = resolveView(view);
  const test = TESTS[v][resolveFilter(v, filter)];
  const inUniverse = UNIVERSE[v];
  const needle = String(q || '').trim().toLowerCase();
  const rows = (list || []).filter(p => inUniverse(p, ctx) && test(p, ctx) && matches(p, needle));
  return rows.sort(SORTERS[resolveSort(v, sort)]);
}

// ── context ──────────────────────────────────────────────────
export function buildCtx({ view, filter, byId, hashQueue, job, pendingOf, checkingId = null, hashBusy, unlabelled } = {}) {
  const v = resolveView(view);
  const queue = Array.isArray(hashQueue) ? hashQueue : [];
  return {
    view: v,
    filter: resolveFilter(v, filter),
    byId: byId || new Map(),
    job: typeof job === 'function'
      ? (id) => job(id) || null
      : (id) => queue.find(j => j.performerId === id && (j.status === 'queued' || j.status === 'processing')) || null,
    pendingOf: typeof pendingOf === 'function' ? pendingOf : () => null,
    checkingId,
    hashBusy: typeof hashBusy === 'function' ? hashBusy : () => false,
    unlabelled: typeof unlabelled === 'function' ? unlabelled : () => 0
  };
}

// ── actions ──────────────────────────────────────────────────
const NO_FOLDER = 'Her folder is missing';
const BLACKLISTED = 'She is blacklisted';
const NEEDS_HASH = 'Needs a hash database';

const firstReason = (...reasons) => reasons.find(Boolean) || null;

/** The reason she cannot get a hash build now, or null. */
function hashBuildReason(p, ctx) {
  const job = ctx.job(p.id);
  return firstReason(
    isBlacklisted(p) && BLACKLISTED,
    !hasFolder(p) && NO_FOLDER,
    job && (job.status === 'processing' ? 'Hashing now, see Jobs' : 'Queued, see Jobs')
  );
}

/** One action by key, with its default (menu) label, before the row's pending state is applied. */
function base(p, ctx, key) {
  const side = sideOf(p);
  const upd = p.leakshavenUpdate || {};
  const twin = twinOf(p, ctx);
  switch (key) {
    case 'gallery':
      return { label: 'Open gallery', to: `/p/${p.id}`, disabled: firstReason(side !== 'after' && 'Only for a record in After', !hasFolder(p) && NO_FOLDER) };
    case 'filter':
      return { label: 'Open in Filter', to: `/filter/${p.id}`, disabled: firstReason(side !== 'before' && 'Only for a record in Before', !hasFolder(p) && NO_FOLDER) };
    case 'rename':
      return { label: 'Rename…' };
    case 'scrape':
      return { label: 'Scrape…' };
    case 'rescan':
      return { label: 'Rescan folder', disabled: firstReason(isBlacklisted(p) && BLACKLISTED, !hasFolder(p) && NO_FOLDER) };
    case 'leakhaven-open':
      return { label: 'Open on Leakhaven', href: upd.url || undefined, disabled: upd.url ? null : 'No link' };
    case 'leakhaven-set':
      return { label: upd.url ? 'Change Leakhaven link…' : 'Set Leakhaven link…' };
    case 'pipeline':
      return { label: 'Labels and funscripts…', disabled: firstReason(!hasFolder(p) && NO_FOLDER, !(p.vids_count > 0) && 'She has no videos') };
    case 'hash-build':
      return { label: p.hasHashDB ? 'Rebuild hash database…' : 'Build hash database', disabled: hashBuildReason(p, ctx) };
    case 'hash-check':
      return { label: 'Find duplicates in her files', disabled: p.hasHashDB ? null : NEEDS_HASH, busy: !!ctx.hashBusy(p.id), busyLabel: 'Checking…' };
    case 'hash-compare':
      return { label: 'Compare with…', disabled: p.hasHashDB ? null : NEEDS_HASH };
    case 'hash-compare-twin':
      return {
        label: 'Compare with her After record',
        disabled: firstReason(!(p.location === 'before' && twin) && 'She has no record in After', twin && !(p.hasHashDB && twin.hasHashDB) && 'Both need a hash database'),
        busy: !!(twin && ctx.hashBusy(p.id, twin.id)),
        busyLabel: 'Checking…'
      };
    case 'hash-build-pair': {
      const missing = [p, twin].filter(r => r && !r.hasHashDB);
      return {
        label: 'Build hashes',
        disabled: firstReason(
          !twin && 'She has no record in After',
          twin && !missing.length && 'Both have a hash database',
          missing.length > 0 && missing.every(r => hashBuildReason(r, ctx)) && hashBuildReason(missing[0], ctx)
        )
      };
    }
    case 'hash-results':
      return {
        label: 'Open duplicates',
        to: p.latest_internal_run_id ? `/hash-results/${p.latest_internal_run_id}` : undefined,
        disabled: firstReason(!p.latest_internal_run_id && 'Find duplicates first', !hasOwnDuplicates(p) && 'No duplicates open')
      };
    case 'hash-delete':
      return { label: 'Delete hash database…', disabled: p.hasHashDB ? null : NEEDS_HASH };
    case 'move-after':
    case 'merge-pair':
      return {
        label: key === 'merge-pair' ? 'Move into After…' : (side === 'before' && folderTwinOn(p, 'after', ctx) ? 'Move into her After record…' : 'Move to After…'),
        disabled: firstReason(isBlacklisted(p) && BLACKLISTED, !hasFolder(p) && NO_FOLDER, side !== 'before' && 'Only for a record in Before')
      };
    case 'move-before':
      return {
        label: 'Move back to Before…',
        danger: false,
        disabled: firstReason(isBlacklisted(p) && BLACKLISTED, !hasFolder(p) && NO_FOLDER, side !== 'after' && 'Only for a record in After',
          side === 'after' && folderTwinOn(p, 'before', ctx) && 'A Before folder of her name exists')
      };
    case 'merge':
      return { label: 'Merge into another performer…' };
    case 'remove':
      return { label: 'Delete or manage…', danger: true };
    case 'unblacklist':
      return { label: 'Unblacklist', disabled: isBlacklisted(p) ? null : 'She is not blacklisted' };
    case 'mark-seen':
      return { label: 'Mark seen', disabled: leakhavenState(p) === 'new' ? null : 'No new upload' };
    case 'check-now':
      return { label: 'Check now', disabled: upd.url ? null : 'No link', busy: ctx.checkingId === p.id, busyLabel: 'Checking…' };
    default:
      return null;
  }
}

/** An action with the row's pending state applied: the pending one is busy, every other one disabled. */
function make(p, ctx, key, label) {
  const b = base(p, ctx, key);
  if (!b) return null;
  const a = { key, label: label || b.label, disabled: b.disabled || null, busy: !!b.busy, busyLabel: b.busyLabel || BUSY_WORDS[key], danger: !!b.danger };
  if (b.to) a.to = b.to;
  if (b.href) a.href = b.href;
  const pend = ctx.pendingOf?.(p.id);
  if (pend) {
    if (pend.key === key) { a.busy = true; a.busyLabel = pend.label || a.busyLabel; a.disabled = null; }
    else a.disabled = `Busy: ${pend.label}`;
  }
  return a;
}

/** The move item of the menu: Before records move to After, After records back to Before. */
const moveKey = (p) => (sideOf(p) === 'after' ? 'move-before' : 'move-after');

function slotsFor(p, ctx) {
  const state = leakhavenState(p);
  if (ctx.view === 'updates') {
    const one = state === 'new' ? make(p, ctx, 'mark-seen')
      : state === 'none' ? make(p, ctx, 'leakhaven-set', 'Set link')
        : make(p, ctx, 'check-now');
    return [one, make(p, ctx, 'leakhaven-open', 'Leakhaven')];
  }
  if (ctx.view === 'duplicates') {
    const job = ctx.job(p.id);
    let one;
    if (job && job.status === 'processing') {
      one = { ...make(p, ctx, 'hash-build', `Hashing ${Math.round(job.progress || 0)}%`), disabled: 'Hashing now, see Jobs', busy: false };
    } else if (job) {
      one = { ...make(p, ctx, 'hash-build', 'Queued'), disabled: 'Queued, see Jobs', busy: false };
    } else if (!p.hasHashDB) {
      one = make(p, ctx, 'hash-build', 'Build hash');
    } else {
      one = make(p, ctx, 'hash-check', 'Find duplicates');
    }
    return [one, make(p, ctx, 'hash-compare')];
  }
  // library
  let one;
  if (isBlacklisted(p)) one = make(p, ctx, 'unblacklist');
  else if (p.location === 'missing-or-empty') one = p.folderExists ? make(p, ctx, 'rescan', 'Rescan') : make(p, ctx, 'remove', 'Delete or manage…');
  else if (p.location === 'before') one = make(p, ctx, 'filter', 'Filter');
  else one = make(p, ctx, 'gallery', 'Gallery');
  return [one, make(p, ctx, 'scrape')];
}

export function actionsFor(p, ctx) {
  const linked = !!p.leakshavenUpdate?.url;
  const menu = [
    make(p, ctx, 'gallery'),
    make(p, ctx, 'filter'),
    'divider',
    make(p, ctx, 'rename'),
    make(p, ctx, 'scrape'),
    make(p, ctx, 'rescan'),
    linked ? make(p, ctx, 'leakhaven-open') : make(p, ctx, 'leakhaven-set'),
    make(p, ctx, 'pipeline'),
    'divider',
    make(p, ctx, 'hash-build'),
    make(p, ctx, 'hash-check'),
    make(p, ctx, 'hash-compare'),
    make(p, ctx, 'hash-delete'),
    'divider',
    make(p, ctx, moveKey(p)),
    make(p, ctx, 'merge'),
    make(p, ctx, 'remove')
  ];
  return { slots: slotsFor(p, ctx), menu };
}

/**
 * The row's icon buttons in their groups, every one always there (a disabled one says why), so the groups line up
 * from row to row: [{ id, label, items: [Action + { tip?, spin? }] }]. Leakhaven is there only with something to do:
 * Mark seen when she has a new upload, Check now in the Updates view.
 */
export function rowActions(p, ctx) {
  const side = sideOf(p);
  const job = ctx.job(p.id);
  const open = isBlacklisted(p) ? make(p, ctx, 'unblacklist')
    : side === 'after' ? make(p, ctx, 'gallery') : make(p, ctx, 'filter');
  const build = make(p, ctx, 'hash-build');
  if (job) {
    build.label = job.status === 'processing' ? `Hashing ${Math.round(job.progress || 0)}%` : 'Queued for hashing';
    build.spin = true;
  } else if (!build.disabled && p.hasHashDB) {
    build.tip = `Rebuild her hash database (${formatNumber(p.hashStats?.fileCount || 0)} files)`;
  }
  const groups = [];
  const leak = [];
  if (leakhavenState(p) === 'new') leak.push(make(p, ctx, 'mark-seen'));
  if (ctx.view === 'updates' && p.leakshavenUpdate?.url) leak.push(make(p, ctx, 'check-now', 'Check Leakhaven now'));
  if (leak.length) groups.push({ id: 'leakhaven', label: 'Leakhaven', items: leak });
  groups.push(
    {
      id: 'performer',
      label: 'Performer',
      items: [open, make(p, ctx, 'rename'), make(p, ctx, 'scrape'), make(p, ctx, 'rescan'), make(p, ctx, 'merge'), make(p, ctx, 'remove')]
    },
    { id: 'hash', label: 'Hash database', items: [build, make(p, ctx, 'hash-check'), make(p, ctx, 'hash-compare')] },
    { id: 'labels', label: 'Labels and funscripts', items: [make(p, ctx, 'pipeline')] }
  );
  return groups;
}

/**
 * The row's one line after the counts: small labels with a dot or an icon, each with its tooltip.
 * [{ key, label, tone, tip, strong?, icon?: 'scrape' | 'leakhaven' state, action?: key, href?, to?, copy? }]
 * tone is a token: the dot's colour (dot labels) or the text's (icon labels).
 */
export function rowFlags(p, ctx) {
  const out = [];
  const job = ctx.job(p.id);
  const hs = p.hashStats || {};

  // hash database
  if (job) {
    out.push({
      key: 'hash', tone: 'var(--info)',
      label: job.status === 'processing' ? `hashing ${Math.round(job.progress || 0)}%` : 'hash queued',
      tip: job.status === 'processing'
        ? (job.total > 0 ? `Hashing ${formatNumber(job.processed || 0)} of ${formatNumber(job.total)} files, see Jobs` : 'Hashing now, see Jobs')
        : 'Queued for hashing, see Jobs'
    });
  } else if (p.hasHashDB) {
    out.push({
      key: 'hash', tone: 'var(--ok)', label: 'hash',
      tip: `Hash database: ${plural(hs.fileCount || 0, 'file')}${hs.lastUpdated ? `, built ${formatDay(hs.lastUpdated)}` : ''}`
    });
  } else {
    out.push({ key: 'hash', tone: 'var(--faint)', label: 'no hash', tip: 'No hash database' });
  }

  // open duplicates in her own files
  if (hasOwnDuplicates(p)) {
    const n = Number(p.internal_duplicate_count) || 0;
    out.push({
      key: 'dupes', tone: 'var(--warn)', label: plural(n, 'duplicate'),
      tip: `${plural(n, 'duplicate')} open in her own files. Click to open them`,
      to: p.latest_internal_run_id ? `/hash-results/${p.latest_internal_run_id}` : undefined
    });
  }

  // labels
  const vids = p.vids_count || 0;
  if (vids > 0) {
    const un = Math.min(vids, Math.max(0, Number(ctx.unlabelled(p)) || 0));
    out.push({
      key: 'labels', tone: un ? 'var(--warn)' : 'var(--ok)',
      label: un ? `${formatNumber(un)} unlabelled` : 'labelled',
      tip: `${formatNumber(vids - un)} of ${plural(vids, 'video')} labelled (scenes, dress state, tags)`
    });
  }

  // scraped
  const src = p.scraped_source === 'leakhaven' ? 'Leakhaven' : p.scraped_source;
  out.push(p.hasScrapedData
    ? {
      key: 'scrape', icon: 'scraped', tone: 'var(--ok)', label: 'scraped', action: 'scrape',
      tip: `Scraped${p.scrapedAt ? ` ${formatDay(p.scrapedAt)}` : ''}${src ? ` from ${src}` : ''}. Click to scrape again`
    }
    : { key: 'scrape', icon: 'unscraped', tone: 'var(--muted)', label: 'not scraped', action: 'scrape', tip: 'Not scraped. Click to scrape' });

  // Leakhaven
  const upd = p.leakshavenUpdate || {};
  const state = leakhavenState(p);
  if (state === 'none') {
    out.push({ key: 'leakhaven', icon: 'none', tone: 'var(--muted)', label: 'no link', action: 'scrape', tip: 'No Leakhaven link. Click to scrape' });
  } else {
    const checked = upd.lastCheckDate ? `, checked ${timeAgo(upd.lastCheckDate)}` : '';
    const f = {
      new: { tone: 'var(--bad)', strong: true, label: `new · ${timeAgo(upd.newestUpload)}`, tip: `New upload ${formatDay(upd.newestUpload)}${checked}. Click to open her Leakhaven page` },
      current: {
        tone: 'var(--dim)', label: upd.newestUpload ? timeAgo(upd.newestUpload) : 'no uploads',
        tip: `Up to date${upd.newestUpload ? `, newest upload ${formatDay(upd.newestUpload)}` : ''}${checked}. Click to open her Leakhaven page`
      },
      unchecked: { tone: 'var(--muted)', label: 'not checked', tip: 'Linked, never checked for updates. Click to open her Leakhaven page' },
      failed: { tone: 'var(--warn)', label: 'check failed', tip: `Last check failed: ${upd.error}. Click to open her Leakhaven page` }
    }[state];
    out.push({ key: 'leakhaven', icon: state, href: upd.url, ...f });
  }

  // folder
  if (p.folderExists && p.actualPath) {
    out.push({ key: 'folder', tone: 'var(--ok)', label: 'folder', tip: `${p.actualPath}. Click to copy the path`, copy: true });
  } else {
    const where = p.actualPath || p.expectedPath;
    out.push({ key: 'folder', tone: 'var(--bad)', label: p.folderExists ? 'folder empty' : 'folder missing',
      tip: where ? `${p.folderExists ? 'Empty' : 'Not found'}: ${where}. Click to copy the path` : 'No folder on record', copy: !!where });
  }
  return out;
}

/** Any action by key (menu, slot or drawer), with the same rules everywhere. `label` overrides the default label. */
export function actionOf(p, ctx, key, label) {
  if (!p) return null;
  return make(p, ctx, key, label);
}

/** The key of the move action for her (move-after or move-before), for the drawer. */
export const moveActionKey = moveKey;

// ── the meta line ────────────────────────────────────────────
function countParts(p) {
  const c = counts(p);
  return [
    c.pics > 0 && plural(c.pics, 'pic'),
    c.vids > 0 && plural(c.vids, 'vid'),
    c.scripted > 0 && `${formatNumber(c.scripted)} scripted`
  ].filter(Boolean).map(text => ({ text }));
}

/** The row's second line as parts: [{ text, tone? }], joined by ' · '. */
export function metaLine(p, view, ctx) {
  const v = resolveView(view);
  const state = leakhavenState(p);
  const upd = p.leakshavenUpdate || {};
  const parts = [];
  const add = (text, tone) => { if (text) parts.push(tone ? { text, tone } : { text }); };

  if (v === 'updates') {
    if (state === 'none') add('no Leakhaven link');
    else if (state === 'unchecked') add('linked, never checked');
    else if (state === 'failed') {
      add('check failed', 'warn');
      if (upd.error) add(String(upd.error));
    } else if (state === 'new') {
      add(`new upload ${formatDay(upd.newestUpload)}`, 'bad');
      add(timeAgo(upd.newestUpload));
    } else {
      add(upd.newestUpload ? `newest upload ${formatDay(upd.newestUpload)}` : 'no uploads listed');
    }
    if (upd.lastCheckDate) add(`checked ${timeAgo(upd.lastCheckDate)}`);
    return parts;
  }

  if (v === 'duplicates') {
    const job = ctx?.job?.(p.id);
    if (job && job.status === 'processing') {
      add(job.total > 0 ? `hashing ${formatNumber(job.processed || 0)} of ${formatNumber(job.total)}` : `hashing ${Math.round(job.progress || 0)}%`, 'info');
    } else if (job) {
      add('queued for hashing', 'info');
    }
    if (p.hasHashDB) {
      add(`${formatNumber(p.hashStats?.fileCount || 0)} files hashed`);
      if (p.hashStats?.lastUpdated) add(`built ${formatDay(p.hashStats.lastUpdated)}`);
      if (p.internal_duplicate_count > 0) add(plural(p.internal_duplicate_count, 'duplicate') + ' open', 'warn');
    } else if (!job) {
      add('no hash database');
      const c = counts(p);
      add(plural(c.pics + c.vids + c.scripted, 'file'));
    }
    return parts;
  }

  // library: the location pill says Blacklisted, Empty or Missing; the line says only what the pill does not
  if (isBlacklisted(p)) {
    if (p.blacklist_date) add(formatDay(p.blacklist_date));
    if (p.blacklist_reason) add(`"${p.blacklist_reason}"`);
    return parts;
  }
  if (p.location === 'missing-or-empty') {
    if (p.folderExists) add('0 files counted, Rescan to recount');
    else add(p.expectedPath ? `expected at ${relPath(p.expectedPath)}` : 'no folder on record');
    if (state === 'new') add('new upload', 'bad');
    return parts;
  }
  parts.push(...countParts(p));
  add(formatSize(p.total_size_gb));
  if (state === 'new') add('new upload', 'bad');
  if (!p.hasHashDB) add('no hash');
  if (!p.hasScrapedData) add('not scraped');
  return parts;
}

/** Her other records (any location) for texts: the first one, or null. */
export const otherRecordOf = anyTwin;

// ── the sidebar's View list ──────────────────────────────────
const VIEW_ICONS = { library: PeopleOutlineIcon, updates: UpdateIcon, duplicates: ContentCopyIcon };
const plainClick = (e) => !e || (!e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey);

/**
 * The View list of SidebarPage: Library (every record), Updates (new uploads), Duplicates (needs attention).
 *
 *   performerViews({ library, updates, duplicates }?, onPick?)
 *
 * counts: a number or null per view (left out: no count). Each item links to /performer-management?view=<id>, so a
 * middle or ctrl click opens a tab. onPick(id): a plain click calls it instead of following the link (the page
 * switches through its query state); without it the link is followed (pushed), as from the hash results page.
 */
let lastViewCounts = null;

/** Performer Management keeps its View list counts here, so the hash results page can show them without a fetch. */
export function rememberViewCounts(counts) {
  lastViewCounts = counts || null;
}

/** The counts Performer Management last showed ({} when it has not loaded in this tab). */
export function rememberedViewCounts() {
  return lastViewCounts || {};
}

export function performerViews(counts = {}, onPick) {
  return VIEWS.map(v => ({
    id: v.id,
    label: v.label,
    count: typeof counts?.[v.id] === 'number' ? counts[v.id] : null,
    icon: React.createElement(VIEW_ICONS[v.id]),
    to: `/performer-management?view=${v.id}`,
    title: v.id === 'updates' ? 'New uploads' : v.id === 'duplicates' ? 'Needs attention' : 'Every record',
    onClick: onPick ? (e) => {
      if (!plainClick(e)) return;
      e.preventDefault();
      onPick(v.id);
    } : undefined,
  }));
}
