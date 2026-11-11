/**
 * The phone page bar's contents, set by the page that is shown.
 *
 *   usePageBar({ title?, parent?, onBack?, actions?, menu?: [{ label, onClick, disabled?, hint?, danger? }] })
 *     Registers while mounted (useLayoutEffect, so the bar never paints a stale title). The newest
 *     registration wins; unmounting removes it. Does nothing unless useChrome() === 'phone'.
 *   usePageBarValue() -> the newest registration or null. Only PhoneBar reads it.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useChrome } from './shell';

// Registrations in mount order (a Map keeps insertion order; set() on an existing key keeps its place).
const entries = new Map();
let snapshot = null;
const listeners = new Set();

function publish() {
  let top = null;
  entries.forEach((opts) => { top = opts; });
  if (top === snapshot) return;
  snapshot = top;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const getSnapshot = () => snapshot;

const same = (a, b) => !!a && !!b && a.title === b.title && a.parent === b.parent && a.onBack === b.onBack
  && a.actions === b.actions && a.menu === b.menu;

export function usePageBar(opts) {
  const active = useChrome() === 'phone';
  const keyRef = useRef(null);
  if (!keyRef.current) keyRef.current = Symbol('pageBar');
  const { title, parent, onBack, actions, menu } = opts || {};

  // Mount and unmount: the newest mount is on top.
  useLayoutEffect(() => {
    if (!active) return undefined;
    const key = keyRef.current;
    entries.set(key, null);
    return () => {
      entries.delete(key);
      publish();
    };
  }, [active]);

  // Every render: update the contents in place, so a re-render does not change which page is on top.
  useLayoutEffect(() => {
    if (!active) return;
    const key = keyRef.current;
    if (!entries.has(key)) return;
    const next = { title, parent, onBack, actions, menu };
    if (same(entries.get(key), next)) return;
    entries.set(key, next);
    publish();
  });
}

export function usePageBarValue() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
