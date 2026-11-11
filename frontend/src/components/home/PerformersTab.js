/**
 * The Gallery home's Performers tab: the toolbar (search, sort, Filters, and "New uploads N" while anyone has one), the
 * removable chips of the active search and filters, and the grid of the kept performer cards (PerformerCard in
 * gallery mode, unchanged but for the New upload badge). newCount: how many of all performers have a new upload.
 * The list and its in-place updates come from homeData (useGalleryPerformers); GalleryView filters and sorts it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Box, Button, IconButton, MenuItem, Select, Typography } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import CloseIcon from '@mui/icons-material/Close';
import PerformerCard from '../PerformerCard';
import PerformerSettingsModal from '../PerformerSettingsModal';
import { Toolbar, Panel, EmptyState } from '../layout';
import { FilterChip, SearchField, SmallButton, TotalText } from '../discover/shared';
import { useNotify, errorText, plural } from '../ui';
import { useOpen } from '../../nav';
import { useMountNavType } from './useHomeQuery';
import { galleryUrl } from './performerFacts';
import { SORTS, countActive, activeChips, removeChip, isNewOnly, isNewOnlyChip, toggleNewOnly } from './filterModel';
import PerformerGrid, { GridSkeleton } from './PerformerGrid';

const SCROLL_KEY = 'acm.home.scroll';

const selectSx = { fontSize: '.84rem', height: 32, bgcolor: 'var(--surface)' };

function readScroll() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
    return saved && typeof saved.y === 'number' ? saved : null;
  } catch {
    return null;
  }
}

/** 'Could not delete Rhea: Not found', or errorText's 'Could not delete Rhea: the server did not answer'. */
const failText = (err, what) => (err?.message && err.name !== 'TypeError' ? `${what}: ${err.message}` : errorText(err, what));

/** The error of a list, as text. */
const listErrorText = (error) => (typeof error === 'string' ? error : errorText(error, 'The list did not load'));

function RemovableChip({ label, onRemove }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', height: 28, pl: 1.25, pr: 0.5, gap: 0.5, maxWidth: '100%',
      borderRadius: 'var(--radius-sm, 4px)', border: '1px solid var(--line-strong)', bgcolor: 'var(--raised)',
      fontSize: '.78rem', color: 'var(--text)'
    }}>
      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Box>
      <IconButton aria-label={`Remove filter: ${label}`} onClick={onRemove} sx={{
        width: 22, height: 22, p: 0, color: 'var(--dim)', '&:hover': { color: 'var(--text)' },
        '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 0 }
      }}>
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

export default function PerformersTab({ data, shown, total, newCount = 0, q, sort, filters, facets, onQuery, onOpenFilters, basePath }) {
  const { performers, error, failures, reload, patch, remove, refreshOne } = data;
  const notify = useNotify();
  const open = useOpen();
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useMountNavType();
  const [settings, setSettings] = useState(null);

  const n = countActive(filters);
  const query = String(q || '').trim();
  const shownCount = shown.main.length + shown.missing.length;
  const newOnly = isNewOnly(filters);
  // the New uploads chip in the toolbar is the 'New upload' filter: not again as a removable chip
  const chips = useMemo(() => activeChips(filters, facets).filter(c => !isNewOnlyChip(c)), [filters, facets]);

  // The latest list and search, for the stable callbacks below.
  const listRef = useRef(performers);
  listRef.current = performers;
  const searchRef = useRef(location.search);
  searchRef.current = location.search;
  const find = (id) => (listRef.current || []).find(p => p.id === id) || null;

  // ── card callbacks ─────────────────────────────────────────
  const rate = useCallback(async (id, rating) => {
    const next = rating == null ? null : Math.round(Math.min(5, Math.max(0, Number(rating))) * 100) / 100;
    const before = find(id);
    const prev = before?.performer_rating == null ? null : Number(before.performer_rating);
    if (prev === next) return;
    patch(id, { performer_rating: next });
    let res;
    try {
      res = await fetch(`/api/performers/${id}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: next })
      });
    } catch (err) {
      patch(id, { performer_rating: prev });
      throw err;
    }
    if (!res.ok) {
      patch(id, { performer_rating: prev });
      throw new Error(`The server answered ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));
    const saved = Object.prototype.hasOwnProperty.call(body, 'rating')
      ? (body.rating == null ? null : Number(body.rating))
      : next;
    patch(id, { performer_rating: saved });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- find reads a ref
  }, [patch]);

  const changeThumb = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/performers/${id}/random-thumbnail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`The server answered ${res.status}`);
      const body = await res.json();
      if (!body?.thumbnailPath) throw new Error('No picture to use');
      patch(id, { thumbnail: body.thumbnailPath });
    } catch (err) {
      notify({ severity: 'error', message: failText(err, 'Could not change the thumbnail') });
    }
  }, [patch, notify]);

  const del = useCallback(async (id, deleteFromSystem = false, action = 'delete') => {
    const name = find(id)?.name || 'the performer';
    if (action === 'move') {
      remove(id);
      notify(`Moved ${name} back to Filter`);
      return;
    }
    try {
      const res = await fetch(`/api/performers/${id}${deleteFromSystem ? '?deleteFromSystem=true' : ''}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `The server answered ${res.status}`);
      }
      remove(id);
      notify(deleteFromSystem ? `Deleted ${name} and her folder` : `Deleted ${name}`);
    } catch (err) {
      notify({ severity: 'error', message: failText(err, `Could not delete ${name}`) });
      throw err;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- find reads a ref
  }, [remove, notify]);

  const openSettings = useCallback((p) => setSettings(p), []);
  const openThumbs = useCallback((p) => navigate(`/thumbnail-selector/${p.id}`, { state: { performer: p } }), [navigate]);
  const auxOpen = useCallback((p) => { window.open(galleryUrl(p, basePath), '_blank', 'noopener'); }, [basePath]);

  const renderItem = useCallback((p) => (
    <PerformerCard
      performer={p}
      mode="gallery"
      basePath={basePath}
      onClick={(e) => open(galleryUrl(p, basePath), e)}
      onRate={rate}
      onChangeThumbnail={changeThumb}
      onDelete={del}
      onSettings={openSettings}
      onOpenThumbnailSelector={openThumbs}
    />
  ), [basePath, open, rate, changeThumb, del, openSettings, openThumbs]);

  const itemKey = useCallback((p) => p.id, []);

  const sections = useMemo(() => [
    { key: 'main', items: shown.main },
    ...(shown.missing.length
      ? [{ key: 'missing', label: `${shown.missingLabel} · ${plural(shown.missing.length, 'performer')}`, items: shown.missing }]
      : [])
  ], [shown]);

  // ── a failed background refresh, while a list is shown: once per failure, and not for one from before this mount ──
  const toldFailures = useRef(failures);
  useEffect(() => {
    if (failures === toldFailures.current) return;
    toldFailures.current = failures;
    if (performers == null) return;   // no list yet: the error panel says it
    notify({ severity: 'warning', message: 'Could not refresh the gallery', action: { label: 'Retry', onClick: reload } });
  }, [failures, performers, notify, reload]);

  // ── scroll: saved while a list is shown, restored once on Back ──
  const hasList = performers != null;
  useEffect(() => {
    if (!hasList) return undefined;
    let timer = null;
    const save = () => {
      timer = null;
      try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ search: searchRef.current, y: window.scrollY })); } catch { /* storage off */ }
    };
    const onScroll = () => { if (!timer) timer = setTimeout(save, 250); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (timer) clearTimeout(timer); };
  }, [hasList]);

  const restored = useRef(false);
  useEffect(() => {
    if (!hasList || restored.current) return;
    restored.current = true;
    if (navType !== 'POP') return;
    const saved = readScroll();
    if (saved && saved.search === searchRef.current) {
      requestAnimationFrame(() => window.scrollTo(0, saved.y));
    }
  }, [hasList, navType]);

  const clearAll = () => onQuery({ q: '', filters: {} });

  // ── the content ────────────────────────────────────────────
  let content;
  if (performers == null && error) {
    content = (
      <Panel role="alert" sx={{ borderColor: 'var(--bad)', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 600, color: 'var(--text)' }}>Could not load performers</Typography>
        <Typography variant="body2" sx={{ color: 'var(--text)' }}>{listErrorText(error)}</Typography>
        <Typography variant="body2" sx={{ color: 'var(--dim)' }}>Your library and ratings are not affected.</Typography>
        <SmallButton onClick={reload}>Retry</SmallButton>
      </Panel>
    );
  } else if (performers == null) {
    content = <GridSkeleton />;
  } else if (total === 0) {
    content = (
      <EmptyState
        title="No performers in the gallery yet"
        description="Performers show up here once they are imported and kept in Filter."
        action={(
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
            <SmallButton primary component={RouterLink} to="/local-import">Import performers</SmallButton>
            <SmallButton component={RouterLink} to="/filter">Go to Filter</SmallButton>
          </Box>
        )}
      />
    );
  } else if (shownCount === 0) {
    const parts = [query ? `the search "${query}"` : null, n ? plural(n, 'filter') : null].filter(Boolean);
    const joined = parts.join(' and ');
    const verb = parts.length === 1 && !(n > 1 && !query) ? 'hides' : 'hide';
    const all = total === 1 ? 'the one performer' : `all ${total} performers`;
    content = (
      <EmptyState
        title="No performers match"
        description={`${joined.charAt(0).toUpperCase()}${joined.slice(1)} ${verb} ${all}.`}
        action={(
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
            <SmallButton primary onClick={clearAll}>Clear search and filters</SmallButton>
            {n > 0 && <SmallButton onClick={onOpenFilters}>Edit filters</SmallButton>}
          </Box>
        )}
      />
    );
  } else {
    content = <PerformerGrid sections={sections} itemKey={itemKey} renderItem={renderItem} onAuxOpen={auxOpen} />;
  }

  return (
    <>
      <Toolbar>
        <SearchField value={q} onChange={(v) => onQuery({ q: v })} placeholder="Search performers" />
        <Select size="small" value={sort} onChange={(e) => onQuery({ sort: e.target.value })} inputProps={{ 'aria-label': 'Sort' }} sx={selectSx}>
          {SORTS.map(s => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
        </Select>
        <Button
          variant="outlined"
          size="small"
          startIcon={<FilterListIcon sx={{ fontSize: 16 }} />}
          onClick={onOpenFilters}
          aria-label={`Filters${n ? `, ${n} active` : ''}`}
          sx={{
            textTransform: 'none', fontSize: '.8rem', color: 'var(--text)', borderColor: 'var(--line-strong)', height: 32,
            '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' }
          }}
        >
          Filters
          {n > 0 && <Box component="span" sx={{ ml: 0.75, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{n}</Box>}
        </Button>
        {(newCount > 0 || newOnly) && (
          <FilterChip on={newOnly} onClick={() => onQuery({ filters: toggleNewOnly(filters) })}
            title={newOnly ? 'Showing only performers with a new upload: click to show everyone' : 'Show only performers with a new upload'}>
            New uploads
            <Box component="span" sx={{ ml: 0.75, fontVariantNumeric: 'tabular-nums' }}>{newCount}</Box>
          </FilterChip>
        )}
      </Toolbar>

      {(query || n > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 2 }}>
          {query && <RemovableChip label={`Search: "${query}"`} onRemove={() => onQuery({ q: '' })} />}
          {chips.map(chip => (
            <RemovableChip key={chip.id} label={chip.label} onRemove={() => onQuery({ filters: removeChip(filters, chip) })} />
          ))}
          <SmallButton onClick={clearAll}>Clear all</SmallButton>
          {performers != null && (
            <Box sx={{ ml: 'auto' }}>
              <TotalText>{`Showing ${shownCount} of ${total}`}</TotalText>
            </Box>
          )}
        </Box>
      )}

      {content}

      {settings && (
        <PerformerSettingsModal
          performer={settings}
          open
          onClose={() => setSettings(null)}
          onUpdate={() => {
            Promise.resolve()
              .then(() => refreshOne(settings.id))
              .catch(() => notify({ severity: 'warning', message: 'Could not refresh her card', action: { label: 'Retry', onClick: reload } }));
          }}
          basePath={basePath}
        />
      )}
    </>
  );
}
