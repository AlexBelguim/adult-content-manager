import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Snackbar, useMediaQuery } from '@mui/material';
import { DEFAULT_SHORTCUTS, loadShortcuts } from '../utils/settings';
import { MediaStage, ScenesPanel, TagPanel, isVideoItem, useScenes } from './player';
import DecisionBar from './filter/DecisionBar';
import FileCard from './filter/FileCard';
import FilterSidebar from './filter/FilterSidebar';
import FunscriptCard from './filter/FunscriptCard';
import Icon from './filter/Icon';
import QueueRail from './filter/QueueRail';
import useSwipeStage from './filter/useSwipeStage';
import { ACTION_LABEL, TABS, TAB_LABEL, errorMessage, matchesKey, mediaItemFor, tabProgress } from './filter/filterUtils';
import './filter/filter.css';

const FLASH_MS = 450;
const PRELOAD = 5;
const HISTORY_MAX = 20;
const ZERO_DELTA = { pics: { done: 0, total: 0 }, vids: { done: 0, total: 0 }, funscript_vids: { done: 0, total: 0 } };
const ZERO_TALLY = { pics: { keep: 0, delete: 0 }, vids: { keep: 0, delete: 0 }, funscript_vids: { keep: 0, delete: 0 } };
const TYPING = /^(INPUT|SELECT|TEXTAREA)$/;

/** HandyIntegration.uploadAndSetScript writes progress into a button; hand it an inert one. */
const progressSink = () => ({ textContent: '', disabled: false, setAttribute() {}, removeAttribute() {} });

const bump = (obj, tab, key, by) => ({ ...obj, [tab]: { ...obj[tab], [key]: obj[tab][key] + by } });

const listOf = (data) => (Array.isArray(data) ? data : data?.files || []);

/**
 * Keep / delete / move for one performer, on the shared player
 * (docs/redesign/SPEC.md, filter-redesign-mockup.html). Mounted by FilterView.
 */
function PerformerFilterView({ performer, onBack, onNext, handyIntegration, handyConnected, initialTab }) {
  const [currentTab, setCurrentTab] = useState(initialTab || 'pics');
  const [files, setFiles] = useState([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('performerFilterSortBy') || 'name');
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('performerFilterSortOrder') || 'asc');
  const [hideKeptFiles, setHideKeptFiles] = useState(true);
  const [mlEnabled, setMlEnabled] = useState(false); // the prediction side was never written: shows "(no model)"
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS);
  const [stats, setStats] = useState(null);
  const [delta, setDelta] = useState(ZERO_DELTA); // decisions the (cached) stats don't show yet
  const [tally, setTally] = useState(ZERO_TALLY); // this session's kept / deleted per tab
  const [history, setHistory] = useState([]); // newest first
  const [undoBusy, setUndoBusy] = useState(false);
  const [fsBusy, setFsBusy] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [lastScriptPrompt, setLastScriptPrompt] = useState(null); // { folderName, path }
  const [backBusy, setBackBusy] = useState(false);
  const [snack, setSnack] = useState(null); // { severity, msg }
  const [flash, setFlash] = useState(null); // { kind, n }
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [scenesOpen, setScenesOpen] = useState(false);
  const [loop, setLoop] = useState(false);
  const [mediaInfo, setMediaInfo] = useState(null);

  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const stageApi = useRef(null);
  const abortRef = useRef(null);
  const loadRef = useRef({ offset: 0 }); // where the background loader is in the server's list
  const inflight = useRef(new Set());
  const serverStats = useRef(null);
  const flashTimer = useRef(null);
  const historyId = useRef(0);

  const phone = useMediaQuery('(max-width:760px)');
  const file = files[currentIndex] || null;
  const item = useMemo(() => (file ? mediaItemFor(file, currentTab) : null), [file, currentTab]);
  const isVideo = isVideoItem(item);
  const scenes = useScenes(isVideo ? item.path : null);
  const info = mediaInfo && item && mediaInfo.path === item.path ? mediaInfo : null;

  const notify = useCallback((severity, msg) => setSnack({ severity, msg }), []);

  /* ── the sticky app bar above us ── */
  useEffect(() => {
    const root = rootRef.current;
    const appBar = document.querySelector('.MuiAppBar-root');
    if (!root || !appBar) return undefined;
    const update = () => {
      const position = window.getComputedStyle(appBar).position;
      const pinned = position === 'sticky' || position === 'fixed';
      root.style.setProperty('--fv-top', pinned ? `${Math.round(appBar.getBoundingClientRect().height)}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(appBar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (initialTab) setCurrentTab(initialTab);
  }, [initialTab]);

  // FilterView reuses this instance for the next performer: session state starts over.
  useEffect(() => {
    setHistory([]);
    setTally(ZERO_TALLY);
    setDelta(ZERO_DELTA);
    setStats(null);
    serverStats.current = null;
    setMediaInfo(null);
  }, [performer.id]);

  useEffect(() => localStorage.setItem('performerFilterSortBy', sortBy), [sortBy]);
  useEffect(() => localStorage.setItem('performerFilterSortOrder', sortOrder), [sortOrder]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  /* ── shortcuts: once on mount and when the tab becomes visible again ── */
  useEffect(() => {
    const load = () => loadShortcuts().then(setShortcuts);
    load();
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  /* ── files: the first one fast, the rest in the background ── */
  const filesUrl = useCallback(
    (extra = '') => `/api/filter/files/${performer.id}?type=${currentTab}&sortBy=${sortBy}&sortOrder=${sortOrder}&hideKept=${hideKeptFiles}${extra}`,
    [performer.id, currentTab, sortBy, sortOrder, hideKeptFiles]
  );

  useEffect(() => {
    if (!performer?.id) return undefined;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const aborted = () => controller.signal.aborted;

    setLoadingFiles(true);
    setLoadingMore(false);
    setFiles([]);
    setTotalFiles(0);
    setCurrentIndex(0);
    setLastScriptPrompt(null);
    loadRef.current = { offset: 0 };

    const page = async (limit, offset) => {
      const res = await fetch(filesUrl(`&limit=${limit}&offset=${offset}`), { signal: controller.signal });
      if (!res.ok) throw new Error(await errorMessage(res));
      return res.json();
    };

    const run = async () => {
      try {
        const first = await page(1, 0);
        if (aborted()) return;
        const paginated = first && first.files && first.total !== undefined;
        const list = paginated ? first.files : listOf(first);
        let more = paginated ? !!first.hasMore : false;
        setFiles(list);
        setTotalFiles(paginated ? first.total : list.length);
        setLoadingFiles(false);
        loadRef.current.offset = list.length;
        let loaded = list.length;
        if (more) setLoadingMore(true);
        // One at a time for the first five and for videos; pictures then come 40 a go.
        while (more && !aborted()) {
          await new Promise((r) => setTimeout(r, 10));
          if (aborted()) return;
          const batch = loaded >= 5 && currentTab === 'pics' ? 40 : 1;
          const data = await page(batch, loadRef.current.offset);
          if (aborted()) return;
          const got = data.files || [];
          if (got.length > 0) {
            setFiles((prev) => {
              const seen = new Set(prev.map((f) => f.path));
              return [...prev, ...got.filter((f) => !seen.has(f.path))];
            });
          }
          loaded += got.length;
          loadRef.current.offset += batch;
          if (data.total !== undefined) setTotalFiles(data.total);
          more = !!data.hasMore && got.length > 0;
        }
        if (!aborted()) setLoadingMore(false);
      } catch (err) {
        if (err.name === 'AbortError' || aborted()) return;
        setLoadingFiles(false);
        setLoadingMore(false);
        notify('error', `Could not load files: ${err.message}`);
      }
    };
    run();
    return () => controller.abort();
  }, [performer.id, currentTab, filesUrl, notify]);

  /** Full reload of the current tab (after undo / funscript changes), as the old view did. */
  const reloadAll = useCallback(async () => {
    abortRef.current?.abort();
    const res = await fetch(filesUrl());
    if (!res.ok) throw new Error(await errorMessage(res));
    const list = listOf(await res.json());
    setFiles(list);
    setTotalFiles(list.length);
    setLoadingMore(false);
    return list;
  }, [filesUrl]);

  /* ── progress ── */
  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/filter/stats/${performer.id}`);
      if (!res.ok) return;
      const fresh = await res.json();
      const prev = serverStats.current;
      serverStats.current = fresh;
      setStats(fresh);
      // The backend caches stats for a minute. When the numbers move, the
      // server has caught up with this session's decisions: drop the local delta.
      if (prev && JSON.stringify(prev) !== JSON.stringify(fresh)) setDelta(ZERO_DELTA);
    } catch (e) {
      // progress is decoration; the next action refreshes it again
    }
  }, [performer.id]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats, currentTab]);

  const refreshStatsSoon = useCallback(() => setTimeout(refreshStats, 100), [refreshStats]);

  const progress = useMemo(() => Object.fromEntries(TABS.map((t) => [t, tabProgress(stats, delta, t)])), [stats, delta]);
  const nextTab = useMemo(() => {
    const from = TABS.indexOf(currentTab);
    return TABS.map((_, i) => TABS[(from + 1 + i) % TABS.length]).find((t) => t !== currentTab && progress[t].left > 0) || null;
  }, [currentTab, progress]);

  /* ── preload what comes next so a decision never shows an empty frame ── */
  useEffect(() => {
    files.slice(currentIndex + 1, currentIndex + 1 + PRELOAD).forEach((f) => {
      const it = mediaItemFor(f, currentTab);
      new Image().src = it.thumbnail;
      if (currentTab === 'pics') new Image().src = it.url;
    });
  }, [files, currentIndex, currentTab]);

  /* ── navigation ── */
  const switchTab = useCallback((tab) => {
    if (tab === currentTab) return;
    if (tab !== 'funscript_vids' && sortBy === 'funscript_count') setSortBy('name');
    setCurrentTab(tab);
    setSheetOpen(false);
  }, [currentTab, sortBy]);

  const goTo = useCallback((n) => {
    if (n >= 0 && n < files.length) setCurrentIndex(n);
  }, [files.length]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex]);
  const goNext = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex]);

  /* ── decisions ── */
  const getStage = useCallback(() => stageApi.current?.root?.querySelector('.pl-stage') || null, []);
  const decideRef = useRef(null);
  const onSwipe = useCallback((action, fromX) => decideRef.current?.(action, fromX), []);
  const { stageProps, overlay: swipeStamps, flyOut } = useSwipeStage({ getStage, mouse: phone, onDecide: onSwipe });

  const decide = useCallback(async (action, fromX = 0) => {
    const target = files[currentIndex];
    if (!target || inflight.current.has(target.path)) return;
    if (action === 'move_to_funscript' && currentTab !== 'vids') return;
    inflight.current.add(target.path);

    const tab = currentTab;
    const index = currentIndex;
    const removes = action === 'delete' || hideKeptFiles;
    const entry = { id: ++historyId.current, file: target, action, tab };

    // Applied at once: the next file is on screen before the request goes out.
    if (removes) {
      setFiles((prev) => prev.filter((f) => f.path !== target.path));
      setCurrentIndex(Math.min(index, Math.max(0, files.length - 2)));
    } else {
      setFiles((prev) => prev.map((f) => (f.path === target.path ? { ...f, filtered: action } : f)));
      if (index < files.length - 1) setCurrentIndex(index + 1);
    }
    setHistory((h) => [entry, ...h].slice(0, HISTORY_MAX));
    setDelta((d) => {
      let next = bump(d, tab, 'done', 1);
      if (action === 'move_to_funscript') next = bump(next, 'vids', 'total', -1);
      return next;
    });
    if (action !== 'move_to_funscript') setTally((t) => bump(t, tab, action, 1));
    setFlash({ kind: action, n: entry.id });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    const media = mediaItemFor(target, tab);
    flyOut(action, tab === 'pics' ? media.url : media.thumbnail, fromX);

    try {
      const res = await fetch('/api/filter/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performerId: performer.id, filePath: target.path, action })
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const result = await res.json();
      // The server's list just lost this file: keep the background loader aligned.
      if (removes) loadRef.current.offset = Math.max(0, loadRef.current.offset - 1);
      // Moving to a funscript folder hands the video to funpipe for script
      // generation — report whether that actually took.
      if (action === 'move_to_funscript' && result.funpipe) {
        const fp = result.funpipe;
        if (fp.queued) notify('success', 'Queued with funpipe for funscript generation');
        else if (fp.skipped) notify('info', `Not queued — ${fp.skipped}`);
        else if (fp.error) notify('warning', `Moved, but funpipe didn't take it: ${fp.error}`);
      }
      refreshStatsSoon();
    } catch (err) {
      // Put the file back where it was.
      notify('error', `${ACTION_LABEL[action]} failed: ${err.message}`);
      setHistory((h) => h.filter((x) => x.id !== entry.id));
      setDelta((d) => {
        let next = bump(d, tab, 'done', -1);
        if (action === 'move_to_funscript') next = bump(next, 'vids', 'total', 1);
        return next;
      });
      if (action !== 'move_to_funscript') setTally((t) => bump(t, tab, action, -1));
      if (removes) {
        setFiles((prev) => {
          if (prev.some((f) => f.path === target.path)) return prev;
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, target);
          return next;
        });
        setCurrentIndex(index);
      } else {
        setFiles((prev) => prev.map((f) => (f.path === target.path ? { ...f, filtered: target.filtered } : f)));
      }
    } finally {
      inflight.current.delete(target.path);
    }
  }, [files, currentIndex, currentTab, hideKeptFiles, performer.id, flyOut, notify, refreshStatsSoon]);
  decideRef.current = decide;

  const undo = useCallback(async () => {
    if (undoBusy) return;
    setUndoBusy(true);
    try {
      const res = await fetch('/api/filter/undo', { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res));
      const entry = history[0] || null;
      if (entry) {
        setHistory((h) => h.slice(1));
        setDelta((d) => bump(d, entry.tab, 'done', -1));
        if (entry.action !== 'move_to_funscript') setTally((t) => bump(t, entry.tab, entry.action, -1));
      }
      if (entry && entry.tab !== currentTab) {
        switchTab(entry.tab);
      } else {
        const list = await reloadAll();
        const i = entry ? list.findIndex((f) => f.path === entry.file.path) : -1;
        setCurrentIndex(i >= 0 ? i : Math.max(0, Math.min(currentIndex - 1, list.length - 1)));
      }
      refreshStatsSoon();
    } catch (err) {
      notify('error', `Undo failed: ${err.message}`);
    } finally {
      setUndoBusy(false);
    }
  }, [undoBusy, history, currentTab, currentIndex, switchTab, reloadAll, refreshStatsSoon, notify]);

  /* ── funscript tab ── */
  const funscriptAction = useCallback(async (action, script, options) => {
    const target = files[currentIndex];
    if (!target || currentTab !== 'funscript_vids' || fsBusy) return;
    setFsBusy(true);
    try {
      const res = await fetch('/api/filter/funscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performerId: performer.id, videoFolder: target.folderName, action, funscriptFile: script, ...(options ? { options } : {}) })
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const result = await res.json();
      if (result.lastFunscript) {
        // The folder now holds only the video; a reload would drop it from the
        // list before the user has said what to do with it.
        setFiles((prev) => prev.map((f) => (f.path === target.path
          ? { ...f, funscripts: (f.funscripts || []).filter((s) => s !== script), funscriptCount: Math.max(0, (f.funscriptCount || 1) - 1) }
          : f)));
        setLastScriptPrompt({ folderName: target.folderName, path: target.path });
      } else {
        const list = await reloadAll();
        const i = list.findIndex((f) => f.path === target.path);
        setCurrentIndex(i >= 0 ? i : Math.max(0, Math.min(currentIndex, list.length - 1)));
      }
      if (result.message) notify('success', result.message);
    } catch (err) {
      notify('error', `Funscript ${action} failed: ${err.message}`);
    } finally {
      setFsBusy(false);
    }
  }, [files, currentIndex, currentTab, fsBusy, performer.id, reloadAll, notify]);

  const videoAfterFunscript = useCallback(async (keepVideo) => {
    if (!lastScriptPrompt || fsBusy) return;
    setFsBusy(true);
    try {
      const res = await fetch('/api/filter/video-after-funscript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performerId: performer.id, videoFolder: lastScriptPrompt.folderName, keepVideo })
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const result = await res.json();
      setLastScriptPrompt(null);
      notify('success', result.message || (keepVideo ? 'Video moved to Videos' : 'Video deleted'));
      setDelta((d) => {
        let next = bump(d, 'funscript_vids', 'total', -1);
        if (keepVideo) next = bump(next, 'vids', 'total', 1);
        return next;
      });
      const list = await reloadAll();
      setCurrentIndex(Math.max(0, Math.min(currentIndex, list.length - 1)));
      refreshStatsSoon();
    } catch (err) {
      notify('error', `Could not ${keepVideo ? 'keep' : 'delete'} the video: ${err.message}`);
    } finally {
      setFsBusy(false);
    }
  }, [lastScriptPrompt, fsBusy, performer.id, currentIndex, reloadAll, refreshStatsSoon, notify]);

  const uploadToHandy = useCallback(async (script) => {
    const target = files[currentIndex];
    if (!target || currentTab !== 'funscript_vids' || uploading) return;
    if (!handyIntegration || !handyConnected) {
      notify('warning', 'Handy not connected. Connect your Handy device first.');
      return;
    }
    setUploading(script);
    try {
      const sep = target.path.includes('\\') ? '\\' : '/';
      const folderPath = target.path.substring(0, target.path.lastIndexOf(sep));
      const res = await fetch(`/api/files/raw?path=${encodeURIComponent(`${folderPath}${sep}${script}`)}`);
      if (!res.ok) throw new Error(`Failed to load funscript: ${res.status}`);
      const content = await res.json();
      const video = videoRef.current;
      await handyIntegration.uploadAndSetScript(video, { content, fileName: script }, progressSink());
      if (video) video.style.minHeight = ''; // uploadAndSetScript pins a pixel min-height; the stage sizes it
      notify('success', `Funscript uploaded to Handy: ${script}`);
    } catch (err) {
      notify('error', `Error uploading funscript to Handy: ${err.message}`);
    } finally {
      setUploading(null);
    }
  }, [files, currentIndex, currentTab, uploading, handyIntegration, handyConnected, notify]);

  /* ── leaving ── */
  const handleBack = useCallback(async () => {
    if (backBusy) return;
    setBackBusy(true);
    abortRef.current?.abort();
    try {
      // Fire and forget: it is a server task, so the toolbar indicator and the
      // Jobs page show its progress and its "Deleted N files" result.
      const cleanupResponse = await fetch(`/api/performers/${performer.id}/cleanup-trash-async`, { method: 'POST' });
      if (!cleanupResponse.ok) throw new Error(`HTTP ${cleanupResponse.status}`);
    } catch (error) {
      notify('warning', `Trash cleanup could not be started: ${error.message}`);
    }
    onBack();
  }, [backBusy, performer.id, onBack, notify]);

  const handleNextPerformer = useCallback(async () => {
    try {
      await fetch(`/api/performers/${performer.id}/cleanup-trash`, { method: 'POST' });
      onNext(performer.id);
    } catch (error) {
      onBack();
    }
  }, [performer.id, onNext, onBack]);

  /* ── keys ── */
  const keyActions = useRef({});
  keyActions.current = {
    decide,
    undo,
    goPrev,
    goNext,
    canMove: !!file && currentTab === 'vids',
    togglePlay: () => stageApi.current?.togglePlay(),
    closeOverlays: () => {
      if (sheetOpen) {
        setSheetOpen(false);
        return true;
      }
      return false;
    }
  };
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if ((t && (TYPING.test(t.tagName) || t.isContentEditable)) || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = shortcutsRef.current;
      const a = keyActions.current;
      if (matchesKey(e, s.keep)) a.decide('keep');
      else if (matchesKey(e, s.delete)) a.decide('delete');
      else if (matchesKey(e, s.move_to_funscript)) {
        if (!a.canMove) return;
        a.decide('move_to_funscript');
      } else if (matchesKey(e, s.undo)) a.undo();
      else if (matchesKey(e, s.prev)) a.goPrev();
      else if (matchesKey(e, s.next)) a.goNext();
      else if (e.key === ' ') {
        if (t && t.tagName === 'BUTTON') t.blur(); // a focused button would also "click"
        a.togglePlay();
      } else if (e.key === 'Escape') {
        if (!a.closeOverlays()) return;
      } else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ── render ── */
  const tabLabel = TAB_LABEL[currentTab];
  const p = progress[currentTab];
  const counter = file
    ? `${currentIndex + 1} / ${files.length}${totalFiles > files.length ? ` (${totalFiles} total)` : ''}${loadingMore ? ' · loading…' : ''}`
    : '';

  let stateNode = null;
  if (!file) {
    if (loadingFiles) {
      stateNode = <div className="fv-state"><p className="fv-sub">Loading the first file…</p></div>;
    } else {
      const t = tally[currentTab];
      let heading = `No ${tabLabel.toLowerCase()} for this performer`;
      if (p.total > 0) {
        heading = `${tabLabel} done — ${t.keep || t.delete ? `${t.keep} kept, ${t.delete} deleted` : `all ${p.total} files filtered`}`;
      }
      stateNode = (
        <div className="fv-state">
          <div>
            <h2>{heading}</h2>
            {hideKeptFiles && p.total > 0 && <p className="fv-sub">Turn off "Hide kept files" to review what you kept.</p>}
            <div className="fv-row">
              {nextTab && (
                <button type="button" className="pl-btn" onClick={() => switchTab(nextTab)}>
                  Continue with {TAB_LABEL[nextTab]} <Icon name="right" size={14} />
                </button>
              )}
              <button type="button" className="pl-btn fv-go" onClick={handleNextPerformer}>
                Next performer <Icon name="right" size={14} />
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="fv" ref={rootRef}>
      <FilterSidebar
        performer={performer}
        currentTab={currentTab}
        progress={progress}
        onTab={switchTab}
        onBack={handleBack}
        backBusy={backBusy}
        onNextPerformer={handleNextPerformer}
        sortBy={sortBy}
        sortOrder={sortOrder}
        hideKept={hideKeptFiles}
        mlEnabled={mlEnabled}
        onSortBy={setSortBy}
        onSortOrder={setSortOrder}
        onHideKept={setHideKeptFiles}
        onMlEnabled={setMlEnabled}
        shortcuts={shortcuts}
        sheetOpen={sheetOpen}
        onCloseSheet={() => setSheetOpen(false)}
      >
        {item && (
          <FileCard
            item={item}
            file={file}
            info={info}
            isVideo={isVideo}
            tagsOpen={tagsOpen}
            scenesOpen={scenesOpen}
            onToggleTags={() => setTagsOpen((v) => !v)}
            onToggleScenes={() => setScenesOpen((v) => !v)}
          />
        )}
        {item && tagsOpen && <TagPanel item={item} />}
        {item && isVideo && scenesOpen && <ScenesPanel item={item} scenes={scenes} videoRef={videoRef} />}
        {item && currentTab === 'funscript_vids' && (
          <FunscriptCard
            file={file}
            onAction={funscriptAction}
            onRename={(script, newName) => funscriptAction('rename', script, { newName })}
            onUpload={uploadToHandy}
            uploading={uploading}
            busy={fsBusy}
            lastPrompt={lastScriptPrompt && lastScriptPrompt.path === file.path ? lastScriptPrompt : null}
            onVideoAfter={videoAfterFunscript}
          />
        )}
      </FilterSidebar>
      {sheetOpen && <button type="button" className="fv-sheet-scrim" aria-label="Close panel" onClick={() => setSheetOpen(false)} />}

      <section className="fv-mid">
        <div className="fv-mtop">
          <button type="button" className="pl-ib" onClick={handleBack} disabled={backBusy} aria-label="Back to performers"><Icon name="back" size={18} /></button>
          <span className="fv-grow">
            {file ? `${currentIndex + 1} / ${files.length}` : loadingFiles ? 'Loading…' : 'Done'} <span className="fv-sub">({totalFiles || files.length} total)</span>
          </span>
          <span className="fv-chip">{p.pct}%</span>
          <button type="button" className="pl-ib" onClick={() => setSheetOpen(true)} aria-label="Progress, file details and options"><Icon name="menu" size={18} /></button>
        </div>
        <MediaStage
          className="fv-sw"
          item={item}
          scenes={scenes}
          videoRef={videoRef}
          apiRef={stageApi}
          autoPlay
          muted
          loop={loop}
          onLoopChange={setLoop}
          onMediaInfo={setMediaInfo}
          counterText={counter}
          stageProps={stageProps}
          overlay={(
            <>
              {swipeStamps}
              {flash && <div key={flash.n} className={`fv-flash ${flash.kind}`} aria-hidden="true" />}
              {stateNode}
            </>
          )}
          actionBar={(
            <DecisionBar
              shortcuts={shortcuts}
              hasItem={!!file}
              canPrev={currentIndex > 0}
              canNext={currentIndex < files.length - 1}
              canMove={!!file && currentTab === 'vids'}
              canUndo={!undoBusy}
              onPrev={goPrev}
              onNext={goNext}
              onDecide={decide}
              onUndo={undo}
            />
          )}
        />
      </section>

      <QueueRail
        history={history}
        onUndo={undo}
        undoBusy={undoBusy}
        files={files}
        currentTab={currentTab}
        currentIndex={currentIndex}
        onPick={goTo}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {snack ? (
          <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>
            {snack.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </div>
  );
}

export default PerformerFilterView;
