import React, { useCallback, useMemo, useRef } from 'react';

const DECIDE_DISTANCE = 70; // px
const FLICK_DISTANCE = 24; // px
const FLICK_VELOCITY = 0.35; // px/ms
const DRAG_MIN = 8; // px before a touch counts as a drag (and its click is swallowed)
const FLY_MS = 170;

/**
 * Tinder-style swipe on a MediaStage's media area: dragging moves and rotates
 * the media with KEEP / DELETE stamps fading in; releasing past 70 px, or a
 * quick flick, decides. Touch always swipes; the mouse only when `mouse` is on
 * (phone width). The decision is applied by the caller at once — the next file
 * renders in the same tick — and `flyOut` throws a ghost of the old media off
 * screen on top of it.
 *
 * @param {object}   o
 * @param {Function} o.getStage   () => the `.pl-stage` element (MediaStage's media area)
 * @param {boolean}  o.mouse      accept mouse drags as swipes
 * @param {Function} o.onDecide   (action: 'keep' | 'delete', fromX)
 * @returns {{ stageProps: object, overlay: React.ReactNode, flyOut: Function }}
 */
export default function useSwipeStage({ getStage, mouse, onDecide }) {
  const latest = useRef({});
  latest.current = { getStage, mouse, onDecide };
  const drag = useRef(null);
  const keepStamp = useRef(null);
  const deleteStamp = useRef(null);
  const swallowClick = useRef(false);

  const paint = (d) => {
    d.media.forEach((m) => {
      m.style.transition = '';
      m.style.transform = `translateX(${d.dx}px) rotate(${d.dx / 22}deg)`;
    });
    if (keepStamp.current) keepStamp.current.style.opacity = Math.max(0, d.dx / 90);
    if (deleteStamp.current) deleteStamp.current.style.opacity = Math.max(0, -d.dx / 90);
  };

  const reset = (d, animate) => {
    d.media.forEach((m) => {
      m.style.transition = animate ? 'transform .12s' : '';
      m.style.transform = '';
    });
    if (keepStamp.current) keepStamp.current.style.opacity = 0;
    if (deleteStamp.current) deleteStamp.current.style.opacity = 0;
  };

  const onPointerDown = useCallback((e) => {
    swallowClick.current = false;
    if (e.pointerType === 'mouse' && (!latest.current.mouse || e.button !== 0)) return;
    if (e.target.closest('button, input, select, a')) return;
    const stage = e.currentTarget;
    drag.current = {
      id: e.pointerId,
      sx: e.clientX,
      lx: e.clientX,
      lt: e.timeStamp,
      dx: 0,
      vel: 0,
      dragged: false,
      media: Array.from(stage.querySelectorAll('.pl-media'))
    };
    stage.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.dx = e.clientX - d.sx;
    if (Math.abs(d.dx) > DRAG_MIN) d.dragged = true;
    if (e.timeStamp > d.lt) {
      d.vel = (e.clientX - d.lx) / (e.timeStamp - d.lt);
      d.lx = e.clientX;
      d.lt = e.timeStamp;
    }
    paint(d);
  }, []);

  const end = useCallback((e, cancelled) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    swallowClick.current = d.dragged;
    const flick = Math.abs(d.dx) > FLICK_DISTANCE && Math.abs(d.vel) > FLICK_VELOCITY && Math.sign(d.vel) === Math.sign(d.dx);
    if (!cancelled && (Math.abs(d.dx) > DECIDE_DISTANCE || flick)) {
      reset(d, false);
      latest.current.onDecide?.(d.dx > 0 ? 'keep' : 'delete', d.dx);
    } else {
      reset(d, true);
    }
  }, []);

  const onPointerUp = useCallback((e) => end(e, false), [end]);
  const onPointerCancel = useCallback((e) => end(e, true), [end]);

  // A drag must not also play / pause the video (MediaStage toggles on click).
  const onClickCapture = useCallback((e) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  const stageProps = useMemo(() => ({
    className: 'fv-stage',
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture
  }), [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture]);

  /**
   * Ghost of the media that was just decided flies off over the new file.
   * `src` is what to show (the picture itself, or a video's thumbnail).
   */
  const flyOut = useCallback((action, src, fromX = 0) => {
    const stage = latest.current.getStage?.();
    if (!stage) return;
    const ghost = document.createElement('div');
    ghost.className = 'fv-ghost';
    if (src) ghost.style.backgroundImage = `url("${src}")`;
    if (action !== 'move_to_funscript') {
      const stamp = document.createElement('span');
      stamp.className = `fv-verdict ${action === 'keep' ? 'k' : 'd'}`;
      stamp.textContent = action === 'keep' ? 'KEEP' : 'DELETE';
      ghost.appendChild(stamp);
    }
    stage.appendChild(ghost);
    const remove = () => ghost.remove();
    const width = stage.clientWidth || 600;
    const to = action === 'move_to_funscript'
      ? 'translateY(-110%)'
      : `translateX(${action === 'keep' ? width * 1.25 : -width * 1.25}px) rotate(${action === 'keep' ? 18 : -18}deg)`;
    if (typeof ghost.animate === 'function') {
      ghost.animate(
        [{ transform: `translateX(${fromX}px) rotate(${fromX / 22}deg)`, opacity: 1 }, { transform: to, opacity: 0.85 }],
        { duration: FLY_MS, easing: 'cubic-bezier(.3,0,.8,.4)' }
      ).onfinish = remove;
    }
    setTimeout(remove, FLY_MS + 90); // throttled animations (hidden tab) still clean up
  }, []);

  const overlay = (
    <>
      <span ref={keepStamp} className="fv-verdict k" aria-hidden="true">KEEP</span>
      <span ref={deleteStamp} className="fv-verdict d" aria-hidden="true">DELETE</span>
    </>
  );

  return { stageProps, overlay, flyOut };
}
