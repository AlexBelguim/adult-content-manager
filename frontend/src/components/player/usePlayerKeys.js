import { useEffect, useRef } from 'react';

// Inputs that only take clicks: the player's keys still work on them.
const CLICK_INPUTS = /^(range|checkbox|radio|button|submit|color|file)$/i;
const ARROWS = /^Arrow(Left|Right|Up|Down)$/;
// Anything in the event path that owns its own keys.
const OWN_KEYS = '[role="dialog"], [popover], .MuiDialog-root';

function isTextEntry(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t.tagName === 'INPUT' && !CLICK_INPUTS.test(t.type || 'text');
}

function pathOwnsKeys(e) {
  const list = e.composedPath ? e.composedPath() : [];
  return list.some((n) => n && n.nodeType === 1 && (n.tagName === 'HANDY-CONTROL' || (n.matches && n.matches(OWN_KEYS))));
}

/**
 * Keyboard shortcuts for a page that hosts a MediaStage.
 *
 *   Space        play / pause
 *   ← / →        5 s back / forward for video; previous / next for pictures
 *   Shift+← / →  previous / next        N / P  next / previous
 *   F fullscreen · M mute · L loop · ? onHelp
 *   Esc          onEscape (not while fullscreen: the browser uses Esc to leave fullscreen)
 *
 * No key fires:
 *   - while a MUI dialog is open anywhere on the page;
 *   - when the event path holds a dialog, a [popover] or a <handy-control> (its shadow DOM has fields);
 *   - in text-entry fields (textarea, contenteditable, text-like inputs);
 *   - with Ctrl, Meta or Alt held.
 * On a range input, a checkbox, a radio or a select, the plain arrow keys stay with the control. Every other key works there
 * (and on buttons and checkboxes) and first blurs the control, so Space does not also click it.
 *
 * @param {object}   o
 * @param {object}   o.videoRef      ref to the <video> (same ref given to MediaStage)
 * @param {object}   o.stageApi      ref filled by MediaStage's `apiRef` prop
 * @param {boolean}  o.isVideo       current item is a video
 * @param {Function} [o.onPrev]
 * @param {Function} [o.onNext]
 * @param {Function} [o.onToggleLoop]
 * @param {Function} [o.onEscape]
 * @param {Function} [o.onHelp]      '?': show the shortcuts
 * @param {boolean}  [o.enabled=true]
 */
export default function usePlayerKeys(options) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const onKey = (e) => {
      const o = latest.current;
      if (o.enabled === false) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // keys typed inside a shadow DOM reach document with the host as target: look at the real one
      const t = e.composedPath ? e.composedPath()[0] : e.target;
      if (isTextEntry(t)) return;
      if (document.querySelector('.MuiDialog-root')) return;
      if (pathOwnsKeys(e)) return;
      const tag = t && t.tagName;
      const keepsArrows = tag === 'SELECT' || (tag === 'INPUT' && /^(range|checkbox|radio)$/i.test(t.type));
      if (ARROWS.test(e.key) && !e.shiftKey && keepsArrows) return;

      const video = o.isVideo ? o.videoRef?.current : null;
      const api = o.stageApi?.current;
      const k = e.key.toLowerCase();
      let arrow = 0;
      if (k === 'arrowleft') arrow = -1;
      else if (k === 'arrowright') arrow = 1;

      let act;
      if (arrow) {
        act = () => {
          if (!video || e.shiftKey) (arrow < 0 ? o.onPrev : o.onNext)?.();
          else api?.seekBy(arrow * 5);
        };
      } else if (k === 'n') act = () => o.onNext?.();
      else if (k === 'p') act = () => o.onPrev?.();
      else if (k === ' ') act = () => api?.togglePlay();
      else if (k === 'f') act = () => api?.toggleFullscreen();
      else if (k === 'm') act = () => { if (video) api?.toggleMute(); };
      else if (k === 'l') act = () => { if (video) o.onToggleLoop?.(); };
      else if (e.key === '?') act = () => o.onHelp?.();
      else if (k === 'escape') {
        if (document.fullscreenElement) return;
        act = () => o.onEscape?.();
      } else return;

      // a focused control would also take the key (Space clicks a button, toggles a checkbox)
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT') t.blur();
      e.preventDefault();
      act();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
