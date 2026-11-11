/**
 * Performer Management (/performer-management): every performer record, in three views.
 *
 *   Library     where each record is (Before, After, Missing, Blacklisted) and the record housekeeping; on top, the
 *               names in both Before and After as one pair row each ('In both Before and After')
 *   Updates     her Leakhaven link and the update check
 *   Duplicates  hash duplicates: open duplicates in her own files, no hash database yet
 *               (/hash-management redirects here; the old ?view=duplicates&f=pairs goes to the Library)
 *
 * The frame is SidebarPage (components/layout). Its View list is the three views with a count each (Library: every
 * record, Updates: new uploads, Duplicates: needs attention; model.js performerViews). Then, in the sidebar (the
 * rail's flyouts, the phone's Filters sheet): Show (search, sort), the view's filters as a list with counts (Where,
 * Link or Kind) and Records (Reload; on Updates the update check as the main action and its last result). The content
 * is one ContentLine naming what is shown, then the list at full width.
 *
 * The URL holds the state (all replace): view, f (filter), sort, q (search); performer=<id> is the record whose detail
 * is open in the side panel (pushed, so Back closes it). Changing the view clears f and sort; an unknown value falls
 * back to the view's first. The panel opens over the list, whatever the list shows, and the list stays where it was.
 *
 * On the Library a pair is shown whole, in the pairs section, when EITHER of her two records passes the filter and the
 * search (model.js libraryPairs); its records are not listed again below. The filter list counts records.
 *
 * This file only wires the parts together; it renders no row, detail or dialog of its own:
 *   components/performers/usePerformers.js   the one store (GET /api/performer-management/all, refreshOne, patch)
 *   components/performers/model.js          views, filters, sorts, pairs, the actions of a row and their disabled reasons
 *   components/performers/useRowActions.js  what each action does, the update check, the dialogs
 *   components/performers/PerformerRow.js, PairRow.js (PairSection), PerformerDetail.js, DuplicatesView.js
 *   components/hash/useHashActions.js       hash databases, through the server's hash queue
 * A row refreshes itself when the server says her hash job ended (socket performers_updated), and when a hash build of
 * hers in the jobs list ends (done, failed or cancelled).
 *
 * What the parts get: PerformerRow({ performer, ctx, actions, selected, onOpen }), PairSection({ pairs, ctx, actions,
 * selectedId, onOpen }), DuplicatesView({ performers, ctx, actions, selectedId, onOpen }) and, in the side panel,
 * PerformerDetail({ performer, ctx, actions, layout: 'panel' }). onOpen(id) opens her panel. `actions` is
 * useRowActions' object plus expand(id, intent?) (opens her panel, at intent { section, edit }), collapse() (closes
 * it), intentFor(id) -> { id, section, edit } | null and expandedId (the open record's id).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Drawer, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import CategoryIcon from '@mui/icons-material/Category';
import TuneIcon from '@mui/icons-material/Tune';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import StopIcon from '@mui/icons-material/Stop';
import {
  ContentLine, EmptyState, LoadingState, Panel, SIDE, SidebarPage, SideButton, SideButtons, SideFacts, SideGroup,
  SideList, SideMain, SideNote, SideSearch, SideSelect
} from '../components/layout';
import { ListError, SmallButton, useOverlay, useQueryState } from '../components/discover/shared';
import { useNotify } from '../components/ui';
import useHashActions from '../components/hash/useHashActions';
import usePerformers from '../components/performers/usePerformers';
import useRowActions from '../components/performers/useRowActions';
import PerformerRow from '../components/performers/PerformerRow';
import { PairSection, SectionTitle } from '../components/performers/PairRow';
import PerformerDetail from '../components/performers/PerformerDetail';
import DuplicatesView from '../components/performers/DuplicatesView';
import {
  buildCtx, FILTERS, filterCounts, libraryPairs, newCount, performerViews, rememberViewCounts, resolveFilter, resolveSort, resolveView, SORTS,
  viewList
} from '../components/performers/model';
import '../components/performers/performers.css';

const TITLE = 'Performer Management';
const PAGE_ROWS = 100;
const quiet = (promise) => { Promise.resolve(promise).catch(() => {}); };

// the side panel: about 760px on PC, the whole screen on a phone
const FULL = '@media (max-width: 599.98px)';
const panelPaperSx = {
  width: 'min(760px, 100vw)', boxSizing: 'border-box', bgcolor: 'var(--bg)', backgroundImage: 'none',
  borderLeft: '1px solid var(--line-strong)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  [FULL]: { width: '100vw', borderLeft: 'none' }
};
// Close floats top right, over the detail's header (its name keeps 44px free on the right, pm-panel-who)
const panelCloseSx = {
  position: 'absolute', zIndex: 2, top: 'calc(10px + env(safe-area-inset-top))', right: 10, width: 40, height: 40,
  color: 'var(--text)', bgcolor: 'var(--scrim-strong)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius, 6px)',
  '&:hover': { bgcolor: 'var(--scrim-strong)', borderColor: 'var(--text)' },
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
};
const panelBodySx = {
  flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
  p: 2, pt: 'calc(16px + env(safe-area-inset-top))', pb: 'calc(16px + env(safe-area-inset-bottom))',
  [FULL]: { p: 1.5, pt: 'calc(12px + env(safe-area-inset-top))', pb: 'calc(12px + env(safe-area-inset-bottom))' }
};

/** The view's filter list in the sidebar: its group id, title and icon. */
const FILTER_GROUP = {
  library: { id: 'where', title: 'Where', icon: <PlaceOutlinedIcon /> },
  updates: { id: 'link', title: 'Link', icon: <LinkOutlinedIcon /> },
  duplicates: { id: 'kind', title: 'Kind', icon: <CategoryIcon /> },
};

/** What the content line calls a filter (else the filter's own label). */
const SHOWN_TITLE = {
  library: { all: 'All performers' },
  updates: { linked: 'Linked performers', new: 'New uploads' },
};
const shownTitle = (view, filter) => SHOWN_TITLE[view]?.[filter] || FILTERS[view].find(f => f.id === filter)?.label || '';

/** What an empty filter says (the search has its own line). */
const NOTHING = {
  library: {
    all: 'No performer is listed.',
    before: 'No performer is in Before.',
    after: 'No performer is in After.',
    missing: 'Every performer has her folder.',
    blacklisted: 'Nobody is blacklisted.',
  },
  updates: {
    linked: 'No performer has a Leakhaven link.',
    new: 'No new uploads. Check updates looks again.',
    failed: 'No check failed.',
    unchecked: 'Every linked performer has been checked.',
    nolink: 'Every performer has a Leakhaven link.',
  },
  duplicates: {
    all: 'Nothing needs attention: no open duplicates, every folder has a hash database.',
    own: 'No check of her own files left duplicates open.',
    nohash: 'Every performer with a folder has a hash database.',
  },
};

export default function PerformerManagementPage({ basePath }) {
  const notify = useNotify();
  const store = usePerformers();
  const storeRef = useRef(store);
  storeRef.current = store;

  const hash = useHashActions({
    basePath,
    onChanged: (id) => (id ? storeRef.current.refreshOne(id) : storeRef.current.reload()),
  });

  // ── the side panel (?performer=<id>) and what its detail should open at ──
  const expandOv = useOverlay('performer');
  const expandRef = useRef(expandOv);
  expandRef.current = expandOv;
  const expandedId = Number(expandOv.value) || null;
  const [intent, setIntent] = useState(null);   // { id, section, edit }
  const expand = useCallback((id, next = null) => {
    const key = Number(id);
    if (!Number.isFinite(key)) return;
    setIntent(next ? { ...next, id: key } : null);
    // one history entry for the open panel: another record replaces it, so Back (or closing) never re-opens the first
    if (expandRef.current.value) expandRef.current.set(key); else expandRef.current.open(key);
  }, []);
  const collapse = useCallback(() => { expandRef.current.close(); }, []);
  useEffect(() => { if (!expandedId) setIntent(null); }, [expandedId]);
  const intentFor = useCallback((id) => (intent && intent.id === Number(id) ? intent : null), [intent]);
  const closedByPage = useRef(new Set());   // ids whose panel the page closed after removing her

  const actions = useRowActions({
    store, hash, expand,
    onMerged: (sourceId, targetId) => {
      const o = expandRef.current;
      if (Number(o.value) === Number(sourceId)) o.set(targetId);
    },
    onRemoved: (id) => {
      const o = expandRef.current;
      if (Number(o.value) !== Number(id)) return;
      // closing is a history Back (async): until it lands, the URL still names her, and that is not news
      closedByPage.current.add(Number(id));
      o.close();
    },
  });
  const rowActions = { ...actions, expand, collapse, intentFor, expandedId };
  const openRow = useCallback((id) => expand(id), [expand]);

  // ── the URL state ──
  const [qs, setQs] = useQueryState({ view: 'library', f: '', sort: '', q: '' });
  const view = resolveView(qs.view);
  const filter = resolveFilter(view, qs.f);
  const sort = resolveSort(view, qs.sort);
  const q = qs.q;
  const viewRef = useRef(view);
  viewRef.current = view;
  const setView = useCallback((v) => { if (v !== viewRef.current) setQs({ view: v, f: '', sort: '' }); }, [setQs]);
  // the view's first filter and sort stay out of the URL
  const setFilter = (id) => setQs({ f: id === FILTERS[view][0].id ? '' : id });
  const setSort = (id) => setQs({ sort: id === SORTS[view][0].id ? '' : id });
  const setSearch = (text) => setQs({ q: text.trim() ? text : '' });
  const showAll = () => setQs({ f: '', q: '' });

  // the pairs were a Duplicates filter once: an old link goes to the Library, where they are now
  const oldPairsLink = qs.view === 'duplicates' && qs.f === 'pairs';
  useEffect(() => { if (oldPairsLink) setQs({ view: 'library', f: '', sort: '' }); }, [oldPairsLink, setQs]);

  const ctx = buildCtx({
    view, filter, byId: store.byId, job: hash.job,
    pendingOf: actions.pendingOf, checkingId: actions.check.currentId, hashBusy: hash.isBusy, unlabelled: store.unlabelled,
  });

  const list = store.list;
  const counts = filterCounts(list, view, ctx);
  const shown = viewList(list, { view, filter, sort, q }, ctx);
  // the Library's pairs (whole, when either record is shown) and the rows in no pair
  const { pairs, rest } = view === 'library' ? libraryPairs(shown, ctx) : { pairs: [], rest: shown };

  // the View list's counts: every record, the new uploads, what needs attention in Duplicates
  const dupCount = useMemo(() => filterCounts(list, 'duplicates').all ?? 0, [list]);
  const newUploads = useMemo(() => newCount(list), [list]);
  const viewCounts = useMemo(
    () => (store.loaded ? { library: list.length, updates: newUploads, duplicates: dupCount } : null),
    [store.loaded, list.length, newUploads, dupCount]
  );
  useEffect(() => { if (viewCounts) rememberViewCounts(viewCounts); }, [viewCounts]);
  const views = performerViews(viewCounts || {}, setView);

  // the first 100 rows, then 100 more at a time; back to 100 when the view, filter, sort or search change
  const listKey = `${view}|${filter}|${sort}|${q}`;
  const [more, setMore] = useState({ key: listKey, n: PAGE_ROWS });
  const limit = more.key === listKey ? more.n : PAGE_ROWS;

  // ── the record in the panel: the live row; while the panel slides shut, the last one ──
  const live = expandedId ? store.byId.get(expandedId) || null : null;
  const lastShown = useRef(null);
  if (live) lastShown.current = live;
  const panelPerformer = live || lastShown.current;

  // a link to a record that is not in the list (removed, say): say so and close the panel
  // (not for a record the page removed and is closing the panel of itself)
  const warned = useRef(null);
  useEffect(() => {
    if (!expandedId) { warned.current = null; closedByPage.current.clear(); return; }
    if (!store.loaded || store.byId.has(expandedId) || warned.current === expandedId) return;
    if (closedByPage.current.has(expandedId)) return;
    warned.current = expandedId;
    notify({ severity: 'warning', message: `Performer #${expandedId} is not in the list: she may have been removed` });
    expandRef.current.close();
  }, [expandedId, store.loaded, store.byId, notify]);

  // ── a row refreshes itself after a hash job ──
  // usePerformers follows the server's socket events; the fallback here:
  // a hash build of hers in the jobs list that was queued or running and has ended
  const jobStatus = useRef(null);
  useEffect(() => {
    const rows = hash.jobs || [];
    const before = jobStatus.current;
    jobStatus.current = new Map(rows.map(j => [j.id, j.status]));
    if (!before) return;   // the rows there when the page opened are not news
    for (const j of rows) {
      const was = before.get(j.id);
      const ended = j.status === 'done' || j.status === 'failed' || j.status === 'cancelled';
      if (ended && (was === 'queued' || was === 'running') && j.raw?.performerId != null) {
        quiet(storeRef.current.refreshOne(j.raw.performerId));
      }
    }
  }, [hash.jobs]);

  const reload = useCallback(() => quiet(storeRef.current.reload()), []);

  // the detail's own header names her (layout 'panel'); the drawer adds only Close
  const panelName = panelPerformer ? (panelPerformer.name || 'Unnamed') : '';
  const panel = (
    <Drawer anchor="right" open={!!live} onClose={collapse}
      slotProps={{ paper: { sx: panelPaperSx, role: 'dialog', 'aria-modal': true, 'aria-label': `Details of ${panelName}` } }}>
      {panelPerformer && (
        <>
          <Tooltip title="Close (Esc)">
            <IconButton onClick={collapse} aria-label="Close" sx={panelCloseSx}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Box sx={panelBodySx}>
            <PerformerDetail key={panelPerformer.id} performer={panelPerformer} ctx={ctx} actions={rowActions} layout="panel" />
          </Box>
        </>
      )}
    </Drawer>
  );

  const tail = (
    <>
      {hash.modals}
      {actions.dialogs}
    </>
  );

  // ── the sidebar: Records (Reload, and on Updates the update check) ──
  const recordsGroup = (extra = null, summary = '') => (
    <SideGroup id="page" title="Records" icon={<TuneIcon />} order={SIDE.page}
      summary={store.refreshing ? 'Reloading' : summary}>
      {extra}
      <SideButtons>
        <SideButton icon={<RefreshIcon />} onClick={reload} disabled={store.refreshing}>
          {store.refreshing ? 'Reloading…' : 'Reload'}
        </SideButton>
      </SideButtons>
    </SideGroup>
  );

  // ── first load, and a first load that failed: nothing else ──
  if ((store.error && list.length === 0) || !store.loaded) {
    return (
      <SidebarPage title={TITLE} views={views} view={view}>
        {store.error && list.length === 0
          ? <ListError error={store.error} onRetry={reload} />
          : <LoadingState label="Loading performers…" />}
        {tail}
      </SidebarPage>
    );
  }

  // the view's filters as a list with their counts (Where, Link or Kind)
  const fg = FILTER_GROUP[view];
  const firstFilter = FILTERS[view][0].id;
  const filterLabel = FILTERS[view].find(f => f.id === filter)?.label || '';
  const sortLabel = SORTS[view].find(s => s.id === sort)?.label || '';
  const filterGroup = (
    <SideGroup key={fg.id} id={fg.id} title={fg.title} icon={fg.icon} order={SIDE.list}
      badge={filter !== firstFilter ? 1 : 0} summary={filterLabel}>
      <SideList label={fg.title} value={filter} onChange={setFilter}
        items={FILTERS[view].map(f => ({ id: f.id, label: f.label, count: counts[f.id] ?? 0 }))} />
    </SideGroup>
  );
  const showGroup = (
    <SideGroup id="show" title="Show" icon={<FilterListIcon />} order={SIDE.show}
      badge={q ? 1 : 0} summary={q ? `"${q.trim()}" · ${sortLabel}` : sortLabel}>
      <SideSearch value={q} onChange={setSearch} placeholder="Search names and aliases" />
      <SideSelect label="Sort" value={sort} onChange={setSort}
        options={SORTS[view].map(s => ({ value: s.id, label: s.label }))} />
    </SideGroup>
  );

  // Updates: the update check is the page's main action, its last result the facts under it
  // (Duplicates has "Build missing" on its own line, in DuplicatesView)
  const check = actions.check;
  let records = recordsGroup();
  if (view === 'updates') {
    const linked = counts.linked ?? 0;
    const last = check.result && !check.running ? check.result : null;
    records = recordsGroup(
      <>
        {check.running
          ? <SideMain icon={<StopIcon />} label={`Stop · ${check.done} of ${check.total}`} onClick={() => check.stop()} />
          : (
            <SideMain icon={<SyncIcon />} label={`Check updates (${linked})`} onClick={() => check.start()}
              disabled={linked === 0} tip={linked === 0 ? 'No performer has a Leakhaven link' : undefined} />
          )}
        {last && (
          <>
            <SideNote>Last check</SideNote>
            <SideFacts rows={[
              { label: 'Checked', value: Number(last.done || 0).toLocaleString() },
              { label: 'New', value: Number(last.newCount || 0).toLocaleString(), tone: 'accent' },
              { label: 'Failed', value: Number(last.failed || 0).toLocaleString(), tone: last.failed > 0 ? 'bad' : undefined },
            ]} />
          </>
        )}
      </>,
      check.running ? `Checking ${check.done} of ${check.total}` : `${linked.toLocaleString()} linked`
    );
  }

  // ── the content line: what is shown ──
  const total = counts[filter] ?? 0;
  const meta = [
    `${q ? `${shown.length.toLocaleString()} of ` : ''}${total.toLocaleString()} ${total === 1 ? 'performer' : 'performers'}`,
    view === 'library' && pairs.length > 0 ? `${pairs.length.toLocaleString()} in both Before and After` : null,
  ].filter(Boolean).join(' · ');
  const line = <ContentLine title={shownTitle(view, filter)} meta={meta} />;

  // ── the list, or why it is empty ──
  let body;
  if (list.length === 0) {
    body = (
      <EmptyState title="No performers yet" description="Performers you import show here."
        action={<SmallButton component={RouterLink} to="/local-import">Open Import</SmallButton>} />
    );
  } else if (shown.length === 0) {
    const why = q ? `No performer matches "${q.trim()}" here.` : (NOTHING[view]?.[filter] || 'No performer matches this filter.');
    const canWiden = !!(qs.f || q);
    body = (
      <EmptyState title="Nothing here" description={why}
        action={canWiden ? <SmallButton onClick={showAll}>Show all</SmallButton> : undefined} />
    );
  } else if (view === 'duplicates') {
    body = (
      <DuplicatesView key={filter} performers={shown} ctx={ctx} actions={rowActions} selectedId={expandedId} onOpen={openRow} />
    );
  } else {
    body = (
      <>
        <PairSection key={filter} pairs={pairs} ctx={ctx} actions={rowActions} selectedId={expandedId} onOpen={openRow} />
        {rest.length > 0 && (
          <Box component="section" aria-labelledby={pairs.length ? 'pm-rest' : undefined} sx={{ minWidth: 0 }}>
            {pairs.length > 0 && <SectionTitle id="pm-rest" count={rest.length}>Other performers</SectionTitle>}
            <Panel padded={false} className="pm-list">
              {rest.slice(0, limit).map(p => (
                <PerformerRow key={p.id} performer={p} ctx={ctx} actions={rowActions} selected={p.id === expandedId} onOpen={openRow} />
              ))}
            </Panel>
            {rest.length > limit && (
              <div className="pm-more">
                <SmallButton onClick={() => setMore({ key: listKey, n: limit + PAGE_ROWS })}>Show 100 more</SmallButton>
              </div>
            )}
          </Box>
        )}
      </>
    );
  }

  return (
    <SidebarPage title={TITLE} views={views} view={view}>
      {showGroup}
      {filterGroup}
      {records}
      {line}
      {body}
      {panel}
      {tail}
    </SidebarPage>
  );
}
