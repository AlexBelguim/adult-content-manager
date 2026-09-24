import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadPlayerContext, mediaItemFromPath, playerUrl, updatePlayerContext } from '../utils/playerContext';
import {
  FileInfoPanel,
  FunscriptPanel,
  MediaStage,
  RatingPanel,
  ScenesPanel,
  TagPanel,
  fmtRating,
  fmtSize,
  fmtTime,
  isVideoItem,
  useFunscripts,
  usePlayerKeys,
  useScenes
} from '../components/player';
import './PlayerPage.css';

const AUTONEXT_KEY = 'player.autoplayNext';
const SWIPE_MIN = 70;

const RAIL = [
  { id: 'rate', icon: '⭐', label: 'Score' },
  { id: 'tags', icon: '🏷️', label: 'Tags' },
  { id: 'fs', icon: '🤖', label: 'Funscripts' },
  { id: 'scenes', icon: '🎬', label: 'Scenes' },
  { id: 'info', icon: 'ℹ️', label: 'File info' }
];
const IMAGE_PANELS = ['tags', 'info'];

const Chevron = ({ d }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function readAutoNext() {
  try {
    return localStorage.getItem(AUTONEXT_KEY) !== '0';
  } catch (e) {
    return true;
  }
}

/** "Up next": tall thumbnails, 2 columns (3 on a phone), current one highlighted. */
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
 * /player?ctx=<id>&i=<index>  or  /player?path=<file>
 * Direction 3 of player-redesign-mockups.html: tools left, media centre, queue right.
 */
export default function PlayerPage({ handyIntegration, handyConnected, handyCode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ctxId = params.get('ctx');
  const pathParam = params.get('path');

  const source = useMemo(() => {
    const ctx = ctxId ? loadPlayerContext(ctxId) : null;
    if (ctx) return ctx;
    if (pathParam) return { title: '', backUrl: '', items: [mediaItemFromPath(pathParam)] };
    return { title: '', backUrl: '', items: [] };
  }, [ctxId, pathParam]);

  // Local copy: items get patched (ratings, tags) and removed (delete).
  const [items, setItems] = useState(source.items);
  useEffect(() => setItems(source.items), [source]);

  const index = Math.min(Math.max(0, parseInt(params.get('i'), 10) || 0), Math.max(0, items.length - 1));
  const item = items[index] || null;
  const isVideo = isVideoItem(item);
  const path = item?.path;

  const videoRef = useRef(null);
  const stageApi = useRef(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [loop, setLoop] = useState(false);
  const [autoNext, setAutoNext] = useState(readAutoNext);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mediaInfo, setMediaInfo] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const leftRef = useRef(null);

  const scenes = useScenes(isVideo ? path : null);
  const { funscripts, reload: reloadFunscripts } = useFunscripts(isVideo ? path : null);

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!item?.name) return undefined;
    const previous = document.title;
    document.title = item.name;
    return () => {
      document.title = previous;
    };
  }, [item?.name]);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2300);
  }, []);

  /* ── navigation ── */
  const goTo = useCallback((n, forcePlay = false) => {
    if (!ctxId || n < 0 || n >= items.length || n === index) return;
    const v = videoRef.current;
    setAutoPlay(forcePlay || (!!v && !v.paused));
    navigate(playerUrl(ctxId, n), { replace: true });
  }, [ctxId, items.length, index, navigate]);

  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);

  const goBack = useCallback(() => {
    if (source.backUrl) navigate(source.backUrl);
    else window.history.back();
  }, [navigate, source.backUrl]);

  const onEnded = useCallback(() => {
    if (autoNext && !loop && index + 1 < items.length) goTo(index + 1, true);
  }, [autoNext, loop, index, items.length, goTo]);

  const toggleAutoNext = (e) => {
    const on = e.target.checked;
    setAutoNext(on);
    try {
      localStorage.setItem(AUTONEXT_KEY, on ? '1' : '0');
    } catch (err) {
      // private mode: the toggle still works for this visit
    }
  };

  /* ── keeping the list honest ── */
  const commitItems = useCallback((next) => {
    setItems(next);
    if (ctxId) updatePlayerContext(ctxId, { ...source, items: next });
  }, [ctxId, source]);

  const patchCurrent = useCallback((patch) => {
    if (!path) return;
    commitItems(items.map((it) => (it.path === path ? { ...it, ...patch } : it)));
  }, [commitItems, items, path]);

  const onDeleted = useCallback((deleted) => {
    const next = items.filter((it) => it.path !== deleted.path);
    commitItems(next);
    if (next.length === 0) {
      goBack();
      return;
    }
    // the item that followed the deleted one now sits at the same index
    setAutoPlay(false);
    if (ctxId) navigate(playerUrl(ctxId, Math.min(index, next.length - 1)), { replace: true });
  }, [items, commitItems, goBack, ctxId, index, navigate]);

  /* ── phone: bottom sheet + swipe feed ── */
  const openSheet = (panelId) => {
    setSheetOpen(true);
    requestAnimationFrame(() => {
      leftRef.current?.querySelector(`[data-panel="${panelId}"]`)?.scrollIntoView({ block: 'start' });
    });
  };

  const touch = useRef(null);
  const stageProps = {
    className: 'pp-stage',
    onTouchStart: (e) => {
      const t = e.touches[0];
      touch.current = e.touches.length === 1 && !e.target.closest('button') ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e) => {
      const start = touch.current;
      touch.current = null;
      if (!start) return;
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
    onEscape: () => (sheetOpen ? setSheetOpen(false) : goBack())
  });

  if (!item) {
    return (
      <div className="pp pp-empty">
        <p>Nothing to play — this list is no longer available.</p>
        <button type="button" className="pl-btn" onClick={goBack}>← Back</button>
      </div>
    );
  }

  const info = mediaInfo && mediaInfo.path === path ? mediaInfo : null;
  const width = info?.width || item.width;
  const height = info?.height || item.height;
  const counter = `${index + 1} / ${items.length}`;
  const sub = [counter, fmtSize(item), width && height ? `${width}×${height}` : ''].filter(Boolean).join(' · ');
  const rail = RAIL.filter((r) => isVideo || IMAGE_PANELS.includes(r.id));

  return (
    <div className="pp">
      <aside className={`pp-left${sheetOpen ? ' is-open' : ''}`} ref={leftRef}>
        <button type="button" className="pl-btn sm pp-sheet-x" onClick={() => setSheetOpen(false)}>Close</button>
        <div className="pp-backrow">
          <button type="button" className="pl-btn sm" onClick={goBack} title="Back (Esc)">← Back</button>
        </div>
        <header className="pp-head">
          {source.title && <div className="pp-title">{source.title}</div>}
          <h2>{item.name}</h2>
          <span className="pp-sub">{sub}</span>
        </header>
        {isVideo && <RatingPanel item={item} funscripts={funscripts} onRatingChange={patchCurrent} onDeleted={onDeleted} />}
        <TagPanel item={item} onTagsChange={(tags) => patchCurrent({ tags })} />
        {isVideo && (
          <FunscriptPanel
            item={item}
            videoRef={videoRef}
            scenes={scenes}
            funscripts={funscripts}
            onReloadFunscripts={reloadFunscripts}
            handyIntegration={handyIntegration}
            handyConnected={handyConnected}
            handyCode={handyCode}
            onNotify={notify}
          />
        )}
        {isVideo && <ScenesPanel item={item} scenes={scenes} videoRef={videoRef} />}
        <FileInfoPanel item={item} dimensions={info} duration={info?.duration} />
      </aside>
      {sheetOpen && <button type="button" className="pp-sheet-scrim" aria-label="Close panel" onClick={() => setSheetOpen(false)} />}

      <MediaStage
        className="pp-sw"
        item={item}
        scenes={scenes}
        videoRef={videoRef}
        apiRef={stageApi}
        autoPlay={autoPlay}
        loop={loop}
        onLoopChange={setLoop}
        onEnded={onEnded}
        onMediaInfo={setMediaInfo}
        counterText={counter}
        stageProps={stageProps}
        overlay={(
          <>
            <div className="pp-ud">
              <button type="button" onClick={goPrev} disabled={index <= 0} title="Previous (P)" aria-label="Previous">
                <Chevron d="M5 15l7-7 7 7" />
              </button>
              <button type="button" onClick={goNext} disabled={index >= items.length - 1} title="Next (N)" aria-label="Next">
                <Chevron d="M5 9l7 7 7-7" />
              </button>
            </div>
            <div className="pp-arail">
              {rail.map((r) => (
                <button type="button" key={r.id} onClick={() => openSheet(r.id)} title={r.label} aria-label={r.label}>{r.icon}</button>
              ))}
            </div>
            {toast && <div className="pl-toast pp-toast" role="status">{toast}</div>}
          </>
        )}
      />

      <aside className="pp-right">
        <div className="pp-railhead">
          <b>Up next</b>
          <span className="pp-grow" />
          <label className="pp-toggle">
            <input type="checkbox" checked={autoNext} onChange={toggleAutoNext} disabled={!isVideo} /> Autoplay
          </label>
        </div>
        <Queue items={items} index={index} onPick={goTo} />
      </aside>
    </div>
  );
}
