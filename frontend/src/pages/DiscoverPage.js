/**
 * Discover: what the keep scanner found. The watchers read their sites, the P model judges the pictures, and this page is where
 * the performers are decided: Keep and Delete go to the profile page and P's training, Remove only takes her off here.
 *
 * Reads GET /api/discovery/summary (the totals, the watchers, the two runs and the timer) every few seconds while a run goes
 * and less often otherwise, and at once when the page comes back into view. A run that ends or a new keep line bumps
 * `version`: the open tab then offers "New results · Reload" (it never reloads by itself). The tabs are in
 * components/discover/.
 *
 * Layout: SidebarPage. The tabs are its View list (with their counts); each tab draws its own Show group and the one
 * content line; the Watch section (RunControls: the keep line, the timer, the run facts, Scan now, Older posts,
 * Re-judge, Log) is the page's own section. On a phone the View list is the tab row, the rest is in the Filters sheet
 * and Scan now is in the page bar.
 *
 * Routes: /discover/<performers|liked|kept|duplicates|watchers|upload>, /discover/watchers/<watcherId>. /discover goes to the
 * tab used last. Each tab keeps its filters in its own query string; switching tabs comes back to the query a tab had last
 * in this page session. Drawers and sheets are query params too (p, u, pic, sheet), so Back closes them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button } from '@mui/material';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import { SidebarPage, LoadingState, SPACE } from '../components/layout';
import { get, post, sourceLabels, useAsk, useToast } from '../components/discover/shared';
import PerformersTab from '../components/discover/PerformersTab';
import DuplicatesTab from '../components/discover/DuplicatesTab';
import WatchersTab from '../components/discover/WatchersTab';
import UploadTab from '../components/discover/UploadTab';
import RunControls from '../components/discover/RunControls';
import useIsPhone from '../mobile/useIsPhone';
import '../components/discover/page.css';

const TABS = ['performers', 'liked', 'kept', 'duplicates', 'watchers', 'upload'];
const TAB_KEY = 'discover.tab';
const OVERLAY_PARAMS = ['p', 'u', 'pic', 'sheet'];   // a drawer or sheet is not part of a tab's filters
const POLL_RUNNING_MS = 4000;
const POLL_IDLE_MS = 15000;
const NO_WATCHERS = [];

const running = (s) => !!(s?.job?.running || s?.watchJob?.running);

function lastTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.includes(t)) return t;
  } catch {}
  return 'performers';
}

/** A tab's query string without the open drawer or sheet. */
function filtersOf(search) {
  const params = new URLSearchParams(search);
  OVERLAY_PARAMS.forEach(k => params.delete(k));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * What the tabs' "New results" follows: when each slot last finished and the keep line. A slot that starts a run
 * (finishedAt goes blank) or a server that restarted keeps the last end it had, so only an end or a new line counts.
 */
function endsOf(s, prev) {
  const end = (j, before) => (j?.running ? before ?? null : (j?.finishedAt ?? before ?? null));
  const ends = { hand: end(s.job, prev?.hand), timer: end(s.watchJob, prev?.timer), threshold: s.threshold };
  return { ...ends, key: `${ends.hand}|${ends.timer}|${ends.threshold}` };
}

export default function DiscoverPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPhone = useIsPhone();
  const rest = useParams()['*'] || '';
  const [tab = '', watcherId, ...extra] = rest.split('/');
  const valid = TABS.includes(tab);

  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [ask, askDialog] = useAsk();
  // On a phone the drawers are full width: the toast goes above their bottom bar, so it never covers a control
  const overlays = new URLSearchParams(location.search);
  const [notify, toastNode] = useToast({ lift: isPhone && (overlays.has('p') || overlays.has('u')) });
  const alive = useRef(true);
  const wasRunning = useRef(false);
  const loaded = useRef(false);
  const ends = useRef(null);
  const memory = useRef({});   // tab → the query it had last, for this page session only
  useEffect(() => () => { alive.current = false; }, []);

  // The old page kept the whole view (search included) in this browser; the URL holds it now
  useEffect(() => { try { localStorage.removeItem('discover.view'); } catch {} }, []);

  useEffect(() => {
    if (valid) { try { localStorage.setItem(TAB_KEY, tab); } catch {} }
  }, [tab, valid]);

  // Remember each tab's filters; a watcher's own filters are not the Watchers grid's
  useEffect(() => {
    if (!valid || (tab === 'watchers' && watcherId)) return;
    memory.current[tab] = filtersOf(location.search);
  }, [location.search, tab, watcherId, valid]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await get('/summary');
      if (!alive.current) return;
      loaded.current = true;
      setSummary(s);
      setError(null);
      wasRunning.current = running(s);
      const next = endsOf(s, ends.current);
      if (ends.current && ends.current.key !== next.key) setVersion(v => v + 1);
      ends.current = next;
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    let timer;
    let stopped = false;
    const tick = async () => {
      clearTimeout(timer);
      if (!document.hidden || !loaded.current) await loadSummary();   // the first load always; a page in the background then rests
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(tick, wasRunning.current ? POLL_RUNNING_MS : POLL_IDLE_MS);
    };
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadSummary]);

  // The app bar above the page (desktop) or the phone's page bar is sticky; what sticks in the page (the
  // stale pill) goes under it, not behind it. Both carry data-app-bar; a chrome flip swaps them.
  useEffect(() => {
    const root = document.querySelector('.dp-page');
    const bar = document.querySelector('[data-app-bar]');
    if (!root || !bar) return undefined;
    const update = () => {
      const position = window.getComputedStyle(bar).position;
      const pinned = position === 'sticky' || position === 'fixed';
      root.style.setProperty('--dv-top', pinned ? `${Math.round(bar.getBoundingClientRect().height)}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => { observer.disconnect(); root.style.removeProperty('--dv-top'); };
  }, [isPhone]);

  // A picture dropped outside the Upload tab's zone: the browser shouldn't open it
  useEffect(() => {
    const stop = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', stop);
    return () => { document.removeEventListener('dragover', stop); document.removeEventListener('drop', stop); };
  }, []);

  /** A POST, then the summary; a refusal is said in a toast. True when the POST went through. */
  const act = useCallback(async (path, body) => {
    let ok = true;
    try { await post(path, body); } catch (e) { ok = false; notify(e.message, 'error'); }
    await loadSummary();
    return ok;
  }, [loadSummary, notify]);

  /**
   * The summary again. refresh({ stale: true }): also the open list shows "New results · Reload", for a change made from a
   * tab that is not on screen any more (an Undo clicked in the toast after switching tabs).
   */
  const refresh = useCallback((options) => {
    if (options?.stale) setVersion(v => v + 1);
    return loadSummary();
  }, [loadSummary]);

  const watchers = summary?.watchers || NO_WATCHERS;
  const labelsKey = watchers.map(w => `${w.site}:${w.kind}:${w.label}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sourceLabel = useMemo(() => sourceLabels(watchers), [labelsKey]);

  if (!tab) return <Navigate to={`/discover/${lastTab()}`} replace />;
  if (!valid) return <Navigate to="/discover/performers" replace />;
  if ((watcherId && tab !== 'watchers') || extra.some(Boolean)) {
    const to = tab === 'watchers' ? `/discover/watchers/${encodeURIComponent(watcherId)}` : `/discover/${tab}`;
    return <Navigate to={`${to}${location.search}`} replace />;
  }

  const goTab = (id) => {
    if (id === tab) {
      if (watcherId) navigate('/discover/watchers');
      return;
    }
    navigate(`/discover/${id}${memory.current[id] || ''}`);
  };

  const t = summary?.totals || {};
  const run = summary?.run || {};
  const threshold = summary?.threshold ?? run.threshold ?? 50;

  // The tabs as the View list: a link each (a middle click opens a new tab), switched in place to keep each tab's filters.
  // On a watcher's page Watchers stays highlighted, and a click on it goes back to the grid.
  const count = (n) => (summary ? n ?? 0 : null);
  const views = [
    { id: 'performers', label: 'Performers', icon: <GridViewOutlinedIcon />, count: count(t.performers) },
    { id: 'liked', label: 'Liked', icon: <FavoriteBorderIcon />, count: count(t.performers_with_keeps) },
    { id: 'kept', label: 'Kept', icon: <CheckCircleOutlineIcon />, count: count(t.kept_tab) },
    { id: 'duplicates', label: 'Duplicates', icon: <ContentCopyIcon />, count: count(t.duplicates) },
    { id: 'watchers', label: 'Watchers', icon: <VisibilityOutlinedIcon />, count: count(watchers.length) },
    { id: 'upload', label: 'Upload', icon: <FileUploadOutlinedIcon />, count: count(summary?.uploads) }
  ].map(v => ({
    ...v,
    to: `/discover/${v.id}${v.id === tab && !watcherId ? filtersOf(location.search) : memory.current[v.id] || ''}`,
    title: v.id === 'watchers' && watcherId ? 'Back to all watchers' : undefined,
    onClick: (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) return;   // a new tab or window: the link's own way
      e.preventDefault();
      goTab(v.id);
    }
  }));

  const shared = { version, ask, notify, refresh, sourceLabel, watchers, totals: summary?.totals || {}, threshold, isPhone };
  const watcherPage = tab === 'watchers' && !!watcherId;

  return (
    <SidebarPage title="Discover" className="dp-page" views={views} view={tab}>
      {error && (
        <Alert severity="error" sx={{ mb: SPACE.md }}
          action={<Button color="inherit" size="small" onClick={loadSummary}>Retry</Button>}>
          {error}
        </Alert>
      )}
      {!summary && !error && <LoadingState label="Loading…" />}

      {summary && (
        <>
          {/* The page's own section; a watcher's page has its own main action (Run now), so Scan now is a plain button there */}
          <RunControls summary={summary} ask={ask} notify={notify} act={act}
            compact={tab === 'duplicates' || watcherPage} main={!watcherPage} />
          {(tab === 'performers' || tab === 'liked' || tab === 'kept') && <PerformersTab key={tab} tab={tab} {...shared} />}
          {tab === 'duplicates' && <DuplicatesTab {...shared} />}
          {tab === 'watchers' && <WatchersTab summary={summary} watcherId={watcherId} {...shared} />}
          <UploadTab active={tab === 'upload'} {...shared} />
        </>
      )}

      {askDialog}
      {toastNode}
    </SidebarPage>
  );
}
