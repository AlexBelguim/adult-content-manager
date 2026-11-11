/**
 * The duplicates page's data and actions: one run read as groups (a keeper and the open items pointing to it),
 * Keep / Remove choices saved as they are made, a new keeper, a dismissed match, and removal into her trash folder
 * (hashRemovals.js: marked so the trash cleanup never saves a duplicate for training), with Undo while the toast shows.
 *
 * Group state (from the DB flags, at read time):
 *   hidden        no open item whose file is live and on a removable side (nothing to decide)
 *   ok            the keeper is live
 *   choose_keeper the keeper is not live, 2+ live members and one of them may be keeper
 *   orphan        otherwise: the live file(s) matched only files that are gone
 * Effective selection = ticked, open, live, removable side, not changed since the check, and (ok, or orphan ticked
 * by the user).
 * Changed since the check (from the DB, so a hash rebuild cannot hide it): the item was stored as an exact copy and
 * is not one any more, or the member's or the keeper's row has an mtime after the run was made.
 *
 * Reads never write. Disk and picture checks run only for the groups returned.
 */
const fsp = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const db = require('../db');
const hashService = require('./hashService');
const hashRemovals = require('./hashRemovals');

const {
  HashError, CONFIG, mediaTypeOf, isPlayable, parsePhash, phashDistance, similarityOf,
  performerOfPath, folderOf, libraryRootOf, recountInternal, notify,
} = hashService;

const MAX_DIST = CONFIG.maxDistance;

// ── helpers ────────────────────────────────────────────────────

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function requireInt(value, what) {
  const n = toInt(value);
  if (n == null) throw new HashError(400, 'bad_request', `${what} must be a whole number`);
  return n;
}

function requireIdList(list, what, { min = 0, max = 10000 } = {}) {
  if (!Array.isArray(list)) throw new HashError(400, 'bad_request', `${what} must be a list`);
  if (list.length > max) throw new HashError(400, 'bad_request', `At most ${max} ${what} at a time`);
  const out = [];
  const seen = new Set();
  for (const v of list) {
    const n = toInt(v);
    if (n == null) throw new HashError(400, 'bad_request', `${what} must be whole numbers`);
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  if (out.length < min) throw new HashError(400, 'empty', 'Nothing to remove.');
  return out;
}

function fmtBytes(n) {
  if (n == null) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} B` : `${v.toFixed(1)} ${units[i]}`;
}

async function mapLimit(list, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const idx = i++;
      await fn(list[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

/** Cached reachability of library roots for one request. */
function makeReach() {
  const cache = new Map();
  return (root) => {
    if (!root) return Promise.resolve(true);
    if (!cache.has(root)) {
      cache.set(root, fsp.stat(root).then((st) => st.isDirectory()).catch(() => false));
    }
    return cache.get(root);
  };
}

function makeRootOf() {
  const byOwner = new Map();
  return (row) => {
    const info = performerOfPath(row.file_path);
    if (info && info.root) return info.root;
    if (!byOwner.has(row.performer_id)) byOwner.set(row.performer_id, libraryRootOf(row.performer_id));
    return byOwner.get(row.performer_id);
  };
}

/** { state: 'yes'|'no'|'changed'|'unknown', current, stat } for a hash row. */
async function diskState(row, reach, rootOf) {
  const root = rootOf(row);
  if (root && !(await reach(root))) return { state: 'unknown', current: null, stat: null };
  try {
    const st = await fsp.stat(row.file_path);
    if (!st.isFile()) return { state: 'no', current: null, stat: null };
    const mtime = Math.floor(st.mtimeMs / 1000);
    if (st.size !== row.file_size || row.mtime == null || Math.abs(mtime - row.mtime) > 2) {
      return { state: 'changed', current: { size: st.size, mtime }, stat: st };
    }
    return { state: 'yes', current: null, stat: st };
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { state: 'no', current: null, stat: null };
    return { state: 'unknown', current: null, stat: null };
  }
}

const dimsCache = new Map(); // path|size|mtime -> { width, height, duration }
async function dimensionsOf(row, stat) {
  const key = `${row.file_path}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
  if (dimsCache.has(key)) return dimsCache.get(key);
  let out = { width: null, height: null, duration: null };
  try {
    if (mediaTypeOf(row.file_path) === 'vid') {
      const p = db.prepare('SELECT size, width, height, duration FROM media_probe WHERE path = ?').get(row.file_path);
      if (p && p.size === stat.size) {
        out = { width: p.width || null, height: p.height || null, duration: p.duration || null };
      }
    } else {
      const m = await sharp(row.file_path, { failOn: 'none' }).metadata();
      if (m && m.width && m.height) {
        const swap = m.orientation >= 5 && m.orientation <= 8;
        out = { width: swap ? m.height : m.width, height: swap ? m.width : m.height, duration: null };
      }
    }
  } catch (_) { /* unknown */ }
  if (dimsCache.size > 5000) dimsCache.delete(dimsCache.keys().next().value);
  dimsCache.set(key, out);
  return out;
}

// ── the run ────────────────────────────────────────────────────

function loadRun(runId) {
  const r = db.prepare('SELECT * FROM hash_runs WHERE run_id = ?').get(String(runId));
  if (!r) throw new HashError(404, 'run_not_found', 'Run not found');
  let meta = {};
  try { meta = JSON.parse(r.metadata || '{}') || {}; } catch (_) { meta = {}; }
  const perf = db.prepare('SELECT id, name, moved_to_after, hash_verified FROM performers WHERE id = ?');
  const s = perf.get(r.source_performer_id);
  const t = r.target_performer_id === r.source_performer_id ? s : perf.get(r.target_performer_id);
  const side = (p, id) => ({
    id,
    name: p ? p.name : `Performer ${id}`,
    location: p ? (p.moved_to_after === 1 ? 'after' : 'before') : null,
  });
  const internal = r.source_performer_id === r.target_performer_id;
  return {
    id: r.run_id,
    internal,
    kind: internal ? 'internal' : 'compare',
    status: r.status || 'pending',
    error: meta.error || null,
    createdAt: (r.created_at || 0) * 1000,
    source: side(s, r.source_performer_id),
    target: side(t, r.target_performer_id),
    verified: internal && !!s && s.hash_verified === 1,
    meta,
  };
}

function historyOf(row) {
  if (row.deleted_flag === 1) return 'deleted_before';
  if (row.deleted_flag === 2) return 'removed';
  return null;
}

function directMatch(a, b) {
  if (a.exact_hash && a.exact_hash === b.exact_hash) return true;
  const pa = parsePhash(a.perceptual_hash);
  const pb = parsePhash(b.perceptual_hash);
  return !!(pa && pb && phashDistance(pa, pb) <= MAX_DIST);
}

function baseMember(row, extra) {
  const type = mediaTypeOf(row.file_path);
  const info = performerOfPath(row.file_path);
  return {
    fileId: row.id,
    itemId: null,
    isKeeper: false,
    path: row.file_path,
    name: path.basename(row.file_path),
    folder: folderOf(row.file_path),
    location: info ? info.location : null,
    ownerId: row.performer_id,
    ownerName: row.owner_name || row.performer_name || null,
    type,
    playable: type === 'vid' && isPlayable(row.file_path),
    size: row.file_size,
    mtime: row.mtime,
    width: null,
    height: null,
    duration: null,
    disk: 'unknown',
    current: null,
    history: historyOf(row),
    relation: 'keeper',
    similarity: null,
    distance: null,
    linkedVia: null,
    selected: false,
    selectedBy: null,
    canSelect: false,
    reason: null,
    canBeKeeper: false,
    keeperReason: null,
    ...extra,
  };
}

/**
 * Every group of the run (hidden ones included) as wrappers:
 * { key, hidden, keeperRow, g (the public Group), byFile: Map(fileId -> { member, row, item }) }
 */
function buildGroups(run) {
  const items = db.prepare(`
    SELECT id, file_id_ref, candidate_id, selected, selected_by, exact_match, hamming_distance
    FROM hash_run_items WHERE run_id = ? AND status = 'open' ORDER BY id
  `).all(run.id);
  const rows = db.prepare(`
    SELECT h.id, h.performer_id, h.performer_name, h.file_path, h.file_size, h.mtime, h.exact_hash, h.perceptual_hash,
           h.deleted_flag, p.name AS owner_name
    FROM performer_file_hashes h LEFT JOIN performers p ON p.id = h.performer_id
    WHERE h.id IN (
      SELECT file_id_ref FROM hash_run_items WHERE run_id = ? AND status = 'open'
      UNION SELECT candidate_id FROM hash_run_items WHERE run_id = ? AND status = 'open'
    )
  `).all(run.id, run.id);
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const removable = (row) => run.internal || row.performer_id === run.source.id;
  const mayKeep = (row) => run.internal || row.performer_id === run.target.id;
  const live = (row) => row.deleted_flag === 0;
  const runSec = Math.floor((run.createdAt || 0) / 1000);
  // a file dated in the future (wrong camera clock) says nothing about when it changed
  const nowSec = Math.floor(Date.now() / 1000) + 60;
  const newer = (row) => runSec > 0 && row.mtime != null && row.mtime > runSec + 2 && row.mtime <= nowSec;

  const raw = new Map();
  for (const it of items) {
    const row = rowById.get(it.file_id_ref);
    const keeper = rowById.get(it.candidate_id);
    if (!row || !keeper || row.id === keeper.id) continue;
    if (!raw.has(keeper.id)) raw.set(keeper.id, { keeper, entries: [] });
    raw.get(keeper.id).entries.push({ item: it, row });
  }

  const wrappers = [];
  for (const { keeper, entries } of raw.values()) {
    const liveRemovable = entries.filter((e) => live(e.row) && removable(e.row));
    const liveEntries = entries.filter((e) => live(e.row));
    let state;
    if (live(keeper)) state = 'ok';
    else if (liveEntries.length >= 2 && liveEntries.some((e) => mayKeep(e.row))) state = 'choose_keeper';
    else state = 'orphan';

    const kph = parsePhash(keeper.perceptual_hash);
    const keeperChanged = newer(keeper);
    const byFile = new Map();
    const keeperMember = baseMember(keeper, { isKeeper: true, reason: 'keeper', keeperReason: 'is_keeper' });
    byFile.set(keeper.id, { member: keeperMember, row: keeper, item: null });

    const members = [];
    for (const { item, row } of entries) {
      const exact = !!(row.exact_hash && row.exact_hash === keeper.exact_hash);
      const ph = parsePhash(row.perceptual_hash);
      const d = ph && kph ? phashDistance(ph, kph) : null;
      const relation = exact ? 'exact' : (d != null && d <= MAX_DIST ? 'similar' : 'linked');
      const isLive = live(row);
      const isRemovable = removable(row);
      const selfChanged = isLive && (newer(row) || (item.exact_match === 1 && !exact));
      const viaKeeperChanged = isLive && !selfChanged && keeperChanged && live(keeper);

      let canSelect = true;
      let reason = null;
      if (!isRemovable) { canSelect = false; reason = 'other_performer'; }
      else if (row.deleted_flag === 1) { canSelect = false; reason = 'deleted_before'; }
      else if (row.deleted_flag === 2) { canSelect = false; reason = 'removed'; }
      else if (selfChanged) { canSelect = false; reason = 'changed'; }
      else if (viaKeeperChanged) { canSelect = false; reason = 'keeper_changed'; }
      else if (state === 'choose_keeper') { canSelect = false; reason = 'choose_keeper'; }

      let canBeKeeper = true;
      let keeperReason = null;
      if (!mayKeep(row)) { canBeKeeper = false; keeperReason = 'other_performer'; }
      else if (row.deleted_flag === 1) { canBeKeeper = false; keeperReason = 'deleted_before'; }
      else if (row.deleted_flag === 2) { canBeKeeper = false; keeperReason = 'removed'; }
      else if (selfChanged) { canBeKeeper = false; keeperReason = 'changed'; }

      const selected = item.selected === 1 && isLive && isRemovable && !selfChanged && !viaKeeperChanged &&
        (state === 'ok' || (state === 'orphan' && item.selected_by === 'user'));

      const m = baseMember(row, {
        itemId: item.id,
        relation,
        distance: exact ? 0 : d,
        similarity: exact ? 100 : similarityOf(d),
        selected,
        selectedBy: item.selected_by || null,
        canSelect,
        reason,
        canBeKeeper,
        keeperReason,
      });
      members.push(m);
      byFile.set(row.id, { member: m, row, item });
    }

    const relOrder = { exact: 0, similar: 1, linked: 2 };
    members.sort((a, b) => {
      if (relOrder[a.relation] !== relOrder[b.relation]) return relOrder[a.relation] - relOrder[b.relation];
      const da = a.distance == null ? Infinity : a.distance;
      const dbb = b.distance == null ? Infinity : b.distance;
      if (da !== dbb) return da - dbb;
      return a.name.localeCompare(b.name);
    });
    for (const m of members) {
      if (m.relation !== 'linked') continue;
      const mine = byFile.get(m.fileId).row;
      const via = members.find((o) => o !== m && directMatch(mine, byFile.get(o.fileId).row));
      if (via) m.linkedVia = { fileId: via.fileId, name: via.name };
    }

    const g = {
      key: keeper.id,
      state,
      media: mediaTypeOf(keeper.file_path),
      counts: { members: members.length + 1, exact: 0, similar: 0, linked: 0, selected: 0 },
      selectedBytes: 0,
      minSimilarity: null,
      members: [keeperMember, ...members],
    };
    let minDistance = Infinity;
    let totalSize = keeper.file_size || 0;
    for (const m of members) {
      g.counts[m.relation] += 1;
      totalSize += m.size || 0;
      if (m.distance != null && m.distance < minDistance) minDistance = m.distance;
      if (m.relation !== 'exact' && m.similarity != null) {
        g.minSimilarity = g.minSimilarity == null ? m.similarity : Math.min(g.minSimilarity, m.similarity);
      }
    }
    recountSelected(g);
    wrappers.push({
      key: keeper.id,
      hidden: liveRemovable.length === 0,
      keeperRow: keeper,
      g,
      byFile,
      liveRemovable: liveRemovable.length,
      sortExact: g.counts.exact > 0 ? 0 : 1,
      minDistance,
      totalSize,
    });
  }

  wrappers.sort((a, b) => (a.sortExact - b.sortExact) || (a.minDistance - b.minDistance) ||
    (b.totalSize - a.totalSize) || (a.key - b.key));
  return wrappers;
}

function recountSelected(g) {
  g.counts.selected = 0;
  g.selectedBytes = 0;
  for (const m of g.members) {
    if (m.selected) { g.counts.selected += 1; g.selectedBytes += m.size || 0; }
  }
}

function selectedMembers(wrappers) {
  const out = [];
  for (const w of wrappers) for (const m of w.g.members) if (m.selected) out.push({ w, m });
  return out;
}

function summarize(wrappers) {
  const s = { count: 0, bytes: 0, exact: 0, similar: 0 };
  for (const { m } of selectedMembers(wrappers)) {
    s.count += 1;
    s.bytes += m.size || 0;
    if (m.relation === 'exact') s.exact += 1;
    else s.similar += 1;
  }
  return s;
}

function selectionOf(run) {
  return summarize(buildGroups(run));
}

/** Disk state, current numbers and dimensions for the members of the given groups, then the page-level rules. */
async function decorate(wrappers, reach = makeReach(), rootOf = makeRootOf()) {
  const tasks = [];
  for (const w of wrappers) for (const [, entry] of w.byFile) tasks.push(entry);
  await mapLimit(tasks, 8, async ({ member, row }) => {
    const d = await diskState(row, reach, rootOf);
    member.disk = d.state;
    member.current = d.state === 'changed' ? d.current : null;
    if (d.stat) Object.assign(member, await dimensionsOf(row, d.stat));
  });

  for (const w of wrappers) {
    const g = w.g;
    for (const m of g.members) {
      if (m.disk === 'no' || m.disk === 'changed') {
        const why = m.disk === 'no' ? 'not_on_disk' : 'changed';
        if (!m.isKeeper && (m.canSelect || m.reason === 'choose_keeper')) { m.canSelect = false; m.reason = why; }
        if (m.canBeKeeper) { m.canBeKeeper = false; m.keeperReason = why; }
      } else if (m.disk === 'unknown') {
        if (!m.isKeeper && m.canSelect) { m.canSelect = false; m.reason = 'library_offline'; }
        if (m.canBeKeeper) { m.canBeKeeper = false; m.keeperReason = 'library_offline'; }
      }
    }
    const keeper = g.members[0];
    if (g.state === 'ok' && keeper.disk === 'no' && keeper.history == null) {
      g.state = 'choose_keeper';
      for (const m of g.members) {
        if (m.isKeeper) continue;
        // still counted by the run's selection (it has no disk check); the page leaves these out and says why
        if (m.selected) m.waiting = true;
        m.selected = false;
        if (m.canSelect) { m.canSelect = false; m.reason = 'choose_keeper'; }
      }
      recountSelected(g);
    }
  }
}

const QUERY = {
  section: ['review', 'orphans'],
  kind: ['all', 'exact', 'similar'],
  media: ['all', 'pics', 'vids'],
  size: ['all', 'pairs', 'groups'],
};

function parseQuery(q = {}) {
  const pick = (name) => (QUERY[name].includes(q[name]) ? q[name] : QUERY[name][0]);
  const page = toInt(q.page);
  const pageSize = toInt(q.pageSize);
  const maxDistance = toInt(q.maxDistance);
  return {
    section: pick('section'),
    kind: pick('kind'),
    media: pick('media'),
    size: pick('size'),
    maxDistance: [9, 6, 3].includes(maxDistance) ? maxDistance : 9,
    page: page != null && page >= 1 ? page : 1,
    pageSize: pageSize != null ? Math.min(50, Math.max(1, pageSize)) : 20,
  };
}

function matchesFilters(w, f) {
  const { counts, media, members } = w.g;
  if (f.kind === 'exact' && counts.exact === 0) return false;
  if (f.kind === 'similar' && counts.similar + counts.linked === 0) return false;
  if (f.media === 'pics' && media !== 'pic') return false;
  if (f.media === 'vids' && media !== 'vid') return false;
  if (f.size === 'pairs' && counts.members !== 2) return false;
  if (f.size === 'groups' && counts.members < 3) return false;
  if (f.maxDistance < MAX_DIST && counts.exact === 0 &&
    !members.some((m) => !m.isKeeper && m.distance != null && m.distance <= f.maxDistance)) return false;
  return true;
}

async function getRunView(runId, query) {
  const run = loadRun(runId);
  const f = parseQuery(query);
  const all = buildGroups(run);
  const visible = all.filter((w) => !w.hidden);
  const review = visible.filter((w) => w.g.state !== 'orphan');
  const orphans = visible.filter((w) => w.g.state === 'orphan');

  const totals = { groups: review.length, orphanGroups: orphans.length, files: 0, removable: 0, exact: 0, similar: 0 };
  for (const w of review) totals.files += w.g.counts.members;
  for (const w of visible) {
    for (const m of w.g.members) {
      if (m.isKeeper) continue;
      const { row } = w.byFile.get(m.fileId);
      if (row.deleted_flag !== 0 || !(run.internal || row.performer_id === run.source.id)) continue;
      totals.removable += 1;
      if (m.relation === 'exact') totals.exact += 1;
      else totals.similar += 1;
    }
  }

  const list = f.section === 'orphans' ? orphans : review.filter((w) => matchesFilters(w, f));
  const pageCount = Math.max(1, Math.ceil(list.length / f.pageSize));
  const page = Math.min(Math.max(1, f.page), pageCount);
  const pageGroups = list.slice((page - 1) * f.pageSize, page * f.pageSize);

  const reach = makeReach();
  const rootOf = makeRootOf();
  await decorate(pageGroups, reach, rootOf);

  const roots = new Set([libraryRootOf(run.source.id), libraryRootOf(run.target.id)].filter(Boolean));
  for (const w of pageGroups) for (const [, e] of w.byFile) { const r = rootOf(e.row); if (r) roots.add(r); }
  let libraryReachable = true;
  for (const r of roots) if (!(await reach(r))) { libraryReachable = false; break; }
  const removedRow = db.prepare(`SELECT COUNT(*) AS n FROM hash_run_items WHERE run_id = ? AND status = 'removed'`).get(run.id);

  return {
    success: true,
    run: {
      id: run.id,
      kind: run.kind,
      status: run.status,
      error: run.error,
      createdAt: run.createdAt,
      source: run.source,
      target: run.target,
      verified: run.verified,
      libraryReachable,
      removedCount: removedRow ? removedRow.n : 0,
    },
    totals,
    selection: summarize(all),
    section: f.section,
    filters: { kind: f.kind, media: f.media, size: f.size, maxDistance: f.maxDistance },
    page,
    pageSize: f.pageSize,
    pageCount,
    filteredGroups: list.length,
    groups: pageGroups.map((w) => w.g),
  };
}

function itemIndex(wrappers) {
  const map = new Map();
  for (const w of wrappers) {
    for (const [, e] of w.byFile) if (e.item) map.set(e.item.id, { w, ...e });
  }
  return map;
}

// ── actions ────────────────────────────────────────────────────

function setSelection(runId, body = {}) {
  const run = loadRun(runId);
  const updated = [];
  const refused = [];
  let cleared;

  let restore;
  if (body.all === true) {
    if (body.selected !== false) throw new HashError(400, 'bad_request', 'Only { all: true, selected: false } is supported');
    // Undo puts back only what was in effect, as it was ('auto' stays 'auto'). Stored ticks that were not in
    // effect (a last copy, a changed file) are cleared too but never come back as a person's tick.
    const effective = selectedMembers(buildGroups(run))
      .map(({ m }) => ({ itemId: m.itemId, selectedBy: m.selectedBy === 'user' ? 'user' : 'auto' }));
    const ids = db.prepare(`SELECT id FROM hash_run_items WHERE run_id = ? AND status = 'open' AND selected = 1`).all(run.id).map((r) => r.id);
    const clear = db.prepare(`UPDATE hash_run_items SET selected = 0, selected_by = 'user' WHERE id = ?`);
    db.transaction(() => { for (const id of ids) clear.run(id); })();
    cleared = effective.map((e) => e.itemId);
    restore = effective;
    updated.push(...ids);
  } else if (Array.isArray(body.restore)) {
    // { restore: [{ itemId, selectedBy }] }: the Undo of a Clear
    if (body.restore.length > 10000) throw new HashError(400, 'bad_request', 'At most 10000 items at a time');
    const index = itemIndex(buildGroups(run));
    const write = db.prepare(`UPDATE hash_run_items SET selected = 1, selected_by = ? WHERE id = ? AND run_id = ? AND status = 'open'`);
    const list = body.restore.map((r) => {
      const id = toInt(r && r.itemId);
      if (id == null) throw new HashError(400, 'bad_request', 'itemId must be a whole number');
      return { id, by: r.selectedBy === 'user' ? 'user' : 'auto' };
    });
    db.transaction(() => {
      for (const { id, by } of list) {
        const e = index.get(id);
        if (!e) { refused.push({ itemId: id, reason: 'not_open' }); continue; }
        if (!e.member.canSelect) { refused.push({ itemId: id, reason: e.member.reason || 'not_removable' }); continue; }
        // a check's own tick only comes back on an exact copy of a live keeper, the way the check makes it
        if (by === 'auto' && !(e.member.relation === 'exact' && e.w.g.state === 'ok')) {
          refused.push({ itemId: id, reason: 'not_removable' });
          continue;
        }
        write.run(by, id, run.id);
        updated.push(id);
      }
    })();
  } else {
    const ids = requireIdList(body.itemIds, 'itemIds');
    if (typeof body.selected !== 'boolean') throw new HashError(400, 'bad_request', 'selected must be true or false');
    const index = itemIndex(buildGroups(run));
    const status = db.prepare('SELECT status FROM hash_run_items WHERE id = ? AND run_id = ?');
    const write = db.prepare(`UPDATE hash_run_items SET selected = ?, selected_by = 'user' WHERE id = ? AND run_id = ? AND status = 'open'`);
    db.transaction(() => {
      for (const id of ids) {
        const e = index.get(id);
        if (!e) {
          const s = status.get(id, run.id);
          refused.push({ itemId: id, reason: s ? (s.status === 'removed' ? 'removed' : 'not_open') : 'not_found' });
          continue;
        }
        if (body.selected && !e.member.canSelect) {
          refused.push({ itemId: id, reason: e.member.reason || 'not_removable' });
          continue;
        }
        write.run(body.selected ? 1 : 0, id, run.id);
        updated.push(id);
      }
    })();
  }

  const result = { success: true, updated, refused, selection: selectionOf(run) };
  if (cleared) { result.cleared = cleared; result.restore = restore; }
  return result;
}

function selectionLabel(m) {
  return [m.ownerName, m.location, m.folder || 'top folder'].filter(Boolean).join(' / ');
}

function getSelectionList(runId) {
  const run = loadRun(runId);
  const wrappers = buildGroups(run);
  const sel = selectedMembers(wrappers);
  const summary = summarize(wrappers);
  const items = sel.map(({ w, m }) => ({
    itemId: m.itemId,
    fileId: m.fileId,
    groupKey: w.key,
    path: m.path,
    name: m.name,
    folder: m.folder,
    location: m.location,
    ownerName: m.ownerName,
    type: m.type,
    size: m.size,
    mtime: m.mtime,
    relation: m.relation,
    similarity: m.similarity,
    _label: selectionLabel(m),
  }));
  items.sort((a, b) => a._label.localeCompare(b._label) || a.name.localeCompare(b.name));
  const folders = [];
  const byLabel = new Map();
  for (const it of items) {
    if (!byLabel.has(it._label)) {
      const f = { label: it._label, count: 0, bytes: 0 };
      byLabel.set(it._label, f);
      folders.push(f);
    }
    const f = byLabel.get(it._label);
    f.count += 1;
    f.bytes += it.size || 0;
    delete it._label;
  }
  return { success: true, ...summary, items, folders };
}

async function setKeeper(runId, groupKey, fileId) {
  const run = loadRun(runId);
  const key = requireInt(groupKey, 'groupKey');
  const fid = requireInt(fileId, 'fileId');
  const wrappers = buildGroups(run);
  const w = wrappers.find((x) => x.key === key);
  const entry = w ? w.byFile.get(fid) : null;
  if (!entry) throw new HashError(400, 'not_member', 'This file is not in that group.');

  if (!entry.member.isKeeper) {
    if (!entry.member.canBeKeeper) {
      const why = {
        other_performer: run.internal ? 'This file cannot be the keeper.' : `Only ${run.target.name}'s files can be the keeper here.`,
        deleted_before: 'This file was deleted before; it cannot be the keeper.',
        removed: 'This file was removed as a duplicate; it cannot be the keeper.',
      }[entry.member.keeperReason] || 'This file cannot be the keeper.';
      throw new HashError(409, 'not_eligible', why);
    }
    const reach = makeReach();
    const rootOf = makeRootOf();
    const d = await diskState(entry.row, reach, rootOf);
    if (d.state === 'unknown') throw new HashError(409, 'library_offline', 'The library folder cannot be reached.');
    if (d.state === 'no') throw new HashError(409, 'not_on_disk', 'This file is no longer on disk.');
    if (d.state === 'changed') throw new HashError(409, 'not_eligible', 'Changed after the check. Run Check again to compare the new version.');

    const newKeeper = entry.row;
    const oldKeeper = w.keeperRow;
    const removable = (row) => run.internal || row.performer_id === run.source.id;
    db.transaction(() => {
      db.prepare('DELETE FROM hash_run_items WHERE run_id = ? AND candidate_id = ? AND file_id_ref = ?').run(run.id, key, fid);
      db.prepare('UPDATE hash_run_items SET candidate_id = ? WHERE run_id = ? AND candidate_id = ?').run(fid, run.id, key);
      const ins = db.prepare(`
        INSERT INTO hash_run_items (run_id, file_path, file_id_ref, candidate_id, exact_match, hamming_distance, selected, selected_by, status)
        VALUES (?, ?, ?, ?, 0, NULL, 0, NULL, 'open')
      `).run(run.id, oldKeeper.file_path, oldKeeper.id, fid);
      const oldKeeperItemId = Number(ins.lastInsertRowid);

      const kph = parsePhash(newKeeper.perceptual_hash);
      const rows = db.prepare(`
        SELECT i.id, i.status, i.selected_by, h.exact_hash, h.perceptual_hash, h.deleted_flag, h.performer_id
        FROM hash_run_items i JOIN performer_file_hashes h ON h.id = i.file_id_ref
        WHERE i.run_id = ? AND i.candidate_id = ?
      `).all(run.id, fid);
      const upd = db.prepare('UPDATE hash_run_items SET exact_match = ?, hamming_distance = ? WHERE id = ?');
      const auto = db.prepare(`UPDATE hash_run_items SET selected = ?, selected_by = ? WHERE id = ?`);
      for (const r of rows) {
        const exact = r.exact_hash && r.exact_hash === newKeeper.exact_hash ? 1 : 0;
        const ph = parsePhash(r.perceptual_hash);
        upd.run(exact, ph && kph ? phashDistance(ph, kph) : null, r.id);
        // the check's own ticks follow the new keeper: only exact copies of it start ticked; a person's choice stays
        if (r.id !== oldKeeperItemId && r.status === 'open' && r.selected_by !== 'user') {
          const tick = exact === 1 && newKeeper.deleted_flag === 0 && r.deleted_flag === 0 && removable(r);
          auto.run(tick ? 1 : 0, tick ? 'auto' : null, r.id);
        }
      }
    })();
    if (run.internal) recountInternal(run.source.id);
  }

  const fresh = buildGroups(run);
  const nw = fresh.find((x) => x.key === fid);
  if (nw) await decorate([nw]);
  return { success: true, group: nw ? nw.g : null, selection: summarize(fresh) };
}

function dismissGroup(runId, groupKey) {
  const run = loadRun(runId);
  const key = requireInt(groupKey, 'groupKey');
  const r = db.prepare(`UPDATE hash_run_items SET status = 'dismissed', selected = 0 WHERE run_id = ? AND candidate_id = ? AND status = 'open'`)
    .run(run.id, key);
  if (run.internal) recountInternal(run.source.id);
  return { success: true, dismissed: r.changes, selection: selectionOf(run) };
}

// Removals and their Undo run one at a time, so two tabs or two runs cannot each move one side of the same pair.
let removeChain = Promise.resolve();
function inChain(fn) {
  const next = removeChain.then(fn);
  removeChain = next.catch(() => { });
  return next;
}
function removeItems(runId, itemIds) {
  return inChain(() => removeItemsNow(runId, itemIds));
}

/** Undo of a removal (the toast's Undo): the batch's files come back from her trash while they are still there. */
function undoRemove(runId, batchId) {
  return inChain(async () => {
    const run = loadRun(runId);
    if (typeof batchId !== 'string' || !batchId) throw new HashError(400, 'bad_request', 'batchId is required');
    const r = await hashRemovals.undoBatch(run.id, batchId);
    return { success: true, ...r, selection: selectionOf(run) };
  });
}

async function removeItemsNow(runId, itemIds) {
  const run = loadRun(runId);
  const ids = requireIdList(itemIds, 'itemIds', { min: 1, max: 10000 });
  const wrappers = buildGroups(run);
  const index = itemIndex(wrappers);
  const reach = makeReach();
  const rootOf = makeRootOf();

  // nothing moves when a library folder involved cannot be reached
  const roots = new Set();
  for (const id of ids) {
    const e = index.get(id);
    if (!e) continue;
    const r1 = rootOf(e.row);
    const r2 = rootOf(e.w.keeperRow);
    if (r1) roots.add(r1);
    if (r2) roots.add(r2);
  }
  for (const r of roots) {
    if (!(await reach(r))) throw new HashError(409, 'library_offline', 'The library folder cannot be reached. Nothing was removed.');
  }

  const batchId = hashRemovals.newBatchId();
  const removed = [];
  const undo = [];
  const skipped = [];
  const owners = new Set();
  let bytes = 0;
  const requestedFiles = new Set();
  for (const id of ids) { const e = index.get(id); if (e) requestedFiles.add(e.row.id); }
  const statusOf = db.prepare('SELECT status, file_path, file_id_ref FROM hash_run_items WHERE id = ? AND run_id = ?');
  const flagOf = db.prepare('SELECT deleted_flag FROM performer_file_hashes WHERE id = ?');

  for (const id of ids) {
    const e = index.get(id);
    if (!e) {
      const s = statusOf.get(id, run.id);
      skipped.push({
        itemId: id, fileId: s ? s.file_id_ref : null, path: s ? s.file_path : null, name: s ? path.basename(s.file_path) : null,
        reason: 'not_selected', message: s && s.status === 'removed' ? 'Already removed.' : 'Not ticked any more.',
      });
      continue;
    }
    const { member: m, row, w } = e;
    const keeper = w.keeperRow;
    const keeperName = path.basename(keeper.file_path);
    const skip = (reason, message) => skipped.push({ itemId: id, fileId: row.id, path: row.file_path, name: m.name, reason, message });

    if (row.deleted_flag !== 0 || !(run.internal || row.performer_id === run.source.id)) {
      skip('not_removable', 'This file cannot be removed here.');
      continue;
    }
    if (m.reason === 'changed') { skip('changed', 'Changed since the check. Run Check again to compare the new version.'); continue; }
    if (m.reason === 'keeper_changed') { skip('keeper_changed', `Its keeper ${keeperName} changed since the check. Run Check again.`); continue; }
    if (!m.selected) { skip('not_selected', 'Not ticked any more.'); continue; }
    if (requestedFiles.has(keeper.id)) {
      skip('keeper_in_batch', `Its keeper ${keeperName} is being removed too. Keep one copy.`);
      continue;
    }

    const d = await diskState(row, reach, rootOf);
    if (d.state === 'no') { skip('missing', 'No longer on disk.'); continue; }
    if (d.state === 'unknown') { skip('error', 'The file could not be checked.'); continue; }
    if (d.state === 'changed') {
      skip('changed', d.current.size !== row.file_size
        ? `Changed since the check (${fmtBytes(d.current.size)}, was ${fmtBytes(row.file_size)})`
        : 'Changed since the check (modified after it)');
      continue;
    }

    if (keeper.deleted_flag === 0) {
      const kd = await diskState(keeper, reach, rootOf);
      if (kd.state === 'no') {
        skip('keeper_missing', `Its keeper ${keeperName} is no longer on disk. Choose a keeper in that group.`);
        continue;
      }
      if (kd.state === 'unknown') { skip('error', `Its keeper ${keeperName} could not be checked.`); continue; }
      if (kd.state === 'changed' && kd.current.size !== keeper.file_size) {
        skip('keeper_changed', `Its keeper ${keeperName} changed since the check. Run Check again.`);
        continue;
      }
    } else if (!(w.g.state === 'orphan' && m.selectedBy === 'user')) {
      skip('keeper_missing', `Its keeper ${keeperName} is no longer on disk. Choose a keeper in that group.`);
      continue;
    }

    // the keeper and the file as they are now, not as they were when this request started
    const keeperNow = flagOf.get(keeper.id);
    if (keeper.deleted_flag === 0 && (!keeperNow || keeperNow.deleted_flag !== 0)) {
      skip('keeper_missing', `Its keeper ${keeperName} was removed meanwhile. Choose a keeper in that group.`);
      continue;
    }
    const ownNow = flagOf.get(row.id);
    if (!ownNow || ownNow.deleted_flag !== 0) { skip('not_removable', 'Already removed.'); continue; }

    try {
      const moved = await hashRemovals.trashFile({ row, itemId: id, ownerId: row.performer_id });
      removed.push({ itemId: id, fileId: row.id, path: row.file_path, name: m.name, size: row.file_size });
      undo.push({ itemId: id, fileId: row.id, ownerId: row.performer_id, path: row.file_path, trashPath: moved.trashPath, name: m.name });
      bytes += row.file_size || 0;
      if (row.performer_id != null) owners.add(row.performer_id);
    } catch (err) {
      if (err.code === 'busy') skip('busy', err.message);
      else skip('error', err.message || 'Could not move the file.');
    }
  }

  hashRemovals.rememberBatch(batchId, run.id, undo);
  if (run.internal) owners.add(run.source.id);
  for (const ownerId of owners) {
    try { recountInternal(ownerId); } catch (_) { /* best effort */ }
  }
  try {
    const meta = run.meta || {};
    if (!Array.isArray(meta.actions)) meta.actions = [];
    meta.actions.push({ action: 'remove', to: 'trash', timestamp: Date.now(), batchId, itemCount: ids.length, removed: removed.length, skipped: skipped.length });
    db.prepare('UPDATE hash_runs SET metadata = ? WHERE run_id = ?').run(JSON.stringify(meta), run.id);
  } catch (err) {
    console.error('Could not log the removal on the run:', err.message);
  }
  for (const ownerId of owners) notify({ performerId: ownerId, type: 'hash_updated' });

  return {
    success: true,
    batchId,
    removed,
    skipped,
    bytes,
    undoUntil: undo.length ? Date.now() + hashRemovals.UNDO_MS : null,
    selection: selectionOf(run),
  };
}

module.exports = {
  loadRun,
  buildGroups,
  getRunView,
  setSelection,
  getSelectionList,
  setKeeper,
  dismissGroup,
  removeItems,
  undoRemove,
  parseQuery,
};
