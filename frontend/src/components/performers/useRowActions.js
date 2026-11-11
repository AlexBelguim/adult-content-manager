import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsk, useNotify, errorText, plural } from '../ui';
import ScrapeDialog from '../ScrapeDialog';
import PipelineDialog from '../PipelineDialog';
import RemovePerformerDialog from './RemovePerformerDialog';
import MergeDialog from './MergeDialog';
import { BUSY_WORDS, folderTwinOn, locationWord, relPath, twinOf, otherRecordOf } from './model';

/**
 * Every action of Performer Management, for the rows, the pair rows and the inline detail: run(key, p) does what the
 * key says (model.js's action keys), with its question, busy word and toast. One pending action per row
 * (pendingOf(id)); a second run on a busy row is ignored. check is the Updates view's "Check updates" loop (one request
 * at a time; Stop ends it after the current one; unmounting stops it). Render `dialogs` once on the page.
 *
 * store: usePerformers(); hash: useHashActions(); expand(id, intent?): expands her row in place, its detail opened at
 * intent { section, edit } ('leakhaven-set' asks for { section: 'leakhaven', edit: true }); onMerged(sourceId,
 * targetId): the expanded row follows her into the record she was merged into; onRemoved(id): her record is gone
 * (collapse her row). openDrawer is the old name of expand and still accepted.
 */

/** A request whose answer is { success, error }: the answer, or a throw with the server's reason. */
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw Object.assign(new Error(data.error || `the server answered ${res.status}`), { status: res.status, data });
  }
  return data;
}

/** 'Could not rescan Anna: <reason>' */
const failText = (what, err) => {
  const text = errorText(err, what);
  return text.startsWith(what) ? text : `${what}: ${text}`;
};

const NAME_RULE = 'A name cannot contain / \\ or :, be . or .., or start with a dot';
function nameProblem(value, current) {
  const v = String(value || '').trim();
  if (!v) return 'Enter a name';
  if (v === current) return 'That is her name now';
  // eslint-disable-next-line no-control-regex
  if (/[/\\:]/.test(v) || v === '.' || v === '..' || v.startsWith('.') || /[\u0000-\u001f]/.test(v)) return NAME_RULE;
  if (v.length > 255) return 'A name can be at most 255 characters';
  return null;
}

const NO_CHECK = { running: false, done: 0, total: 0, newCount: 0, failed: 0, currentId: null, result: null };

export default function useRowActions({ store, hash, expand, openDrawer, onMerged, onRemoved }) {
  const ask = useAsk();
  const notify = useNotify();
  const navigate = useNavigate();
  const [pending, setPending] = useState(() => new Map());
  const pendingRef = useRef(new Map());
  const [scrapeFor, setScrapeFor] = useState(null);
  const [removeFor, setRemoveFor] = useState(null);
  const [mergeFor, setMergeFor] = useState(null);
  const [pipelineFor, setPipelineFor] = useState(null);
  const [check, setCheck] = useState(NO_CHECK);
  const checkRunning = useRef(false);
  const stopCheck = useRef(false);
  const aliasSaving = useRef(false);
  const mounted = useRef(true);

  // the latest of everything the callbacks read, so run() stays stable
  const live = useRef({});
  live.current = { store, hash, expand: expand || openDrawer, onMerged, onRemoved };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopCheck.current = true;   // the update check sends nothing after the page is gone
    };
  }, []);

  const say = useCallback((message, severity = 'success', action) => notify({ message, severity, ...(action && { action }) }), [notify]);
  const sayError = useCallback((what, err) => notify({ severity: 'error', message: failText(what, err) }), [notify]);
  const openJobs = useCallback(() => navigate('/jobs'), [navigate]);

  // ── pending, one per row ───────────────────────────────────
  const begin = useCallback((id, key) => {
    if (pendingRef.current.has(id)) return false;
    const next = new Map(pendingRef.current);
    next.set(id, { key, label: BUSY_WORDS[key] || 'Working…' });
    pendingRef.current = next;
    setPending(next);
    return true;
  }, []);
  const end = useCallback((id) => {
    if (!pendingRef.current.has(id)) return;
    const next = new Map(pendingRef.current);
    next.delete(id);
    pendingRef.current = next;
    if (mounted.current) setPending(next);
  }, []);
  const pendingOf = useCallback((id) => pending.get(id) || null, [pending]);

  /** Run fn as her pending action; ignored when she has one already. */
  const withPending = useCallback(async (p, key, fn) => {
    if (!begin(p.id, key)) return;
    try {
      await fn();
    } finally {
      end(p.id);
    }
  }, [begin, end]);

  /** For ask's run: her pending action while it runs; an error shows inline in the question. */
  const pendingRun = useCallback((p, key, fn) => async (answer) => {
    if (!begin(p.id, key)) throw new Error(`${p.name} is busy: wait for it to end`);
    try {
      await fn(answer);
    } finally {
      end(p.id);
    }
  }, [begin, end]);

  const twinIn = (p) => twinOf(p, { byId: live.current.store.byId });

  // ── the actions ────────────────────────────────────────────
  const rename = async (p) => {
    const { store: s } = live.current;
    const other = otherRecordOf(p, { byId: s.byId });
    const otherWord = other && (other.location === 'before' || other.location === 'after') ? locationWord(other) : null;
    const text = (p.actualPath ? `Renames her folder ${relPath(p.actualPath)} and her records.` : 'Renames her records. She has no folder to rename.')
      + (other ? (otherWord ? ` Her other record in ${otherWord} keeps its name and folder.` : ` Her other record (#${other.id}) keeps its name and folder.`) : '');
    let renamed = null;
    await ask({
      title: `Rename ${p.name}`,
      text,
      input: { label: 'New name', value: p.name, validate: (v) => nameProblem(v, p.name) },
      okLabel: 'Rename',
      busyLabel: 'Renaming…',
      run: pendingRun(p, 'rename', async (newName) => {
        try {
          renamed = await call('POST', `/api/performer-management/${p.id}/rename`, { newName, renameFolder: true });
          renamed.newName = renamed.newName || newName;
        } catch (err) {
          throw new Error(failText(`Could not rename ${p.name}`, err));
        }
      })
    });
    if (!renamed) return;
    await live.current.store.reload();
    say(`Renamed to ${renamed.newName}`);
  };

  const rescan = (p) => withPending(p, 'rescan', async () => {
    try {
      const data = await call('POST', `/api/performer-management/${p.id}/rescan`);
      await live.current.store.refreshOne(p.id);
      const st = data.stats || {};
      say(`Rescanned ${p.name}: ${plural(st.pics_count || 0, 'picture')}, ${plural(st.vids_count || 0, 'video')}`);
    } catch (err) {
      sayError(`Could not rescan ${p.name}`, err);
    }
  });

  const markSeen = (p) => withPending(p, 'mark-seen', async () => {
    try {
      await call('POST', `/api/performer-management/${p.id}/acknowledge-update`);
      await live.current.store.refreshOne(p.id);
      say(`Marked ${p.name} seen`);
    } catch (err) {
      sayError(`Could not mark ${p.name} seen`, err);
    }
  });

  /** One check-update: { success, newestUpload, isNew } or { success: false, error } (a refusal throws). */
  const checkRequest = async (id) => {
    const res = await fetch(`/api/performer-management/${id}/check-update`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `the server answered ${res.status}`);
    return data;
  };

  const checkNow = (p) => withPending(p, 'check-now', async () => {
    let data;
    try {
      data = await checkRequest(p.id);
    } catch (err) {
      sayError(`Could not check ${p.name}`, err);
      return;
    }
    await live.current.store.refreshOne(p.id);
    if (data.success === false) say(`Check failed for ${p.name}: ${data.error || 'no reason given'}`, 'warning');
    else if (data.isNew) say(`New upload for ${p.name}`, 'info');
    else say(`No new uploads for ${p.name}`, 'info');
  });

  const unblacklist = async (p) => {
    let done = false;
    await ask({
      title: `Unblacklist ${p.name}?`,
      text: 'She can be imported again. Nothing is deleted.',
      okLabel: 'Unblacklist',
      busyLabel: 'Unblacklisting…',
      run: pendingRun(p, 'unblacklist', async () => {
        try {
          await call('POST', `/api/performer-management/${p.id}/unblacklist`);
          done = true;
        } catch (err) {
          throw new Error(failText(`Could not unblacklist ${p.name}`, err));
        }
      })
    });
    if (!done) return;
    await live.current.store.refreshOne(p.id);
    say(`Unblacklisted ${p.name}`);
  };

  /** Move to After (or merge into her After record when she has one), or back to Before: asked first. */
  const move = async (p, key) => {
    // the server merges into any After record of her name whose folder is on disk, an Empty one too
    const twin = key === 'move-before' ? null : folderTwinOn(p, 'after', { byId: live.current.store.byId });
    const merging = !!twin;
    let data = null;
    const doMove = pendingRun(p, key, async () => {
      const url = key === 'move-before' ? `/api/performers/${p.id}/move-to-before` : `/api/performers/${p.id}/move-to-after`;
      try {
        data = await call('POST', url);
      } catch (err) {
        const what = merging ? `Could not merge ${p.name}` : `Could not move ${p.name}`;
        throw new Error(failText(what, err));
      }
    });
    if (key === 'move-before') {
      await ask({
        title: `Move ${p.name} back to Before?`,
        text: `Her folder moves to before filter performer/${p.name} and her filter decisions are cleared, so she is filtered again.`,
        okLabel: 'Move back to Before',
        danger: true,
        busyLabel: 'Moving…',
        run: doMove
      });
    } else if (merging) {
      await ask({
        title: `Merge ${p.name} into her After record?`,
        text: 'Her Before pictures and videos move into the After folder, renamed where a file name is taken. Her hashes go to the After record, and the Before record is deleted with its filter decisions and tags. Cannot be undone.',
        okLabel: 'Merge into her After record',
        danger: true,
        busyLabel: 'Merging…',
        run: doMove
      });
    } else {
      await ask({
        title: `Move ${p.name} to After?`,
        text: `Her folder moves to after filter performer/${p.name}, as when filtering is done. Her filter decisions are cleared.`,
        okLabel: 'Move to After',
        busyLabel: 'Moving…',
        run: doMove
      });
    }
    if (!data) return;
    const { store: s, onMerged: merged } = live.current;
    if (merging) {
      merged?.(p.id, twin.id);   // first, so her expanded row follows her before this one is gone
      await s.reload();
      say(`Merged ${p.name} into her After record`);
    } else if (key === 'move-before') {
      await s.reload();
      say(`Moved ${p.name} back to Before`);
    } else {
      await s.reload();
      say(data.merged ? `Merged ${p.name} into her After record` : `Moved ${p.name} to After`);
    }
  };

  const run = (key, p) => {
    if (!p || pendingRef.current.has(p.id)) return;   // one action per row at a time
    const { hash: h, expand: open } = live.current;
    switch (key) {
      case 'gallery': navigate(`/p/${p.id}`); return;
      case 'filter': navigate(`/filter/${p.id}`); return;
      case 'leakhaven-open':
        if (p.leakshavenUpdate?.url) window.open(p.leakshavenUpdate.url, '_blank', 'noopener,noreferrer');
        return;
      case 'leakhaven-set': open?.(p.id, { section: 'leakhaven', edit: true }); return;
      case 'rename': rename(p); return;
      case 'scrape': setScrapeFor(p); return;
      case 'rescan': rescan(p); return;
      case 'mark-seen': markSeen(p); return;
      case 'check-now': checkNow(p); return;
      case 'unblacklist': unblacklist(p); return;
      case 'pipeline': setPipelineFor(p.id); return;
      case 'hash-build': h?.build(p); return;
      case 'hash-check': h?.checkOwn(p.id); return;
      case 'hash-compare': h?.compare(p.id); return;
      case 'hash-compare-twin': {
        const twin = twinIn(p);
        if (twin) h?.compare(p.id, twin.id);
        return;
      }
      case 'hash-build-pair': h?.buildMany([p, twinIn(p)].filter(Boolean)); return;
      case 'hash-delete': h?.remove(p); return;
      case 'move-after':
      case 'merge-pair': move(p, key); return;
      case 'move-before': move(p, key); return;
      case 'merge': setMergeFor(p); return;
      case 'remove': setRemoveFor(p); return;
      default: console.warn(`Performer Management: no action "${key}"`);
    }
  };

  // ── Check updates (the Updates view) ───────────────────────
  const startCheck = async () => {
    if (checkRunning.current) return;
    const linked = live.current.store.list.filter(p => p.leakshavenUpdate?.url && p.blacklisted !== 1 && p.location !== 'blacklisted');
    if (!linked.length) { say('No linked performers to check', 'info'); return; }
    checkRunning.current = true;
    stopCheck.current = false;
    const total = linked.length;
    let done = 0;
    let newFound = 0;
    let failed = 0;
    setCheck(c => ({ running: true, done, total, newCount: 0, failed: 0, currentId: null, result: c.result }));
    for (const p of linked) {
      if (stopCheck.current || !mounted.current) break;
      setCheck(c => ({ ...c, currentId: p.id }));
      let data;
      try {
        data = await checkRequest(p.id);
      } catch (err) {
        data = { success: false, error: errorText(err) };
      }
      done++;
      if (data.isNew) newFound++;
      if (data.success === false) failed++;
      if (!mounted.current) break;
      const snap = { done, newCount: newFound, failed };
      setCheck(c => ({ ...c, ...snap }));
      live.current.store.refreshOne(p.id);
    }
    checkRunning.current = false;
    if (!mounted.current) return;
    const result = { done, newCount: newFound, failed };
    setCheck({ running: false, done, total, newCount: newFound, failed, currentId: null, result });
    say(`Checked ${done}: ${newFound} new, ${failed} failed`, failed > 0 ? 'warning' : 'info');
  };
  const stop = useCallback(() => { stopCheck.current = true; }, []);

  // ── Build missing (the Duplicates view) ────────────────────
  const buildMissing = async (list) => {
    const n = (list || []).length;
    if (!n) return;
    const ok = await ask({
      title: `Build ${plural(n, 'hash database')}?`,
      text: 'They are built one after another on the hash queue; follow them on Jobs. Each one reads every file in her folder.',
      okLabel: `Build ${n}`
    });
    if (!ok) return;
    live.current.hash?.buildMany(list);
  };

  // ── detail helpers ─────────────────────────────────────────
  /** PUT her Leakhaven link: null when saved, else the error to show under the field. */
  const saveLink = async (p, link) => {
    try {
      await call('PUT', `/api/performer-management/${p.id}/leakhaven-link`, { link });
    } catch (err) {
      return failText('Could not save the link', err);
    }
    await live.current.store.refreshOne(p.id);
    say('Link saved');
    return null;
  };

  const removeLink = async (p) => {
    let done = false;
    await ask({
      title: 'Remove her Leakhaven link?',
      text: 'Her update history is cleared.',
      okLabel: 'Remove link',
      danger: true,
      busyLabel: 'Removing…',
      run: async () => {
        try {
          await call('PUT', `/api/performer-management/${p.id}/leakhaven-link`, { link: '' });
          done = true;
        } catch (err) {
          throw new Error(failText('Could not remove the link', err));
        }
      }
    });
    if (!done) return;
    await live.current.store.refreshOne(p.id);
    say('Link removed');
  };

  /** PUT her whole alias list; one save at a time. true when saved (the store has it), false after an error toast. */
  const saveAliases = async (p, aliases) => {
    if (aliasSaving.current) return false;
    aliasSaving.current = true;
    try {
      await call('PUT', `/api/performers/${p.id}/aliases`, { aliases });
      live.current.store.patch(p.id, { aliases });
      return true;
    } catch (err) {
      sayError(`Could not save ${p.name}'s aliases`, err);
      return false;
    } finally {
      aliasSaving.current = false;
    }
  };

  const copyPath = async (p) => {
    const text = p.actualPath || p.expectedPath;
    if (!text) { say('She has no path to copy', 'info'); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      say('Path copied');
    } catch (err) {
      say('Not copied: this browser blocks the clipboard here. Select the path and copy it yourself.', 'warning');
    }
  };

  // ── dialogs ────────────────────────────────────────────────
  const onRemoveDone = async (choice, data) => {
    const { store: s, onRemoved: removed } = live.current;
    const id = removeFor?.id;
    if (id != null && data?.success && ['delete-record', 'delete-complete', 'delete-forget'].includes(choice)) {
      removed?.(id);   // first, so her row collapses before it is gone
      s.remove(id);
    }
    await s.reload();
  };

  const onMergeDone = async (target) => {
    const source = mergeFor;
    const { store: s, onMerged: merged } = live.current;
    if (source && target) merged?.(source.id, target.id);   // first: her expanded row follows her
    await s.reload();
    if (source && target) say(`Merged ${source.name} into ${target.name}`);
  };

  const dialogs = (
    <>
      <ScrapeDialog
        performer={scrapeFor}
        open={!!scrapeFor}
        onClose={() => setScrapeFor(null)}
        onSaved={() => { if (scrapeFor) live.current.store.refreshOne(scrapeFor.id); }}
      />
      <RemovePerformerDialog
        open={!!removeFor}
        performer={removeFor ? (store.byId.get(removeFor.id) || removeFor) : null}
        onClose={() => setRemoveFor(null)}
        onDone={onRemoveDone}
      />
      <MergeDialog
        open={!!mergeFor}
        source={mergeFor}
        performers={store.list}
        onClose={() => setMergeFor(null)}
        onMerged={onMergeDone}
      />
      <PipelineDialog
        open={pipelineFor != null}
        initialPerformerIds={pipelineFor != null ? [pipelineFor] : []}
        onClose={() => setPipelineFor(null)}
        onQueued={(msg) => say(typeof msg === 'string' && msg ? msg : 'Queued', 'success', { label: 'Open Jobs', onClick: openJobs })}
      />
    </>
  );

  return {
    run,
    pendingOf,
    check: { ...check, start: startCheck, stop },
    buildMissing,
    saveLink,
    removeLink,
    saveAliases,
    copyPath,
    dialogs
  };
}
