import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { socketService } from '../../services/SocketService';
import { useNotify, errorText } from '../ui';
import { sideOf } from './model';

/**
 * Performer Management's one store: every record from GET /api/performer-management/all, always live (no IndexedDB
 * copy is painted: the list takes destructive actions). reload() fetches the list again (refreshing while it runs; a
 * failure keeps the list and says so in a toast, the first load's failure is `error`), refreshOne(id) fetches one row
 * (GET /api/performer-management/:id; gone -> removed). A socket `performers_updated` with a listed performerId
 * refreshes that row, any other one reloads (600 ms debounce). unlabelled(p): her videos with no label
 * (GET /api/video-labels/counts, once).
 */

const LIST_URL = '/api/performer-management/all';

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return { res, data };
}

export default function usePerformers() {
  const notify = useNotify();
  const [state, setState] = useState({ list: [], loaded: false, error: null, refreshing: false });
  const [labelCounts, setLabelCounts] = useState({});
  const mounted = useRef(true);
  const seq = useRef(0);
  const live = useRef(state);
  live.current = state;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    const n = ++seq.current;
    setState(s => ({ ...s, refreshing: s.loaded }));
    let error = null;
    let list = null;
    try {
      const { res, data } = await getJson(LIST_URL);
      if (!res.ok || !data || !data.success) error = (data && data.error) || `The list did not load: the server answered ${res.status}`;
      else list = Array.isArray(data.performers) ? data.performers : [];
    } catch (err) {
      error = errorText(err, 'The list did not load');
    }
    if (!mounted.current || n !== seq.current) return;
    if (list) {
      setState({ list, loaded: true, error: null, refreshing: false });
      return;
    }
    const had = live.current.list.length > 0;
    setState(s => ({ ...s, loaded: true, error, refreshing: false }));
    if (had) notify({ severity: 'error', message: `Could not reload the list: ${error}` });
  }, [notify]);

  const replaceRow = useCallback((id, row) => {
    setState(s => {
      const at = s.list.findIndex(p => p.id === id);
      if (!row) return at < 0 ? s : { ...s, list: s.list.filter(p => p.id !== id) };
      if (at < 0) return { ...s, list: [...s.list, row] };
      const list = s.list.slice();
      list[at] = row;
      return { ...s, list };
    });
  }, []);

  const refreshOne = useCallback(async (id) => {
    const key = Number(id);
    if (!Number.isFinite(key)) return;
    const n = seq.current;
    try {
      const { res, data } = await getJson(`/api/performer-management/${key}`);
      if (!mounted.current || n !== seq.current) return;   // a full reload started meanwhile: it has her
      // an older server has no one-row route: its 404 is 'No such API route', or not JSON at all; fetch the list instead
      const noRoute = !data || /^No such API route/.test(String(data.error || ''));
      if (noRoute) { await reload(); return; }
      if (res.status === 404 && !data.success) { replaceRow(key, null); return; }
      if (res.ok && data.success && data.performer) replaceRow(key, data.performer);
    } catch (err) {
      console.warn(`Could not refresh performer ${key}:`, err);
    }
  }, [replaceRow, reload]);

  const patch = useCallback((id, changes) => {
    setState(s => ({ ...s, list: s.list.map(p => (p.id === id ? { ...p, ...changes } : p)) }));
  }, []);

  const remove = useCallback((id) => replaceRow(id, null), [replaceRow]);

  const byId = useMemo(() => new Map(state.list.map(p => [p.id, p])), [state.list]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  // first load, and the labelled-video counts once
  useEffect(() => {
    reload();
    fetch('/api/video-labels/counts')
      .then(r => (r.ok ? r.json() : { counts: {} }))
      .then(d => { if (mounted.current) setLabelCounts(d.counts || {}); })
      .catch(() => {});
  }, [reload]);

  // a hash build or check ended, a scan changed her: refresh her row, or the list
  useEffect(() => {
    let timer = null;
    const onUpdate = (payload) => {
      const id = payload?.performerId != null ? Number(payload.performerId) : null;
      if (id != null && byIdRef.current.has(id)) { refreshOne(id); return; }
      clearTimeout(timer);
      timer = setTimeout(() => { if (mounted.current) reload(); }, 600);
    };
    socketService.connect();
    socketService.on('performers_updated', onUpdate);
    return () => {
      clearTimeout(timer);
      socketService.off('performers_updated', onUpdate);
    };
  }, [refreshOne, reload]);

  const unlabelled = useCallback((p) => {
    if (!p) return 0;
    const labelled = labelCounts[`${sideOf(p)}/${p.name}`] || 0;
    return Math.max(0, (p.vids_count || 0) - labelled);
  }, [labelCounts]);

  return {
    list: state.list,
    byId,
    loaded: state.loaded,
    error: state.error,
    refreshing: state.refreshing,
    reload,
    refreshOne,
    patch,
    remove,
    unlabelled
  };
}
