import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The player's view of window.HandyControl (public/handy-control.js, shared with faptap-dl: not edited here).
 *
 *   const handy = useHandy();     // { available, status, error, script: { status, error } }, re-rendered on 'change'
 *   const loaded = useHandyLoaded();   // what THE PLAYER put on the device, or null
 *   getHandyLoaded(), stopHandy({ user }), getUserStops()
 *
 * loaded = { path, name, kind: 'main' | 'scene', sceneId?, sceneEnd? }. setHandyLoaded is for FunscriptPanel only.
 */

let loaded = null;
const listeners = new Set();

export const getHandyLoaded = () => loaded;

export function setHandyLoaded(next) {
  const value = next || null;
  if (value === loaded) return;
  loaded = value;
  listeners.forEach((l) => l());
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useHandyLoaded() {
  return useSyncExternalStore(subscribe, getHandyLoaded, getHandyLoaded);
}

// Counts the stops a person asked for (Stop, a delete). FunscriptPanel compares it per item, so a stop
// made for a delete keeps 'Send automatically' from putting the script straight back.
let userStops = 0;
export const getUserStops = () => userStops;

/** Takes the player's script off the Handy. { user: true } when a person asked for it (Stop, a delete). */
export function stopHandy({ user = false } = {}) {
  if (user) userStops += 1;
  try {
    window.HandyControl?.unload();
  } catch (e) {
    // the device is optional; the page must not care
  }
  setHandyLoaded(null);
}

const WAIT_MS = 500;
const WAIT_TRIES = 20; // 10 s

const controlNow = () => (typeof window !== 'undefined' ? window.HandyControl || null : null);

export default function useHandy() {
  const [control, setControl] = useState(controlNow);
  const [gaveUp, setGaveUp] = useState(false);
  const [, setTick] = useState(0);

  // handy-control.js is a plain <script>: normally there before React mounts, but give it 10 s.
  useEffect(() => {
    if (control) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      const found = controlNow();
      if (found) {
        clearInterval(timer);
        setControl(found);
      } else if (++tries >= WAIT_TRIES) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, WAIT_MS);
    return () => clearInterval(timer);
  }, [control]);

  useEffect(() => {
    if (!control) return undefined;
    const onChange = () => {
      // Someone else took the script off (another page, the filter view): the store follows.
      if (getHandyLoaded() && !control.raw) setHandyLoaded(null);
      setTick((t) => t + 1);
    };
    control.addEventListener('change', onChange);
    onChange();
    return () => control.removeEventListener('change', onChange);
  }, [control]);

  if (!control) {
    return { available: !gaveUp, status: 'idle', error: '', script: { status: 'none', error: '' } };
  }
  const script = control.script || {};
  return {
    available: true,
    status: control.status || 'idle',
    error: control.error || '',
    script: { status: script.status || 'none', error: script.error || '' }
  };
}
