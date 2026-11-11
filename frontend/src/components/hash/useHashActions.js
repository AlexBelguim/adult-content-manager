import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CheckHashModal from '../CheckHashModal';
import { errorText, plural, useAsk, useNotify } from '../ui';
import { hashPost, hashRequest } from './hashApi';
import useHashQueue from '../../hooks/useHashQueue';

/**
 * A performer's hash-database actions, for Performer Management's rows and duplicate pairs. Building goes to the
 * server's hash queue (POST /api/hashes/queue), so it runs one at a time and keeps going when the page or the browser
 * is left; a check opens its results in this tab (/hash-results/:runId); "compare" without a target asks for one in
 * CheckHashModal. Render `modals` once on the page.
 * basePath and onError are accepted for the old callers but no longer used: the server finds the folder, and every
 * message is a toast of the app's one host (components/ui), so it still shows after the page was left.
 * job(id) is her active build (queued or processing, from the server's list, or queued while the request is on its
 * way) or null; jobs is the hash rows of the jobs list; buildMany(list) queues every performer of the list that has no
 * hash database and is not queued, in one request with one toast. onChanged(performerId) runs after a delete, and
 * after a check that found nothing.
 */
export default function useHashActions({ basePath, onChanged, onError } = {}) {
  const navigate = useNavigate();
  const ask = useAsk();
  const notify = useNotify();
  const { jobs, jobFor, enqueue } = useHashQueue();
  const [busy, setBusy] = useState(() => new Set());
  const [pending, setPending] = useState(() => new Set());   // performer ids whose queue request is on its way
  const [pickFor, setPickFor] = useState(null);   // a performer id: CheckHashModal asks whom to compare her with
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const say = useCallback((text, severity = 'success') => notify({ message: text, severity }), [notify]);

  const job = (id) => jobFor(id)
    || (pending.has(id) ? { status: 'queued', progress: 0, processed: 0, total: 0, performerId: id } : null);
  const queued = (id) => !!job(id);

  const addPending = (ids) => setPending(prev => {
    const next = new Set(prev);
    ids.forEach(id => next.add(id));
    return next;
  });
  const dropPending = (ids) => {
    if (!mounted.current) return;
    setPending(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  };

  /** Queue building her hash DB; when she has one, a rebuild ('replace') after asking. */
  const build = async (performer) => {
    if (!performer) return;
    if (queued(performer.id)) { say('Already queued, see Jobs', 'info'); return; }
    if (performer.hasHashDB) {
      const ok = await ask({
        title: `Rebuild ${performer.name}'s hash database?`,
        text: 'Every file is read again. Files that are gone are kept as deleted history, so re-downloads are still recognised.',
        okLabel: 'Rebuild hash database',
      });
      if (!ok) return;
    }
    // The server keeps one active build per performer, so a double click (or "Hash both") never queues her twice.
    addPending([performer.id]);
    try {
      const data = await enqueue([{ performerId: performer.id, mode: performer.hasHashDB ? 'replace' : 'append' }]);
      const skipped = data?.skipped?.[0];
      const already = data?.queued?.[0]?.already;
      if (skipped) say(skipped.reason, 'error');
      else if (already === 'running') say('Already hashing, see Jobs', 'info');
      else if (already === 'queued') say('Already queued, see Jobs', 'info');
      else say(`Queued: ${performer.name}`);
    } catch (err) {
      say(errorText(err, 'Could not queue the hash build'), 'error');
    } finally {
      dropPending([performer.id]);
    }
  };

  /** Queue a first build for every one of them that has no hash database and is not queued: one request, one toast. */
  const buildMany = async (list) => {
    const seen = new Set();
    const todo = (list || []).filter(p => {
      if (!p || p.hasHashDB || queued(p.id) || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    if (!todo.length) { say('Nothing to build', 'info'); return; }
    const ids = todo.map(p => p.id);
    addPending(ids);
    try {
      const data = await enqueue(todo.map(p => ({ performerId: p.id, mode: 'append' })));
      const added = (data?.queued || []).filter(q => q.already === false).length;
      const skipped = data?.skipped || [];
      // One toast (a second would replace the first): what was queued, then why the rest was not.
      const notQueued = skipped.length
        ? `${skipped.length === 1 ? '1 not queued' : `${skipped.length} not queued`}: ${skipped[0].reason}`
        : null;
      if (added) {
        notify({
          message: notQueued ? `Queued ${plural(added, 'hash build')}. ${notQueued}` : `Queued ${plural(added, 'hash build')}`,
          severity: notQueued ? 'warning' : 'success',
          action: { label: 'Open Jobs', onClick: () => navigate('/jobs') }
        });
      } else if (notQueued) {
        say(`Nothing queued. ${notQueued}`, 'warning');
      } else {
        say('Nothing to build', 'info');
      }
    } catch (err) {
      say(errorText(err, 'Could not queue the hash builds'), 'error');
    } finally {
      dropPending(ids);
    }
  };

  const remove = async (performer) => {
    if (!performer) return;
    const ok = await ask({
      title: `Delete ${performer.name}'s hash database?`,
      text: 'Her file hashes and duplicate checks are removed. The record of files she deleted is kept, so re-downloads are still recognised. You can build it again any time.',
      okLabel: 'Delete hash database',
      danger: true,
    });
    if (!ok) return;
    try {
      await hashRequest('DELETE', `/performer/${performer.id}`);
      say('Hash database deleted');
      onChanged?.(performer.id);
    } catch (err) {
      say(errorText(err, 'Could not delete the hash database'), 'error');
    }
  };

  /** After a check: open its results in this tab, or say there were none. */
  const finish = (data, noneText, sourceId) => {
    if (!data?.runId || !data.groupCount) {
      say(noneText, 'info');
      onChanged?.(sourceId);
      return;
    }
    if (mounted.current) navigate(`/hash-results/${data.runId}`);
  };

  const withBusy = async (key, fn) => {
    if (busy.has(key)) return;
    setBusy(prev => new Set(prev).add(key));
    try {
      await fn();
    } finally {
      if (mounted.current) setBusy(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  /** Duplicates inside her own files. */
  const checkOwn = (id) => withBusy(`${id}-${id}`, async () => {
    try {
      const data = await hashPost(`/performer/${id}/internal-check`, {});
      finish(data, 'No duplicates in her files', id);
    } catch (err) {
      say(errorText(err, 'The check failed'), 'error');
    }
  });

  const runCompare = (sourceId, targetId) => withBusy(`${sourceId}-${targetId}`, async () => {
    try {
      const data = await hashPost('/check', { source_performer_id: sourceId, target_performer_id: targetId });
      finish(data, 'No copies found between them', sourceId);
    } catch (err) {
      say(errorText(err, 'The compare failed'), 'error');
    }
  });

  /** Her files against another performer's; without a target, ask for one. */
  const compare = (sourceId, targetId) => (targetId ? runCompare(sourceId, targetId) : setPickFor(sourceId));
  const isBusy = (sourceId, targetId = sourceId) => busy.has(`${sourceId}-${targetId}`);

  /** CheckHashModal's compare: errors go back to the dialog (shown inline); success closes it. */
  const compareFromModal = async (targetId, signal) => {
    const sourceId = pickFor;
    const data = await hashPost('/check', { source_performer_id: sourceId, target_performer_id: targetId }, { signal });
    if (signal?.aborted || !mounted.current) return data;
    setPickFor(null);
    finish(data, 'No copies found between them', sourceId);
    return data;
  };

  const modals = (
    <CheckHashModal
      open={pickFor != null}
      sourceId={pickFor}
      onClose={() => setPickFor(null)}
      onCompare={compareFromModal}
    />
  );

  return { queued, job, jobs, build, buildMany, remove, checkOwn, compare, isBusy, modals };
}
