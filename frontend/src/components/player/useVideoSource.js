import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The source of the player's <video>: the file as it is when the browser plays it, else a stream converted while it
 * plays (/api/files/stream-video, backend/services/videoStream.js).
 *
 * The server's probe (/api/files/video-probe) says how: direct, remux (streams copied into fragmented MP4) or
 * transcode (h264 + aac). A converted stream cannot be seeked and starts at 0, so for one the element is patched:
 *   duration     the file's real length from the probe, so the whole timeline shows
 *   currentTime  offset + the stream's own time; setting it reloads the stream at ?start=<t> (a remux starts on the
 *                keyframe at or before t: /api/files/video-keyframe says which, and that is the offset)
 *   play()       after the end, or after the server cut the stream short, starts the stream again from there
 * Everything that reads or sets the time (seek bar, wheel, keys, scenes, funscripts, the Handy) goes through the
 * element as before. Direct files are not touched: normal seeking, range requests.
 *
 * mp4 / m4v / mov / webm start loading as they are right away (they nearly always play); the probe still runs and
 * switches to a conversion when the codecs need it. Other files wait for the probe: MediaStage gets no url for them.
 * Until that probe answers, an error of the early load is held back (and a play() refused for the format waits): a
 * conversion makes it moot; when the file stays direct it is passed on then.
 */

// mkv too: Chrome and Samsung Internet open it although canPlayType says no, so it is tried as it is first
const FAST_DIRECT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const DIRECT_TRY_MS = 5000;  // how long a file the probe would convert for its container gets to load as it is

/**
 * Resolves true when the element loads the file with a picture (or as audio when it has no video), false on an
 * error or after `ms`. Used before converting a file only because of its container.
 */
function loadsDirect(el, ms) {
  const good = () => el.readyState >= 1 && !el.error && (el.videoWidth > 0 || el.videoHeight > 0);
  if (el.error) return Promise.resolve(false);
  if (el.readyState >= 1) return Promise.resolve(good());
  return new Promise((resolve) => {
    const done = (v) => { clearTimeout(t); el.removeEventListener('loadedmetadata', onMeta); el.removeEventListener('error', onErr); resolve(v); };
    const onMeta = () => done(good());
    const onErr = () => done(false);
    const t = setTimeout(() => done(good()), ms);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('error', onErr);
  });
}
/** True when the file is loaded as it is before the probe answers (the item keeps its url). */
export const startsDirect = (path) => FAST_DIRECT.test(String(path || ''));

const SEEK_SETTLE_MS = 180;  // seeks closer together than this (a drag, the wheel) make one reload
const CUT_SLACK_S = 2;       // a stream that ends this far before the real end was cut short
const CLIENT_ID = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

const CODEC_TESTS = [
  ['h264', 'video/mp4; codecs="avc1.640028"'],
  ['hevc', 'video/mp4; codecs="hvc1.1.6.L120.90"'],
  ['hevc', 'video/mp4; codecs="hev1.1.6.L120.90"'],
  ['av1', 'video/mp4; codecs="av01.0.08M.08"'],
  ['vp9', 'video/webm; codecs="vp9"'],
  ['vp8', 'video/webm; codecs="vp8"'],
  ['aac', 'audio/mp4; codecs="mp4a.40.2"'],
  ['mp3', 'audio/mpeg'],
  ['opus', 'audio/webm; codecs="opus"'],
  ['vorbis', 'audio/webm; codecs="vorbis"'],
  ['flac', 'audio/flac']
];
let codecList = null;

/** What this browser decodes, as the server's ?can= list ('' leaves the server's defaults). */
export function browserCodecs() {
  if (codecList !== null) return codecList;
  const found = new Set();
  try {
    const v = document.createElement('video');
    CODEC_TESTS.forEach(([name, type]) => {
      const answer = v.canPlayType(type);
      if (answer === 'probably' || (answer === 'maybe' && !type.includes('codecs='))) found.add(name);
    });
  } catch (e) {
    // no DOM: the server's defaults
  }
  codecList = [...found].join(',');
  return codecList;
}

/** The converted stream of `path` from `start` seconds. */
export function streamUrl(path, { mode, start = 0, can = browserCodecs() } = {}) {
  let url = `/api/files/stream-video?path=${encodeURIComponent(path)}&client=${CLIENT_ID}`;
  if (can) url += `&can=${encodeURIComponent(can)}`;
  if (mode) url += `&mode=${mode}`;
  // 6 decimals: a remux starts on a keyframe's own time (the server rounds it up to the ms); rounded to 3 here it
  // could fall just before that keyframe, and ffmpeg would start a whole keyframe interval earlier
  if (start > 0) url += `&start=${start.toFixed(6)}`;
  return url;
}

const IDLE = { path: null, mode: null, duration: null, loading: false, reason: null, probed: false };
const proto = typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.prototype : null;
const timeDesc = proto && Object.getOwnPropertyDescriptor(proto, 'currentTime');
const durationDesc = proto && Object.getOwnPropertyDescriptor(proto, 'duration');

/**
 * useVideoSource({ videoEl, item, loop, playIntentRef })
 *   videoEl        the <video> MediaStage made for `item` (keyed by path: a new element per item)
 *   item           the video item ({ path, url }), or null for a picture
 *   loop           the player's loop switch (a converted stream loops through a reload, not natively)
 *   playIntentRef  ref: true when the item should start playing (the player's autoplay intent)
 * → { mode: 'direct' | 'remux' | 'transcode' | null, duration, loading, reason, probed, converted, handlesError(path) }
 *   handlesError(path) is true while an error of that item is the hook's to handle: the probe has not answered yet,
 *   or a failed remux is being tried again as a transcode.
 */
export default function useVideoSource({ videoEl, item, loop = false, playIntentRef }) {
  const [state, setState] = useState(IDLE);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const intentRef = useRef(playIntentRef);
  intentRef.current = playIntentRef;
  const live = useRef(null);  // the running effect's state, for handlesError

  const path = item?.path || null;
  const directUrl = item?.url || null;

  useEffect(() => {
    // isConnected: for one commit after a change of item the old (removed) element is still the state
    if (!videoEl || !path || !proto || !videoEl.isConnected) return undefined;
    const el = videoEl;
    const can = browserCodecs();
    const fast = startsDirect(path);
    const s = {
      path,
      mode: fast ? 'direct' : null,
      duration: null,
      offset: 0,          // where the current stream starts on the file's timeline
      pending: null,      // the time shown while a seek waits or loads
      timer: null,
      seq: 0,
      cut: false,         // the server ended the stream before the end of the file
      ended: false,       // the stream reached the end of the file
      retried: false,     // a failed remux was tried again as a transcode
      retryFailed: false, // ... and that failed too: the player may say so and move on
      patched: false,
      probing: true,      // the probe has not answered
      holding: fast,      // ... and the early direct load's errors are held back until it does
      heldError: false,
      ownSrc: false,
      srcAbs: null,
      observer: null,
      disposed: false
    };
    live.current = s;
    const ac = new AbortController();

    const publish = (patch) => {
      if (s.disposed) return;
      setState((prev) => ({ ...(prev.path === path ? prev : { ...IDLE, path }), ...patch }));
    };
    publish({ path, mode: s.mode, duration: null, loading: !fast, reason: null, probed: false });

    const nativeTime = () => timeDesc.get.call(el) || 0;
    const shown = () => (s.pending != null ? s.pending : s.offset + nativeTime());
    const nativePlay = () => proto.play.call(el);
    const fire = (type) => el.dispatchEvent(new Event(type));
    const wantStart = () => !el.paused || !!intentRef.current?.current;
    const quietPlay = () => {
      const p = nativePlay();
      if (p && p.catch) p.catch(() => {});  // a refusal shows through the element's own events
    };
    const setSrc = (url) => {
      s.ownSrc = true;
      s.srcAbs = new URL(url, window.location.href).href;
      el.src = url;
    };

    /** Load the converted stream at `t` (a remux at the keyframe before it). Resolves to play()'s promise. */
    const reload = async (t, play) => {
      const seq = ++s.seq;
      clearTimeout(s.timer);
      s.timer = null;
      s.pending = t;
      s.cut = false;
      s.ended = false;
      let start = t;
      if (s.mode === 'remux' && t > 0) {
        try {
          const r = await fetch(`/api/files/video-keyframe?path=${encodeURIComponent(path)}&t=${t.toFixed(3)}`, { signal: ac.signal });
          if (r.ok) {
            const j = await r.json();
            if (Number.isFinite(j.start) && j.start >= 0 && j.start <= t + 0.01) start = j.start;
          }
        } catch (e) {
          if (ac.signal.aborted) return undefined;
          // the server will start near t: close enough
        }
      }
      if (seq !== s.seq || s.disposed) return undefined;
      s.offset = start;
      publish({ loading: true });
      setSrc(streamUrl(path, { mode: s.mode, start, can }));
      return play ? nativePlay() : undefined;
    };

    const seekTo = (value) => {
      const t = Number(value);
      if (!Number.isFinite(t)) return;
      const max = s.duration ? Math.max(0, s.duration - 0.5) : Infinity;
      const target = Math.min(max, Math.max(0, t));
      s.pending = target;
      fire('seeking');
      fire('timeupdate');
      clearTimeout(s.timer);
      s.timer = setTimeout(() => {
        s.timer = null;
        reload(target, !el.paused).catch(() => {});
      }, SEEK_SETTLE_MS);
    };

    const onLoaded = () => {
      if (!s.patched || (s.srcAbs && el.currentSrc && el.currentSrc !== s.srcAbs)) return;
      if (s.pending != null && !s.timer) {
        s.pending = null;
        fire('seeked');
        fire('timeupdate');
      }
      publish({ loading: false });
    };
    // Capture listeners on the element run before MediaStage's: they can keep a cut stream from counting as the end.
    const onEnded = (e) => {
      if (!s.patched) return;
      const at = s.offset + nativeTime();
      if (s.duration && at < s.duration - CUT_SLACK_S) {
        e.stopImmediatePropagation();
        s.cut = true;
        publish({ loading: false });
        return;
      }
      if (loopRef.current) {
        e.stopImmediatePropagation();
        reload(0, true).catch(() => {});
        return;
      }
      s.ended = true;
    };
    const onError = (e) => {
      if (!s.patched) return;
      if (s.retried) {
        s.retryFailed = true;
        return;
      }
      if (s.mode !== 'remux') return;
      const code = el.error && el.error.code;
      if (code !== 3 && code !== 4) return;  // decode error, or the source would not open
      e.stopImmediatePropagation();
      s.retried = true;
      s.mode = 'transcode';
      publish({ mode: 'transcode' });
      reload(shown(), true).catch(() => {});
    };
    const stripLoop = () => {
      if (el.hasAttribute('loop')) el.removeAttribute('loop');
    };

    // The early direct load of an mp4/m4v/mov/webm: its error waits for the probe (capture: before MediaStage's).
    let probeSettled = null;
    const probed = new Promise((resolve) => { probeSettled = resolve; });
    const onEarlyError = (e) => {
      if (!s.holding) return;
      e.stopImmediatePropagation();
      s.heldError = true;
    };
    if (fast) {
      el.addEventListener('error', onEarlyError, true);
      el.play = () => {
        const p = nativePlay();
        if (!p || !p.catch) return p;
        return p.catch((err) => {
          if (!s.holding || !err || err.name !== 'NotSupportedError') throw err;
          // the format may be converted: wait for the probe; refused only when the file stays direct
          return probed.then((kind) => { if (kind === 'direct') throw err; });
        });
      };
    }
    /** The probe answered: kind 'direct' passes a held error on, 'converted' drops it. */
    const endHold = (kind) => {
      s.probing = false;
      const held = s.holding && s.heldError;
      s.holding = false;
      el.removeEventListener('error', onEarlyError, true);
      if (fast && !s.patched) delete el.play;
      probeSettled(kind);
      if (kind === 'direct' && held && el.error) fire('error');
    };

    const patch = () => {
      s.patched = true;
      Object.defineProperty(el, 'currentTime', { configurable: true, get: shown, set: seekTo });
      Object.defineProperty(el, 'duration', { configurable: true, get: () => s.duration || durationDesc.get.call(el) });
      el.play = () => {
        if (s.cut || s.ended) return reload(s.cut ? shown() : 0, true);
        return nativePlay();
      };
      el.addEventListener('loadeddata', onLoaded);
      el.addEventListener('ended', onEnded, true);
      el.addEventListener('error', onError, true);
      // A native loop would replay the stream from its own start: ended + reload does it instead.
      s.observer = new MutationObserver(stripLoop);
      s.observer.observe(el, { attributes: true, attributeFilter: ['loop'] });
      stripLoop();
    };

    fetch(`/api/files/video-probe?path=${encodeURIComponent(path)}${can ? `&can=${encodeURIComponent(can)}` : ''}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`probe ${r.status}`))))
      .then(async (info) => {
        if (s.disposed) return;
        s.duration = Number(info.duration) > 0 ? Number(info.duration) : null;
        // Converted only because of the container (not its codecs): keep the file as it is when the browser opens it
        const containerOnly = /does not open/.test(info.reason || '');
        if ((info.mode === 'remux' || info.mode === 'transcode') && fast && containerOnly && !el.error) {
          const opens = await loadsDirect(el, DIRECT_TRY_MS);
          if (s.disposed) return;
          if (opens) info = { ...info, mode: 'direct', reason: null };
        }
        if (info.mode !== 'remux' && info.mode !== 'transcode') {
          s.mode = 'direct';
          endHold('direct');
          if (!fast && directUrl) {
            setSrc(directUrl);
            if (wantStart()) quietPlay();
          }
          publish({ mode: 'direct', duration: s.duration, loading: false, reason: null, probed: true });
          return;
        }
        const at = fast && !el.error ? nativeTime() : 0;
        const play = wantStart();
        s.mode = info.mode;
        patch();
        endHold('converted');
        publish({ mode: s.mode, duration: s.duration, reason: info.reason || null, loading: true, probed: true });
        fire('durationchange');
        reload(at, play).catch(() => {});
      })
      .catch(() => {
        if (s.disposed || ac.signal.aborted) return;
        endHold('direct');
        // No probe: a file the browser may open stays as it is; anything else, the server converts as it sees fit.
        if (!fast) {
          setSrc(streamUrl(path, { can }));
          if (wantStart()) quietPlay();
        }
        publish({ mode: fast ? 'direct' : 'transcode', loading: false, probed: true });
      });

    return () => {
      s.disposed = true;
      if (live.current === s) live.current = null;
      ac.abort();
      clearTimeout(s.timer);
      el.removeEventListener('error', onEarlyError, true);
      if (fast && !s.patched) delete el.play;
      if (s.patched) {
        delete el.currentTime;
        delete el.duration;
        delete el.play;
        el.removeEventListener('loadeddata', onLoaded);
        el.removeEventListener('ended', onEnded, true);
        el.removeEventListener('error', onError, true);
        s.observer?.disconnect();
        if (loopRef.current) el.setAttribute('loop', '');
      }
      if (s.ownSrc) {
        // stop the download, so the server stops converting
        el.removeAttribute('src');
        try { el.load(); } catch (e) { /* already gone */ }
      }
    };
  }, [videoEl, path, directUrl]);

  /** True while a media error on `path` is being handled here (a remux tried again as a transcode). */
  const handlesError = useCallback((p) => {
    const s = live.current;
    return !!s && s.path === p && (s.probing || (s.retried && !s.retryFailed));
  }, []);

  const current = state.path === path ? state : IDLE;
  return {
    ...current,
    converted: current.mode === 'remux' || current.mode === 'transcode',
    handlesError
  };
}
