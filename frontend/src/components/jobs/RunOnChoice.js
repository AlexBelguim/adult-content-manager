import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { useRunOn } from '../RunOnSelect';

/**
 * "Run on" for jobs still waiting (POST /api/jobs/run-on): label, funscript and training rows. RowRunOn sits on one
 * waiting row; BulkRunOn on the content line moves every waiting one shown. The choices: "Follow the order" (the
 * coordinator's) or a machine that takes the kind (every kind of the rows, for the bulk one). Without a coordinator
 * there is nothing to choose and these draw nothing.
 */
const PART = { label: 'label', funpipe: 'funscript', train: 'training' };
export const runOnPart = (job) => (job?.status === 'queued' ? PART[job.type] || null : null);

const selectSx = {
  height: 26, maxWidth: 150, fontSize: '.75rem', fontFamily: 'inherit', color: 'var(--text)', bgcolor: 'var(--bg)',
  border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', px: 0.5, cursor: 'pointer',
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
};

async function setRunOn(ids, runOn) {
  const r = await fetch('/api/jobs/run-on', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, runOn: runOn || null })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `The server answered ${r.status}`);
  return d;
}

function Choice({ parts, value, label, title, onPick, disabled }) {
  const run = useRunOn(parts);
  if (!run.connected || run.nodes.length === 0) return null;
  const known = !value || run.nodes.some(n => n.id === value);
  return (
    <Tooltip title={title}>
      <Box component="select" aria-label={label} value={known ? (value || '') : ''} disabled={disabled}
        onClick={e => e.stopPropagation()} onChange={e => onPick(e.target.value || null)} sx={selectSx}>
        <option value="">{label === 'Run on' ? 'Follow the order' : 'Waiting: follow the order'}</option>
        {run.nodes.map(n => (
          <option key={n.id} value={n.id}>{label === 'Run on' ? '' : 'Waiting: only '}{n.name}{n.online ? '' : ' (away)'}</option>
        ))}
      </Box>
    </Tooltip>
  );
}

/** One waiting row's machine. onDone(message, error) after a change. */
export function RowRunOn({ job, onDone }) {
  const part = runOnPart(job);
  if (!part) return null;
  const pick = (runOn) => setRunOn([job.id], runOn).then(() => onDone?.(null), (e) => onDone?.(e));
  return <Choice parts={[part]} value={job.raw?.runOn || null} label="Run on" onPick={pick}
    title="Run on: follow the coordinator's order, or wait for this machine" />;
}

/** Every waiting label / funscript / training row in `jobs` to one machine, or back to the order. */
export function BulkRunOn({ jobs, onDone, disabled }) {
  const waiting = jobs.filter(runOnPart);
  const parts = [...new Set(waiting.map(runOnPart))].sort();
  if (!waiting.length) return null;
  const pins = new Set(waiting.map(j => j.raw?.runOn || ''));
  const value = pins.size === 1 ? [...pins][0] || null : '__mixed';
  const pick = (runOn) => setRunOn(waiting.map(j => j.id), runOn).then(
    (d) => onDone?.(null, `${d.changed} waiting job${d.changed === 1 ? '' : 's'} ${runOn ? 'pinned to that machine' : 'follow the order again'}`),
    (e) => onDone?.(e));
  return <Choice key={parts.join()} parts={parts} value={value === '__mixed' ? null : value} label="Waiting jobs run on"
    onPick={pick} disabled={disabled}
    title={`The ${waiting.length} waiting label, funscript and training job${waiting.length === 1 ? '' : 's'} shown: follow the order, or only this machine`} />;
}
