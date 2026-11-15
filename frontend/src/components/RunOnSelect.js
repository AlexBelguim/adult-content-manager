import React, { useEffect, useState } from 'react';
import { TextField } from '@mui/material';

/**
 * "Run on": where a GPU job runs. "Follow the order" (the order set for its kind in the coordinator) or one machine
 * among those that take it; a job pinned to a machine waits for that machine. The choices come from GET
 * /api/coordinator/kinds (routes/coordinator.js); without a coordinator there is nothing to choose and this draws nothing.
 *
 *   const run = useRunOn(['label', 'funscript']);   // { connected, nodes: [{ id, name, online, place }], now }
 *   <RunOnSelect parts={['label', 'funscript']} value={runOn} onChange={setRunOn} />
 *
 * parts: the job kinds the queued work makes (Labels + funscript: both); a machine is listed when it takes every one.
 */
let cache = { at: 0, value: null, pending: null };
function loadKinds() {
  if (cache.value && Date.now() - cache.at < 15000) return Promise.resolve(cache.value);
  if (cache.pending) return cache.pending;
  cache.pending = fetch('/api/coordinator/kinds')
    .then(r => (r.ok ? r.json() : { connected: false, parts: {} }))
    .catch(() => ({ connected: false, parts: {} }))
    .then(v => { cache = { at: Date.now(), value: v, pending: null }; return v; });
  return cache.pending;
}

export function useRunOn(parts) {
  const [kinds, setKinds] = useState(cache.value);
  useEffect(() => {
    let alive = true;
    loadKinds().then(v => { if (alive) setKinds(v); });
    return () => { alive = false; };
  }, []);
  const key = parts.join(',');
  const first = kinds?.parts?.[parts[0]];
  const takes = (id) => parts.every(p => (kinds?.parts?.[p]?.nodes || []).some(n => n.id === id && n.takes));
  return {
    connected: !!kinds?.connected,
    key,
    nodes: (first?.nodes || []).filter(n => takes(n.id)),
    now: first?.now || null,
  };
}

export default function RunOnSelect({ parts, value, onChange, size = 'small', sx, label = 'Run on' }) {
  const run = useRunOn(parts);
  if (!run.connected || run.nodes.length === 0) return null;
  const known = !value || run.nodes.some(n => n.id === value);
  return (
    <TextField
      select size={size} label={label} value={known ? (value || '') : ''}
      onChange={e => onChange(e.target.value || null)}
      SelectProps={{ native: true }}
      helperText={!value && run.now ? `The order: ${run.now.replace(/^in order: /, '')}` : value ? 'It waits for that machine' : undefined}
      sx={{ minWidth: 200, ...sx }}
      onKeyDown={e => e.stopPropagation()}
    >
      <option value="">Follow the order</option>
      {run.nodes.map(n => (
        <option key={n.id} value={n.id}>{n.name}{n.online ? '' : ' (away)'}</option>
      ))}
    </TextField>
  );
}
