/**
 * Hash / duplicate-check API helpers and the text formatters shared by the
 * duplicates page (/hash-results/:runId) and the hash flows that lead to it.
 *
 * Every request goes to /api/hashes. Errors throw an Error carrying the
 * server's `{ error, code }` so callers can show the message as is.
 */

export async function hashRequest(method, path, body, { signal } = {}) {
  const res = await fetch(`/api/hashes${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, code: data.code, data });
  return data;
}

export const hashGet = (path, opts) => hashRequest('GET', path, undefined, opts);
export const hashPost = (path, body, opts) => hashRequest('POST', path, body || {}, opts);

/* ─── numbers and dates ──────────────────────────────────────────── */

export function plural(n, one, many = one + 's') {
  const v = Number(n) || 0;
  return `${v.toLocaleString()} ${v === 1 ? one : many}`;
}

/** '0 B', '812 KB', '3.1 MB', '2.1 GB' (one decimal from MB up). */
export function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${Math.round(v)} B`;
  const kb = Math.round(v / 1024);
  if (kb < 1024) return `${kb} KB`;
  const mb = v / 1024 ** 2;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = v / 1024 ** 3;
  if (gb < 1024) return `${gb.toFixed(1)} GB`;
  return `${(gb / 1024).toFixed(1)} TB`;
}

/** 'just now', '5 minutes ago', '3 hours ago', '3 days ago', '2 months ago', '1 year ago'. */
export function formatAgo(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - Number(ms)) / 1000);
  if (s < 60) return 'just now';
  const min = Math.floor(s / 60);
  if (min < 60) return `${plural(min, 'minute')} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${plural(h, 'hour')} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${plural(d, 'day')} ago`;
  const mo = Math.floor(d / 30);
  if (d < 365) return `${plural(Math.max(1, mo), 'month')} ago`;
  return `${plural(Math.floor(d / 365), 'year')} ago`;
}

/** '7 Nov 2026, 21:14' */
export function formatDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** '7 Nov 2026' */
export function formatDay(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** '10 Dec' (no year) */
export function formatShortDay(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** '6:12', '1:02:05' */
export function formatDuration(s) {
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return '';
  const total = Math.max(0, Math.round(Number(s)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/* ─── media URLs (never a Date.now() in them: stable URLs cache) ──── */

export function thumbUrl(m) {
  const enc = encodeURIComponent(m.path);
  return m.type === 'vid'
    ? `/api/files/video-thumbnail?path=${enc}&v=${m.mtime || 0}`
    : `/api/files/preview?path=${enc}&v=${m.mtime || 0}`;
}

export function fullUrl(m) {
  const enc = encodeURIComponent(m.path);
  return m.type === 'vid' ? `/api/files/stream-video?path=${enc}` : `/api/files/raw?path=${enc}`;
}

/* ─── member texts ───────────────────────────────────────────────── */

/** 'Exact copy of the keeper' / '94% like the keeper' / 'Keeper'. */
export function similarityText(m, { short = false } = {}) {
  if (!m) return '';
  if (m.relation === 'keeper' || m.isKeeper) return 'Keeper';
  if (m.relation === 'exact') return short ? 'Exact' : 'Exact copy of the keeper';
  if (m.similarity !== null && m.similarity !== undefined) return short ? `${m.similarity}%` : `${m.similarity}% like the keeper`;
  return m.relation === 'linked' ? 'Linked through another copy' : 'Similar';
}

/**
 * Why a member cannot be ticked for removal (Member.reason).
 * ctx: { otherName } = the performer whose files are never touched on a comparison.
 */
export function reasonText(code, ctx = {}) {
  const other = ctx.ownerName || ctx.otherName || 'The other performer';
  switch (code) {
    case 'keeper': return 'The keeper is never removed. Make another file the keeper first.';
    case 'other_performer': return `${other}'s own copy: check her files to clean it up.`;
    case 'deleted_before': return 'Not on disk: deleted before. Nothing to remove.';
    case 'removed': return 'Already removed as a duplicate.';
    case 'not_on_disk': return 'Not on disk: nothing to remove.';
    case 'changed': return 'Changed after the check. Run Check again to compare the new version.';
    case 'keeper_changed': return 'Its keeper changed after the check. Run Check again to compare the new version.';
    case 'choose_keeper': return 'Choose a keeper first.';
    case 'library_offline': return 'The library folder cannot be reached.';
    default: return code ? 'This file cannot be removed here.' : '';
  }
}

/** Why a member cannot become the keeper (Member.keeperReason). */
export function keeperReasonText(code, ctx = {}) {
  const other = ctx.otherName || 'the other performer';
  switch (code) {
    case 'is_keeper': return 'Already the keeper';
    case 'other_performer': return `In a comparison the keeper is on ${other}'s side`;
    case 'not_on_disk': return 'A file that is not on disk cannot be the keeper';
    case 'deleted_before': return 'A file that was deleted before cannot be the keeper';
    case 'removed': return 'A file removed as a duplicate cannot be the keeper';
    case 'changed': return 'A file that changed after the check cannot be the keeper. Run Check again first.';
    case 'library_offline': return 'The library folder cannot be reached';
    default: return code ? 'This file cannot be the keeper' : '';
  }
}

/** Short form of a remove skip reason, for the 'Skipped: …' group badge. */
export function skipShortText(reason) {
  switch (reason) {
    case 'not_selected': return 'not selected';
    case 'not_removable': return 'cannot be removed';
    case 'missing': return 'not on disk';
    case 'changed': return 'changed since the check';
    case 'keeper_missing': return 'keeper not on disk';
    case 'keeper_changed': return 'keeper changed';
    case 'keeper_in_batch': return 'keeper in the same batch';
    case 'busy': return 'file in use';
    default: return 'error';
  }
}

/** 'pics / import 2026-10' from the '/'-separated folder inside the performer folder. */
export function folderText(folder) {
  if (!folder) return 'top folder';
  return String(folder).split('/').filter(Boolean).join(' / ');
}
