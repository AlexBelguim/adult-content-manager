import { useEffect, useState } from 'react';

/**
 * labelmaster's scenes of a video (GET /api/video-labels?path=, sent by scenetest): the activity scenes and
 * the dress-state lane, plus the names and colours the player draws them with.
 */

export const GROUP_COLOR = {
  away: '#374151', show: '#8b5cf6', foreplay: '#f9a8d4', masturbation: '#ec4899', toy: '#c026d3', oral: '#f43f5e',
  cunnilingus: '#06b6d4', stroking: '#fb923c', sex: '#dc2626', other: '#64748b'
};
export const DRESS_COLOR = { dressed: '#475569', underwear: '#94a3b8', topless: '#c084fc', bottomless: '#f472b6', nude: '#fb7185' };
export const CAST = { solo: 'solo', MF: 'with a man', FF: 'with a woman', group: 'group' };

const words = (s) => String(s || '').replace(/_/g, ' ');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function sceneName(s) {
  if (s.group === 'sex' && s.position) return `Sex · ${words(s.position)}`;
  if (s.group === 'stroking' && s.detail) return cap(words(s.detail));
  return cap(words(s.group)) + (s.detail ? ` · ${words(s.detail)}` : '');
}

export const sceneAt = (scenes, t) => scenes.findIndex((s) => t >= s.start && t < s.end);
export const dressAt = (exposure, t) => (exposure.find(([a, b]) => t >= a && t < b) || [])[2] || null;

/** [time, state] where the dress state changes (the first known state included). */
export function dressChanges(exposure) {
  const out = [];
  exposure.forEach(([a, , e]) => {
    if (e && (!out.length || out[out.length - 1][1] !== e)) out.push([a, e]);
  });
  return out;
}

/** The video's labels, or null while loading and for a video scenetest has not labelled. */
export function useVideoLabels(path) {
  const [state, setState] = useState({ path: null, data: null });
  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    fetch(`/api/video-labels?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setState({ path, data: data?.scenes?.length ? data : null }); })
      .catch(() => { if (!cancelled) setState({ path, data: null }); });
    return () => { cancelled = true; };
  }, [path]);
  return state.path === path ? state.data : null;
}

/** The video's current time, updated on timeupdate / seeking (about 4 Hz while playing). */
export function useVideoTime(videoEl) {
  const [t, setT] = useState(0);
  useEffect(() => {
    setT(0);
    if (!videoEl) return undefined;
    const on = () => setT(videoEl.currentTime || 0);
    const events = ['timeupdate', 'seeking', 'seeked'];
    events.forEach((n) => videoEl.addEventListener(n, on));
    on();
    return () => events.forEach((n) => videoEl.removeEventListener(n, on));
  }, [videoEl]);
  return t;
}
