/**
 * The Gallery home's performer filters, sorts and genre sorts. Pure: no React, no requests.
 *
 * Filter state is a plain object; an absent key means the group is off:
 *   chips  { [key]: { inc: string[], exc: string[] } }   (a value is never in both)
 *   ranges { [key]: [lo, hi] }
 * In the URL: chips `param=a,!b` (each value encodeURIComponent-ed, an exclude prefixed '!'), ranges `param=lo-hi`.
 * The toolbar's "New uploads N" chip is the `lh` group's 'new' include (isNewOnly, toggleNewOnly).
 */
import {
  currentAge, cupLetter, cupRank, bandOf, breastsOf, heightCm, weightKg, tagsOf, aliasesOf, hasNewUpload
} from './performerFacts';

/** A trimmed string, or null for nothing or ''. */
const text = (v) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
};

const group = (g) => Object.freeze(g);

export const GROUPS = Object.freeze([
  group({
    key: 'lh', param: 'lh', label: 'Leakhaven', kind: 'chips', order: 'fixed',
    fixed: Object.freeze([{ value: 'new', label: 'New upload' }]), showWhen: 'any-new',
    get: (p) => (hasNewUpload(p) ? 'new' : null)
  }),
  group({
    key: 'age', param: 'age', label: 'Age', kind: 'range', order: 'count',
    note: 'Current age, worked out from the scraped age and its date.', get: currentAge
  }),
  group({ key: 'ethnicity', param: 'eth', label: 'Ethnicity', kind: 'chips', order: 'count', get: (p) => text(p.ethnicity) }),
  group({ key: 'hair', param: 'hair', label: 'Hair', kind: 'chips', order: 'count', get: (p) => text(p.hair_color) }),
  group({ key: 'eyes', param: 'eyes', label: 'Eyes', kind: 'chips', order: 'count', get: (p) => text(p.eye_color) }),
  group({ key: 'body', param: 'body', label: 'Body type', kind: 'chips', order: 'count', get: (p) => text(p.body_type) }),
  group({
    key: 'band', param: 'band', label: 'Band', kind: 'chips', order: 'band',
    get: (p) => { const b = bandOf(p); return b == null ? null : String(b); }
  }),
  group({ key: 'cup', param: 'cup', label: 'Cup', kind: 'chips', order: 'cup', get: cupLetter }),
  group({
    key: 'breasts', param: 'breasts', label: 'Breasts', kind: 'chips', order: 'fixed',
    fixed: Object.freeze([
      { value: 'natural', label: 'Natural' },
      { value: 'enhanced', label: 'Enhanced' },
      { value: 'unknown', label: 'Unknown' }
    ]),
    note: 'Performers without this data count as Unknown, not as Natural.', get: breastsOf
  }),
  group({ key: 'height', param: 'height', label: 'Height', kind: 'range', unit: 'cm', order: 'count', get: heightCm }),
  group({ key: 'weight', param: 'weight', label: 'Weight', kind: 'range', unit: 'kg', order: 'count', get: weightKg }),
  group({
    key: 'tags', param: 'tag', label: 'Tags', kind: 'chips', multi: true, order: 'count', collapseAfter: 12,
    searchable: true, note: 'Shows performers with every included tag.', get: tagsOf
  })
]);

const BY_KEY = Object.freeze(Object.fromEntries(GROUPS.map(g => [g.key, g])));
export const groupOf = (key) => BY_KEY[key] || null;

const isRange = (v) => Array.isArray(v);
const chipsOf = (v) => ({ inc: v?.inc || [], exc: v?.exc || [] });
const isOn = (v) => (isRange(v) ? true : !!v && ((v.inc && v.inc.length > 0) || (v.exc && v.exc.length > 0)));

// ── the URL ──────────────────────────────────────────────────
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** URLSearchParams -> filter state (not normalized). */
export function readFilters(params) {
  const state = {};
  for (const g of GROUPS) {
    const raw = params.get(g.param);
    if (raw == null || raw === '') continue;
    if (g.kind === 'range') {
      const m = /^(\d+)-(\d+)$/.exec(raw.trim());
      if (!m) continue;
      const a = Number(m[1]);
      const b = Number(m[2]);
      state[g.key] = [Math.min(a, b), Math.max(a, b)];
      continue;
    }
    const inc = [];
    const exc = [];
    for (const piece of raw.split(',')) {
      const out = piece.startsWith('!');
      const value = decode(out ? piece.slice(1) : piece).trim();
      if (!value) continue;
      if (inc.includes(value) || exc.includes(value)) continue;
      (out ? exc : inc).push(value);
    }
    if (inc.length || exc.length) state[g.key] = { inc, exc };
  }
  return state;
}

/** Writes the filter state into params (mutates it). Other params are never touched. */
export function writeFilters(params, state) {
  for (const g of GROUPS) params.delete(g.param);
  for (const g of GROUPS) {
    const v = state?.[g.key];
    if (v == null) continue;
    if (g.kind === 'range') {
      if (!isRange(v) || v.length !== 2) continue;
      const lo = Math.round(Number(v[0]));
      const hi = Math.round(Number(v[1]));
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      params.set(g.param, `${Math.min(lo, hi)}-${Math.max(lo, hi)}`);
      continue;
    }
    const { inc, exc } = chipsOf(v);
    const parts = [...inc.map(encodeURIComponent), ...exc.map(x => `!${encodeURIComponent(x)}`)];
    if (parts.length) params.set(g.param, parts.join(','));
  }
  return params;
}

// ── facets ───────────────────────────────────────────────────
const byName = (a, b) => String(a).localeCompare(String(b));

/** Per group: the chip values with their counts over all performers, or the range of a number. */
export function buildFacets(performers) {
  const list = Array.isArray(performers) ? performers : [];
  const facets = {};
  for (const g of GROUPS) {
    if (g.kind === 'range') {
      let min = null;
      let max = null;
      let withValue = 0;
      for (const p of list) {
        const v = g.get(p);
        if (v == null || !Number.isFinite(v)) continue;
        withValue++;
        if (min == null || v < min) min = v;
        if (max == null || v > max) max = v;
      }
      facets[g.key] = { kind: 'range', min, max, withValue, missing: list.length - withValue };
      continue;
    }
    const counts = new Map();
    for (const p of list) {
      const v = g.get(p);
      const values = g.multi ? (Array.isArray(v) ? v : []) : (v == null ? [] : [v]);
      for (const x of values) counts.set(x, (counts.get(x) || 0) + 1);
    }
    let values;
    if (g.order === 'fixed') {
      values = g.fixed.map(f => ({ value: f.value, label: f.label, count: counts.get(f.value) || 0 }));
    } else {
      values = [...counts].map(([value, count]) => ({ value, label: value, count }));
      if (g.order === 'band') values.sort((a, b) => Number(a.value) - Number(b.value) || byName(a.value, b.value));
      else if (g.order === 'cup') values.sort((a, b) => cupRank(a.value) - cupRank(b.value) || byName(a.value, b.value));
      else values.sort((a, b) => b.count - a.count || byName(a.value, b.value));
    }
    facets[g.key] = { kind: 'chips', values };
  }
  return facets;
}

/** The groups the drawer shows: those with something to pick, and any group that is on. */
export function visibleGroups(facets, state) {
  return GROUPS.filter((g) => {
    if (isOn(state?.[g.key])) return true;
    const f = facets?.[g.key];
    if (!f) return false;
    if (g.kind === 'range') return f.min != null && f.max != null && f.min < f.max;
    if (g.showWhen === 'any-new') return (f.values.find(v => v.value === 'new')?.count || 0) > 0;
    return f.values.some(v => v.count > 0);
  });
}

/**
 * A new state: ranges clamped to the data, and dropped when they cover all of it (or there is no data);
 * chip groups with nothing in them dropped; unknown keys dropped. Unknown chip values are kept.
 */
export function normalizeFilters(state, facets) {
  const out = {};
  for (const g of GROUPS) {
    const v = state?.[g.key];
    if (v == null) continue;
    if (g.kind === 'range') {
      if (!isRange(v) || v.length !== 2) continue;
      const f = facets?.[g.key];
      if (!f || f.kind !== 'range' || f.min == null || f.max == null) continue;
      let lo = Math.min(Number(v[0]), Number(v[1]));
      let hi = Math.max(Number(v[0]), Number(v[1]));
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
      // A range wholly outside the data stays as asked (it matches nobody); otherwise clamp it.
      if (!(hi < f.min || lo > f.max)) {
        lo = Math.max(lo, f.min);
        hi = Math.min(hi, f.max);
        if (lo <= f.min && hi >= f.max) continue;
      }
      out[g.key] = [lo, hi];
      continue;
    }
    const { inc, exc } = chipsOf(v);
    if (inc.length || exc.length) out[g.key] = { inc: [...inc], exc: [...exc] };
  }
  return out;
}

// ── matching ─────────────────────────────────────────────────
/** The name or any alias contains q (trimmed, any case). */
export function matchesSearch(p, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return true;
  if (String(p?.name ?? '').toLowerCase().includes(needle)) return true;
  return aliasesOf(p).some(a => a.toLowerCase().includes(needle));
}

/** The performers that pass every group (groups AND together). */
export function applyFilters(performers, state, facets) {
  const list = Array.isArray(performers) ? performers : [];
  const norm = normalizeFilters(state, facets);
  const tests = GROUPS.filter(g => norm[g.key]).map((g) => {
    const v = norm[g.key];
    if (g.kind === 'range') {
      const [lo, hi] = v;
      return (p) => { const x = g.get(p); return x != null && x >= lo && x <= hi; };
    }
    const inc = v.inc;
    const exc = v.exc;
    if (g.multi) {
      return (p) => {
        const tags = new Set(g.get(p) || []);
        return inc.every(t => tags.has(t)) && !exc.some(t => tags.has(t));
      };
    }
    return (p) => {
      const x = g.get(p);
      if (inc.length && !(x != null && inc.includes(x))) return false;
      if (exc.length && x != null && exc.includes(x)) return false;
      return true;
    };
  });
  if (!tests.length) return list;
  return list.filter(p => tests.every(t => t(p)));
}

// ── changing the state ───────────────────────────────────────
/** off -> include -> exclude -> off. */
export function cycleValue(state, key, value) {
  const next = { ...(state || {}) };
  const { inc, exc } = chipsOf(isRange(next[key]) ? null : next[key]);
  let i = inc.filter(x => x !== value);
  let e = exc.filter(x => x !== value);
  if (inc.includes(value)) e = [...e, value];
  else if (!exc.includes(value)) i = [...i, value];
  if (i.length || e.length) next[key] = { inc: i, exc: e };
  else delete next[key];
  return next;
}

/** range: [lo, hi] (whole numbers), or null to turn the group off. */
export function setRange(state, key, range) {
  const next = { ...(state || {}) };
  if (!range || range.length !== 2 || !Number.isFinite(Number(range[0])) || !Number.isFinite(Number(range[1]))) {
    delete next[key];
    return next;
  }
  const a = Math.round(Number(range[0]));
  const b = Math.round(Number(range[1]));
  next[key] = [Math.min(a, b), Math.max(a, b)];
  return next;
}

export function resetGroup(state, key) {
  const next = { ...(state || {}) };
  delete next[key];
  return next;
}

/** Included and excluded values, plus one per range. The search is not counted. */
export function countActive(state) {
  let n = 0;
  for (const v of Object.values(state || {})) {
    if (isRange(v)) n += 1;
    else if (v) n += (v.inc?.length || 0) + (v.exc?.length || 0);
  }
  return n;
}

// ── the toolbar's "New uploads N" chip ───────────────────────
/**
 * The chip is the Leakhaven group's "New upload" include (`lh=new` in the URL), so the drawer, the chip and the URL
 * never disagree. On: only performers with a new upload. Turning it off leaves an exclude alone.
 */
export const isNewOnly = (state) => !isRange(state?.lh) && !!state?.lh?.inc?.includes('new');

export function toggleNewOnly(state) {
  const next = { ...(state || {}) };
  const { exc } = chipsOf(isRange(next.lh) ? null : next.lh);
  if (isNewOnly(state)) {
    if (exc.length) next.lh = { inc: [], exc: [...exc] };
    else delete next.lh;
  } else {
    next.lh = { inc: ['new'], exc: exc.filter(x => x !== 'new') };
  }
  return next;
}

/** The chip the toolbar shows itself: left out of the removable chips under it. */
export const isNewOnlyChip = (chip) => chip?.key === 'lh' && chip.kind === 'include' && chip.value === 'new';

const valueLabel = (g, value) => g.fixed?.find(f => f.value === value)?.label ?? value;

/** The removable chips of the active filters, in group order. With facets, ranges are shown as normalized. */
export function activeChips(state, facets) {
  const s = facets ? normalizeFilters(state, facets) : (state || {});
  const chips = [];
  for (const g of GROUPS) {
    const v = s[g.key];
    if (v == null) continue;
    if (g.kind === 'range') {
      if (!isRange(v)) continue;
      chips.push({ id: `${g.key}:range`, key: g.key, kind: 'range', label: `${g.label} ${v[0]}–${v[1]}${g.unit ? ` ${g.unit}` : ''}` });
      continue;
    }
    const name = g.key === 'tags' ? 'Tag' : g.label;
    const { inc, exc } = chipsOf(v);
    for (const value of inc) {
      const label = g.key === 'lh' ? valueLabel(g, value) : `${name}: ${valueLabel(g, value)}`;
      chips.push({ id: `${g.key}:include:${value}`, key: g.key, value, kind: 'include', label });
    }
    for (const value of exc) {
      chips.push({ id: `${g.key}:exclude:${value}`, key: g.key, value, kind: 'exclude', label: `${name}: not ${valueLabel(g, value)}` });
    }
  }
  return chips;
}

export function removeChip(state, chip) {
  if (!chip) return { ...(state || {}) };
  if (chip.kind === 'range') return resetGroup(state, chip.key);
  const next = { ...(state || {}) };
  const cur = next[chip.key];
  if (!cur || isRange(cur)) return next;
  const { inc, exc } = chipsOf(cur);
  const i = chip.kind === 'include' ? inc.filter(x => x !== chip.value) : inc;
  const e = chip.kind === 'exclude' ? exc.filter(x => x !== chip.value) : exc;
  if (i.length || e.length) next[chip.key] = { inc: i, exc: e };
  else delete next[chip.key];
  return next;
}

/** 'Name, A to Z' -> 'name, A to Z': a sort label inside a line of text. */
export const lowerFirst = (t) => (t ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : '');

// ── performer sorts ──────────────────────────────────────────
export const SORTS = Object.freeze([
  { id: 'name-asc', label: 'Name, A to Z' },
  { id: 'name-desc', label: 'Name, Z to A' },
  { id: 'rating-desc', label: 'Rating, high to low' },
  { id: 'rating-asc', label: 'Rating, low to high' },
  { id: 'age-asc', label: 'Age, youngest first' },
  { id: 'age-desc', label: 'Age, oldest first' },
  { id: 'cup-asc', label: 'Cup size, smallest first' },
  { id: 'cup-desc', label: 'Cup size, largest first' },
  { id: 'size-desc', label: 'Size, largest first' },
  { id: 'size-asc', label: 'Size, smallest first' },
  { id: 'date-desc', label: 'Added, newest first' },
  { id: 'date-asc', label: 'Added, oldest first' }
]);
export const DEFAULT_SORT = 'name-asc';
export const isSort = (id) => SORTS.some(s => s.id === id);

const nameOf = (p) => String(p?.name ?? '');
const byPerformerName = (a, b) => nameOf(a).localeCompare(nameOf(b));

/** field: [the sort key, whether a row lacks it, the label of the rows that lack it] */
const SORT_KEYS = {
  name: [null, () => false, null],
  rating: [(p) => Number(p.performer_rating), (p) => p.performer_rating == null, 'Not rated'],
  age: [currentAge, (p) => currentAge(p) == null, 'No age data'],
  cup: [(p) => cupRank(cupLetter(p)), (p) => cupLetter(p) == null, 'No cup size'],
  size: [(p) => Number(p.total_size_gb) || 0, () => false, null],
  date: [(p) => Date.parse(p.import_date) || 0, (p) => !p.import_date, 'No date added']
};

/**
 * Sorts without hiding anyone: { main, missing, missingLabel }. Rows without the sort value are in `missing`
 * (A to Z), to show last under a divider. Ties break by name A to Z. An unknown id sorts as name-asc.
 */
export function sortPerformers(list, sortId) {
  const rows = Array.isArray(list) ? list : [];
  const id = isSort(sortId) ? sortId : DEFAULT_SORT;
  const [field, dir] = id.split('-');
  const sign = dir === 'desc' ? -1 : 1;
  const [keyOf, lacks, label] = SORT_KEYS[field];
  if (field === 'name') {
    return { main: [...rows].sort((a, b) => sign * byPerformerName(a, b)), missing: [], missingLabel: null };
  }
  const main = [];
  const missing = [];
  for (const p of rows) (lacks(p) ? missing : main).push(p);
  const keys = new Map(main.map(p => [p, keyOf(p)]));
  main.sort((a, b) => sign * (keys.get(a) - keys.get(b)) || byPerformerName(a, b));
  missing.sort(byPerformerName);
  return { main, missing, missingLabel: label };
}

// ── genres ───────────────────────────────────────────────────
export const GENRE_SORTS = Object.freeze([
  { id: 'name-asc', label: 'Name, A to Z' },
  { id: 'name-desc', label: 'Name, Z to A' },
  { id: 'count-desc', label: 'Most files first' },
  { id: 'count-asc', label: 'Fewest files first' },
  { id: 'size-desc', label: 'Largest first' },
  { id: 'size-asc', label: 'Smallest first' }
]);
export const isGenreSort = (id) => GENRE_SORTS.some(s => s.id === id);

const n0 = (v) => Number(v) || 0;

/**
 * The counts of one genre row: the files in the genre folder (origin) and, apart, those tagged with the genre
 * elsewhere (virtual). Rows without the split count everything as origin.
 */
export function genreTotals(g) {
  const split = g?.originCounts && g?.virtualCounts;
  const pics = n0(split ? g.originCounts.pics : g?.pics);
  const vids = n0(split ? g.originCounts.vids : g?.vids);
  const funscripts = n0(split ? g.originCounts.funscripts : g?.funscripts);
  const tagged = split
    ? { pics: n0(g.virtualCounts.pics), vids: n0(g.virtualCounts.vids), funscripts: n0(g.virtualCounts.funscripts) }
    : { pics: 0, vids: 0, funscripts: 0 };
  tagged.total = tagged.pics + tagged.vids + tagged.funscripts;
  return { pics, vids, funscripts, total: pics + vids + funscripts, tagged, sizeGb: parseFloat(g?.size) || 0 };
}

const genreName = (g) => String(g?.name ?? '');
const genreCount = (g) => n0(g?.pics) + n0(g?.vids) + n0(g?.funscripts);

/** A sorted copy. Count is the grand total (folder plus tagged). Ties break by name. */
export function sortGenres(genres, id) {
  const rows = Array.isArray(genres) ? [...genres] : [];
  const sortId = isGenreSort(id) ? id : 'name-asc';
  const [field, dir] = sortId.split('-');
  const sign = dir === 'desc' ? -1 : 1;
  const byGenreName = (a, b) => genreName(a).localeCompare(genreName(b));
  if (field === 'name') return rows.sort((a, b) => sign * byGenreName(a, b));
  const key = field === 'count' ? genreCount : (g) => parseFloat(g?.size) || 0;
  return rows.sort((a, b) => sign * (key(a) - key(b)) || byGenreName(a, b));
}
