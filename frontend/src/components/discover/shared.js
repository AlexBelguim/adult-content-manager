/**
 * What the Discover page's tabs share: requests, formatting, the toolbar's pieces, the card, the detail drawer and the
 * question dialog. The page is pages/DiscoverPage.js; the API is backend/routes/discovery.js.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, MenuItem, Select,
  TextField, Tooltip, Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { overlayChipSx, SPACE } from '../layout';

export const API = '/api/discovery';
export const PAGE = 60;

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

const keyOf = (x) => x.id ?? x.post_id ?? x.profile_id;

/**
 * A list from the API, a page at a time. A new path starts over; the same path again (a run ended, reload) keeps as many
 * as were loaded, so a long list doesn't jump back to the top. remove(id) takes one out without asking the server.
 */
export function useList(path, { active = true, version = 0 } = {}) {
  const [list, setList] = useState({ items: [], total: 0, extra: {}, loaded: false });
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);
  const count = useRef(0);
  const lastPath = useRef(null);
  count.current = list.items.length;

  const fetchPage = useCallback((offset, limit) => get(`${path}${path.includes('?') ? '&' : '?'}offset=${offset}&limit=${limit}`), [path]);

  const load = useCallback(async (limit) => {
    const mine = ++seq.current;
    try {
      const { items, total, offset, ...extra } = await fetchPage(0, limit);
      if (mine !== seq.current) return;   // a newer filter won
      setList({ items, total, extra, loaded: true });
      setError(null);
    } catch (e) {
      if (mine === seq.current) { setError(e.message); setList(l => ({ ...l, loaded: true })); }
    }
  }, [fetchPage]);

  const reload = useCallback(() => load(Math.min(200, Math.max(PAGE, count.current))), [load]);

  useEffect(() => {
    if (!active) return;
    if (lastPath.current === path) reload();
    else { lastPath.current = path; load(PAGE); }
  }, [active, path, version, load, reload]);

  const loadMore = useCallback(async () => {
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const { items, total } = await fetchPage(count.current, PAGE);
      if (mine !== seq.current) return;
      setList(l => {
        const have = new Set(l.items.map(keyOf));
        return { ...l, total, items: [...l.items, ...items.filter(x => !have.has(keyOf(x)))] };
      });
    } catch (e) { setError(e.message); } finally { setLoadingMore(false); }
  }, [fetchPage]);

  const remove = useCallback((id) => setList(l => ({ ...l, total: Math.max(0, l.total - 1), items: l.items.filter(x => x.id !== id) })), []);

  return { ...list, error, loadingMore, hasMore: list.items.length < list.total, reload, loadMore, remove };
}

/** What a drawer shows. The item stays while the drawer slides out. */
export function useDetail() {
  const [state, setState] = useState({ open: false, item: null });
  const show = useCallback((item) => setState({ open: true, item }), []);
  const close = useCallback(() => setState(s => ({ ...s, open: false })), []);
  return { ...state, show, close };
}

/**
 * A question in the app's own dialog: const [ask, dialog] = useAsk(); await ask({ title, text, okLabel, danger }) is true or
 * false; with input: '<label>' (and value) it is the text typed, or null.
 */
export function useAsk() {
  const [q, setQ] = useState({ open: false });
  const [value, setValue] = useState('');
  const ask = useCallback((options) => new Promise((resolve) => {
    setValue(options.value || '');
    setQ({ ...options, open: true, resolve });
  }), []);
  const close = (answer) => {
    q.resolve?.(answer);
    setQ(prev => ({ ...prev, open: false }));
  };
  const cancel = () => close(q.input ? null : false);
  const dialog = (
    <Dialog open={q.open} onClose={cancel} maxWidth="xs" fullWidth>
      <form onSubmit={(e) => { e.preventDefault(); close(q.input ? value : true); }}>
        <DialogTitle>{q.title}</DialogTitle>
        <DialogContent>
          {q.text && <Typography variant="body2" sx={{ color: 'var(--dim)', mb: q.input ? 1.5 : 0 }}>{q.text}</Typography>}
          {q.input && (
            <TextField autoFocus fullWidth size="small" label={q.input} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cancel} sx={{ color: 'var(--dim)' }}>Cancel</Button>
          <Button type="submit" autoFocus={!q.input} variant={q.danger ? 'outlined' : 'contained'} sx={q.danger ? dangerBtnSx : undefined}>
            {q.okLabel || 'OK'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
  return [ask, dialog];
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
export const meta = { fontSize: '.74rem', color: 'var(--dim)' };
export const headSx = { mt: 2.25, mb: 1, fontSize: '.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' };
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
export function Badge({ tone = 'dim', title, children }) {
  const [color, bgcolor] = BADGE_TONE[tone];
  return (
    <Box component="span" title={title} sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5, height: 20, px: 1, borderRadius: 99, fontSize: '.7rem', fontWeight: 600,
      whiteSpace: 'nowrap', color, bgcolor
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

/** The underlined tabs: the page's, and a watcher's Kept / Not kept / Skipped */
export function TabBar({ tabs, value, onChange, label, small, sx }) {
  return (
    <Box role="tablist" aria-label={label} sx={{ display: 'flex', gap: '2px', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, borderBottom: '1px solid var(--line)', mb: small ? 1.5 : SPACE.md, overflowX: 'auto', ...sx }}>
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
  );
}

// ── the toolbar's pieces ─────────────────────────────────────
const fieldSx = { fontSize: '.84rem', height: 32, bgcolor: 'var(--surface)' };

/** Search, a quarter of a second after the typing stops. */
export function SearchField({ value, onChange, placeholder }) {
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
      sx={{ flex: '1 1 200px', maxWidth: { sm: 260 }, '& .MuiInputBase-root': fieldSx }} />
  );
}

export function SortSelect({ value, onChange, newest = 'Newest found first' }) {
  return (
    <Select size="small" value={value} onChange={(e) => onChange(e.target.value)} inputProps={{ 'aria-label': 'Sort' }} sx={fieldSx}>
      <MenuItem value="score">Score, high to low</MenuItem>
      <MenuItem value="scoreAsc">Score, low to high</MenuItem>
      <MenuItem value="newest">{newest}</MenuItem>
      <MenuItem value="name">Name</MenuItem>
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

// ── the card ─────────────────────────────────────────────────
export const CARD_GRID = { display: 'grid', gridTemplateColumns: { xs: 'repeat(auto-fill, minmax(150px, 1fr))', sm: 'repeat(auto-fill, minmax(200px, 1fr))' }, gap: { xs: 1, sm: 1.5 } };

const OVERLAY_AT = {
  tl: { top: 8, left: 8 },
  tr: { top: 8, right: 8, fontSize: '.68rem', fontWeight: 640, px: '7px' },
  bl: { bottom: 8, left: 8, fontSize: '.68rem', fontWeight: 640, px: '7px', py: '4px' }
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
    <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: '.74rem' }}>No picture</Box>
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
        transition: 'border-color .16s ease, background-color .16s ease, transform .16s ease',
        '&:hover': { borderColor: picked ? 'var(--accent)' : 'var(--line-strong)', bgcolor: 'var(--raised)', transform: 'translateY(-2px)' },
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
        <Typography noWrap sx={{ ...meta, fontSize: '.72rem', minHeight: '1.05em' }}>{subtitle}</Typography>
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
          fontSize: '.74rem', fontWeight: 560, transition: 'color .14s ease, border-color .14s ease, background-color .14s ease',
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
        const sx = { fontSize: '.62rem', fontWeight: 600, px: '7px', py: '2px', borderRadius: 'var(--radius-sm, 4px)', color: 'var(--info)', bgcolor: 'var(--info-quiet)', textDecoration: 'none' };
        return link
          ? <Box key={s} component="a" href={link} target="_blank" rel="noreferrer" title={`Open her on ${label}`} onClick={(e) => e.stopPropagation()}
              sx={{ ...sx, '&:hover': { boxShadow: 'inset 0 0 0 1px var(--info)' } }}>{label}</Box>
          : <Box key={s} component="span" sx={sx}>{label}</Box>;
      })}
    </Box>
  );
}

/** One find of her, a profile or a post, opening it on the site. */
export function MemberRow({ m, showMatch, sourceLabel }) {
  const kind = m.type === 'profile' ? 'Profile' : 'Post';
  const note = [sourceLabel(m.source), showMatch && m.matched_on?.length ? `matched on ${m.matched_on.join(', ')}` : null, m.posted_at ? ago(m.posted_at) : null].filter(Boolean).join(' · ');
  return (
    <Box component={m.link ? 'a' : 'div'} href={m.link || undefined} target={m.link ? '_blank' : undefined} rel={m.link ? 'noreferrer' : undefined}
      title={`${kind}: ${m.title || m.name}`} sx={{
        display: 'flex', gap: 1.25, alignItems: 'center', p: 0.75, minWidth: 0, color: 'inherit', textDecoration: 'none',
        border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', bgcolor: 'var(--bg)', transition: 'border-color .14s ease',
        '&:hover': { borderColor: 'var(--line-strong)' }
      }}>
      <Box sx={{ position: 'relative', width: 46, height: 61, flexShrink: 0, borderRadius: 'var(--radius-sm, 4px)', overflow: 'hidden', bgcolor: 'var(--raised)' }}>
        {m.image && <Box component="img" loading="lazy" src={m.image} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        {m.score != null && (
          <Box component="span" sx={{
            position: 'absolute', right: 2, bottom: 2, px: '3px', fontSize: '.6rem', fontWeight: 700, borderRadius: '3px', bgcolor: 'var(--scrim-strong)',
            color: m.kept ? 'var(--ok)' : 'var(--dim)', fontVariantNumeric: 'tabular-nums'
          }}>{m.score}</Box>
        )}
      </Box>
      <Box sx={{ minWidth: 0, fontSize: '.78rem', lineHeight: 1.35, overflow: 'hidden', color: 'var(--text)' }}>
        <Box component="b" sx={{ fontWeight: 600, color: 'var(--dim)' }}>{kind}</Box> {m.title || m.name}
        <Box sx={{ color: 'var(--muted)', fontSize: '.7rem' }}>{note}</Box>
      </Box>
    </Box>
  );
}

export const MEMBER_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 1, mt: 1 };

// ── the drawer ───────────────────────────────────────────────
export function DetailDrawer({ open, onClose, image, score, tone, children }) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      slotProps={{ paper: { sx: { width: 'min(460px, 100vw)', bgcolor: 'var(--surface)', backgroundImage: 'none', borderLeft: '1px solid var(--line-strong)' } } }}>
      <Box sx={{ position: 'relative', aspectRatio: '3 / 4', flexShrink: 0, bgcolor: 'var(--raised)' }}>
        {image && <Box component="img" src={image} alt="" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
        {score != null && <Overlay tone={tone}>{score}</Overlay>}
        <Tooltip title="Close (Esc)">
          <IconButton onClick={onClose} aria-label="Close" sx={{
            position: 'absolute', top: 10, right: 10, width: 30, height: 30, color: 'var(--text)', bgcolor: 'var(--scrim-strong)',
            border: '1px solid var(--line-strong)', borderRadius: 'var(--radius, 6px)', '&:hover': { bgcolor: 'var(--scrim-strong)' }
          }}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ p: SPACE.md }}>{children}</Box>
    </Drawer>
  );
}

export function DrawerTitle({ children, subtitle }) {
  return (
    <>
      <Typography component="h2" sx={{ fontSize: '1.15rem', fontWeight: 640, letterSpacing: '-0.015em', color: 'var(--text)', overflowWrap: 'anywhere' }}>{children}</Typography>
      {subtitle && <Typography variant="body2" sx={{ color: 'var(--dim)', mt: 0.25 }}>{subtitle}</Typography>}
    </>
  );
}

export const RowOf = ({ children, sx }) => <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5, ...sx }}>{children}</Box>;

export const Link = ({ href, children }) => (href
  ? <Box component="a" href={href} target="_blank" rel="noreferrer" sx={{ color: 'var(--accent)', '&:hover': { color: 'var(--accent-hover)' } }}>{children || href}</Box>
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
    ...Object.entries(scrape?.socials || {}).map(([k, url], i) => [i === 0 ? 'Socials' : '', <>{k}: <Link href={url} /></>])
  ];
}

export const PICTURE_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 };

/** A picture in a drawer, opening it full size; hidden when the file is gone. */
export function PictureTile({ image, score, tone, name, title, error }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <Box component="a" href={image} target="_blank" rel="noreferrer" title={title} sx={{
      position: 'relative', display: 'block', aspectRatio: '3 / 4', borderRadius: 'var(--radius, 6px)', overflow: 'hidden',
      bgcolor: 'var(--raised)', border: '1px solid var(--line)'
    }}>
      <Box component="img" loading="lazy" src={image} alt="" onError={() => setGone(true)} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {(score != null || error) && (
        <Box sx={{ ...overlayChipSx(score != null ? tone : 'var(--bad)'), position: 'absolute', top: 6, left: 6, px: '7px', py: '3px', fontSize: '.7rem' }}>
          {score != null ? score : '!'}
        </Box>
      )}
      {name && (
        <Box sx={{
          position: 'absolute', left: 0, right: 0, bottom: 0, p: '14px 6px 5px', fontSize: '.64rem', color: 'var(--text)',
          background: 'linear-gradient(transparent, var(--scrim-strong))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{name}</Box>
      )}
    </Box>
  );
}
