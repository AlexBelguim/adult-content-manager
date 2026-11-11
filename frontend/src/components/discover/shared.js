/**
 * What the Discover page's tabs share: requests, the list hook, URL state (overlays and filters), the toast and question
 * shims (on components/ui), formatting, the toolbar's pieces and the detail drawer. The page is pages/DiscoverPage.js;
 * the API is backend/routes/discovery.js. The tiles are in Tile.js / PerformerTile.js, the performer drawer in
 * PerformerDrawer.js.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Button, ButtonBase, Drawer, IconButton, MenuItem, Select, TextField, Tooltip, Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { overlayChipSx, Panel, SPACE } from '../layout';
import { useAsk as useAppAsk, useNotify, useToastLift } from '../ui';

export const API = '/api/discovery';
export const PAGE = 60;
const MAX_LIMIT = 200;

// ── requests ─────────────────────────────────────────────────
/** Any method, JSON or a raw body; the answer as JSON. A refusal throws with its message, .status and .data. */
export async function request(method, path, body, type = 'application/json') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': type },
    body: body === undefined || type !== 'application/json' ? body : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}
export const get = (path) => request('GET', path);
export const post = (path, body) => request('POST', path, body || {});
export const del = (path) => request('DELETE', path);

/** The key of a list item: a group or upload id, a post or profile id, or a member key. */
export const keyOf = (x) => x.id ?? x.post_id ?? x.profile_id ?? x.key;
/** Whether an item is one seen already: an item with no key is never taken for another one */
const seenBefore = (keys, x) => { const k = keyOf(x); return k != null && keys.has(k); };

const withRange = (path, offset, limit) => `${path}${path.includes('?') ? '&' : '?'}offset=${offset}&limit=${limit}`;

/** `count` items from offset 0, in pages of at most 200, one after the other. */
async function fetchFirst(path, count) {
  const items = [];
  const seen = new Set();
  let total = 0;
  let extra = {};
  let offset = 0;
  for (;;) {
    const limit = Math.min(MAX_LIMIT, Math.max(1, count - items.length));
    const { items: page = [], total: t = 0, offset: _o, ...rest } = await get(withRange(path, offset, limit));
    total = t;
    extra = rest;
    for (const x of page) {
      if (seenBefore(seen, x)) continue;
      const k = keyOf(x);
      if (k != null) seen.add(k);
      items.push(x);
    }
    offset += page.length;
    if (page.length < limit || items.length >= count || offset >= total) break;
  }
  return { items, total, extra };
}

const NO_ITEMS = [];
const NO_EXTRA = {};
const NO_GONE = new Set();

/**
 * A list from the API, a page at a time.
 * - A new path clears the list at once and loads the first page.
 * - A `version` change (a run ended, the line changed) does not refetch: it sets `stale`, so nothing moves under the
 *   pointer. reload() fetches as many as are shown again (pages of 200) and clears `stale` and `gone`.
 * - patch(key, changes) changes one item in place; markGone(key, true) counts an item that no longer belongs to the list
 *   (it stays where it is until a reload); loadMore() starts after the items that are still on the server.
 * - extra: every field of the answer except items/total/offset (counts, not_judged_ids, watcher…).
 */
export function useList(path, { active = true, version = 0 } = {}) {
  const [s, setS] = useState({ path: null, items: NO_ITEMS, total: 0, extra: NO_EXTRA, loaded: false, error: null, stale: false, gone: NO_GONE, goneBase: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);
  const mine = s.path === path;
  const items = mine ? s.items : NO_ITEMS;
  const gone = mine ? s.gone : NO_GONE;
  const live = useRef(null);
  live.current = { path, items, gone };

  const load = useCallback(async (p, count) => {
    const n = ++seq.current;
    try {
      const { items: got, total, extra } = await fetchFirst(p, count);
      if (n !== seq.current) return;   // a newer path or reload won
      setS({ path: p, items: got, total, extra, loaded: true, error: null, stale: false, gone: NO_GONE, goneBase: 0 });
    } catch (e) {
      if (n !== seq.current) return;
      setS(prev => (prev.path === p
        ? { ...prev, loaded: true, error: e.message }
        : { path: p, items: NO_ITEMS, total: 0, extra: NO_EXTRA, loaded: true, error: e.message, stale: false, gone: NO_GONE, goneBase: 0 }));
    }
  }, []);

  const reload = useCallback(() => {
    const { path: p, items: have, gone: out } = live.current;
    return load(p, Math.max(PAGE, have.length - out.size));
  }, [load]);

  const loadedPath = useRef(null);
  useEffect(() => {
    if (!active) return;
    if (loadedPath.current !== path) { loadedPath.current = path; load(path, PAGE); }
    else reload();   // shown again: catch up quietly
  }, [active, path, load, reload]);

  const lastVersion = useRef(version);
  useEffect(() => {
    if (lastVersion.current === version) return;
    lastVersion.current = version;
    const p = live.current.path;
    setS(prev => (prev.path === p && prev.loaded ? { ...prev, stale: true } : prev));
  }, [version]);

  const loadMore = useCallback(async () => {
    const { path: p, items: have, gone: out } = live.current;
    const n = seq.current;
    setLoadingMore(true);
    try {
      const { items: more = [], total, offset: _o, ...extra } = await get(withRange(p, Math.max(0, have.length - out.size), PAGE));
      if (n !== seq.current) return;
      setS(prev => {
        if (prev.path !== p) return prev;
        const keys = new Set(prev.items.map(keyOf));
        return { ...prev, total, extra: { ...prev.extra, ...extra }, goneBase: prev.gone.size, items: [...prev.items, ...more.filter(x => !seenBefore(keys, x))] };
      });
    } catch (e) {
      if (n === seq.current) setS(prev => (prev.path === p ? { ...prev, error: e.message } : prev));
    } finally {
      setLoadingMore(false);
    }
  }, []);

  const remove = useCallback((key) => setS(prev => {
    if (!prev.items.some(x => keyOf(x) === key)) return prev;
    const nextGone = prev.gone.has(key) ? new Set([...prev.gone].filter(k => k !== key)) : prev.gone;
    return { ...prev, total: Math.max(0, prev.total - 1), items: prev.items.filter(x => keyOf(x) !== key), gone: nextGone };
  }), []);

  const patch = useCallback((key, changes) => setS(prev => ({
    ...prev,
    items: prev.items.map(x => (keyOf(x) === key ? (typeof changes === 'function' ? changes(x) : { ...x, ...changes }) : x))
  })), []);

  const markGone = useCallback((key, isGone) => setS(prev => {
    if (prev.gone.has(key) === !!isGone) return prev;
    const next = new Set(prev.gone);
    if (isGone) next.add(key); else next.delete(key);
    return { ...prev, gone: next };
  }), []);

  return {
    items,
    total: mine ? s.total : 0,
    extra: mine ? s.extra : NO_EXTRA,
    loaded: mine && s.loaded,
    error: mine ? s.error : null,
    loadingMore,
    // the server's total counts what was gone at the last fetch already
    hasMore: mine && items.length - s.goneBase < s.total,
    stale: mine && s.stale,
    gone,
    reload, loadMore, remove, patch, markGone, retry: reload
  };
}

/** What a drawer shows. The item stays while the drawer slides out. (Kept for older callers; new ones use useOverlay.) */
export function useDetail() {
  const [state, setState] = useState({ open: false, item: null });
  const show = useCallback((item) => setState({ open: true, item }), []);
  const close = useCallback(() => setState(s => ({ ...s, open: false })), []);
  return { ...state, show, close };
}

// ── URL state ────────────────────────────────────────────────
/** The location and navigate of this render, readable from stable callbacks (BrowserRouter's navigate changes often). */
function useRouterRefs() {
  const location = useLocation();
  const navigate = useNavigate();
  const here = useRef(location);
  const nav = useRef(navigate);
  here.current = location;
  nav.current = navigate;
  return { location, here, nav };
}

const searchOf = (params) => {
  const s = params.toString();
  return s ? `?${s}` : '';
};

/**
 * An overlay (drawer, lightbox, sheet) kept in the URL, so Back closes it and a reload opens it again.
 * open(value) pushes an entry with state { overlay: name }; close() goes back when this entry opened it, else replaces
 * the URL without the param; set(value) replaces the value without a new entry. `also`: params that go with it (a
 * lightbox inside a drawer) and are removed when it opens or closes. Other params are kept.
 */
export function useOverlay(name, { also = [] } = {}) {
  const { location, here, nav } = useRouterRefs();
  const alsoKey = also.join(',');
  const value = new URLSearchParams(location.search).get(name);

  const target = useCallback((v) => {
    const loc = here.current;
    const params = new URLSearchParams(loc.search);
    if (alsoKey) alsoKey.split(',').forEach(k => params.delete(k));
    if (v == null) params.delete(name); else params.set(name, String(v));
    return { loc, to: { pathname: loc.pathname, search: searchOf(params), hash: loc.hash } };
  }, [here, name, alsoKey]);

  const open = useCallback((v) => {
    const { loc, to } = target(v);
    const already = loc.state?.overlay === name && new URLSearchParams(loc.search).has(name);
    if (to.search === loc.search) return;
    const state = already ? loc.state : { overlay: name };
    here.current = { ...loc, search: to.search, state };
    nav.current(to, { replace: already, state });
  }, [here, nav, name, target]);

  const close = useCallback(() => {
    const { loc, to } = target(null);
    if (!new URLSearchParams(loc.search).has(name)) return;
    if (loc.state?.overlay === name) {
      here.current = { ...loc, search: to.search, state: null };
      nav.current(-1);
    } else {
      here.current = { ...loc, search: to.search };
      nav.current(to, { replace: true, state: loc.state });
    }
  }, [here, nav, name, target]);

  const set = useCallback((v) => {
    const loc = here.current;
    const params = new URLSearchParams(loc.search);
    if (v == null) params.delete(name); else params.set(name, String(v));
    const search = searchOf(params);
    if (search === loc.search) return;
    here.current = { ...loc, search };
    nav.current({ pathname: loc.pathname, search, hash: loc.hash }, { replace: true, state: loc.state });
  }, [here, nav, name]);

  return { value, open, close, set };
}

/**
 * Filters in the query string: state = { key: URL value or default } for every key of `defaults` (strings).
 * setState(changes) writes those keys (replace), leaving out '' and defaults; every other param is kept.
 */
export function useQueryState(defaults) {
  const { location, here, nav } = useRouterRefs();
  const defs = useRef(defaults);
  defs.current = defaults;
  const signature = Object.entries(defaults).map(([k, v]) => `${k}=${v}`).join('&');

  const state = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return Object.fromEntries(Object.entries(defs.current).map(([k, d]) => [k, params.get(k) ?? d]));
  }, [location.search, signature]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setState = useCallback((changes) => {
    const loc = here.current;
    const params = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(changes || {})) {
      const d = defs.current[k];
      if (v == null || v === '' || (d != null && String(v) === String(d))) params.delete(k);
      else params.set(k, String(v));
    }
    const search = searchOf(params);
    if (search === loc.search) return;
    here.current = { ...loc, search };
    nav.current({ pathname: loc.pathname, search, hash: loc.hash }, { replace: true, state: loc.state });
  }, [here, nav]);

  return [state, setState];
}

// ── the toast and the question (shims on the app's one system, components/ui) ──
/**
 * const [notify, toastNode] = useToast(); notify(message, severity = 'success', { action: { label, onClick }, duration }).
 * Kept for the Discover tabs and useHashActions: it calls components/ui's useNotify (one toast host for the app), so
 * toastNode is null. New code imports useNotify from components/ui. lift: the toast sits higher, above the bottom bar
 * of an open drawer (the page passes it on phones only).
 */
export function useToast({ lift = false } = {}) {
  const notify = useNotify();
  useToastLift(lift ? 'calc(136px + env(safe-area-inset-bottom, 0px))' : null);
  const say = useCallback((message, severity = 'success', { action = null, duration } = {}) => (
    notify({ message, severity, action, duration })
  ), [notify]);
  return [say, null];
}

/**
 * const [ask, dialog] = useAsk(); await ask({ title, text, okLabel, danger }) is true or false; with input: '<label>'
 * (and value) it is the trimmed text typed, or null. Kept for the Discover tabs: it calls components/ui's useAsk (one
 * question host for the app), so dialog is null. New code imports useAsk from components/ui.
 */
export function useAsk() {
  const ask = useAppAsk();
  const shim = useCallback((o) => ask({
    ...o,
    // the old dialog let an empty answer through ('' rather than null); the callers check it themselves
    input: typeof o.input === 'string' ? { label: o.input, value: o.value || '', allowEmpty: true } : o.input,
  }), [ask]);
  return [shim, null];
}

// ── formatting ───────────────────────────────────────────────
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  let v = s / 60;
  for (const [n, unit] of [[60, 'min'], [24, 'h'], [30, 'd'], [12, 'mo']]) {
    if (v < n) return `${Math.floor(v)} ${unit} ago`;
    v /= n;
  }
  return `${Math.floor(v)} y ago`;
}
export const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const one = (x) => (x == null ? null : Math.round(x * 10) / 10);
export const cachedImage = (file) => `${API}/cache/${file.split('/').map(encodeURIComponent).join('/')}`;

/** "23y · UA · 5'9" · 34C" from a performer's profile data */
export function dataLine(data) {
  const f = data?.profile || {};
  const first = (v) => (v == null ? null : String(v).split(' (')[0]);
  return [f.age && `${f.age}y`, f.country_flag && String(f.country_flag).toUpperCase(), first(f.height), first(f.measurements_cup), f.ethnicity].filter(Boolean).join(' · ');
}

export const poolText = (g) => (g.pool_score != null ? `together ${g.pool_score} (${g.pool_images} pictures)` : g.pool_pending ? 'together: not scored yet' : '');

/** The label of a source ("fapello:posts"). One without a watcher of its own is a profile saved for a watcher's post ("Fapello profile"). */
export function sourceLabels(watchers) {
  return (src) => {
    const [site, kind] = String(src).split(':');
    const own = watchers.find(w => w.site === site && w.kind === kind);
    if (own) return own.label;
    const sibling = watchers.find(w => w.site === site);
    return sibling ? `${sibling.label.split(' ')[0]} ${kind === 'profiles' ? 'profile' : 'post'}` : src;
  };
}

// ── small pieces ─────────────────────────────────────────────
export const smallBtnSx = {
  minWidth: 0, px: '9px', py: '2px', fontSize: '.78rem', lineHeight: 1.5, textTransform: 'none', whiteSpace: 'nowrap',
  color: 'var(--text)', borderColor: 'var(--line-strong)', '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' }
};
export const dangerBtnSx = {
  ...smallBtnSx, color: 'var(--bad)', borderColor: 'var(--bad)', '&:hover': { borderColor: 'var(--bad)', bgcolor: 'var(--bad-quiet)' }
};
export const meta = { fontSize: '.75rem', color: 'var(--dim)' };
export const headSx = { mt: 2.25, mb: 1, fontSize: '.75rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' };
const focusRing = { '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 } };

export function SmallButton({ tip, primary, danger, sx, children, ...rest }) {
  const btn = (
    <Button size="small" variant={primary ? 'contained' : 'outlined'}
      sx={{ ...(primary ? { textTransform: 'none', whiteSpace: 'nowrap', py: '2px', fontSize: '.78rem' } : danger ? dangerBtnSx : smallBtnSx), ...sx }} {...rest}>
      {children}
    </Button>
  );
  // A disabled button fires no events, so the tooltip needs the span.
  return tip ? <Tooltip title={tip}><span>{btn}</span></Tooltip> : btn;
}

const BADGE_TONE = {
  dim: ['var(--dim)', 'var(--raised)'], accent: ['var(--accent)', 'var(--accent-quiet)'], info: ['var(--info)', 'var(--info-quiet)'],
  ok: ['var(--ok)', 'var(--ok-quiet)'], bad: ['var(--bad)', 'var(--bad-quiet)'], warn: ['var(--warn)', 'var(--warn-quiet)']
};
export function Badge({ tone = 'dim', title, children, sx, ...rest }) {
  const [color, bgcolor] = BADGE_TONE[tone] || BADGE_TONE.dim;
  return (
    <Box component="span" title={title} {...rest} sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5, height: 22, px: 1, borderRadius: 'var(--radius-sm, 4px)', fontSize: '.75rem', fontWeight: 600,
      whiteSpace: 'nowrap', color, bgcolor, textDecoration: 'none', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', ...sx
    }}>
      {children}
    </Box>
  );
}

export function FilterChip({ on, title, onClick, children }) {
  const chip = (
    <ButtonBase onClick={onClick} aria-pressed={on} sx={{
      height: 28, px: 1.25, borderRadius: 'var(--radius-sm, 4px)', border: '1px solid', fontSize: '.76rem', fontWeight: 550, whiteSpace: 'nowrap',
      borderColor: on ? 'var(--accent)' : 'var(--line)', color: on ? 'var(--accent)' : 'var(--dim)', bgcolor: on ? 'var(--accent-quiet)' : 'var(--raised)',
      '&:hover': { borderColor: on ? 'var(--accent)' : 'var(--line-strong)', color: on ? 'var(--accent)' : 'var(--text)' }, ...focusRing
    }}>
      {children}
    </ButtonBase>
  );
  return title ? <Tooltip title={title}>{chip}</Tooltip> : chip;
}

/** A compact segmented control: [To decide 12 | Decided 3]. */
export function Segment({ label, value, onChange, options }) {
  return (
    <Box role="radiogroup" aria-label={label} sx={{
      display: 'inline-flex', flex: 'none', gap: '2px', p: '2px', height: 32, maxWidth: '100%', overflowX: 'auto', scrollbarWidth: 'none',
      border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', bgcolor: 'var(--bg)',
      '@media (pointer: coarse)': { height: 40 }
    }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <ButtonBase key={o.id} role="radio" aria-checked={on} onClick={() => { if (!on) onChange(o.id); }} sx={{
            flex: 'none', px: 1.25, borderRadius: 'var(--radius-sm, 4px)', fontSize: '.78rem', fontWeight: 560, whiteSpace: 'nowrap',
            color: on ? 'var(--accent)' : 'var(--dim)', bgcolor: on ? 'var(--accent-quiet)' : 'transparent',
            '&:hover': { color: on ? 'var(--accent)' : 'var(--text)', bgcolor: on ? 'var(--accent-quiet)' : 'var(--raised)' },
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
          }}>
            {o.label}
            {o.count != null && <Box component="span" sx={{ color: 'var(--muted)', fontWeight: 500, ml: 0.5, fontVariantNumeric: 'tabular-nums' }}>{o.count}</Box>}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/**
 * The underlined tabs: the page's, and a watcher's sub-tabs. The selected tab is scrolled into view; when the bar
 * overflows, a solid chevron button at that edge scrolls it.
 */
export function TabBar({ tabs, value, onChange, label, small, sx }) {
  const bar = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = bar.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge(e => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = bar.current;
    if (!el) return undefined;
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [measure]);

  const widths = tabs.map(t => `${t.id}:${t.label}:${t.count ?? ''}`).join('|');
  useEffect(() => { measure(); }, [widths, measure]);

  // The selected tab into view (nearest edge), inside the bar only: the page itself never scrolls for it.
  useEffect(() => {
    const el = bar.current;
    const tab = el?.querySelector('[aria-selected="true"]');
    if (!el || !tab) return;
    const pad = 32;
    const l = tab.offsetLeft;
    const r = l + tab.offsetWidth;
    if (l - pad < el.scrollLeft) el.scrollLeft = Math.max(0, l - pad);
    else if (r + pad > el.scrollLeft + el.clientWidth) el.scrollLeft = r + pad - el.clientWidth;
    measure();
  }, [value, widths, measure]);

  const scroll = (dir) => {
    const el = bar.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: 'smooth' });
  };
  const chevron = (side) => (
    <ButtonBase aria-label="More tabs" onClick={() => scroll(side === 'left' ? -1 : 1)} sx={{
      position: 'absolute', top: 0, bottom: '1px', [side]: 0, width: 28, zIndex: 1, color: 'var(--dim)', bgcolor: 'var(--bg)',
      '&:hover': { color: 'var(--text)' }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
    }}>
      {side === 'left' ? <ChevronLeftIcon sx={{ fontSize: 20 }} /> : <ChevronRightIcon sx={{ fontSize: 20 }} />}
    </ButtonBase>
  );

  return (
    <Box sx={{ position: 'relative', mb: small ? 1.5 : SPACE.md, minWidth: 0, ...sx }}>
      <Box ref={bar} role="tablist" aria-label={label} sx={{
        position: 'relative', display: 'flex', gap: '2px', overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
        borderBottom: '1px solid var(--line)'
      }}>
        {tabs.map(({ id, label: text, count }) => (
          <ButtonBase key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)} sx={{
            flex: 'none', px: small ? 1.5 : 1.75, py: small ? 1 : 1.25, fontSize: small ? '.8rem' : '.85rem', fontWeight: 560, whiteSpace: 'nowrap',
            color: value === id ? 'var(--text)' : 'var(--dim)', borderBottom: '2px solid', borderColor: value === id ? 'var(--accent)' : 'transparent',
            '&:hover': { color: 'var(--text)' }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
          }}>
            {text}
            {count != null && <Box component="span" sx={{ color: 'var(--muted)', fontWeight: 500, ml: 0.5, fontVariantNumeric: 'tabular-nums' }}>{count}</Box>}
          </ButtonBase>
        ))}
      </Box>
      {edge.left && chevron('left')}
      {edge.right && chevron('right')}
    </Box>
  );
}

// ── the toolbar's pieces ─────────────────────────────────────
const fieldSx = { fontSize: '.84rem', height: 32, bgcolor: 'var(--surface)' };

/** Search, a quarter of a second after the typing stops. sx is merged into the root. */
export function SearchField({ value, onChange, placeholder, sx }) {
  const [text, setText] = useState(value);
  const timer = useRef(null);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <TextField size="small" type="search" placeholder={placeholder} value={text} inputProps={{ 'aria-label': placeholder }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(next), 250);
      }}
      sx={{ flex: '1 1 200px', maxWidth: { sm: 260 }, '& .MuiInputBase-root': fieldSx, ...sx }} />
  );
}

/** The sorts of the Discover lists, for SortSelect and the sidebar's SideSelect. */
export const SORT_OPTIONS = Object.freeze([
  { value: 'score', label: 'Score, high to low' },
  { value: 'scoreAsc', label: 'Score, low to high' },
  { value: 'newest', label: 'Newest found first' },
  { value: 'name', label: 'Name' }
]);

/** newest: the label of the 'newest' sort. sx is merged into the root. */
export function SortSelect({ value, onChange, newest = 'Newest found first', sx }) {
  return (
    <Select size="small" value={value} onChange={(e) => onChange(e.target.value)} inputProps={{ 'aria-label': 'Sort' }} sx={{ ...fieldSx, ...sx }}>
      {SORT_OPTIONS.map((o) => (
        <MenuItem key={o.value} value={o.value}>{o.value === 'newest' ? newest : o.label}</MenuItem>
      ))}
    </Select>
  );
}

export function TotalText({ children }) {
  return <Typography component="span" sx={{ color: 'var(--muted)', fontSize: '.78rem', fontVariantNumeric: 'tabular-nums' }}>{children}</Typography>;
}

export function LoadMore({ list }) {
  if (!list.hasMore) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5, mb: 1 }}>
      <SmallButton disabled={list.loadingMore} onClick={list.loadMore}>{list.loadingMore ? 'Loading…' : 'Load more'}</SmallButton>
    </Box>
  );
}

/** "New results · Reload", "3 decided here · Reload", or both: sticky over the top of a grid. */
export function StalePill({ list, onReload = list.reload }) {
  const n = list.gone?.size || 0;
  if (!list.stale && !n) return null;
  const text = list.stale && n ? `New results, ${n} decided here` : list.stale ? 'New results' : `${n} decided here`;
  return (
    <Box sx={{ position: 'sticky', top: 'calc(var(--dv-top, 0px) + 8px)', zIndex: 5, display: 'flex', justifyContent: 'center', mb: 1, pointerEvents: 'none' }}>
      <Box role="status" sx={{
        pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 1, maxWidth: 'calc(100vw - 32px)', py: '4px', pl: 1.5, pr: '4px',
        bgcolor: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius, 6px)', boxShadow: 'var(--shadow-md)',
        fontSize: '.78rem', color: 'var(--text)', fontVariantNumeric: 'tabular-nums'
      }}>
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</Box>
        <SmallButton onClick={onReload}>Reload</SmallButton>
      </Box>
    </Box>
  );
}

/** A list that could not load: what went wrong and Retry. */
export function ListError({ error, onRetry }) {
  if (!error) return null;
  return (
    <Panel role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: SPACE.md, py: 1.25, borderColor: 'var(--bad)' }}>
      <Typography sx={{ flex: '1 1 200px', fontSize: '.85rem', color: 'var(--text)', overflowWrap: 'anywhere' }}>{error}</Typography>
      {onRetry && <SmallButton onClick={onRetry}>Retry</SmallButton>}
    </Panel>
  );
}

/** A link to another site: a new tab, with the open-in-new icon after the text. */
export function ExternalLink({ href, children, sx, ...rest }) {
  if (!href) return null;
  return (
    <Box component="a" href={href} target="_blank" rel="noreferrer" {...rest} sx={{
      display: 'inline-flex', alignItems: 'center', gap: '3px', minWidth: 0, color: 'var(--accent)', textDecoration: 'none', overflowWrap: 'anywhere',
      '&:hover': { color: 'var(--accent-hover)', textDecoration: 'underline' }, ...focusRing, ...sx
    }}>
      {children || href}
      <OpenInNewIcon sx={{ fontSize: 15, flexShrink: 0 }} aria-hidden />
    </Box>
  );
}

// ── the old card (kept for callers not moved to Tile.js yet) ──
export const CARD_GRID = { display: 'grid', gridTemplateColumns: { xs: 'repeat(auto-fill, minmax(150px, 1fr))', sm: 'repeat(auto-fill, minmax(200px, 1fr))' }, gap: { xs: 1, sm: 1.5 } };

const OVERLAY_AT = {
  tl: { top: 8, left: 8 },
  tr: { top: 8, right: 8, fontSize: '.75rem', fontWeight: 640, px: '7px' },
  bl: { bottom: 8, left: 8, fontSize: '.75rem', fontWeight: 640, px: '7px', py: '4px' }
};
/** A chip on a picture: the score top left, the state top right, a note bottom left. */
export function Overlay({ at = 'tl', tone, border, title, children }) {
  return (
    <Box title={title} sx={{ ...overlayChipSx(tone), position: 'absolute', ...OVERLAY_AT[at], ...(border && { borderColor: tone }) }}>
      {children}
    </Box>
  );
}

function NoPicture() {
  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: '.75rem' }}>No picture</Box>
  );
}

/** The picture clean with chips over it, name, meta and sources under it, the actions under a hairline. Enter opens it, like a click. */
export function Card({ image, title, tooltip, subtitle, below, overlays, actions, dimmed, known, picked, onOpen }) {
  return (
    <Box component="article" tabIndex={0} aria-label={title} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } }}
      sx={{
        display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', cursor: 'pointer', opacity: known ? 0.62 : 1,
        bgcolor: 'var(--surface)', border: '1px solid', borderColor: picked ? 'var(--accent)' : 'var(--line)', borderRadius: 'var(--radius-lg, 10px)',
        transition: 'border-color .16s ease, background-color .16s ease',
        '&:hover': { borderColor: picked ? 'var(--accent)' : 'var(--line-strong)', bgcolor: 'var(--raised)' },
        '&:hover .card-actions, &:focus-within .card-actions': { opacity: 1 },
        ...focusRing
      }}>
      <Box sx={{ position: 'relative', aspectRatio: '3 / 4', flexShrink: 0, bgcolor: 'var(--raised)' }}>
        {image
          ? <Box component="img" loading="lazy" src={image} alt="" sx={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              filter: dimmed ? 'saturate(.55) brightness(.8)' : undefined
            }} />
          : <NoPicture />}
        {overlays}
      </Box>
      <Box sx={{ display: 'grid', gap: '3px', p: '9px 10px 10px', minWidth: 0 }}>
        <Typography noWrap title={tooltip || title} sx={{ fontSize: '.86rem', fontWeight: 620, letterSpacing: '-0.01em', color: 'var(--text)' }}>{title}</Typography>
        <Typography noWrap sx={{ ...meta, minHeight: '1.05em' }}>{subtitle}</Typography>
        {below}
      </Box>
      {actions && (
        <Box className="card-actions" onClick={(e) => e.stopPropagation()} sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, p: { xs: 0.75, sm: 1 }, mt: 'auto', borderTop: '1px solid var(--line)', opacity: 0.72,
          transition: 'opacity .16s ease', '@media (hover: none)': { opacity: 1 }
        }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}

/** A button in a card's row (or a drawer's). quiet: no border until hovered, and only as wide as its word. */
export function CardAction({ tone, quiet, icon, title, children, ...rest }) {
  const color = tone ? `var(--${tone})` : 'var(--text)';
  return (
    <Tooltip title={title}>
      <Box component="span" sx={{ display: 'inline-flex', flex: quiet ? '0 0 auto' : '1 1 0', minWidth: 0 }}>
        <ButtonBase {...rest} sx={{
          flex: 1, gap: 0.5, height: 28, px: 0.5, borderRadius: 'var(--radius, 6px)', whiteSpace: 'nowrap',
          border: '1px solid', borderColor: quiet ? 'transparent' : 'var(--line)', color: quiet ? 'var(--muted)' : 'var(--dim)',
          fontSize: '.75rem', fontWeight: 560, transition: 'color .14s ease, border-color .14s ease, background-color .14s ease',
          '& svg': { fontSize: 15, flexShrink: 0, display: { xs: 'none', sm: 'block' } },
          '&:hover': { color, borderColor: tone ? color : 'var(--line-strong)', bgcolor: tone ? `var(--${tone}-quiet)` : 'var(--raised)' },
          '&.Mui-disabled': { opacity: 0.45 }, ...focusRing
        }}>
          {icon}{children}
        </ButtonBase>
      </Box>
    </Tooltip>
  );
}

// ── a performer's pieces ─────────────────────────────────────
/** Her sources as links: each opens the best of what that source found of her, on the site. */
export function SourceChips({ g, sourceLabel }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
      {g.sources.map(s => {
        const link = g.members.find(m => m.source === s)?.link;   // members come best first
        const label = sourceLabel(s);
        const sx = { fontSize: '.75rem', fontWeight: 600, px: '7px', py: '2px', borderRadius: 'var(--radius-sm, 4px)', color: 'var(--info)', bgcolor: 'var(--info-quiet)', textDecoration: 'none' };
        return link
          ? <Box key={s} component="a" href={link} target="_blank" rel="noreferrer" title={`Open her on ${label}`} onClick={(e) => e.stopPropagation()}
              sx={{ ...sx, '&:hover': { boxShadow: 'inset 0 0 0 1px var(--info)' } }}>{label}</Box>
          : <Box key={s} component="span" sx={sx}>{label}</Box>;
      })}
    </Box>
  );
}

/**
 * One find of her, a profile or a post, opening it on the site (new tab). action: a small control at the end of the
 * row (Take apart), outside the link.
 */
export function MemberRow({ m, showMatch, sourceLabel, action }) {
  const kind = m.type === 'profile' ? 'Profile' : 'Post';
  const label = sourceLabel ? sourceLabel(m.source) : m.source;
  const found = m.posted_at || m.found_at;
  const note = [label, showMatch && m.matched_on?.length ? `matched on ${m.matched_on.join(', ')}` : null, found ? ago(found) : null].filter(Boolean).join(' · ');
  const Tag = m.link ? 'a' : 'div';
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, p: 0.75, minWidth: 0, border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)',
      bgcolor: 'var(--bg)', transition: 'border-color .14s ease', '&:hover': { borderColor: 'var(--line-strong)' }
    }}>
      <Box component={Tag} href={m.link || undefined} target={m.link ? '_blank' : undefined} rel={m.link ? 'noreferrer' : undefined}
        title={m.link ? `Open on the site: ${m.title || m.name}` : `${kind}: ${m.title || m.name}`} sx={{
          display: 'flex', gap: 1.25, alignItems: 'center', flex: '1 1 auto', minWidth: 0, color: 'inherit', textDecoration: 'none', ...focusRing
        }}>
        <Box sx={{ position: 'relative', width: 48, height: 64, flexShrink: 0, borderRadius: 'var(--radius-sm, 4px)', overflow: 'hidden', bgcolor: 'var(--raised)' }}>
          {m.image && <Box component="img" loading="lazy" src={m.image} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          {m.score != null && (
            <Box component="span" sx={{
              position: 'absolute', right: 2, bottom: 2, px: '3px', fontSize: '.75rem', fontWeight: 700, lineHeight: 1.3, borderRadius: '3px', bgcolor: 'var(--scrim-strong)',
              color: m.kept ? 'var(--ok)' : 'var(--dim)', fontVariantNumeric: 'tabular-nums'
            }}>{m.score}</Box>
          )}
        </Box>
        <Box sx={{ minWidth: 0, flex: '1 1 auto', fontSize: '.8rem', lineHeight: 1.35, overflow: 'hidden', color: 'var(--text)' }}>
          <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
            <Box component="b" sx={{ fontWeight: 600, color: 'var(--dim)' }}>{kind}</Box> {m.title || m.name}
          </Box>
          <Box sx={{ color: 'var(--muted)', fontSize: '.75rem', overflowWrap: 'anywhere' }}>{note}</Box>
        </Box>
        {m.link && <OpenInNewIcon aria-hidden sx={{ fontSize: 15, color: 'var(--muted)', flexShrink: 0 }} />}
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}

export const MEMBER_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 1, mt: 1 };

// ── the drawer ───────────────────────────────────────────────
/**
 * The right-hand drawer: a cover (3/4, at most 45vh) and the children in a scrolling body; `bar` is a bottom bar that
 * stays in place. Esc, the backdrop and the close button close it. cover={false} leaves the cover out (loading, gone).
 */
export function DetailDrawer({ open, onClose, image, score, tone, bar, cover = true, children }) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      slotProps={{ paper: { sx: {
        width: 'min(460px, 100vw)', bgcolor: 'var(--surface)', backgroundImage: 'none', borderLeft: '1px solid var(--line-strong)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      } } }}>
      <Tooltip title="Close (Esc)">
        <IconButton onClick={onClose} aria-label="Close" sx={{
          position: 'absolute', top: 10, right: 10, zIndex: 2, width: 40, height: 40, color: 'var(--text)', bgcolor: 'var(--scrim-strong)',
          border: '1px solid var(--line-strong)', borderRadius: 'var(--radius, 6px)', '&:hover': { bgcolor: 'var(--scrim-strong)', borderColor: 'var(--text)' }
        }}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Box sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {cover && (
          <Box sx={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', maxHeight: '45vh', flexShrink: 0, bgcolor: 'var(--raised)', overflow: 'hidden' }}>
            {image
              ? <Box component="img" src={image} alt="" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <NoPicture />}
            {score != null && <Overlay tone={tone}>{score}</Overlay>}
          </Box>
        )}
        <Box sx={{ p: SPACE.md, pt: cover ? SPACE.md : 7 }}>{children}</Box>
      </Box>
      {bar && (
        <Box sx={{
          flex: 'none', bgcolor: 'var(--surface)', borderTop: '1px solid var(--line-strong)',
          p: '12px 16px', pb: 'calc(12px + env(safe-area-inset-bottom))'
        }}>
          {bar}
        </Box>
      )}
    </Drawer>
  );
}

export function DrawerTitle({ children, subtitle }) {
  return (
    <>
      <Typography component="h2" sx={{ fontSize: '1.15rem', fontWeight: 640, letterSpacing: '-0.015em', color: 'var(--text)', overflowWrap: 'anywhere' }}>{children}</Typography>
      {subtitle && <Typography variant="body2" sx={{ color: 'var(--dim)', mt: 0.25, overflowWrap: 'anywhere' }}>{subtitle}</Typography>}
    </>
  );
}

export const RowOf = ({ children, sx }) => <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5, ...sx }}>{children}</Box>;

export const Link = ({ href, children }) => (href
  ? <Box component="a" href={href} target="_blank" rel="noreferrer" sx={{ color: 'var(--accent)', overflowWrap: 'anywhere', '&:hover': { color: 'var(--accent-hover)' } }}>{children || href}</Box>
  : <Nothing />);
export const Nothing = ({ children = 'none' }) => <Box component="span" sx={{ color: 'var(--dim)' }}>{children}</Box>;

/** Label and value rows. */
export function Rows({ rows }) {
  return (
    <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '8px 12px', m: 0, fontSize: '.82rem' }}>
      {rows.map(([label, value], i) => (
        <React.Fragment key={i}>
          <Box component="dt" sx={{ color: 'var(--muted)' }}>{label}</Box>
          <Box component="dd" sx={{ m: 0, overflowWrap: 'anywhere', color: 'var(--text)' }}>{value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

const PROFILE_FIELDS = {
  age: 'Age', born: 'Born', birthplace: 'Birthplace', country_flag: 'Country', height: 'Height', weight: 'Weight', measurements_cup: 'Cup',
  hair_color: 'Hair', eye_color: 'Eyes', ethnicity: 'Ethnicity', body_type: 'Body', orientation: 'Orientation'
};
/** Her profile data as rows. scrape: { profile, aliases, tags, socials } */
export function profileRows(scrape) {
  const f = scrape?.profile || {};
  return [
    ...Object.entries(PROFILE_FIELDS).filter(([k]) => f[k] != null).map(([k, label]) => [label, k === 'country_flag' ? String(f[k]).toUpperCase() : String(f[k])]),
    ['Aliases', (scrape?.aliases || []).join(', ') || <Nothing />],
    ['Tags', (scrape?.tags || []).join(', ') || <Nothing />],
    ...Object.entries(scrape?.socials || {}).map(([k, url], i) => [i === 0 ? 'Socials' : '', <>{k}: <ExternalLink href={url} /></>])
  ];
}

export const PICTURE_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 };

/**
 * A picture in a drawer; hidden when the file is gone. With onOpen it is a button (the in-app lightbox), without it a
 * link to the file.
 */
export function PictureTile({ image, score, tone, name, title, error, onOpen, onGone }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const box = {
    position: 'relative', display: 'block', width: '100%', p: 0, m: 0, aspectRatio: '3 / 4', borderRadius: 'var(--radius, 6px)', overflow: 'hidden',
    bgcolor: 'var(--raised)', border: '1px solid var(--line)', cursor: 'zoom-in', font: 'inherit', color: 'inherit',
    '&:hover': { borderColor: 'var(--line-strong)' }, ...focusRing
  };
  const inner = (
    <>
      <Box component="img" loading="lazy" src={image} alt="" onError={() => { setGone(true); onGone?.(); }} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {(score != null || error) && (
        <Box sx={{ ...overlayChipSx(score != null ? tone : 'var(--bad)'), position: 'absolute', top: 6, left: 6, px: '6px', py: '3px', fontSize: '.75rem', boxShadow: 'none' }}>
          {score != null ? score : '!'}
        </Box>
      )}
      {name && (
        <Box sx={{
          position: 'absolute', left: 0, right: 0, bottom: 0, p: '3px 6px', fontSize: '.75rem', lineHeight: 1.35, color: 'var(--text)', textAlign: 'left',
          bgcolor: 'var(--scrim-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{name}</Box>
      )}
    </>
  );
  return onOpen
    ? <Box component="button" type="button" onClick={onOpen} title={title} aria-label={title || name || 'Open picture'} sx={box}>{inner}</Box>
    : <Box component="a" href={image} target="_blank" rel="noreferrer" title={title} sx={box}>{inner}</Box>;
}
