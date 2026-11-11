import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { fmtTime, isVideoItem, sceneColor, sceneEnd, sceneStart, validScenes } from './playerUtils';
import './player.css';

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  vol: 'M3 10v4h4l5 4V6L7 10zM16 8.5a5 5 0 010 7',
  mute: 'M3 10v4h4l5 4V6L7 10zM16 9.5l5 5M21 9.5l-5 5',
  full: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  unfull: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  loop: 'M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3'
};
const FILLED = { play: true, pause: true };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
// Wheel seeking: one step per this many pixels of accumulated deltaY. A line (deltaMode 1) counts as
// 33px and a page (deltaMode 2) as 800px; the 1px slack lets one 3-line notch (99px) make a step.
const WHEEL_STEP_PX = 100;
const WHEEL_SLACK_PX = 1;
const WHEEL_IDLE_MS = 400;

/** { volume, muted, speed } kept under `key` in localStorage, or null. */
function readPrefs(key) {
  if (!key) return null;
  try {
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    if (!p || typeof p !== 'object') return null;
    const volume = Number(p.volume);
    const speed = Number(p.speed);
    return {
      volume: p.volume != null && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : undefined,
      muted: typeof p.muted === 'boolean' ? p.muted : undefined,
      speed: SPEEDS.includes(speed) ? speed : undefined
    };
  } catch (e) {
    return null;
  }
}

const Icon = ({ name, size = 20 }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    aria-hidden="true"
    {...(FILLED[name]
      ? { fill: 'currentColor' }
      : { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })}
  >
    <path d={ICONS[name]} />
  </svg>
);

/** Picture with its thumbnail as an instant placeholder. Keyed by path by the caller. */
function ImageMedia({ item, onInfo, onError }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && item.thumbnail && (
        <img className="pl-media" src={item.thumbnail} alt="" draggable={false} />
      )}
      <img
        className="pl-media"
        src={item.url}
        alt={item.name || ''}
        draggable={false}
        style={loaded ? undefined : { opacity: 0 }}
        onLoad={(e) => {
          setLoaded(true);
          onInfo?.({ path: item.path, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight });
        }}
        onError={onError}
      />
    </>
  );
}

/** Seek bar + time. Owns the fast-changing playback state so the stage doesn't re-render at 4 Hz. */
function SeekAndTime({ videoEl, item, scenes, children }) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const seekRef = useRef(null);
  const dragging = useRef(false);

  useEffect(() => {
    setTime(0);
    setDuration(0);
    if (!videoEl) return undefined;
    const onTime = () => setTime(videoEl.currentTime || 0);
    const onDur = () => setDuration(Number.isFinite(videoEl.duration) ? videoEl.duration : 0);
    const events = ['timeupdate', 'seeking', 'seeked'];
    events.forEach((n) => videoEl.addEventListener(n, onTime));
    videoEl.addEventListener('durationchange', onDur);
    videoEl.addEventListener('loadedmetadata', onDur);
    onTime();
    onDur();
    return () => {
      events.forEach((n) => videoEl.removeEventListener(n, onTime));
      videoEl.removeEventListener('durationchange', onDur);
      videoEl.removeEventListener('loadedmetadata', onDur);
    };
  }, [videoEl]);

  const total = duration || Number(item?.duration) || 0;
  const enabled = !!videoEl && total > 0;

  const seekFromPointer = (e) => {
    const r = seekRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    videoEl.currentTime = frac * total;
  };
  const onPointerDown = (e) => {
    if (!enabled) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekFromPointer(e);
  };
  const onPointerMove = (e) => {
    if (dragging.current && enabled) seekFromPointer(e);
  };
  const endDrag = () => {
    dragging.current = false;
  };

  const segments = enabled ? validScenes(scenes) : [];

  return (
    <>
      <div
        ref={seekRef}
        className={`pl-seek${enabled ? '' : ' is-off'}`}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(time)}
        aria-disabled={!enabled}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {segments.map((s, i) => {
          const a = sceneStart(s);
          const b = sceneEnd(s);
          return (
            <div
              key={s.id ?? `${a}-${b}`}
              className="pl-seek-scene"
              title={`${s.name || 'Scene'} (${fmtTime(a)} - ${fmtTime(b)})`}
              style={{
                left: `${(a / total) * 100}%`,
                width: `${(Math.max(0, b - a) / total) * 100}%`,
                background: sceneColor(i)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                videoEl.currentTime = a;
              }}
            />
          );
        })}
        <div className="pl-seek-fill" style={{ width: enabled ? `${Math.min(100, (time / total) * 100)}%` : 0 }} />
      </div>
      {children(videoEl ? `${fmtTime(time)} / ${fmtTime(total)}` : null)}
    </>
  );
}

/**
 * The media box + control bar + optional action bar, as ONE root element that
 * goes fullscreen as a whole (so `actionBar` stays usable in fullscreen).
 * Generic: no page logic, no data fetching. See index.js for the prop list.
 */
export default function MediaStage({
  item,
  scenes,
  videoRef,
  apiRef,
  autoPlay = false,
  muted = false,
  loop = false,
  onLoopChange,
  onEnded,
  onMediaInfo,
  overlay,
  actionBar,
  barStart,
  barEnd,
  counterText,
  stageProps,
  className,
  timeline,
  prefsKey,
  onMediaError,
  errorNote
}) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const [prefs] = useState(() => readPrefs(prefsKey));
  const [videoEl, setVideoEl] = useState(null);
  const [paused, setPaused] = useState(true);
  const [volume, setVolume] = useState(prefs?.volume ?? 1);
  const [isMuted, setIsMuted] = useState(prefs?.muted ?? !!muted);
  const [speed, setSpeed] = useState(prefs?.speed ?? 1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  const isVideo = isVideoItem(item);
  const itemPath = item?.path;
  const itemPathRef = useRef(itemPath);
  itemPathRef.current = itemPath;

  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onMediaInfoRef = useRef(onMediaInfo);
  onMediaInfoRef.current = onMediaInfo;
  const reportInfo = useCallback((info) => onMediaInfoRef.current?.(info), []);
  const onMediaErrorRef = useRef(onMediaError);
  onMediaErrorRef.current = onMediaError;
  const errorReportedFor = useRef(null);

  // The banner: a media 'error' event, a picture that does not load, or play() refusing the format.
  // onMediaError hears about it once per item.
  const fail = useCallback(() => {
    setMediaError(true);
    const p = itemPathRef.current;
    if (errorReportedFor.current === p) return;
    errorReportedFor.current = p;
    onMediaErrorRef.current?.({ path: p });
  }, []);
  // AbortError (a newer load) and NotAllowedError (autoplay blocked) are not the file's fault.
  const playFailed = useCallback((err) => {
    if (err && err.name === 'NotSupportedError') fail();
  }, [fail]);

  // The <video> is keyed by path, so every item gets a fresh element; hand it
  // to the parent's ref as well as to our own state.
  const attachVideo = useCallback((el) => {
    setVideoEl(el);
    if (typeof videoRef === 'function') videoRef(el);
    else if (videoRef) videoRef.current = el;
  }, [videoRef]);

  // A change of the `muted` prop wins; at mount the initial state (stored prefs, else `muted`) stands.
  const lastMutedProp = useRef(!!muted);
  useEffect(() => {
    if (lastMutedProp.current === !!muted) return;
    lastMutedProp.current = !!muted;
    setIsMuted(!!muted);
  }, [muted]);
  useEffect(() => {
    setMediaError(false);
    errorReportedFor.current = null;
  }, [itemPath]);

  useEffect(() => {
    if (!prefsKey) return;
    try {
      localStorage.setItem(prefsKey, JSON.stringify({ volume, muted: isMuted, speed }));
    } catch (e) {
      // private mode or full storage: the settings still hold for this visit
    }
  }, [prefsKey, volume, isMuted, speed]);

  // Volume / mute / speed survive item changes.
  useEffect(() => {
    if (!videoEl) return;
    videoEl.volume = volume;
    videoEl.muted = isMuted;
    videoEl.defaultPlaybackRate = speed;
    videoEl.playbackRate = speed;
  }, [videoEl, volume, isMuted, speed]);

  useEffect(() => {
    setPaused(true);
    if (!videoEl) return undefined;
    const sync = () => setPaused(videoEl.paused);
    const ended = (e) => onEndedRef.current?.(e);
    const playing = () => setMediaError(false);
    const meta = () => reportInfo({
      path: itemPathRef.current,
      width: videoEl.videoWidth,
      height: videoEl.videoHeight,
      duration: Number.isFinite(videoEl.duration) ? videoEl.duration : undefined
    });
    videoEl.addEventListener('loadedmetadata', meta);
    videoEl.addEventListener('play', sync);
    videoEl.addEventListener('pause', sync);
    videoEl.addEventListener('ended', ended);
    videoEl.addEventListener('error', fail);
    videoEl.addEventListener('playing', playing);
    if (autoPlayRef.current) videoEl.play().catch(playFailed);
    return () => {
      videoEl.removeEventListener('loadedmetadata', meta);
      videoEl.removeEventListener('play', sync);
      videoEl.removeEventListener('pause', sync);
      videoEl.removeEventListener('ended', ended);
      videoEl.removeEventListener('error', fail);
      videoEl.removeEventListener('playing', playing);
    };
  }, [videoEl, reportInfo, fail, playFailed]);

  // Wheel over the media = seek; scroll up = forward. One step per WHEEL_STEP_PX of accumulated
  // deltaY, so a trackpad does not fire a step per event. The step scales with the video's duration
  // and with how fast the steps follow each other (as in the old modal).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !videoEl) return undefined;
    let lastStep = 0;
    let lastEvent = 0;
    let acc = 0;
    const onWheel = (e) => {
      const d = videoEl.duration;
      if (!d || !Number.isFinite(d)) return;
      e.preventDefault();
      const now = Date.now();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 33;
      else if (e.deltaMode === 2) dy *= 800;
      // a pause or a change of direction starts a fresh count
      if (now - lastEvent > WHEEL_IDLE_MS || (acc && dy && Math.sign(dy) !== Math.sign(acc))) acc = 0;
      lastEvent = now;
      acc += dy;
      if (Math.abs(acc) < WHEEL_STEP_PX - WHEEL_SLACK_PX) return;
      const dir = acc > 0 ? 1 : -1;
      acc = Math.abs(acc) >= WHEEL_STEP_PX ? acc - dir * WHEEL_STEP_PX : 0;
      const gap = Math.max(16, Math.min(500, now - lastStep));
      lastStep = now;
      const speedFactor = Math.max(0.1, Math.min(1, (500 - gap) / 484));
      let base;
      let max;
      if (d < 600) { base = 2; max = 15; }
      else if (d < 1800) { base = 3; max = 30; }
      else if (d < 3600) { base = 5; max = 60; }
      else { base = 8; max = Math.min(120, d * 0.05); }
      const step = Math.round(base + (max - base) * speedFactor ** 0.7);
      videoEl.currentTime = Math.max(0, Math.min(d, videoEl.currentTime + (dir > 0 ? -step : step)));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [videoEl]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!rootRef.current && document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const togglePlay = useCallback(() => {
    if (!videoEl) return;
    if (videoEl.paused) videoEl.play().catch(playFailed);
    else videoEl.pause();
  }, [videoEl, playFailed]);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => {
      if (m && volume === 0) setVolume(1);
      return !m;
    });
  }, [volume]);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (root?.requestFullscreen) root.requestFullscreen().catch(() => {});
    else if (videoEl?.webkitEnterFullscreen) videoEl.webkitEnterFullscreen(); // iPhone: video-only fullscreen
  }, [videoEl]);

  const seekBy = useCallback((seconds) => {
    if (!videoEl) return;
    const d = Number.isFinite(videoEl.duration) ? videoEl.duration : Infinity;
    videoEl.currentTime = Math.max(0, Math.min(d, videoEl.currentTime + seconds));
  }, [videoEl]);

  const seekTo = useCallback((seconds) => {
    if (videoEl) videoEl.currentTime = Math.max(0, seconds);
  }, [videoEl]);

  useImperativeHandle(apiRef, () => ({
    togglePlay,
    toggleMute,
    toggleFullscreen,
    seekBy,
    seekTo,
    get root() { return rootRef.current; }
  }), [togglePlay, toggleMute, toggleFullscreen, seekBy, seekTo]);

  const onVolumeInput = (e) => {
    const v = Number(e.target.value);
    setVolume(v);
    setIsMuted(v === 0);
  };

  const { className: stageClass, ...restStageProps } = stageProps || {};
  const silent = isMuted || volume === 0;

  return (
    <div ref={rootRef} className={`pl-sw${className ? ` ${className}` : ''}`}>
      <div ref={stageRef} className={`pl-stage${stageClass ? ` ${stageClass}` : ''}`} {...restStageProps}>
        {item?.thumbnail && (
          <div className="pl-blur" style={{ backgroundImage: `url("${item.thumbnail}")` }} />
        )}
        {item && isVideo && (
          <video
            key={itemPath}
            ref={attachVideo}
            className="pl-media"
            src={item.url}
            poster={item.thumbnail || undefined}
            preload="metadata"
            playsInline
            loop={loop}
            onClick={togglePlay}
          />
        )}
        {item && !isVideo && <ImageMedia key={itemPath} item={item} onInfo={reportInfo} onError={fail} />}
        {mediaError && (
          <div className="pl-media-error" role="status">
            Could not play this file in the browser{errorNote ? ` · ${errorNote}` : ''}
          </div>
        )}
        {overlay}
      </div>

      <div className="pl-ctl">
        {timeline}
        <SeekAndTime videoEl={isVideo ? videoEl : null} item={item} scenes={scenes}>
          {(timeText) => (
            <div className="pl-ctl-row">
              {barStart}
              <button type="button" className="pl-ib" onClick={togglePlay} disabled={!isVideo || !videoEl} title="Play / Pause (Space)" aria-label={paused ? 'Play' : 'Pause'}>
                <Icon name={paused ? 'play' : 'pause'} size={22} />
              </button>
              <span className="pl-time">
                {timeText || counterText || ''}
                {timeText && counterText ? <span className="pl-time-extra"> · {counterText}</span> : null}
              </span>
              <span className="pl-grow" />
              <button type="button" className="pl-ib" onClick={toggleMute} disabled={!isVideo} title="Mute (M)" aria-label={silent ? 'Unmute' : 'Mute'}>
                <Icon name={silent ? 'mute' : 'vol'} />
              </button>
              <input
                className="pl-vol"
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={isMuted ? 0 : volume}
                onChange={onVolumeInput}
                disabled={!isVideo}
                aria-label="Volume"
              />
              <select
                className="pl-speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                disabled={!isVideo}
                title="Speed"
                aria-label="Speed"
              >
                {SPEEDS.map((x) => <option key={x} value={x}>{x}×</option>)}
              </select>
              <button
                type="button"
                className={`pl-ib${loop ? ' is-on' : ''}`}
                onClick={() => onLoopChange?.(!loop)}
                disabled={!isVideo || !onLoopChange}
                title="Loop (L)"
                aria-label="Loop"
                aria-pressed={!!loop}
              >
                <Icon name="loop" size={18} />
              </button>
              {barEnd}
              <button type="button" className="pl-ib" onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Fullscreen">
                <Icon name={isFullscreen ? 'unfull' : 'full'} size={18} />
              </button>
            </div>
          )}
        </SeekAndTime>
        {actionBar ? <div className="pl-actionbar">{actionBar}</div> : null}
      </div>
    </div>
  );
}
