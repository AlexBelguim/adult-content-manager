import { useCallback, useEffect, useRef, useState } from 'react';
import { hashGet } from '../hashApi';

/* ─── local group helpers ────────────────────────────────────────── */

/** Recount a group's selected members and bytes after a local change. */
export function recountGroup(g) {
  let selected = 0;
  let bytes = 0;
  for (const m of g.members) {
    if (m.selected) { selected += 1; bytes += Number(m.size) || 0; }
  }
  return { ...g, counts: { ...g.counts, selected }, selectedBytes: bytes };
}

/**
 * Map every member of every group. `fn(member, group)` returns the same
 * object when nothing changes, so untouched groups and tiles keep their
 * identity (and React.memo skips them).
 */
export function mapGroupsMembers(groups, fn) {
  if (!groups) return groups;
  let any = false;
  const next = groups.map(g => {
    let changed = false;
    const members = g.members.map(m => {
      const r = fn(m, g);
      if (r !== m) changed = true;
      return r;
    });
    if (!changed) return g;
    any = true;
    return recountGroup({ ...g, members });
  });
  return any ? next : groups;
}

function buildQuery(q) {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  return p.toString();
}

/**
 * The review section of one run.
 *
 * status: 'loading' (first load, nothing to show yet) | 'ready' | 'notfound' | 'error'.
 * Later loads keep the content (`refreshing` is true meanwhile) and never
 * unmount anything. Late answers are dropped (AbortController + sequence).
 * While the run is still pending the page is fetched again every 3 s.
 */
export default function useRunData(runId, query) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [laterError, setLaterError] = useState(null);
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const loadedRunRef = useRef(null); // run id the data on screen belongs to
  const qs = buildQuery({ section: 'review', pageSize: 20, ...query });

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRefreshing(true);
    try {
      const res = await hashGet(`/run/${encodeURIComponent(runId)}?${qs}`, { signal: ctrl.signal });
      if (seq !== seqRef.current) return;
      loadedRunRef.current = runId;
      setData(res);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError' || seq !== seqRef.current) return;
      if (err.status === 404) {
        setStatus('notfound');
        setError(err);
      } else if (loadedRunRef.current === runId) {
        // Keep what is on screen; the page shows the problem as a toast.
        setLaterError({ err, at: Date.now() });
      } else {
        setStatus('error');
        setError(err);
      }
    } finally {
      if (seq === seqRef.current) setRefreshing(false);
    }
  }, [runId, qs]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  // A run that is still being written: ask again every 3 s.
  const runStatus = data?.run?.status;
  useEffect(() => {
    if (status !== 'ready' || runStatus !== 'pending' || refreshing) return undefined;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [status, runStatus, refreshing, load]);

  const replaceGroup = useCallback((oldKey, group) => {
    setData(d => d && ({ ...d, groups: d.groups.map(g => (g.key === oldKey ? group : g)) }));
  }, []);

  const mapMembers = useCallback(fn => {
    setData(d => {
      if (!d) return d;
      const groups = mapGroupsMembers(d.groups, fn);
      return groups === d.groups ? d : { ...d, groups };
    });
  }, []);

  const setSelection = useCallback(selection => {
    if (!selection) return;
    setData(d => d && ({ ...d, selection }));
  }, []);

  const patchRun = useCallback(patch => {
    setData(d => d && ({ ...d, run: { ...d.run, ...patch } }));
  }, []);

  /** Any other local change: fn(data) returns the new data. */
  const patchData = useCallback(fn => {
    setData(d => (d ? fn(d) : d));
  }, []);

  return {
    data, status, error, refreshing, laterError,
    reload: load, replaceGroup, mapMembers, setSelection, patchRun, patchData
  };
}

/**
 * The 'Other copy already removed' section: fetched only while it is open,
 * one page at a time, 'Show more' appends the next page.
 */
export function useOrphans(runId, open) {
  const [groups, setGroups] = useState([]);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const seqRef = useRef(0);
  const abortRef = useRef(null);

  const fetchPage = useCallback(async (p, append) => {
    const seq = ++seqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const res = await hashGet(
        `/run/${encodeURIComponent(runId)}?section=orphans&page=${p}&pageSize=20`,
        { signal: ctrl.signal }
      );
      if (seq !== seqRef.current) return;
      const got = res.groups || [];
      setGroups(prev => {
        if (!append) return got;
        const seen = new Set(prev.map(g => g.key));
        return [...prev, ...got.filter(g => !seen.has(g.key))];
      });
      setPage(res.page || p);
      setPageCount(res.pageCount || 0);
      setTotal(res.filteredGroups ?? res.totals?.orphanGroups ?? got.length);
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError' || seq !== seqRef.current) return;
      setError(err);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [runId]);

  /** Fetch the pages loaded so far again (after a removal or a restore). */
  const reload = useCallback(async () => {
    if (!open) return;
    const upto = Math.max(1, page);
    await fetchPage(1, false);
    for (let p = 2; p <= upto; p += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fetchPage(p, true);
    }
  }, [open, page, fetchPage]);

  useEffect(() => {
    if (open) {
      fetchPage(1, false);
    } else {
      seqRef.current += 1;
      if (abortRef.current) abortRef.current.abort();
      setGroups([]); setPage(0); setPageCount(0); setLoading(false); setError(null);
    }
  }, [open, runId, fetchPage]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const loadMore = useCallback(() => {
    if (page < pageCount) fetchPage(page + 1, true);
  }, [page, pageCount, fetchPage]);

  const mapMembers = useCallback(fn => setGroups(gs => mapGroupsMembers(gs, fn)), []);
  const dropGroup = useCallback(key => {
    setGroups(gs => gs.filter(g => g.key !== key));
    setTotal(t => Math.max(0, t - 1));
  }, []);

  // Open but not fetched yet (the fetch starts after paint): that is loading, not empty.
  const pending = open && page === 0 && !error;
  return {
    groups, page, pageCount, total, loading: loading || pending, error, loadMore, reload, mapMembers, dropGroup
  };
}
