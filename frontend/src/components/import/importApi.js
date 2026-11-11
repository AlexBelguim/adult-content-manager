/**
 * The Import page's requests and the small rules it shares with the uploads provider: file kinds, sizes, the name
 * rule (a mirror of the server's), the match badge, the end-of-import summary, the batches and the batch upload.
 * Plain module, no React. The API is backend/routes/folders.js and backend/routes/uploadQueue.js.
 *
 * Every request helper throws Error(message) on a non-2xx answer, with err.status, err.code and err.body set from
 * the JSON answer ({ error, code? }).
 */

// ── file kinds ───────────────────────────────────────────────
/** The fallback list; the scan answers the server's own as `types`. */
export const IMPORT_TYPES = Object.freeze({
  images: Object.freeze(['.jpg', '.jpeg', '.png', '.gif', '.webp']),
  videos: Object.freeze(['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v']),
  funscript: '.funscript'
});

const extOf = (name) => {
  const base = String(name || '').split(/[/\\]/).pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
};

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x).toLowerCase());

/** 'image' | 'video' | 'funscript' | null for a file name. */
export function kindOf(name, types = IMPORT_TYPES) {
  const ext = extOf(name);
  if (!ext) return null;
  const t = types || IMPORT_TYPES;
  if (asList(t.images || IMPORT_TYPES.images).includes(ext)) return 'image';
  if (asList(t.videos || IMPORT_TYPES.videos).includes(ext)) return 'video';
  if (asList(t.funscript || IMPORT_TYPES.funscript).includes(ext)) return 'funscript';
  return null;
}

// ── sizes ────────────────────────────────────────────────────
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** '0 B', '412 MB', '2.41 GB': 1024-based, at most 3 significant digits. */
export function fmtBytes(n) {
  let v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) { v /= 1024; u += 1; }
  if (u === 0) return `${Math.round(v)} B`;
  const digits = v < 10 ? 2 : v < 100 ? 1 : 0;
  // 1023.7 KB would round to '1024 KB' (4 digits): show it in the next unit.
  if (Number(v.toFixed(digits)) >= 1000 && u < UNITS.length - 1) return `${(v / 1024).toFixed(2)} ${UNITS[u + 1]}`;
  return `${v.toFixed(digits)} ${UNITS[u]}`;
}

/** fmtBytes for a size in GB (a number or a numeric string); '' when there is none. */
export function fmtGb(gb) {
  if (gb === null || gb === undefined || gb === '') return '';
  const v = Number(gb);
  if (!Number.isFinite(v)) return '';
  return fmtBytes(v * 1024 * 1024 * 1024);
}

// ── names ────────────────────────────────────────────────────
/** A performer name from a folder name: drops channel tags, emoji, @handles, (n), #n and .com, and tidies spaces. */
export function cleanName(folderName) {
  return String(folderName || '')
    .replace(/Join Telegram.*$/i, '')
    .replace(/BY Telegram.*$/i, '')
    .replace(/on \[TELEGRAM\].*$/i, '')
    .replace(/\[TELEGRAM\].*$/i, '')
    .replace(/Onlyfans.*$/i, '')
    .replace(/Onlyefuns.*$/i, '')
    .replace(/([/✀-➿]|[-]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[‑-⛿]|\uD83E[\uDD10-\uDDFF])/g, '')
    .replace(/@[a-zA-Z0-9_]+/g, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/\.com|\.net|\.org/gi, '')
    .replace(/[._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The server's performer-name rule (performerNameError): the reason a name is refused, or null. */
export function nameError(name) {
  const s = String(name ?? '').trim();
  if (!s) return 'Type a name';
  if (s.length > 200) return 'A name can be at most 200 characters';
  if (s === '.' || s === '..') return 'A name cannot be . or ..';
  if (/[/\\]/.test(s)) return 'A name cannot contain / or \\';
  if (CONTROL.test(s)) return 'A name cannot contain control characters';
  if (s.startsWith('.')) return 'A name cannot start with a dot';
  return null;
}

// ── the match badge ──────────────────────────────────────────
function shortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/**
 * The badge for a name check: { text, tone, title }. tone is one of accent, dim, warn, bad, ok, info.
 * A folder's import job wins over everything, then checking, then "only unsupported files", then the match.
 */
export function matchChip(match, { checking = false, job = null, unsupportedOnly = false } = {}) {
  if (job) {
    return {
      text: job.status === 'processing' ? 'Importing' : 'Queued',
      tone: 'accent',
      title: 'This folder already has an import job'
    };
  }
  if (checking || !match) return { text: 'Checking…', tone: 'dim', title: 'Checking the name' };
  if (unsupportedOnly) {
    return { text: 'Only unsupported files', tone: 'warn', title: 'Nothing here can be imported. It stays in before upload.' };
  }
  switch (match.kind) {
    case 'invalid':
      return { text: 'Name not allowed', tone: 'bad', title: match.reason || 'This name is not allowed' };
    case 'blacklisted': {
      const date = shortDate(match.blacklistedAt);
      const head = date ? `Blacklisted ${date}` : 'Blacklisted';
      return { text: 'Blacklisted', tone: 'bad', title: match.reason ? `${head}: ${match.reason}` : head };
    }
    case 'existing': {
      // An import always goes into Before: her Before folder when she has one, otherwise a new one next to her After
      const how = match.by === 'alias' ? `${match.name}, matched by the alias "${match.input}"` : match.name;
      const after = match.after || (match.location === 'after' ? { pics: match.pics ?? 0 } : null);
      const before = match.before || (match.location === 'before' ? { pics: match.pics ?? 0 } : null);
      const afterNote = after ? ` Her ${after.pics} pictures in After stay as they are.` : '';
      if (before) {
        return {
          text: `Adds to Before (${before.pics} pics)`,
          tone: 'ok',
          title: `Goes into ${how}'s Before folder, next to the ${before.pics} pictures there.${afterNote}`
        };
      }
      return {
        text: `New in Before · ${after ? after.pics : 0} in After`,
        tone: 'info',
        title: `${how} is already in After. This goes into a new Before folder for her, to filter first.${afterNote}`
      };
    }
    case 'new':
      return { text: 'New performer', tone: 'info', title: 'No performer with this name or alias yet' };
    default:
      return { text: 'Checking…', tone: 'dim', title: 'Checking the name' };
  }
}

// ── the end-of-import summary ────────────────────────────────
const count = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const files = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** ' · 3 identical skipped · 2 renamed · 1 not imported · hashing failed': each part only when it applies. */
function extraParts({ identical, renamed, notImported, hashFailed }) {
  let s = '';
  if (identical > 0) s += ` · ${identical} identical skipped`;
  if (renamed > 0) s += ` · ${renamed} renamed`;
  if (notImported > 0) s += ` · ${notImported} not imported`;
  if (hashFailed) s += ' · hashing failed';
  return s;
}

const partsOf = (r) => ({
  identical: count(r.identical),
  renamed: count(r.renamed),
  notImported: count(r.unsupported) + count(r.failed), // left out by type, or a move that failed
  hashFailed: r.hashing === 'failed'
});

/** 'Imported Jane: 142 files · 3 identical skipped'. Without a report: 'Imported Jane'. */
export function summaryText(title, report) {
  if (!report) return `Imported ${title}`;
  return `Imported ${title}: ${files(count(report.imported))}${extraParts(partsOf(report))}`;
}

/** Several finished in one go: '3 imports finished: 412 files imported · 2 renamed'. */
export function sumText(reports) {
  const list = (reports || []).filter(Boolean);
  const sum = { identical: 0, renamed: 0, notImported: 0, hashFailed: false };
  let imported = 0;
  list.forEach(r => {
    const p = partsOf(r);
    imported += count(r.imported);
    sum.identical += p.identical;
    sum.renamed += p.renamed;
    sum.notImported += p.notImported;
    sum.hashFailed = sum.hashFailed || p.hashFailed;
  });
  const n = (reports || []).length;
  return `${n} ${n === 1 ? 'import' : 'imports'} finished: ${files(imported)} imported${extraParts(sum)}`;
}

// ── requests ─────────────────────────────────────────────────
const enc = encodeURIComponent;

/** '?a=1&b=2' from the given values; null, undefined and '' are left out. */
function qs(params) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function failure(status, data, fallback) {
  const body = data && typeof data === 'object' ? data : {};
  const err = new Error(body.error || fallback || `Request failed (${status})`);
  err.status = status;
  err.code = body.code || null;
  err.body = body;
  return err;
}

async function request(method, url, { body, signal, accept } = {}) {
  const res = await fetch(url, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(accept && accept(res.status, data))) throw failure(res.status, data);
  return data;
}

/** The folders in "before upload", each with its match and any import job. */
export function scanFolders(basePath, { signal } = {}) {
  return request('GET', `/api/folders/scan-before-upload${qs({ basePath })}`, { signal });
}

/** One folder's counts, preview pictures (max 30) and other files. */
export function folderDetails(basePath, name, { signal } = {}) {
  return request('GET', `/api/folders/scan-before-upload-details${qs({ performerName: name, basePath })}`, { signal });
}

/** The match for a name: { kind, input, name, by, performerId, location, pics, vids, reason, blacklistedAt }. */
export async function checkName(basePath, name, { signal } = {}) {
  const data = await request('GET', `/api/folders/name-check${qs({ name, basePath })}`, { signal });
  return data.match;
}

/**
 * Queue server folders: performers = [{ folderName, name, totalFiles? }]. Resolves with { jobs, refused } on 200,
 * and also on 409 (nothing was queued), so the caller reads `refused`. Throws for other answers.
 */
export function queueLocal(basePath, performers, createHashes) {
  const body = { performers, createHashes: !!createHashes };
  if (basePath) body.basePath = basePath;
  return request('POST', '/api/folders/local-import', {
    body,
    accept: (status, data) => status === 409 && Array.isArray(data && data.refused)
  });
}

/** What the server has of an upload: { uploadId, exists, batches, files, bytes, job }. */
export function uploadStatus(basePath, id) {
  return request('GET', `/api/folders/upload-import/${enc(id)}${qs({ basePath })}`);
}

/** Delete an upload's temp folder. An upload the server does not have counts as done. */
export function discardUpload(basePath, id) {
  return request('DELETE', `/api/folders/upload-import/${enc(id)}${qs({ basePath })}`, {
    accept: (status) => status === 404
  });
}

/** Hand a complete upload over to the import queue: { uploadId, performerName, totalFiles, totalBatches, createHashes, sourceLabel }. */
export function handOver(basePath, body) {
  const b = { ...body };
  if (basePath) b.basePath = basePath;
  return request('POST', '/api/upload-queue', { body: b });
}

/** The import queue: { queue: [job], isProcessing, queueLength }. */
export function queueStatus() {
  return request('GET', '/api/upload-queue');
}

/** Run a failed import job again. */
export function retryImportJob(id) {
  return request('POST', `/api/upload-queue/${enc(id)}/retry`, { body: {} });
}

/** Remove an import job (an upload job's temp folder goes with it). */
export function removeImportJob(id) {
  return request('DELETE', `/api/upload-queue/${enc(id)}`);
}

// ── uploads ──────────────────────────────────────────────────
const BATCH_FILES = 50;
const BATCH_BYTES = 200 * 1024 * 1024;
const ATTEMPTS = 3;

const sizeOf = (f) => Number((f && (f.size ?? (f.file && f.file.size))) || 0);

/** [{ file, rel, size? }] → batches of indices: at most 50 files and 200 MB each; a larger single file goes alone. */
export function makeBatches(list) {
  const batches = [];
  let cur = [];
  let bytes = 0;
  (list || []).forEach((f, i) => {
    const size = sizeOf(f);
    if (cur.length > 0 && (cur.length >= BATCH_FILES || bytes + size > BATCH_BYTES)) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(i);
    bytes += size;
  });
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** 'upload-<time>-<10 chars>', which the server's /^upload-[A-Za-z0-9_-]{6,80}$/ takes. */
export function newUploadId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  const c = typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues ? window.crypto : null;
  if (c) {
    const bytes = c.getRandomValues(new Uint8Array(10));
    bytes.forEach(b => { rand += alphabet[b % alphabet.length]; });
  } else {
    for (let i = 0; i < 10; i += 1) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `upload-${Date.now().toString(36)}-${rand}`;
}

const parse = (text) => {
  try { return JSON.parse(text); } catch (e) { return {}; }
};

/** A refusal that a second try cannot fix: a bad request, a handed-over upload, a missing library. */
const final = (status, data) => (data && data.code === 'handed-over')
  || (status >= 400 && status < 500 && status !== 408 && status !== 429);

/**
 * Send one batch: an XHR with up to 3 attempts, waiting 3 s × attempt between them. onProgress(loaded) reports the
 * bytes sent of this try. xhrRef.current holds something with abort() for as long as it runs (the XHR, or the wait
 * between tries); abort() rejects with err.code 'aborted'. Resolves with the server's answer.
 */
export function sendBatch({ basePath, uploadId, batchIndex, totalBatches, files: list, onProgress, xhrRef }) {
  const url = `/api/folders/upload-import${qs({ uploadId, batchIndex, totalBatches, basePath })}`;
  const form = new FormData();
  (list || []).forEach(({ file, rel }) => form.append('files', file, enc(rel || file.name)));

  return new Promise((resolve, reject) => {
    let attempt = 0;
    let settled = false;
    const ref = xhrRef || { current: null };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      ref.current = null;
      fn(value);
    };
    const aborted = () => {
      const err = new Error('The upload was stopped');
      err.code = 'aborted';
      err.status = 0;
      err.body = {};
      return err;
    };
    const again = (err) => {
      if (attempt >= ATTEMPTS) { finish(reject, err); return; }
      const timer = setTimeout(send, 3000 * attempt);
      ref.current = { abort: () => { clearTimeout(timer); finish(reject, aborted()); } };
    };

    function send() {
      if (settled) return;
      attempt += 1;
      const xhr = new XMLHttpRequest();
      ref.current = xhr;
      xhr.open('POST', url, true);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded);
      };
      xhr.onload = () => {
        const data = parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) { finish(resolve, data); return; }
        const err = failure(xhr.status, data, `Batch ${Number(batchIndex) + 1} was not taken (${xhr.status})`);
        if (final(xhr.status, data)) finish(reject, err);
        else again(err);
      };
      xhr.onerror = () => {
        const err = failure(0, {}, 'The server did not answer');
        again(err);
      };
      xhr.onabort = () => finish(reject, aborted());
      xhr.send(form);
    }

    send();
  });
}
