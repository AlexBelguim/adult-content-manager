import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useBack } from '../nav';
import { errorText, plural, useNotify, useToastLift } from '../components/ui';
import { loadPlayerContext, mediaItemFromPath, playerUrl, updatePlayerContext } from '../utils/playerContext';
import {
  FileInfoPanel,
  FunscriptPanel,
  MediaStage,
  RatingPanel,
  ScenesPanel,
  ShortcutsDialog,
  TagPanel,
  fileNameOf,
  fmtRating,
  fmtTime,
  isVideoItem,
  useFunscripts,
  usePlayerKeys,
  useScenes
} from '../components/player';
import useHandy, { useHandyLoaded } from '../components/player/useHandy';
import { restoreFromTrash } from '../components/player/trashApi';
import SceneStrip, { SceneChips } from '../components/player/SceneStrip';
import ScenesCompact from '../components/player/ScenesCompact';
import { useVideoLabels } from '../components/player/videoLabels';
import useVideoSource, { startsDirect } from '../components/player/useVideoSource';
import './PlayerPage.css';

const AUTONEXT_KEY = 'player.autoplayNext';
const SWIPE_MIN = 70;
const ERROR_NEXT_MS = 3000;
// One query for the phone layout and the swipe, so they always agree. The same value is in PlayerPage.css.
const PLAYER_PHONE_QUERY = '(max-width: 899.98px), (max-height: 500px)';
const TOAST_LIFT = 'calc(108px + env(safe-area-inset-bottom, 0px))';
const EMPTY_SOURCE = { title: '', backUrl: '', items: [] };

// Stroked 24px icons, drawn like MediaStage's.
const PATHS = {
  rate: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  tags: 'M3.5 12.5V4h8.5l8.5 8.5-8 8zM8 8h.01',
  fs: 'M2.5 15l3.5-6 3.5 8 4-11 3.5 9 2-3h2.5',
  scenes: 'M4 5h16v14H4zM4 9h16M8.5 5L7 9M13.5 5L12 9M18.5 5L17 9',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5.5M12 7.5h.01',
  queue: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  autoNext: 'M5 5.5v13l9.5-6.5zM18.5 5.5v13',
  keys: 'M3 6.5h18v11H3zM7 10.5h.01M11 10.5h.01M15 10.5h.01M7.5 14h9',
  up: 'M5 15l7-7 7 7',
  down: 'M5 9l7 7 7-7'
};

const Svg = ({ name, size = 22 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);

const RAIL = [
  { id: 'rate', label: 'Score' },
  { id: 'tags', label: 'Tags' },
  { id: 'fs', label: 'Funscripts' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'info', label: 'File info' },
  { id: 'queue', label: 'Up next' }
];
const IMAGE_RAIL = ['tags', 'info', 'queue'];

function readAutoNext() {
  try {
    return localStorage.getItem(AUTONEXT_KEY) !== '0';
  } catch (e) {
    return true;
  }
}

const matchesPhone = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(PLAYER_PHONE_QUERY).matches;

/** True while the player's phone layout is shown (narrow, or a short landscape phone). Reactive. */
function usePlayerPhone() {
  const [phone, setPhone] = useState(matchesPhone);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(PLAYER_PHONE_QUERY);
    const onChange = () => setPhone(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/** "Up next": tall thumbnails, the current one outlined. Facts as chips on the pictures. */
const Queue = React.memo(function Queue({ items, index, onPick }) {
  const boxRef = useRef(null);

  // Centre the current thumbnail inside the list without scrolling the page.
  useEffect(() => {
    const box = boxRef.current;
    const cur = box?.querySelector('.is-cur');
    if (!box || !cur || box.scrollHeight <= box.clientHeight) return;
    const a = cur.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollTop += a.top - b.top - box.clientHeight / 2 + a.height / 2;
  }, [index, items]);

  return (
    <div className="pp-qlist" ref={boxRef}>
      <div className="pp-qgrid">
        {items.map((it, i) => {
          const video = isVideoItem(it);
          return (
            <button
              type="button"
              key={it.path}
              className={`pp-th${i === index ? ' is-cur' : ''}`}
              title={it.name}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => onPick(i)}
            >
              {it.thumbnail && (
                <img loading="lazy" alt="" src={it.thumbnail} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              )}
              {video && <em>★ {fmtRating(it.videoRating)}</em>}
              {video && it.duration ? <span>{fmtTime(it.duration)}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/**
 * /player?ctx=<id>&i=<index>&path=<file>  or  /player?path=<file>
 * Direction 3 of player-redesign-mockups.html: tools left, media centre, queue right. In the phone layout
 * (PLAYER_PHONE_QUERY) the media fills the screen, the tools and the queue are bottom sheets.
 * App still passes the old handy props; the player talks to window.HandyControl through useHandy instead.
 */
export default function PlayerPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [params] = useSearchParams();
  const ctxId = params.get('ctx');
  const pathParam = params.get('path');
  const iParam = params.get('i');

  const ctx = useMemo(() => (ctxId ? loadPlayerContext(ctxId) : null), [ctxId]);
  // Without a context, the path alone plays one file. With one, the path only picks the item.
  const singlePath = ctx ? null : pathParam;
  const source = useMemo(() => {
    if (ctx) return ctx;
    if (singlePath) return { title: '', backUrl: '', items: [mediaItemFromPath(singlePath)] };
    return EMPTY_SOURCE;
  }, [ctx, singlePath]);

  // Local copy: items get patched (ratings, tags), removed (delete) and put back (Undo).
  const [items, setItems] = useState(source.items);
  useEffect(() => setItems(source.items), [source]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const pathIndex = ctx && pathParam ? items.findIndex((it) => it.path === pathParam) : -1;
  const index = pathIndex >= 0
    ? pathIndex
    : Math.min(Math.max(0, parseInt(iParam, 10) || 0), Math.max(0, items.length - 1));
  const item = items[index] || null;
  const isVideo = isVideoItem(item);
  const path = item?.path;
  const pathRef = useRef(path);
  pathRef.current = path;

  // The canonical URL names the context, the index and the file.
  useEffect(() => {
    if (ctx) {
      if (item && (iParam !== String(index) || pathParam !== item.path)) {
        navigate(playerUrl(ctxId, index, item.path), { replace: true });
      }
    } else if (pathParam && ctxId) {
      navigate(`/player?path=${encodeURIComponent(pathParam)}`, { replace: true });
    }
  }, [ctx, ctxId, item, index, iParam, pathParam, navigate]);

  const isPhone = usePlayerPhone();
  const videoRef = useRef(null);
  const [videoEl, setVideoEl] = useState(null);
  const attachVideo = useCallback((el) => {
    videoRef.current = el;
    setVideoEl(el);
  }, []);
  const stageApi = useRef(null);
  const [loop, setLoop] = useState(false);
  const [autoNext, setAutoNext] = useState(readAutoNext);
  // The intent to play: carried from item to item (across pictures), so the next video plays
  // when the last one was playing as it was left. With Autoplay on, the first video plays too.
  const intentRef = useRef(autoNext);
  const [sheet, setSheet] = useState(null); // null | 'tools' | 'queue'
  const [helpOpen, setHelpOpen] = useState(false);
  const [mediaInfo, setMediaInfo] = useState(null);
  const [errorNote, setErrorNote] = useState(null); // { path, text }
  const errorTimer = useRef(null);
  const leftRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useToastLift(TOAST_LIFT);

  // Videos the browser cannot play as they are are converted while they play; MediaStage gets no url for a file
  // that waits for the probe (useVideoSource sets the source itself).
  const videoSource = useVideoSource({ videoEl: isVideo ? videoEl : null, item: isVideo ? item : null, loop, playIntentRef: intentRef });
  const stageItem = useMemo(
    () => (isVideo && item && !startsDirect(item.path) ? { ...item, url: undefined } : item),
    [item, isVideo]
  );

  const scenes = useScenes(isVideo ? path : null);
  const labels = useVideoLabels(isVideo ? path : null);
  const scripts = useFunscripts(isVideo ? path : null);
  const handy = useHandy();
  const handyLoaded = useHandyLoaded();
  const handyLive = !!handyLoaded && handy.script.status === 'ready';

  useEffect(() => {
    if (!item?.name) return undefined;
    const previous = document.title;
    document.title = item.name;
    return () => {
      document.title = previous;
    };
  }, [item?.name]);

  useEffect(() => {
    if (!isPhone) setSheet(null);
  }, [isPhone]);

  /* ── navigation ── */
  const goTo = useCallback((n, forcePlay = false) => {
    const list = itemsRef.current;
    if (!ctx || n < 0 || n >= list.length || n === index) return;
    if (isVideo) {
      const v = videoRef.current;
      intentRef.current = forcePlay || (!!v && !v.paused);
    } else if (forcePlay) {
      intentRef.current = true;
    }
    navigate(playerUrl(ctxId, n, list[n].path), { replace: true });
  }, [ctx, ctxId, index, isVideo, navigate]);
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const pickFromQueue = useCallback((n) => {
    goTo(n);
    setSheet((s) => (s === 'queue' ? null : s));
  }, [goTo]);

  // The back rule: pop when the app pushed this entry, else replace with the list's page.
  const goBack = useBack(source.backUrl || '/');

  const onEnded = useCallback(() => {
    if (autoNext && !loop && index + 1 < items.length) goTo(index + 1, true);
  }, [autoNext, loop, index, items.length, goTo]);

  const toggleAutoNext = () => {
    const on = !autoNext;
    setAutoNext(on);
    if (on) {
      intentRef.current = true;
    } else {
      clearTimeout(errorTimer.current);
      setErrorNote(null);
    }
    try {
      localStorage.setItem(AUTONEXT_KEY, on ? '1' : '0');
    } catch (err) {
      // private mode: the toggle still works for this visit
    }
  };

  // A video that fails while the intent to play is on: say so, then move on.
  const heldError = useRef(null); // an error while the probe has not answered: decided when it does
  useEffect(() => () => clearTimeout(errorTimer.current), [path]);
  const moveOnAfterError = (failedPath) => {
    if (!autoNext || !intentRef.current || !isVideo || failedPath !== path || index + 1 >= items.length) return;
    setErrorNote({ path: failedPath, text: 'Next in 3 s' });
    clearTimeout(errorTimer.current);
    const at = index;
    errorTimer.current = setTimeout(() => goToRef.current(at + 1, true), ERROR_NEXT_MS);
  };
  const onMediaError = ({ path: failedPath }) => {
    if (videoSource.handlesError(failedPath)) {
      // the probe has not answered (a conversion makes the error moot), or a failed remux is tried as a transcode
      if (!videoSource.probed) heldError.current = failedPath;
      return;
    }
    moveOnAfterError(failedPath);
  };
  // The probe answered: a conversion drops an error of the early direct load (and a "Next in 3 s" already set);
  // a file that stays direct gets its held error now.
  useEffect(() => {
    if (!isVideo || !videoSource.probed) return;
    if (videoSource.converted) {
      heldError.current = null;
      clearTimeout(errorTimer.current);
      setErrorNote((n) => (n && n.path === path ? null : n));
      return;
    }
    if (heldError.current === path) {
      heldError.current = null;
      moveOnAfterError(path);
    }
    // moveOnAfterError reads the render's values; it runs once per probe answer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, path, videoSource.probed, videoSource.converted]);

  /* ── keeping the list honest ── */
  const commitItems = useCallback((next) => {
    itemsRef.current = next;
    setItems(next);
    if (ctxId && ctx) updatePlayerContext(ctxId, { ...sourceRef.current, items: next });
  }, [ctxId, ctx]);

  // By path: a late answer for an item that is no longer shown still lands on the right one.
  const patchItem = useCallback((p, patch) => {
    if (!p) return;
    const list = itemsRef.current;
    if (!list.some((it) => it.path === p)) return;
    commitItems(list.map((it) => (it.path === p ? { ...it, ...patch } : it)));
  }, [commitItems]);
  const onTagsChange = useCallback((tags, p) => patchItem(p, { tags }), [patchItem]);

  const showAt = useCallback((n, list) => {
    if (ctxId && ctx && mounted.current && list[n]) navigate(playerUrl(ctxId, n, list[n].path), { replace: true });
  }, [ctxId, ctx, navigate]);

  const putBack = useCallback(async (deleted, oldIndex, trashed) => {
    const name = deleted.name || fileNameOf(deleted.path);
    try {
      const { restored, skipped } = await restoreFromTrash(trashed);
      const back = (restored || []).map((r) => (typeof r === 'string' ? r : r?.path));
      if (back.includes(deleted.path)) {
        const rest = itemsRef.current.filter((it) => it.path !== deleted.path);
        const at = Math.min(oldIndex, rest.length);
        const next = [...rest.slice(0, at), deleted, ...rest.slice(at)];
        commitItems(next);
        intentRef.current = false;
        showAt(at, next);
        notify(`Put back: ${name}`);
      }
      if (skipped && skipped.length) {
        const first = skipped[0];
        const more = skipped.length > 1 ? ` and ${skipped.length - 1} more` : '';
        notify({ severity: 'error', message: `Could not put back ${fileNameOf(first.path)}: ${first.reason || 'it did not work'}${more}` });
      }
    } catch (err) {
      notify({ severity: 'error', message: errorText(err) });
    }
  }, [commitItems, showAt, notify]);

  const onDeleted = useCallback(({ item: deleted, trashed = [], failed = [] }) => {
    if (!deleted?.path) return;
    const list = itemsRef.current;
    const found = list.findIndex((it) => it.path === deleted.path);
    const oldIndex = found >= 0 ? found : list.length;
    const next = list.filter((it) => it.path !== deleted.path);
    commitItems(next);
    if (next.length) {
      if (deleted.path === pathRef.current) {
        // the item that followed the deleted one now sits at the same index
        intentRef.current = false;
        showAt(Math.min(oldIndex, next.length - 1), next);
      } else {
        const keep = next.findIndex((it) => it.path === pathRef.current);
        if (keep >= 0) showAt(keep, next);
      }
    }

    const name = deleted.name || fileNameOf(deleted.path);
    const scriptCount = trashed.filter((t) => t && t.path !== deleted.path).length;
    const undo = { label: 'Undo', onClick: () => putBack(deleted, oldIndex, trashed) };
    if (!failed.length) {
      notify({
        message: `Moved to trash: ${name}${scriptCount ? ` and ${plural(scriptCount, 'funscript')}` : ''}`,
        action: undo
      });
    } else {
      const names = failed.map((f) => fileNameOf(f.path)).join(', ');
      notify({
        severity: 'warning',
        message: `Moved ${name} to the trash; ${plural(failed.length, 'funscript')} could not be moved: ${names}`,
        action: undo
      });
    }
  }, [commitItems, showAt, putBack, notify]);

  /* ── phone: bottom sheets + swipe feed ── */
  const openPanel = (panelId) => {
    if (panelId === 'queue') {
      setSheet('queue');
      return;
    }
    setSheet('tools');
    requestAnimationFrame(() => {
      leftRef.current?.querySelector(`[data-panel="${panelId}"]`)?.scrollIntoView({ block: 'start' });
    });
  };
  const closeSheet = () => setSheet(null);

  const touch = useRef(null);
  const stageProps = {
    className: 'pp-stage',
    onTouchStart: (e) => {
      const t = e.touches[0];
      touch.current = isPhone && e.touches.length === 1 && !e.target.closest('button') ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e) => {
      const start = touch.current;
      touch.current = null;
      if (!start || !isPhone) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dy) > SWIPE_MIN && Math.abs(dy) > Math.abs(dx)) goTo(index + (dy < 0 ? 1 : -1));
    }
  };

  usePlayerKeys({
    videoRef,
    stageApi,
    isVideo,
    onPrev: goPrev,
    onNext: goNext,
    onToggleLoop: () => setLoop((l) => !l),
    onEscape: () => (sheet ? setSheet(null) : goBack()),
    onHelp: () => setHelpOpen(true)
  });

  if (!item) {
    if (source.items.length > 0) {
      // A delete emptied the list: stay, so the toast's Undo can still put the file back.
      return (
        <div className="pp pp-empty">
          <p>The list is empty.</p>
          <button type="button" className="pl-btn" onClick={goBack}>
            <ArrowBackIcon sx={{ fontSize: 18 }} /> Back
          </button>
        </div>
      );
    }
    return (
      <div className="pp pp-empty">
        <p>Nothing to play.</p>
        <p className="pp-empty-note">The list belonged to another tab, or it was cleared.</p>
        <Button component={RouterLink} to="/" variant="contained" disableElevation>Open the library</Button>
      </div>
    );
  }

  const info = mediaInfo && mediaInfo.path === path ? mediaInfo : null;
  const counter = `${index + 1} / ${items.length}`;
  const rail = RAIL.filter((r) => isVideo || IMAGE_RAIL.includes(r.id));
  const note = errorNote && errorNote.path === path ? errorNote.text : null;
  let convertNote = null;
  if (isVideo && videoSource.converted) convertNote = videoSource.loading ? 'Converting for the browser' : 'Converted while it plays';

  const barEnd = (
    <>
      <button
        type="button"
        className={`pl-ib${autoNext ? ' is-on' : ''}`}
        onClick={toggleAutoNext}
        title={`Autoplay next (${autoNext ? 'on' : 'off'})`}
        aria-label="Autoplay next"
        aria-pressed={autoNext}
      >
        <Svg name="autoNext" size={18} />
      </button>
      <button type="button" className="pl-ib pp-keys" onClick={() => setHelpOpen(true)} title="Shortcuts (?)" aria-label="Shortcuts">
        <Svg name="keys" size={18} />
      </button>
    </>
  );

  return (
    <div className="pp">
      <aside className={`pp-left${sheet === 'tools' ? ' is-open' : ''}`} ref={leftRef} aria-label="Tools">
        <button type="button" className="pl-btn sm pp-sheet-x" onClick={closeSheet}>Close</button>
        <div className="pp-backrow">
          <button type="button" className="pl-btn sm" onClick={goBack} title="Back (Esc)">
            <ArrowBackIcon sx={{ fontSize: 16 }} /> Back
          </button>
        </div>
        <header className="pp-head">
          {source.title && <div className="pp-title">{source.title}</div>}
          <h2>{item.name}</h2>
          <span className="pp-sub" title={convertNote && videoSource.reason ? `Converted: ${videoSource.reason}` : undefined}>
            {counter}{convertNote ? ` · ${convertNote}` : ''}
          </span>
        </header>
        {isVideo && <RatingPanel item={item} scripts={scripts} onRatingChange={patchItem} onDeleted={onDeleted} />}
        <TagPanel item={item} onTagsChange={onTagsChange} />
        {isVideo && <FunscriptPanel item={item} videoEl={videoEl} scenes={scenes} scripts={scripts} />}
        {isVideo && (labels
          ? <ScenesCompact data={labels} videoEl={videoEl} item={item} />
          : <ScenesPanel item={item} scenes={scenes} videoRef={videoRef} />)}
        <FileInfoPanel item={item} dimensions={info} duration={(isVideo && videoSource.duration) || info?.duration} />
      </aside>
      {isPhone && sheet && <button type="button" className="pp-sheet-scrim" aria-label="Close panel" onClick={closeSheet} />}

      <MediaStage
        className="pp-sw"
        item={stageItem}
        scenes={scenes}
        videoRef={attachVideo}
        apiRef={stageApi}
        timeline={labels ? <SceneStrip data={labels} videoEl={videoEl} /> : null}
        autoPlay={intentRef.current}
        loop={loop}
        onLoopChange={setLoop}
        onEnded={onEnded}
        onMediaInfo={setMediaInfo}
        onMediaError={onMediaError}
        errorNote={note}
        prefsKey="player.media"
        barEnd={barEnd}
        stageProps={stageProps}
        overlay={(
          <>
            <div className="pp-top">
              <button type="button" className="pp-top-back" onClick={goBack} aria-label="Back" title="Back (Esc)">
                <ArrowBackIcon sx={{ fontSize: 22 }} />
              </button>
              <span className="pp-top-name" title={item.name}>{item.name}</span>
              <span className="pp-top-count">{counter}</span>
            </div>
            {labels && <SceneChips data={labels} videoEl={videoEl} />}
            <div className="pp-ud">
              <button type="button" onClick={goPrev} disabled={index <= 0} title="Previous (P)" aria-label="Previous">
                <Svg name="up" size={24} />
              </button>
              <button type="button" onClick={goNext} disabled={index >= items.length - 1} title="Next (N)" aria-label="Next">
                <Svg name="down" size={24} />
              </button>
            </div>
            <div className="pp-arail">
              {rail.map((r) => (
                <button type="button" key={r.id} onClick={() => openPanel(r.id)} title={r.label} aria-label={r.label}>
                  <Svg name={r.id} size={20} />
                  {r.id === 'fs' && handyLive && <span className="live" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </>
        )}
      />

      <aside className={`pp-right${sheet === 'queue' ? ' is-open' : ''}`} aria-label="Up next">
        <div className="pp-railhead">
          <b>Up next</b>
          <span className="pp-grow" />
          <button type="button" className="pl-btn sm pp-sheet-x" onClick={closeSheet}>Close</button>
        </div>
        <Queue items={items} index={index} onPick={pickFromQueue} />
      </aside>

      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
