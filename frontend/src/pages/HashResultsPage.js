/**
 * Duplicates page: /hash-results/:runId (mock-up 06-hash-duplicates.html).
 *
 * One run of the duplicate check, paged by group on the server. Every
 * Keep / Remove choice is saved at once; removal moves files to her trash
 * folder (never saved for training), with Undo while the toast shows; then they are deleted.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CircularProgress, Switch } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  PageShell, PageHeader, Section, EmptyState, LoadingState
} from '../components/layout';
import {
  hashGet, hashPost, formatAgo, formatBytes, formatDate, plural,
  reasonText, skipShortText
} from '../components/hash/hashApi';
import useRunData, { useOrphans } from '../components/hash/results/useRunData';
import FilterRow, { MIN_TO_DISTANCE } from '../components/hash/results/FilterRow';
import GroupCard from '../components/hash/results/GroupCard';
import SelectionBar from '../components/hash/results/SelectionBar';
import OrphanSection from '../components/hash/results/OrphanSection';
import PreviewDialog from '../components/hash/results/PreviewDialog';
import RemoveDialog from '../components/hash/results/RemoveDialog';
import { useNotify, useToastLift } from '../components/ui';
import '../components/hash/hash.css';

const DEFAULTS = { kind: 'all', media: 'all', size: 'all', min: 86, page: 1 };
const PAGE_SIZE = 20;
// Toasts sit above the sticky selection bar (taller on phones, where it wraps).
const TOAST_LIFT = { xs: 'calc(150px + var(--nav-bottom, 0px))', sm: 'calc(96px + var(--nav-bottom, 0px))' };

function readFilters(sp) {
  const pick = (k, allowed) => (allowed.includes(sp.get(k)) ? sp.get(k) : DEFAULTS[k]);
  const min = Number(sp.get('min'));
  const page = parseInt(sp.get('page'), 10);
  return {
    kind: pick('kind', ['all', 'exact', 'similar']),
    media: pick('media', ['all', 'pics', 'vids']),
    size: pick('size', ['all', 'pairs', 'groups']),
    min: [86, 90, 95].includes(min) ? min : DEFAULTS.min,
    page: Number.isFinite(page) && page > 0 ? page : 1
  };
}

const EMPTY_SUMMARY = { count: 0, bytes: 0, exact: 0, similar: 0 };

/** Selection summary change for ticking (+1) or unticking (-1) these members. */
function summaryDelta(members, sign) {
  const d = { count: 0, bytes: 0, exact: 0, similar: 0 };
  for (const m of members) {
    d.count += sign;
    d.bytes += sign * (Number(m.size) || 0);
    if (m.relation === 'exact') d.exact += sign; else d.similar += sign;
  }
  return d;
}

function addSummary(s, d) {
  const b = s || EMPTY_SUMMARY;
  return {
    ...b,
    count: Math.max(0, (b.count || 0) + d.count),
    bytes: Math.max(0, (b.bytes || 0) + d.bytes),
    exact: Math.max(0, (b.exact || 0) + d.exact),
    similar: Math.max(0, (b.similar || 0) + d.similar)
  };
}

function negate(d) {
  return { count: -d.count, bytes: -d.bytes, exact: -d.exact, similar: -d.similar };
}

export default function HashResultsPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const { kind, media, size, min, page } = filters;
  const query = useMemo(
    () => ({ page, kind, media, size, maxDistance: MIN_TO_DISTANCE[min] }),
    [page, kind, media, size, min]
  );

  const runData = useRunData(runId, query);
  const { data, status, error, refreshing, laterError } = runData;
  const run = data?.run || null;
  const totals = data?.totals || {};

  const [orphansOpen, setOrphansOpen] = useState(false);
  const orphans = useOrphans(runId, orphansOpen);

  const [preview, setPreview] = useState(null); // { groupKey, fileId, section }
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busyKeys, setBusyKeys] = useState(() => new Set());
  const [skippedMap, setSkippedMap] = useState({}); // itemId -> short reason
  const [skipBanner, setSkipBanner] = useState(null); // [{ name, message }]
  const [checking, setChecking] = useState(false);
  const [oldRemoved, setOldRemoved] = useState(null); // [{ name, storedPath, originalPath }]: her folder is gone
  const listTopRef = useRef(null);
  const selSeq = useRef(0);

  // Latest state for the stable callbacks below.
  const live = useRef({});
  live.current = { data, orphans, runData, runId };

  const notify = useNotify();
  useToastLift(TOAST_LIFT);

  // A new run (Check again): forget per-run state.
  useEffect(() => {
    setPreview(null); setRemoveOpen(false); setOrphansOpen(false);
    setSkippedMap({}); setSkipBanner(null); setBusyKeys(new Set());
  }, [runId]);

  // Files of the old Recently removed that could not go to a trash folder: listed once, until dismissed.
  useEffect(() => {
    const ctrl = new AbortController();
    hashGet('/old-removed', { signal: ctrl.signal })
      .then(res => setOldRemoved((res.items || []).length ? res.items : null))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (laterError) notify({ severity: 'error', message: `Could not refresh: ${laterError.err.message}` });
  }, [laterError, notify]);

  /* ─── URL query (filters and page, replace) ─── */
  const updateParams = useCallback(patch => {
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || v === null || String(v) === String(DEFAULTS[k])) n.delete(k);
        else n.set(k, String(v));
      });
      return n;
    }, { replace: true });
  }, [setSearchParams]);

  const changeFilters = useCallback(patch => updateParams({ ...patch, page: 1 }), [updateParams]);
  const resetFilters = useCallback(() => updateParams({ kind: 'all', media: 'all', size: 'all', min: 86, page: 1 }), [updateParams]);
  const goPage = useCallback(p => {
    updateParams({ page: p });
    if (listTopRef.current) listTopRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [updateParams]);

  /* ─── title, back ─── */
  const source = run?.source;
  const target = run?.target;
  const isCompare = run?.kind === 'compare';
  let titleText = 'Duplicates';
  if (run && source) {
    if (isCompare && target) {
      const same = source.name === target.name;
      const a = same && source.location ? `${source.name} (${source.location})` : source.name;
      const b = same && target.location ? `${target.name} (${target.location})` : target.name;
      titleText = `${a} against ${b}`;
    } else {
      titleText = `Duplicates: ${source.name}`;
    }
  }
  if (status === 'notfound') titleText = 'Duplicates';

  useEffect(() => {
    const prev = document.title;
    return () => { document.title = prev; };
  }, []);
  useEffect(() => { document.title = titleText; }, [titleText]);

  const sourceId = source?.id;
  const goBack = useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(sourceId ? `/performer-management?performer=${sourceId}` : '/performer-management', { replace: true });
  }, [navigate, sourceId]);
  const toManagement = useCallback(() => {
    navigate(sourceId ? `/performer-management?performer=${sourceId}` : '/performer-management');
  }, [navigate, sourceId]);

  const ctx = useMemo(() => ({
    kind: isCompare ? 'compare' : 'internal',
    sourceName: source?.name,
    sourceLocation: source?.location,
    targetName: target?.name
  }), [isCompare, source?.name, source?.location, target?.name]);

  /* ─── selection ─── */
  const findMembers = useCallback(ids => {
    const out = [];
    const seen = new Set();
    const scan = groups => {
      for (const g of groups || []) {
        for (const m of g.members) {
          if (m.itemId !== null && m.itemId !== undefined && ids.has(m.itemId) && !seen.has(m.itemId)) {
            seen.add(m.itemId); out.push(m);
          }
        }
      }
    };
    scan(live.current.data?.groups);
    scan(live.current.orphans.groups);
    return out;
  }, []);

  const setMembersSelected = useCallback((ids, selected) => {
    const fn = m => (m.itemId !== null && m.itemId !== undefined && ids.has(m.itemId) && !!m.selected !== selected
      ? { ...m, selected, selectedBy: selected ? 'user' : m.selectedBy }
      : m);
    live.current.runData.mapMembers(fn);
    live.current.orphans.mapMembers(fn);
  }, []);

  const adjustSummary = useCallback(delta => {
    live.current.runData.patchData(d => ({ ...d, selection: addSummary(d.selection, delta) }));
  }, []);

  const changeSelection = useCallback(async (itemIds, selected) => {
    const members = findMembers(new Set(itemIds)).filter(m => !!m.selected !== selected);
    if (!members.length) return;
    const ids = new Set(members.map(m => m.itemId));
    const delta = summaryDelta(members, selected ? 1 : -1);
    setMembersSelected(ids, selected);
    adjustSummary(delta);
    const seq = ++selSeq.current;
    try {
      const res = await hashPost(`/run/${encodeURIComponent(live.current.runId)}/selection`, { itemIds: [...ids], selected });
      const refused = res.refused || [];
      if (refused.length) {
        setMembersSelected(new Set(refused.map(r => r.itemId)), !selected);
        notify({
          severity: 'warning',
          message: `${plural(refused.length, 'file')} could not be ticked. ${reasonText(refused[0].reason)}`
        });
      }
      if (seq === selSeq.current) live.current.runData.setSelection(res.selection);
      else if (refused.length) {
        adjustSummary(negate(summaryDelta(members.filter(m => refused.some(r => r.itemId === m.itemId)), selected ? 1 : -1)));
      }
    } catch (err) {
      setMembersSelected(ids, !selected);
      adjustSummary(negate(delta));
      notify({ severity: 'error', message: `Not saved: ${err.message}` });
    }
  }, [findMembers, setMembersSelected, adjustSummary, notify]);

  const reloadAll = useCallback(() => {
    live.current.runData.reload();
    live.current.orphans.reload();
  }, []);

  // Undo of Clear: puts back exactly what was in effect ('auto' stays 'auto'), then reloads what is shown.
  const undoClear = useCallback(async restore => {
    if (!restore.length) return;
    const seq = ++selSeq.current;
    try {
      const res = await hashPost(`/run/${encodeURIComponent(live.current.runId)}/selection`, { restore });
      if (seq === selSeq.current) live.current.runData.setSelection(res.selection);
      reloadAll();
      const refused = res.refused || [];
      notify(refused.length
        ? { severity: 'warning', message: `Ticked again · ${plural(refused.length, 'file')} could not be ticked` }
        : { severity: 'success', message: 'Selection restored' });
    } catch (err) {
      notify({ severity: 'error', message: `Not saved: ${err.message}` });
    }
  }, [notify, reloadAll]);

  const clearSelection = useCallback(async () => {
    const loaded = [];
    const scan = groups => (groups || []).forEach(g => g.members.forEach(m => { if (m.selected && m.itemId) loaded.push(m.itemId); }));
    scan(live.current.data?.groups);
    scan(live.current.orphans.groups);
    const before = live.current.data?.selection;
    const loadedIds = new Set(loaded);
    setMembersSelected(loadedIds, false);
    live.current.runData.setSelection({ ...(before || EMPTY_SUMMARY), ...EMPTY_SUMMARY });
    const seq = ++selSeq.current;
    try {
      const res = await hashPost(`/run/${encodeURIComponent(live.current.runId)}/selection`, { all: true, selected: false });
      // the server cleared the ticks that wait for a keeper choice too
      live.current.runData.mapMembers(m => (m.waiting ? { ...m, waiting: false } : m));
      if (seq === selSeq.current) live.current.runData.setSelection(res.selection);
      const restore = res.restore || [];
      notify({
        severity: 'success',
        message: 'Selection cleared',
        action: restore.length ? { label: 'Undo', onClick: () => undoClear(restore) } : null
      });
    } catch (err) {
      setMembersSelected(loadedIds, true);
      if (before) live.current.runData.setSelection(before);
      notify({ severity: 'error', message: `Not cleared: ${err.message}` });
    }
  }, [setMembersSelected, notify, undoClear]);

  const selectShownIds = useMemo(() => {
    const ids = [];
    for (const g of data?.groups || []) for (const m of g.members) if (m.canSelect && !m.selected && m.itemId) ids.push(m.itemId);
    return ids;
  }, [data?.groups]);

  const selectShown = useCallback(() => changeSelection(selectShownIds, true), [changeSelection, selectShownIds]);

  /* ─── group actions ─── */
  const setBusy = useCallback((key, on) => {
    setBusyKeys(prev => {
      const n = new Set(prev);
      if (on) n.add(key); else n.delete(key);
      return n;
    });
  }, []);

  const onToggle = useCallback((groupKey, itemId, selected) => changeSelection([itemId], selected), [changeSelection]);

  const onKeepAll = useCallback(groupKey => {
    const g = (live.current.data?.groups || []).find(x => x.key === groupKey);
    if (!g) return;
    changeSelection(g.members.filter(m => m.selected && m.itemId).map(m => m.itemId), false);
  }, [changeSelection]);

  const onMakeKeeper = useCallback(async (groupKey, fileId) => {
    setBusy(groupKey, true);
    try {
      const res = await hashPost(`/run/${encodeURIComponent(live.current.runId)}/keeper`, { groupKey, fileId });
      const inReview = (live.current.data?.groups || []).some(g => g.key === groupKey);
      if (inReview && res.group) live.current.runData.replaceGroup(groupKey, res.group);
      else reloadAll(); // an orphan group: the totals and the page's empty state change too
      if (res.selection) live.current.runData.setSelection(res.selection);
      if (res.group) {
        setPreview(p => (p && p.groupKey === groupKey ? { ...p, groupKey: res.group.key } : p));
      }
    } catch (err) {
      notify({ severity: 'error', message: err.message });
    } finally {
      setBusy(groupKey, false);
    }
  }, [setBusy, notify, reloadAll]);

  const onDismiss = useCallback(async groupKey => {
    setBusy(groupKey, true);
    try {
      const res = await hashPost(`/run/${encodeURIComponent(live.current.runId)}/dismiss`, { groupKey });
      live.current.orphans.dropGroup(groupKey);
      live.current.orphans.reload(); // the later pages moved up by one
      live.current.runData.patchData(d => ({
        ...d,
        selection: res.selection || d.selection,
        totals: { ...d.totals, orphanGroups: Math.max(0, (d.totals?.orphanGroups || 0) - 1) }
      }));
      setPreview(p => (p && p.groupKey === groupKey ? null : p));
    } catch (err) {
      notify({ severity: 'error', message: err.message });
    } finally {
      setBusy(groupKey, false);
    }
  }, [setBusy, notify]);

  const onPreview = useCallback((groupKey, fileId, section = 'review') => setPreview({ groupKey, fileId, section }), []);
  const onPreviewNavigate = useCallback(t => setPreview(p => (p ? { ...p, ...t } : p)), []);

  /* ─── remove, undo ─── */
  const undoBatch = useCallback(async (rid, batchId) => {
    try {
      const res = await hashPost(`/run/${encodeURIComponent(rid)}/undo`, { batchId });
      const ok = (res.restored || []).length;
      const skipped = res.skipped || [];
      if (res.selection && String(rid) === String(live.current.runId)) live.current.runData.setSelection(res.selection);
      notify({
        severity: skipped.length ? 'warning' : 'success',
        message: `Put back ${plural(ok, 'file')}${skipped.length ? ` · ${skipped.length.toLocaleString()} not put back: ${skipped[0].message}` : ''}`
      });
    } catch (err) {
      notify({ severity: 'error', message: `Not undone: ${err.message}` });
    }
    reloadAll();
  }, [notify, reloadAll]);

  const confirmRemove = useCallback(async itemIds => {
    const rid = live.current.runId;
    try {
      const res = await hashPost(`/run/${encodeURIComponent(rid)}/remove`, { itemIds });
      const removed = res.removed || [];
      const skipped = res.skipped || [];
      setRemoveOpen(false);
      setPreview(null);
      const map = {};
      skipped.forEach(s => { if (s.itemId !== null && s.itemId !== undefined) map[s.itemId] = skipShortText(s.reason); });
      setSkippedMap(map);
      setSkipBanner(skipped.length ? skipped : null);
      if (res.selection) live.current.runData.setSelection(res.selection);
      reloadAll();
      const skipText = skipped.length ? ` · ${skipped.length.toLocaleString()} skipped` : '';
      if (removed.length) {
        notify({
          severity: skipped.length ? 'warning' : 'success',
          message: `Moved ${plural(removed.length, 'file')} to the trash${skipText}`,
          action: res.batchId ? { label: 'Undo', onClick: () => undoBatch(rid, res.batchId) } : null,
          duration: 12000
        });
      } else {
        notify({ severity: 'warning', message: `No files moved${skipText}` });
      }
    } catch (err) {
      notify({ severity: 'error', message: err.message });
    }
  }, [notify, reloadAll, undoBatch]);

  /* ─── verified, check again ─── */
  const verified = !!run?.verified;
  const toggleVerified = useCallback(async () => {
    if (!sourceId) return;
    const next = !verified;
    live.current.runData.patchRun({ verified: next });
    try {
      const res = await hashPost(`/performer/${sourceId}/verify`, { verified: next });
      if (typeof res.verified === 'boolean' || typeof res.verified === 'number') live.current.runData.patchRun({ verified: !!res.verified });
    } catch (err) {
      live.current.runData.patchRun({ verified: !next });
      notify({ severity: 'error', message: `Not saved: ${err.message}` });
    }
  }, [sourceId, verified, notify]);

  const checkAgain = useCallback(async () => {
    if (!source) return;
    setChecking(true);
    try {
      const res = isCompare && target
        ? await hashPost('/check', { source_performer_id: source.id, target_performer_id: target.id })
        : await hashPost(`/performer/${source.id}/internal-check`);
      notify({ severity: 'success', message: `Checked again: ${plural(res.groupCount || 0, 'group')}` });
      if (res.runId !== undefined && res.runId !== null) {
        if (String(res.runId) === String(runId)) runData.reload();
        else navigate(`/hash-results/${res.runId}`, { replace: true });
      }
    } catch (err) {
      notify({ severity: 'error', message: err.message });
    } finally {
      setChecking(false);
    }
  }, [source, target, isCompare, notify, navigate, runId, runData]);

  /* ─── what is on screen ─── */
  const { onScreenIds, onScreenSelected } = useMemo(() => {
    const ids = new Set();
    let sel = 0;
    const add = groups => (groups || []).forEach(g => g.members.forEach(m => {
      if (m.itemId === null || m.itemId === undefined || ids.has(m.itemId)) return;
      ids.add(m.itemId);
      if (m.selected) sel += 1;
    }));
    add(data?.groups);
    add(orphans.groups);
    return { onScreenIds: ids, onScreenSelected: sel };
  }, [data?.groups, orphans.groups]);

  // Ticks in a group whose keeper turned out to be missing on disk: the server still counts them, the page does not.
  const { waitingMembers, waitingIds } = useMemo(() => {
    const list = [];
    for (const g of data?.groups || []) for (const m of g.members) if (m.waiting && m.itemId) list.push(m);
    return { waitingMembers: list, waitingIds: new Set(list.map(m => m.itemId)) };
  }, [data?.groups]);
  const selection = useMemo(
    () => (waitingMembers.length
      ? addSummary(data?.selection, summaryDelta(waitingMembers, -1))
      : (data?.selection || EMPTY_SUMMARY)),
    [data?.selection, waitingMembers]
  );
  const offScreen = Math.max(0, (selection.count || 0) - onScreenSelected);

  const allResolved = status === 'ready' && !!run && run.status !== 'pending' && run.status !== 'failed'
    && !(totals.groups > 0) && !(totals.orphanGroups > 0);

  const skippedFor = useCallback(g => {
    for (const m of g.members) if (m.itemId && skippedMap[m.itemId]) return skippedMap[m.itemId];
    return null;
  }, [skippedMap]);

  /* ─── rendering ─── */
  const back = { back: true, onBack: goBack };

  if (status === 'loading' || (status === 'ready' && !run)) {
    return (
      <>
        <PageShell className="hr-page">
          <PageHeader title="Duplicates" {...back} />
          <LoadingState label="Loading the check…" />
        </PageShell>
      </>
    );
  }

  if (status === 'notfound') {
    return (
      <>
        <PageShell className="hr-page">
          <PageHeader title="Duplicates" subtitle="Check not found" {...back} />
          <EmptyState
            title="This check no longer exists"
            description="It was removed, or replaced by a newer check. Nothing was changed on disk."
            action={(
              <button type="button" className="hr-btn" onClick={() => navigate('/performer-management')}>
                <ArrowBackIcon />Back to Performer Management
              </button>
            )}
          />
        </PageShell>
      </>
    );
  }

  if (status === 'error') {
    return (
      <>
        <PageShell className="hr-page">
          <PageHeader title="Duplicates" {...back} />
          <EmptyState
            title="Could not load this check"
            description={error?.message}
            action={<button type="button" className="hr-btn" onClick={runData.reload}><RefreshIcon />Retry</button>}
          />
        </PageShell>
      </>
    );
  }

  /* status ready, run present */
  const checkLabel = isCompare ? 'Compare again' : 'Check again';
  const checkTitle = isCompare
    ? `Compare ${source?.name} with ${target?.name} again`
    : `Run the duplicate check on ${source?.name}'s files again`;
  const checkBtn = (cls = 'hr-btn outlined') => (
    <button type="button" className={cls} disabled={checking} title={checkTitle} onClick={checkAgain}>
      {checking ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
      {checking ? 'Checking…' : checkLabel}
    </button>
  );

  const createdAt = run.createdAt;
  const when = createdAt ? `${formatAgo(createdAt)} (${formatDate(createdAt)})` : '';
  const subtitle = (
    <span className="hr-subtitle">
      {isCompare ? `Compared ${when}` : `Her own files · checked ${when}`}
      {run.status !== 'pending' && run.status !== 'failed' && ` · ${plural(totals.groups || 0, 'group')} · ${plural(totals.files || 0, 'file')}`}
    </span>
  );
  const title = (
    <span className="hr-title">
      {titleText}
      {verified && <span className="hr-badge ok">Verified</span>}
    </span>
  );

  const actions = (
    <>
      <span
        className={`hr-control${isCompare ? ' disabled' : ''}`}
        title={isCompare
          ? "Verified applies to one performer's own files"
          : 'Mark as verified: you have looked at every group and what is left is kept on purpose'}
      >
        <Switch
          size="small"
          checked={verified}
          disabled={isCompare}
          onChange={toggleVerified}
          slotProps={{ input: { 'aria-label': 'Verified' } }}
        />
        Verified
      </span>
      {checkBtn()}
    </>
  );

  const header = (
    <PageHeader
      title={title}
      titleIsInfo
      subtitle={subtitle}
      actions={<div className="hr-actions">{actions}</div>}
      {...back}
    />
  );

  if (run.status === 'pending' || run.status === 'failed') {
    return (
      <>
        <PageShell className="hr-page">
          {header}
          {run.status === 'pending' ? (
            <LoadingState label="This check is still running" />
          ) : (
            <EmptyState title="This check failed" description={run.error || undefined} action={checkBtn('hr-btn')} />
          )}
        </PageShell>
      </>
    );
  }

  const groups = data.groups || [];
  const curPage = data.page || 1;
  const pageCount = data.pageCount || 0;
  const pageSize = data.pageSize || PAGE_SIZE;
  const filtered = data.filteredGroups ?? groups.length;
  const from = groups.length ? (curPage - 1) * pageSize + 1 : 0;
  const to = groups.length ? from + groups.length - 1 : 0;
  const libraryReachable = run.libraryReachable !== false;

  const pager = where => (pageCount > 1 ? (
    <div className={`hr-pager${where === 'bottom' ? ' bottom' : ''}`}>
      <button type="button" className="hr-ibtn" disabled={curPage <= 1} title="Previous page" aria-label="Previous page" onClick={() => goPage(curPage - 1)}>
        <ChevronLeftIcon />
      </button>
      {`Page ${curPage.toLocaleString()} of ${pageCount.toLocaleString()}`}
      <button type="button" className="hr-ibtn" disabled={curPage >= pageCount} title="Next page" aria-label="Next page" onClick={() => goPage(curPage + 1)}>
        <ChevronRightIcon />
      </button>
    </div>
  ) : null);

  return (
    <>
      <PageShell className="hr-page">
        {header}

        {isCompare && (
          <p className="hr-infoline">
            <InfoOutlinedIcon />
            {`Only ${source.name}'s files can be removed here. ${target?.name}'s files are shown for reference and are never touched.`}
          </p>
        )}

        {!libraryReachable && (
          <div className="hr-banner bad" role="alert">
            <WarningAmberIcon />
            <div className="hr-grow">The library folder cannot be reached. Nothing can be removed until it is back.</div>
          </div>
        )}

        {skipBanner && (
          <div className="hr-banner" role="status">
            <WarningAmberIcon />
            <div className="hr-grow">
              <b>{`${plural(skipBanner.length, 'file was', 'files were')} not moved and ${skipBanner.length === 1 ? 'stays' : 'stay'} in review.`}</b>
              <ul>
                {skipBanner.slice(0, 50).map((s, i) => (
                  <li key={`${s.itemId}-${i}`}><b>{s.name}</b>{s.message ? `: ${s.message}` : ''}</li>
                ))}
                {skipBanner.length > 50 && <li>{`and ${(skipBanner.length - 50).toLocaleString()} more`}</li>}
              </ul>
            </div>
            <button type="button" className="hr-ibtn" title="Dismiss" aria-label="Dismiss" onClick={() => setSkipBanner(null)}>
              <CloseIcon />
            </button>
          </div>
        )}

        {oldRemoved && (
          <div className="hr-banner" role="status">
            <WarningAmberIcon />
            <div className="hr-grow">
              <b>{`${plural(oldRemoved.length, 'file')} from the old Recently removed could not go to a trash folder: ${oldRemoved.length === 1 ? 'its' : 'their'} performer folder is gone.`}</b>
              {' They are still here and are deleted 30 days after they were removed. To keep one, move it back by hand before then.'}
              <ul>
                {oldRemoved.slice(0, 50).map(o => <li key={o.id}>{o.storedPath}</li>)}
                {oldRemoved.length > 50 && <li>{`and ${(oldRemoved.length - 50).toLocaleString()} more`}</li>}
              </ul>
            </div>
            <button type="button" className="hr-ibtn" title="Dismiss" aria-label="Dismiss" onClick={() => setOldRemoved(null)}>
              <CloseIcon />
            </button>
          </div>
        )}

        {allResolved ? (
          <EmptyState
            title={run.removedCount > 0 ? 'No duplicates left' : 'No duplicates in this check'}
            description={run.removedCount > 0
              ? `All groups are resolved. ${plural(run.removedCount, 'file was', 'files were')} removed.`
              : undefined}
            action={(
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {checkBtn('hr-btn outlined')}
                <button type="button" className="hr-btn" onClick={toManagement}>
                  <ArrowBackIcon />Back to Performer Management
                </button>
              </div>
            )}
          />
        ) : (
          <>
            <div className="hr-stats">
              <div className="hr-stat">
                <b>{(totals.groups || 0).toLocaleString()}</b>
                <span>Groups</span>
                <em>{`${groups.length.toLocaleString()} on this page`}</em>
              </div>
              <div className="hr-stat accent">
                <b>{(selection.count || 0).toLocaleString()} <small>{`of ${(totals.removable || 0).toLocaleString()}`}</small></b>
                <span>Files to remove</span>
                <em>keepers not counted</em>
              </div>
              <div className="hr-stat bad">
                <b>{(totals.exact || 0).toLocaleString()}</b>
                <span>Exact copies</span>
                <em>ticked by default</em>
              </div>
              <div className="hr-stat warn">
                <b>{(totals.similar || 0).toLocaleString()}</b>
                <span>Similar</span>
                <em>not ticked by default</em>
              </div>
              <div className="hr-stat space">
                <b>{formatBytes(selection.bytes || 0)}</b>
                <span>Space to free</span>
                <em>with the current selection</em>
              </div>
            </div>

            {totals.groups > 0 && (
              <>
                <FilterRow filters={filters} matchCount={filtered} onChange={changeFilters} />
                <div ref={listTopRef} className="hr-anchor" />
                <Section
                  title="To review"
                  description={<span className="hr-num">{`${from.toLocaleString()} to ${to.toLocaleString()} of ${plural(filtered, 'group')}`}</span>}
                  actions={pager('top')}
                >
                  <div className={`hr-list${refreshing ? ' hr-refreshing' : ''}`} aria-busy={refreshing || undefined}>
                    {groups.length === 0 ? (
                      <EmptyState
                        title="No groups match these filters"
                        action={<button type="button" className="hr-btn outlined" onClick={resetFilters}>Show all</button>}
                      />
                    ) : (
                      <div className="hr-groups">
                        {groups.map(g => (
                          <GroupCard
                            key={g.key}
                            group={g}
                            ctx={ctx}
                            busy={busyKeys.has(g.key)}
                            skipped={skippedFor(g)}
                            onToggle={onToggle}
                            onMakeKeeper={onMakeKeeper}
                            onPreview={onPreview}
                            onKeepAll={onKeepAll}
                          />
                        ))}
                      </div>
                    )}
                    {pager('bottom')}
                  </div>
                </Section>
              </>
            )}

            {totals.orphanGroups > 0 && (
              <OrphanSection
                count={totals.orphanGroups}
                open={orphansOpen}
                onOpenChange={setOrphansOpen}
                orphans={orphans}
                ctx={ctx}
                busyKeys={busyKeys}
                onToggle={onToggle}
                onDismiss={onDismiss}
                onPreview={onPreview}
              />
            )}
          </>
        )}
      </PageShell>

      {!allResolved && (
        <SelectionBar
          selection={selection}
          offScreen={offScreen}
          waiting={waitingMembers.length}
          showCount={selectShownIds.length}
          libraryReachable={libraryReachable}
          onClear={clearSelection}
          onSelectShown={selectShown}
          onRemove={() => setRemoveOpen(true)}
        />
      )}

      <PreviewDialog
        open={!!preview}
        groups={preview?.section === 'orphans' ? orphans.groups : groups}
        target={preview}
        ctx={ctx}
        onClose={() => setPreview(null)}
        onNavigate={onPreviewNavigate}
        onToggle={onToggle}
        onMakeKeeper={onMakeKeeper}
      />

      <RemoveDialog
        open={removeOpen}
        runId={runId}
        onScreenIds={onScreenIds}
        waitingIds={waitingIds}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={confirmRemove}
      />
    </>
  );
}
