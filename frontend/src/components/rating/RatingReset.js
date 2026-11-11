/**
 * Reset all ratings, and the snapshots that make it undoable.
 *
 * The server keeps a snapshot of every performer's rating before each reset and before each restore (the 10
 * newest are kept), so both can be put back.
 *
 *   POST /api/performers/reset-rankings                 -> { success, count, snapshotId }
 *   GET  /api/performers/rating-snapshots               -> { snapshots: [{ id, created_at (ms), label, performers }] }
 *   POST /api/performers/rating-snapshots/:id/restore   -> { success, restored, snapshotId (the one taken first) }
 *
 *   const resetAll = useRatingReset({ onChange });     // asks, resets, toasts with Undo; onChange after either
 *   <RatingSnapshots />                                // Settings > System: the kept snapshots, each with Restore
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Section, LoadingState } from '../layout';
import { useAsk, useNotify, plural, errorText } from '../ui';
import { SmallButton } from '../discover/shared';
import { Rows, rowSx, metaSx, getJson, sendJson, SectionError } from '../settings/kit';

const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const restoreRatingSnapshot = (id) => sendJson('POST', `/api/performers/rating-snapshots/${id}/restore`, {});

/**
 * Restores a snapshot and says so, with Undo (which restores the snapshot the restore took first).
 * Resolves true when it was restored.
 */
async function restoreAndTell(id, notify, onChange, message = 'Ratings put back') {
  try {
    const data = await restoreRatingSnapshot(id);
    if (onChange) onChange();
    const undoId = data.snapshotId;
    notify({
      message: `${message} · ${plural(data.restored || 0, 'performer')}`,
      severity: 'success',
      action: undoId ? { label: 'Undo', onClick: () => restoreAndTell(undoId, notify, onChange, 'Restore undone') } : undefined
    });
    return true;
  } catch (err) {
    notify({ message: 'Could not put the ratings back: ' + errorText(err), severity: 'error' });
    return false;
  }
}

/** Returns reset(): asks (type "reset"), resets every rating to 2.5, then a toast offers Undo. */
export function useRatingReset({ onChange } = {}) {
  const ask = useAsk();
  const notify = useNotify();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  return useCallback(async () => {
    let result = null;
    const done = await ask({
      title: 'Reset all ratings?',
      text: 'Every rated performer goes back to 2.5 stars, in the after and the before folder. Duel counts and duel history stay. A snapshot of the ratings is kept first: Undo, or Restore in Settings > System, puts them back.',
      okLabel: 'Reset all ratings',
      danger: true,
      typeToConfirm: 'reset',
      busyLabel: 'Resetting…',
      run: async () => {
        const data = await sendJson('POST', '/api/performers/reset-rankings', {});
        if (!data.success) throw new Error(data.error || 'The server did not reset them');
        result = data;
      }
    });
    if (!done || !result) return false;
    const changed = () => { if (onChangeRef.current) onChangeRef.current(); };
    changed();
    const snapshotId = result.snapshotId;
    notify({
      message: `Reset ${plural(result.count || 0, 'performer')} to 2.5 stars`,
      severity: 'success',
      action: snapshotId ? { label: 'Undo', onClick: () => restoreAndTell(snapshotId, notify, changed) } : undefined
    });
    return true;
  }, [ask, notify]);
}

/** Settings > System: the kept snapshots of the ratings, newest first, each with Restore. */
export function RatingSnapshots() {
  const ask = useAsk();
  const notify = useNotify();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await getJson('/api/performers/rating-snapshots');
      if (!alive.current) return;
      setList(Array.isArray(data.snapshots) ? data.snapshots : []);
      setError(null);
    } catch (e) {
      if (alive.current) setError(errorText(e, 'Could not read the snapshots'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (s) => {
    let restored = null;
    const ok = await ask({
      title: 'Restore these ratings?',
      text: `Every performer gets the rating it had on ${when(s.created_at)}. Performers added since keep theirs. The ratings as they are now are kept as a snapshot first, so this can be undone too.`,
      okLabel: 'Restore',
      busyLabel: 'Restoring…',
      run: async () => { restored = await restoreRatingSnapshot(s.id); }
    });
    if (!ok || !restored) return;
    load();
    const undoId = restored.snapshotId;
    notify({
      message: `Ratings restored · ${plural(restored.restored || 0, 'performer')}`,
      severity: 'success',
      action: undoId ? { label: 'Undo', onClick: () => restoreAndTell(undoId, notify, load, 'Restore undone') } : undefined
    });
  };

  return (
    <Section title="Rating snapshots"
      description="Kept before each reset of all ratings and before each restore. The 10 newest stay."
      actions={<SmallButton onClick={load}>Reload</SmallButton>}>
      {error && <SectionError error={error} onRetry={load} />}
      {!list && !error && <LoadingState />}
      {list && list.length === 0 && (
        <Box sx={metaSx}>No snapshots yet. One is kept each time all ratings are reset.</Box>
      )}
      {list && list.length > 0 && (
        <Rows>
          {list.map(s => (
            <Box key={s.id} sx={rowSx}>
              <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                {s.label}
                <Box component="span" sx={{ ...metaSx, ml: 1 }}>{when(s.created_at)}</Box>
              </Box>
              <Box component="span" sx={{ ...metaSx, flexShrink: 0, fontVariantNumeric: 'tabular-nums', display: { xs: 'none', sm: 'inline' } }}>
                {`${plural(s.performers || 0, 'performer')} rated`}
              </Box>
              <SmallButton onClick={() => restore(s)} sx={{ flexShrink: 0 }}>Restore…</SmallButton>
            </Box>
          ))}
        </Rows>
      )}
    </Section>
  );
}

export default RatingSnapshots;
