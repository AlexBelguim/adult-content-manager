import React, { useEffect, useMemo, useState } from 'react';
import { Box, TextField, Checkbox, FormControlLabel, Typography } from '@mui/material';
import { queuePipeline } from '../utils/pipelines';
import { AppDialog, DialogText, errorText } from './ui';

/**
 * Pick performers and/or content folders and queue labels (labelmaster's scenes) and funscripts for all their
 * videos on scenetest (POST /api/pipelines/queue). `initialPerformerIds` preselects, e.g. from Performer Management.
 */
export default function PipelineDialog({ open, onClose, onQueued, initialPerformerIds = [] }) {
  const [targets, setTargets] = useState({ performers: [], folders: [] });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(() => new Set(initialPerformerIds.map(String)));
  const [folders, setFolders] = useState(() => new Set());
  const [steps, setSteps] = useState({ labels: true, funscript: true });
  const [skipDone, setSkipDone] = useState(true);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPicked(new Set(initialPerformerIds.map(String)));
    setError('');
    fetch('/api/pipelines/targets')
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Could not load the performers (${r.status})`);
        setTargets({ performers: d.performers || [], folders: d.folders || [] });
      })
      .catch((e) => setError(errorText(e, 'Could not load the performers')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const body = useMemo(() => ({ performerIds: [...picked].map(Number), folders: [...folders] }), [picked, folders]);

  useEffect(() => {
    if (!open || (picked.size === 0 && folders.size === 0)) { setCount(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      fetch('/api/pipelines/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => (r.ok ? r.json() : null)).then(d => { if (alive) setCount(d); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [open, body, picked.size, folders.size]);

  const q = query.trim().toLowerCase();
  const shown = targets.performers.filter(p => !q || p.name.toLowerCase().includes(q));
  const toggle = (set, setter, key) => setter(() => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const queue = async () => {
    setBusy(true);
    setError('');
    try {
      onQueued(await queuePipeline({ ...body, steps: Object.keys(steps).filter(k => steps[k]), skipDone }));
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not queue them'));
    } finally {
      setBusy(false);
    }
  };

  const listSx = { maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', p: 0.5 };
  const rowSx = { display: 'flex', alignItems: 'center', m: 0, px: 0.5, width: '100%', '& .MuiFormControlLabel-label': { flex: 1, minWidth: 0 } };

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Labels and funscripts"
      subtitle={count?.videos != null
        ? `${picked.size} performers, ${folders.size} folders · ${count.videos} videos, ${count.labelled} already labelled`
        : 'Pick performers or folders'}
      size="md"
      busy={busy}
      error={error || null}
      primary={{
        label: 'Queue',
        busyLabel: 'Queuing…',
        onClick: queue,
        disabled: !count?.videos || (!steps.labels && !steps.funscript),
      }}
    >
      <DialogText sx={{ mb: 2 }}>
        scenetest on the GPU PC labels every video of what you pick (scenes, dress state, tags), then makes funscripts
        from the scenes. They run ahead of its own backlog; pause them from the Jobs page.
      </DialogText>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 2, '@media (max-width: 700px)': { gridTemplateColumns: '1fr' } }}>
        <Box>
          <TextField size="small" fullWidth placeholder={`Search ${targets.performers.length} performers`} value={query}
            onChange={e => setQuery(e.target.value)} sx={{ mb: 1 }} />
          <Box sx={listSx}>
            {shown.map(p => (
              <FormControlLabel key={p.id} sx={rowSx}
                control={<Checkbox size="small" checked={picked.has(String(p.id))} onChange={() => toggle(picked, setPicked, String(p.id))} />}
                label={(
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', fontSize: '.86rem' }}>
                    <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</Box>
                    <Box component="span" sx={{ color: 'var(--muted)', fontSize: '.76rem' }}>{p.where} · {p.videos} videos</Box>
                  </Box>
                )} />
            ))}
          </Box>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Content folders</Typography>
          <Box sx={listSx}>
            {targets.folders.map(f => (
              <FormControlLabel key={f} sx={rowSx} label={<Box component="span" sx={{ fontSize: '.86rem' }}>{f}</Box>}
                control={<Checkbox size="small" checked={folders.has(f)} onChange={() => toggle(folders, setFolders, f)} />} />
            ))}
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mt: 2 }}>
        <FormControlLabel label="Labels" control={<Checkbox checked={steps.labels} onChange={e => setSteps(s => ({ ...s, labels: e.target.checked }))} />} />
        <FormControlLabel label="Funscripts" control={<Checkbox checked={steps.funscript} onChange={e => setSteps(s => ({ ...s, funscript: e.target.checked }))} />} />
        <FormControlLabel label="Skip videos already done" control={<Checkbox checked={skipDone} onChange={e => setSkipDone(e.target.checked)} />} />
      </Box>
    </AppDialog>
  );
}
