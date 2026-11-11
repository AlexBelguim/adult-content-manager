/**
 * SidebarPage: the one page frame with a sidebar. Desktop: a 264px sidebar (or a 64px rail when collapsed) next to
 * the content. Phone: no sidebar; the View list becomes a tab row and everything else opens from "Filters · N" as a
 * bottom sheet (next to the search, or on the ContentLine when the page has no search).
 *
 *   <SidebarPage title="Discover" views={[{ id, label, count?, sub?, icon, to?, replace?, state?, onClick?, title?, dot? }]}
 *     view="performers" viewsTitle="View" parent onBack barActions barMenu fill={false}
 *     phoneTabs={true} phoneRow={true} className sx>
 *     <SideGroup …>…</SideGroup>   (side.js: drawn in the sidebar, not where it sits)
 *     <ContentLine … />
 *     …the items
 *   </SidebarPage>
 *
 * How groups render: a SideGroup registers its meta here and portals its children into one persistent detached div
 * per group id. The frame appends that div into whatever hosts it now (the sidebar slot, the rail's open flyout or
 * the phone sheet), so React state inside a group survives collapse, expand and the sheet.
 *
 * Also exported: useSidebarCollapsed() -> [collapsed, setCollapsed] (one localStorage key for the whole app),
 * useSidebarMode() -> 'sidebar' | 'rail' | 'phone' | null, useSidebarSheet() -> { open, close, isOpen, count },
 * PhoneViewTabs, compactCount, the constants and the item row style.
 *
 * Imports only nav submodules, never '../../nav' or components/discover (import cycles).
 */
import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore
} from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Box, ButtonBase, CircularProgress, Drawer, Popover, Tooltip, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { useChrome } from '../../nav/shell';
import { usePageBar } from '../../nav/pageBar';
import useIsPhone from '../../nav/useIsPhone';

/* ─── constants ───────────────────────────────────────────────── */
export const SIDEBAR_W = 264;
export const RAIL_W = 64;
export const GUTTER = 24;
/** The desktop app bar: 56px plus its 1px line. */
export const APP_BAR_H = 57;
/** The phone page bar (48px plus its line) and the bottom nav (56px plus its line), safe areas apart. */
const PHONE_BAR_H = 49;
const PHONE_NAV_H = 57;
/** Group order bands: Show groups, second lists, then the page's own sections (a line goes before the first of these). */
export const SIDE = Object.freeze({ show: 10, list: 20, page: 30 });

/** 999 -> '999', 1663 -> '1.7k', 13018 -> '13k', 2400000 -> '2.4M'; null -> ''. */
export function compactCount(n) {
  if (n == null || n === '') return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a < 1000) return String(v);
  if (a < 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (a < 1e6) return `${Math.round(v / 1000)}k`;
  return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

const fullCount = (n) => (n == null ? '' : (typeof n === 'number' ? n.toLocaleString() : String(n)));

export const visuallyHiddenSx = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0
};

/* ─── collapse: one key for the whole app ─────────────────────── */
const COLLAPSE_KEY = 'acm.sidebar.collapsed';

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

let collapsedNow = typeof window === 'undefined' ? false : readCollapsed();
const collapseListeners = new Set();
const emitCollapse = () => collapseListeners.forEach((fn) => fn());

function setCollapsedNow(value) {
  const v = !!value;
  if (v === collapsedNow) return;
  collapsedNow = v;
  try {
    if (v) window.localStorage.setItem(COLLAPSE_KEY, '1');
    else window.localStorage.removeItem(COLLAPSE_KEY);
  } catch {
    // storage blocked: the choice lasts until the page reloads
  }
  emitCollapse();
}

function onStorage(e) {
  if (e.key !== COLLAPSE_KEY && e.key !== null) return;
  const v = readCollapsed();
  if (v === collapsedNow) return;
  collapsedNow = v;
  emitCollapse();
}

function subscribeCollapse(fn) {
  collapseListeners.add(fn);
  if (collapseListeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    collapseListeners.delete(fn);
    if (collapseListeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

const getCollapsed = () => collapsedNow;
const getCollapsedServer = () => false;

/** [collapsed, setCollapsed(bool)]: every mounted SidebarPage follows it. */
export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribeCollapse, getCollapsed, getCollapsedServer);
  return [collapsed, setCollapsedNow];
}

/* ─── contexts ────────────────────────────────────────────────── */
/** The stable registration API (null outside a SidebarPage). */
export const SidebarApiContext = createContext(null);
/** { mode: 'sidebar' | 'rail' | 'phone', phoneRow } (null outside a SidebarPage). */
export const SidebarModeContext = createContext(null);
const NO_SHEET = Object.freeze({ open: () => {}, close: () => {}, isOpen: false, count: 0 });
const SheetContext = createContext(NO_SHEET);

/** 'sidebar' | 'rail' | 'phone', or null outside a SidebarPage. */
export function useSidebarMode() {
  const m = useContext(SidebarModeContext);
  return m ? m.mode : null;
}

/** For pages that draw their own Filters button (phoneRow={false}): { open(), close(), isOpen, count }. */
export function useSidebarSheet() {
  return useContext(SheetContext);
}

/* ─── shared looks ────────────────────────────────────────────── */
/** One row of the View list and of SideList. */
export const itemRowSx = (active, { dim = false, disabled = false } = {}) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', width: '100%',
  height: 34, px: '8px', flexShrink: 0, borderRadius: 'var(--radius)', textAlign: 'left', textDecoration: 'none',
  fontSize: 14, fontFamily: 'inherit', lineHeight: 1.2,
  color: active ? 'var(--text)' : dim ? 'var(--muted)' : 'var(--dim)',
  bgcolor: active ? 'var(--accent-quiet)' : 'transparent',
  boxShadow: active ? 'inset 2px 0 0 var(--accent)' : 'none',
  opacity: disabled ? 0.5 : 1,
  pointerEvents: disabled ? 'none' : undefined,
  transition: 'background-color .12s ease, color .12s ease',
  '&:hover': { bgcolor: active ? 'var(--accent-quiet)' : 'var(--raised)', color: 'var(--text)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '& .si-icon': { display: 'inline-flex', flexShrink: 0, color: 'inherit' },
  '& .si-icon svg': { fontSize: 18, width: 18, height: 18 },
  '& .si-label': { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '& .si-sub': { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 },
  '& .si-count': {
    ml: 'auto', pl: '8px', flexShrink: 0, fontSize: 13, fontVariantNumeric: 'tabular-nums',
    color: active ? 'var(--accent)' : 'var(--muted)'
  }
});

export const groupHeadSx = {
  fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)',
  px: '8px', mb: '6px', lineHeight: 1.4
};

/** The page's one main action: a filled accent button. */
export const mainButtonSx = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', height: 32,
  px: '12px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', bgcolor: 'var(--accent)',
  color: 'var(--on-accent)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
  '&:hover': { bgcolor: 'var(--accent-hover)', borderColor: 'var(--accent-hover)' },
  '&:focus-visible': { outline: '2px solid var(--text)', outlineOffset: '2px' },
  '&.Mui-disabled': { opacity: 0.5, color: 'var(--on-accent)' },
  '& svg': { fontSize: 16, width: 16, height: 16 }
};

const dotColor = (d) => (d === 'ok' ? 'var(--ok)' : d === 'warn' ? 'var(--warn)' : d === 'bad' ? 'var(--bad)' : null);

/** A row's label, sub, dot and count (View list, SideList). */
export function ItemContent({ item, showIcon = false }) {
  const dc = dotColor(item.dot);
  return (
    <>
      {showIcon && item.icon ? <span className="si-icon" aria-hidden>{item.icon}</span> : null}
      <span className="si-label">{item.label}</span>
      {item.sub != null && item.sub !== '' ? <span className="si-sub">{item.sub}</span> : null}
      {dc ? <Box component="span" aria-hidden sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dc, flexShrink: 0 }} /> : null}
      {item.count != null ? <span className="si-count">{fullCount(item.count)}</span> : null}
    </>
  );
}

/**
 * One clickable item: a react-router Link when it has `to` (ctrl/middle click open a new tab; onClick runs first and
 * e.preventDefault() stops the navigation), else a button that runs onClick and then onSelect(id).
 */
export const NavItem = React.forwardRef(function NavItem(
  { item, sx, onSelect, current = false, pressed, children, innerRef, ...rest }, fwdRef
) {
  const ref = useMergedRef(fwdRef, innerRef);
  const disabled = !!item.disabled;
  const handleClick = (e) => {
    item.onClick?.(e);
    if (!item.to && !e.defaultPrevented) onSelect?.(item.id, e);
  };
  if (item.to != null && !disabled) {
    return (
      <ButtonBase
        ref={ref}
        component={RouterLink}
        to={item.to}
        replace={item.replace}
        state={item.state}
        onClick={handleClick}
        title={item.title}
        aria-current={current ? 'page' : pressed ? 'true' : undefined}
        disableRipple
        sx={sx}
        {...rest}
      >
        {children}
      </ButtonBase>
    );
  }
  return (
    <ButtonBase
      ref={ref}
      onClick={handleClick}
      disabled={disabled}
      title={item.title}
      aria-current={current ? 'page' : undefined}
      aria-pressed={pressed === undefined ? undefined : !!pressed}
      disableRipple
      sx={sx}
      {...rest}
    >
      {children}
    </ButtonBase>
  );
});

/** Both refs, as one callback ref. */
function useMergedRef(a, b) {
  return useCallback((node) => {
    [a, b].forEach((r) => {
      if (typeof r === 'function') r(node);
      else if (r) r.current = node;
    });
  }, [a, b]);
}

/** Appends a persistent node into this spot while mounted. */
export function Slot({ node, style }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !node) return undefined;
    host.appendChild(node);
    return () => {
      if (node.parentNode === host) host.removeChild(node);
    };
  }, [node]);
  return <div ref={ref} style={style} />;
}

/** Calls onEsc on a native Escape keydown inside el (portaled group content does not reach MUI's React handler). */
function useNativeEsc(el, active, onEsc) {
  const cb = useRef(onEsc);
  cb.current = onEsc;
  useEffect(() => {
    if (!active || !el) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      cb.current?.();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [el, active]);
}

const hasCloseWatcher = () => typeof window !== 'undefined' && 'CloseWatcher' in window;

/* ─── phone tab row ───────────────────────────────────────────── */
/** The phone's View list: a sideways-scrolling tab row. items as in SidebarPage views; value: the selected id. */
export function PhoneViewTabs({ items = [], value, label = 'View', sx }) {
  const rowRef = useRef(null);
  const selRef = useRef(null);

  // The selected tab scrolls into view inside the row only (never the page).
  useLayoutEffect(() => {
    const row = rowRef.current;
    const tab = selRef.current;
    if (!row || !tab) return;
    const left = tab.offsetLeft;   // the row is position: relative, so this is from its padding edge
    const right = left + tab.offsetWidth;
    if (left < row.scrollLeft + 12) row.scrollLeft = Math.max(0, left - 12);
    else if (right > row.scrollLeft + row.clientWidth - 12) row.scrollLeft = right - row.clientWidth + 12;
  }, [value, items.length]);

  return (
    <Box
      ref={rowRef}
      component="nav"
      aria-label={label}
      sx={{
        display: 'flex', gap: '4px', overflowX: 'auto', overflowY: 'hidden', position: 'relative',
        m: '-12px -12px 12px', px: '12px', borderBottom: '1px solid var(--line)', flexShrink: 0,
        scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
        ...sx
      }}
    >
      {items.map((it) => {
        const on = it.id === value;
        return (
          <NavItem
            key={it.id}
            item={it}
            current={on}
            innerRef={on ? selRef : undefined}
            sx={{
              flexShrink: 0, whiteSpace: 'nowrap', p: '12px 8px', fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
              color: on ? 'var(--text)' : 'var(--dim)', textDecoration: 'none',
              borderBottom: '2px solid', borderColor: on ? 'var(--accent)' : 'transparent', borderRadius: 0,
              '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' }
            }}
          >
            {it.label}
            {dotColor(it.dot) ? (
              <Box component="span" aria-hidden sx={{ width: 7, height: 7, ml: '6px', borderRadius: '50%', bgcolor: dotColor(it.dot) }} />
            ) : null}
            {it.count != null ? (
              <Box component="span" sx={{ ml: '4px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                {fullCount(it.count)}
              </Box>
            ) : null}
          </NavItem>
        );
      })}
    </Box>
  );
}

/* ─── registration ────────────────────────────────────────────── */
const sameIcon = (a, b) => {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type || a.key !== b.key) return false;
  const pa = a.props || {};
  const pb = b.props || {};
  const ka = Object.keys(pa);
  if (ka.length !== Object.keys(pb).length) return false;
  return ka.every((k) => pa[k] === pb[k]);
};

const sameGroup = (a, b) => a.title === b.title && a.badge === b.badge && a.dot === b.dot && a.summary === b.summary
  && a.order === b.order && sameIcon(a.icon, b.icon);

const sameMain = (a, b) => a.label === b.label && a.disabled === b.disabled && a.tip === b.tip && a.busy === b.busy
  && a.busyLabel === b.busyLabel && a.run === b.run && sameIcon(a.icon, b.icon);

function useRegistry() {
  const [groups, setGroups] = useState(() => new Map());
  const [mains, setMains] = useState(() => new Map());
  const [searches, setSearches] = useState(() => []);
  const [lines, setLines] = useState(() => []);
  const seq = useRef(0);
  const nodes = useRef(new Map());
  const searchNodes = useRef(new Map());

  const api = useMemo(() => {
    const makeNode = (map, id, className) => {
      let n = map.get(id);
      if (!n) {
        n = document.createElement('div');
        n.className = className;
        if (className === 'acm-side-group') {
          n.style.display = 'flex';
          n.style.flexDirection = 'column';
          n.style.gap = '8px';
          n.style.minWidth = '0';
        }
        map.set(id, n);
      }
      return n;
    };
    return {
      nodeFor: (id) => makeNode(nodes.current, id, 'acm-side-group'),
      searchNodeFor: (key) => makeNode(searchNodes.current, key, 'acm-side-search'),
      register: (id, meta) => setGroups((prev) => {
        const old = prev.get(id);
        if (old && sameGroup(old, meta)) return prev;
        const next = new Map(prev);
        next.set(id, { ...meta, id, seq: old ? old.seq : (seq.current += 1) });
        return next;
      }),
      unregister: (id) => setGroups((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      }),
      registerMain: (key, meta) => setMains((prev) => {
        const old = prev.get(key);
        if (old && sameMain(old, meta)) return prev;
        const next = new Map(prev);
        next.set(key, meta);
        return next;
      }),
      unregisterMain: (key) => setMains((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      }),
      registerSearch: (key) => setSearches((prev) => (prev.includes(key) ? prev : [...prev, key])),
      unregisterSearch: (key) => setSearches((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev)),
      registerLine: (key) => setLines((prev) => (prev.includes(key) ? prev : [...prev, key])),
      unregisterLine: (key) => setLines((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev))
    };
  }, []);

  const sorted = useMemo(
    () => [...groups.values()].sort((a, b) => (a.order - b.order) || (a.seq - b.seq)),
    [groups]
  );
  let main = null;
  mains.forEach((m) => { main = m; });   // the latest mounted wins
  return { api, groups: sorted, main, searches, lines };
}

/* ─── the frame's pieces ──────────────────────────────────────── */
function GroupBlock({ title, children, mb = '20px' }) {
  return (
    <Box sx={{ mb }}>
      {title ? <Typography component="h2" sx={groupHeadSx}>{title}</Typography> : null}
      {children}
    </Box>
  );
}

const Sep = () => <Box aria-hidden sx={{ height: '1px', bgcolor: 'var(--line)', m: '16px 8px' }} />;

/** The groups in order, with one line before the first page section. */
function GroupList({ groups, api, last = '20px', afterViews = false }) {
  const firstPage = groups.find((g) => g.order >= SIDE.page);
  const hasBefore = !!firstPage && (afterViews || groups[0] !== firstPage);
  return groups.map((g, i) => (
    <React.Fragment key={g.id}>
      {g === firstPage && hasBefore ? <Sep /> : null}
      <GroupBlock title={g.title} mb={i === groups.length - 1 ? last : '20px'}>
        <Slot node={api.nodeFor(g.id)} />
      </GroupBlock>
    </React.Fragment>
  ));
}

/** The main action as a filled accent button; main = { label, icon, run, disabled, busy, busyLabel, tip }. */
export function MainButton({ main, sx, block = false }) {
  if (!main) return null;
  const btn = (
    <ButtonBase
      onClick={main.run}
      disabled={!!main.disabled || !!main.busy}
      aria-busy={main.busy ? 'true' : undefined}
      sx={{ ...mainButtonSx, ...sx }}
    >
      {main.busy ? <CircularProgress size={14} thickness={6} sx={{ color: 'inherit' }} /> : main.icon}
      <span>{main.busy ? (main.busyLabel || main.label) : main.label}</span>
    </ButtonBase>
  );
  if (!main.tip) return btn;
  return <Tooltip title={main.tip}><Box component="span" sx={{ display: block ? 'block' : 'inline-flex', minWidth: 0 }}>{btn}</Box></Tooltip>;
}

const railBtnSx = (state) => ({
  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: '3px', width: '100%', minHeight: 40, p: '8px 0 6px', borderRadius: 'var(--radius-lg)', textDecoration: 'none',
  fontFamily: 'inherit', flexShrink: 0,
  color: state === 'on' || state === 'open' ? 'var(--text)' : 'var(--dim)',
  bgcolor: state === 'on' ? 'var(--accent-quiet)' : state === 'open' ? 'var(--raised)' : 'transparent',
  boxShadow: state === 'on' ? 'inset 2px 0 0 var(--accent)' : 'none',
  '&:hover': { bgcolor: state === 'on' ? 'var(--accent-quiet)' : 'var(--raised)', color: 'var(--text)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '& > .MuiSvgIcon-root, & > .rail-icon svg': { fontSize: 20, width: 20, height: 20 },
  '& .rail-n': {
    fontSize: 12, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
    color: state === 'on' ? 'var(--accent)' : 'var(--muted)'
  }
});

const RAIL_TIP = { placement: 'right', enterDelay: 250 };

function RailView({ item, active }) {
  const tip = item.count != null ? `${item.label} ${fullCount(item.count)}` : item.label;
  return (
    <Tooltip title={tip} {...RAIL_TIP}>
      <NavItem item={item} current={active} aria-label={tip} sx={railBtnSx(active ? 'on' : null)}>
        <span className="rail-icon" style={{ display: 'inline-flex' }} aria-hidden>{item.icon}</span>
        {item.count != null ? <span className="rail-n">{compactCount(item.count)}</span> : null}
        {dotColor(item.dot) ? <RailDot tone={item.dot} /> : null}
      </NavItem>
    </Tooltip>
  );
}

function RailDot({ tone }) {
  return (
    <Box component="span" aria-hidden sx={{
      position: 'absolute', top: '6px', right: '12px', width: 9, height: 9, borderRadius: '50%',
      bgcolor: dotColor(tone), border: '2px solid var(--surface)', boxSizing: 'content-box'
    }} />
  );
}

const groupTip = (g) => {
  const name = g.title || g.summary || g.id;
  return g.title && g.summary ? `${g.title}: ${g.summary}` : name;
};

function RailGroup({ group, open, onOpen }) {
  const tip = groupTip(group);
  const badge = Number(group.badge) > 0 ? Number(group.badge) : 0;
  return (
    <Tooltip title={tip} {...RAIL_TIP}>
      <ButtonBase
        onClick={(e) => onOpen(group.id, e.currentTarget)}
        aria-label={tip}
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
        disableRipple
        sx={railBtnSx(open ? 'open' : null)}
      >
        <span className="rail-icon" style={{ display: 'inline-flex' }} aria-hidden>{group.icon}</span>
        {badge ? (
          <Box component="span" aria-hidden sx={{
            position: 'absolute', top: '3px', right: '6px', minWidth: 16, height: 16, px: '4px', borderRadius: '8px',
            bgcolor: 'var(--accent)', color: 'var(--on-accent)', fontSize: 12, fontWeight: 700, lineHeight: '16px',
            textAlign: 'center', boxSizing: 'border-box', fontVariantNumeric: 'tabular-nums'
          }}>
            {badge}
          </Box>
        ) : null}
        {dotColor(group.dot) ? <RailDot tone={group.dot} /> : null}
      </ButtonBase>
    </Tooltip>
  );
}

function RailMain({ main }) {
  const tip = main.tip || main.label;
  return (
    <Tooltip title={tip} {...RAIL_TIP}>
      <span style={{ display: 'block', marginTop: 6 }}>
        <ButtonBase
          onClick={main.run}
          disabled={!!main.disabled || !!main.busy}
          aria-label={main.label}
          sx={{
            ...railBtnSx(null), minHeight: 36, p: '8px 0', bgcolor: 'var(--accent)', color: 'var(--on-accent)',
            '&:hover': { bgcolor: 'var(--accent-hover)', color: 'var(--on-accent)' },
            '&.Mui-disabled': { opacity: 0.5, color: 'var(--on-accent)' }
          }}
        >
          {main.busy
            ? <CircularProgress size={18} thickness={5} sx={{ color: 'inherit' }} />
            : <span className="rail-icon" style={{ display: 'inline-flex' }} aria-hidden>{main.icon}</span>}
        </ButtonBase>
      </span>
    </Tooltip>
  );
}

function FlyBody({ group, api, onEsc }) {
  const [el, setEl] = useState(null);
  useNativeEsc(el, true, onEsc);
  return (
    <Box ref={setEl}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', m: '0 4px 10px 8px' }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 0 }}>
          {group.title}
        </Typography>
        {group.summary ? (
          <Box component="span" sx={{ ml: 'auto', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {group.summary}
          </Box>
        ) : null}
      </Box>
      <Slot node={api.nodeFor(group.id)} />
    </Box>
  );
}

/* ─── the phone Filters button ────────────────────────────────── */
const filtersButtonSx = {
  height: 40, px: '14px', flexShrink: 0, borderRadius: 'var(--radius)', border: '1px solid var(--line-strong)',
  color: 'var(--text)', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  '&:hover': { bgcolor: 'var(--raised)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' }
};

/** "Filters · N": opens the phone sheet. Drawn in the search row, or on the content line when the page has no search. */
export function FiltersButton({ sx }) {
  const sheet = useContext(SheetContext);
  const { count } = sheet;
  return (
    <ButtonBase
      onClick={sheet.open}
      aria-label={count ? `Filters, ${count} active` : 'Filters'}
      aria-haspopup="dialog"
      aria-expanded={sheet.isOpen ? 'true' : 'false'}
      sx={{ ...filtersButtonSx, ...sx }}
    >
      {count ? `Filters · ${count}` : 'Filters'}
    </ButtonBase>
  );
}

/* ─── the phone sheet ─────────────────────────────────────────── */
function FilterSheet({ open, onClose, groups, api }) {
  const watcher = hasCloseWatcher();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [paper, setPaper] = useState(null);
  const paperRef = useRef(null);
  paperRef.current = paper;
  const [round, setRound] = useState(0);

  // Android Back (and Esc) through CloseWatcher, as AppDialog does.
  useEffect(() => {
    if (!open || !watcher) return undefined;
    let w;
    try {
      w = new window.CloseWatcher();
    } catch {
      return undefined;
    }
    let done = false;
    w.onclose = () => {
      if (done) return;
      done = true;
      const own = paperRef.current;
      const shown = Array.from(document.querySelectorAll('.MuiModal-root:not(.MuiModal-hidden)'));
      const top = shown[shown.length - 1];
      const covered = !!(own && top && !top.contains(own));
      if (!covered) onCloseRef.current?.();
      setRound((r) => r + 1);
    };
    return () => {
      done = true;
      try { w.destroy(); } catch { /* already closed */ }
    };
  }, [open, watcher, round]);

  // Without CloseWatcher, Esc from the portaled group content (outside the Drawer's React tree).
  useNativeEsc(paper, open && !watcher, onClose);

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={(e, reason) => {
        if (reason === 'escapeKeyDown' && watcher) return;   // the watcher handles Esc
        onClose();
      }}
      slotProps={{
        paper: {
          ref: setPaper,
          'aria-label': 'Filters',
          sx: {
            bgcolor: 'var(--surface)', backgroundImage: 'none', color: 'var(--text)',
            borderTop: '1px solid var(--line-strong)', borderRadius: '12px 12px 0 0', maxHeight: '75dvh',
            p: '8px 12px calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column',
            boxShadow: 'var(--shadow-lg)'
          }
        }
      }}
    >
      <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: '2px', bgcolor: 'var(--line-strong)', m: '0 auto 8px', flexShrink: 0 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '12px', flexShrink: 0, minHeight: 40 }}>
        <Typography component="h2" sx={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, pl: '8px' }}>
          Filters
        </Typography>
        <ButtonBase
          onClick={onClose}
          sx={{
            height: 36, px: '10px', gap: '4px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600,
            fontFamily: 'inherit', color: 'var(--dim)', '&:hover': { bgcolor: 'var(--raised)', color: 'var(--text)' },
            '& svg': { fontSize: 18 }
          }}
        >
          <CloseIcon />
          Close
        </ButtonBase>
      </Box>
      <Box sx={{ overflowY: 'auto', minHeight: 0, flex: '1 1 auto', overscrollBehavior: 'contain' }}>
        <GroupList groups={groups} api={api} last="4px" />
      </Box>
    </Drawer>
  );
}

/** A phone held sideways (the same test as App.js, where Smart Compare goes bare). */
const PHONE_SIDEWAYS = '(max-height:500px) and (orientation: landscape)';

/** True while the media query matches; reactive. */
function useMedia(query) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const update = () => setOn(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return on;
}

/* ─── SidebarPage ─────────────────────────────────────────────── */
export default function SidebarPage({
  title,
  views,
  view,
  viewsTitle = 'View',
  parent,
  onBack,
  barActions,
  barMenu,
  fill = false,
  phoneTabs = true,
  phoneRow = true,
  className,
  sx,
  children
}) {
  const chrome = useChrome();
  const isPhone = useIsPhone();
  const sideways = useMedia(PHONE_SIDEWAYS);
  // A bare page on a phone (narrow, or any phone held sideways, which can be 930px wide) gets the phone layout.
  const phone = chrome === 'phone' || (chrome === 'bare' && (isPhone || sideways));
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const mode = phone ? 'phone' : collapsed ? 'rail' : 'sidebar';
  const barH = chrome === 'desktop' ? APP_BAR_H : 0;
  const { pathname } = useLocation();

  usePageBar({ title: typeof title === 'string' ? title : undefined, parent, onBack, actions: barActions, menu: barMenu });

  const { api, groups, main, searches, lines } = useRegistry();

  // The rail's flyout: { id, anchor, open } (id and anchor stay while it slides out).
  const [fly, setFly] = useState(null);
  const closeFly = useCallback(() => setFly((f) => (f && f.open ? { ...f, open: false } : f)), []);
  const openFly = useCallback((id, anchor) => setFly((f) => (f && f.open && f.id === id ? { ...f, open: false } : { id, anchor, open: true })), []);
  const flyGroup = fly ? groups.find((g) => g.id === fly.id) : null;
  useEffect(() => { closeFly(); }, [mode, pathname, closeFly]);
  useEffect(() => { if (fly?.open && !flyGroup) closeFly(); }, [fly, flyGroup, closeFly]);

  // The phone sheet.
  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useEffect(() => { setSheetOpen(false); }, [pathname]);
  useEffect(() => { if (mode !== 'phone') setSheetOpen(false); }, [mode]);

  const count = groups.reduce((s, g) => s + (Number(g.badge) > 0 ? Number(g.badge) : 0), 0);
  const sheet = useMemo(() => ({ open: openSheet, close: closeSheet, isOpen: sheetOpen, count }), [openSheet, closeSheet, sheetOpen, count]);
  // Phone, no search on the page: the Filters button goes on the content line instead of a row of its own.
  const filtersInLine = mode === 'phone' && !!phoneRow && !searches.length && groups.length > 0 && lines.length > 0;
  const modeValue = useMemo(() => ({ mode, phoneRow: !!phoneRow, filtersInLine }), [mode, phoneRow, filtersInLine]);

  const viewList = Array.isArray(views) ? views : [];
  const heading = typeof title === 'string' && title ? <Typography component="h1" sx={visuallyHiddenSx}>{title}</Typography> : null;

  // One tree for every mode: the root, then optional pieces (aside, tab row, search row), then the content box,
  // always the same element at the same index, so crossing the phone breakpoint (or rotating Smart Compare) never
  // remounts the page's own components. Phone without fill: the content box is display: contents, so the items
  // sit in the root exactly as before.
  const isPhoneMode = mode === 'phone';
  const rail = mode === 'rail';
  const sideW = rail ? RAIL_W : SIDEBAR_W;
  const frameH = `calc(100vh - ${barH}px)`;
  const phoneFillH = chrome === 'bare'
    ? '100dvh'
    : `calc(100dvh - ${PHONE_BAR_H}px - env(safe-area-inset-top, 0px) - ${PHONE_NAV_H}px - env(safe-area-inset-bottom, 0px))`;
  const showRow = isPhoneMode && phoneRow && (searches.length > 0 || (groups.length > 0 && !filtersInLine));

  const rootSx = isPhoneMode
    ? {
      // width 100%: the tab row's full width must never widen the page (it scrolls inside itself)
      position: 'relative', p: '12px', minWidth: 0, width: '100%', maxWidth: '100vw', boxSizing: 'border-box',
      ...(fill ? { height: phoneFillH, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : null),
      ...sx
    }
    : {
      position: 'relative', display: 'grid', gridTemplateColumns: `${sideW}px minmax(0, 1fr)`, width: '100%',
      ...(fill ? { height: frameH, overflow: 'hidden' } : { minHeight: frameH }),
      ...sx
    };

  const contentProps = isPhoneMode
    ? {
      'data-sidebar-phone-content': '',
      sx: fill
        ? { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        : { display: 'contents' }
    }
    : {
      'data-sidebar-content': '',
      sx: {
        minWidth: 0, p: `16px ${GUTTER}px ${GUTTER}px`, position: 'relative',
        ...(fill ? { display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, height: '100%' } : null)
      }
    };

  const aside = isPhoneMode ? null : (
    <Box
      component="aside"
      aria-label="Sidebar"
      sx={{
        position: 'sticky', top: barH, height: frameH, alignSelf: 'start', overflowY: 'auto', overflowX: 'hidden',
        bgcolor: 'var(--surface)', borderRight: '1px solid var(--line)', zIndex: 2,
        p: rail ? '12px 8px 0' : '16px 12px 0', display: 'flex', flexDirection: 'column', minWidth: 0,
        scrollbarWidth: 'thin'
      }}
    >
      <Box sx={{ flex: '1 0 auto', pb: rail ? '8px' : '4px' }}>
        {rail ? (
          <>
            {viewList.map((it) => <RailView key={it.id} item={it} active={it.id === view} />)}
            {viewList.length && (groups.length || main) ? <Box aria-hidden sx={{ height: '1px', bgcolor: 'var(--line)', m: '8px 6px' }} /> : null}
            {groups.map((g) => (
              <RailGroup key={g.id} group={g} open={!!(fly?.open && fly.id === g.id)} onOpen={openFly} />
            ))}
            {main ? <RailMain main={main} /> : null}
          </>
        ) : (
          <>
            {viewList.length ? (
              <GroupBlock title={viewsTitle}>
                <Box component="nav" aria-label={viewsTitle || 'View'} sx={{ display: 'flex', flexDirection: 'column' }}>
                  {viewList.map((it) => {
                    const on = it.id === view;
                    return (
                      <NavItem key={it.id} item={it} current={on} sx={itemRowSx(on)}>
                        <ItemContent item={it} />
                      </NavItem>
                    );
                  })}
                </Box>
              </GroupBlock>
            ) : null}
            <GroupList groups={groups} api={api} afterViews={viewList.length > 0} />
          </>
        )}
      </Box>
      <Box sx={{
        position: 'sticky', bottom: 0, bgcolor: 'var(--surface)', borderTop: '1px solid var(--line)',
        m: rail ? '0 -8px' : '0 -12px', p: rail ? '8px' : '8px 12px', flexShrink: 0, zIndex: 1
      }}>
        {rail ? (
          <Tooltip title="Show the sidebar" {...RAIL_TIP}>
            <ButtonBase
              onClick={() => setCollapsed(false)}
              aria-label="Show the sidebar"
              sx={{ ...railBtnSx(null), minHeight: 34, p: '7px 0', color: 'var(--muted)', '& svg': { fontSize: 20 } }}
            >
              <ChevronRightIcon />
            </ButtonBase>
          </Tooltip>
        ) : (
          <ButtonBase
            onClick={() => setCollapsed(true)}
            aria-label="Collapse the sidebar"
            sx={{ ...itemRowSx(false), fontSize: 13, color: 'var(--muted)', '& svg': { fontSize: 16 } }}
          >
            <ChevronLeftIcon />
            Collapse
          </ButtonBase>
        )}
      </Box>
    </Box>
  );

  const phoneSearchRow = showRow ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '12px', flexShrink: 0 }}>
      {searches.map((k) => (
        <Slot key={k} node={api.searchNodeFor(k)} style={{ flex: '1 1 auto', minWidth: 0 }} />
      ))}
      {!searches.length ? <Box sx={{ flex: 1 }} /> : null}
      {groups.length ? <FiltersButton /> : null}
    </Box>
  ) : null;

  const body = (
    <Box className={className} data-sidebar-mode={mode} sx={rootSx}>
      {aside}
      {isPhoneMode && phoneTabs && viewList.length ? <PhoneViewTabs items={viewList} value={view} label={viewsTitle} /> : null}
      {phoneSearchRow}
      <Box {...contentProps}>
        {isPhoneMode ? null : heading}
        {children}
      </Box>
      {isPhoneMode ? <FilterSheet open={sheetOpen} onClose={closeSheet} groups={groups} api={api} /> : null}
      {rail && fly && flyGroup ? (
        <Popover
          open={!!fly.open}
          anchorEl={fly.anchor}
          onClose={closeFly}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{
            transition: { onExited: () => setFly((f) => (f && !f.open ? null : f)) },
            paper: {
              'aria-label': flyGroup.title || undefined,
              sx: {
                ml: '8px', width: 280, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
                bgcolor: 'var(--surface)', backgroundImage: 'none', color: 'var(--text)',
                border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
                p: '12px 12px 8px'
              }
            }
          }}
        >
          <FlyBody group={flyGroup} api={api} onEsc={closeFly} />
        </Popover>
      ) : null}
    </Box>
  );

  return (
    <SidebarApiContext.Provider value={api}>
      <SidebarModeContext.Provider value={modeValue}>
        <SheetContext.Provider value={sheet}>
          {body}
        </SheetContext.Provider>
      </SidebarModeContext.Provider>
    </SidebarApiContext.Provider>
  );
}

export { SidebarPage };
