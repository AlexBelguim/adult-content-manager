import { useEffect, useRef } from 'react';

const TYPING = /^(INPUT|SELECT|TEXTAREA)$/;

/**
 * Keyboard shortcuts for a page that hosts a MediaStage.
 *
 *   Space        play / pause
 *   ← / →        ±5 s for video; previous / next for pictures
 *   Shift+← / →  previous / next        N / P  next / previous
 *   F fullscreen · M mute · L loop · Esc onEscape (not while fullscreen — the
 *   browser uses Esc to leave fullscreen)
 *
 * Keypresses in inputs / selects / textareas and with Ctrl / Meta / Alt are ignored.
 *
 * @param {object}   o
 * @param {object}   o.videoRef      ref to the <video> (same ref given to MediaStage)
 * @param {object}   o.stageApi      ref filled by MediaStage's `apiRef` prop
 * @param {boolean}  o.isVideo       current item is a video
 * @param {Function} [o.onPrev]
 * @param {Function} [o.onNext]
 * @param {Function} [o.onToggleLoop]
 * @param {Function} [o.onEscape]
 * @param {boolean}  [o.enabled=true]
 */
export default function usePlayerKeys(options) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKey = (e) => {
      const o = latest.current;
      if (o.enabled === false) return;
      const t = e.target;
      if ((t && (TYPING.test(t.tagName) || t.isContentEditable)) || e.ctrlKey || e.metaKey || e.altKey) return;

      const video = o.isVideo ? o.videoRef?.current : null;
      const api = o.stageApi?.current;
      const k = e.key.toLowerCase();
      let arrow = 0;
      if (k === 'arrowleft') arrow = -1;
      else if (k === 'arrowright') arrow = 1;

      if (arrow) {
        if (!video || e.shiftKey) (arrow < 0 ? o.onPrev : o.onNext)?.();
        else api?.seekBy(arrow * 5);
      } else if (k === 'n') o.onNext?.();
      else if (k === 'p') o.onPrev?.();
      else if (k === ' ') {
        // a focused button would also "click" on Space
        if (t && t.tagName === 'BUTTON') t.blur();
        api?.togglePlay();
      } else if (k === 'f') api?.toggleFullscreen();
      else if (k === 'm') {
        if (video) api?.toggleMute();
      } else if (k === 'l') {
        if (video) o.onToggleLoop?.();
      } else if (k === 'escape') {
        if (document.fullscreenElement) return;
        o.onEscape?.();
      } else return;

      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
