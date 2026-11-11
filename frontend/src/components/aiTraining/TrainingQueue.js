import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Chip, Button, Alert, LinearProgress, IconButton, Tooltip } from '@mui/material';
import { ArrowUpward, ArrowDownward } from '@mui/icons-material';
import { Panel, Section, iconBtnSx } from '../layout';
import { useAsk } from '../ui';

/**
 * The training queue (GET /api/training/queue): the run going on acm-gpu, the ones waiting (in the order they run),
 * and the last that ended. Cancel stops a waiting run at once and a running one within seconds; ▲▼ reorder the waiting.
 */
export default function TrainingQueue({ version }) {
  const [q, setQ] = useState(null);
  const [error, setError] = useState(null);
  const ask = useAsk();
  const load = useCallback(() => fetch('/api/training/queue').then(r => r.json()).then(d => { setQ(d); setError(null); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load, version]);
  const act = async (url, method = 'POST', body) => {
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) setError(d.error || `HTTP ${r.status}`);
    } catch (e) { setError(e.message); }
    load();
  };
  // A waiting run is cancelled at once; a running one loses its progress, so that asks first
  const cancel = async (j) => {
    if (j.status === 'running') {
      const stop = await ask({
        title: 'Stop this training run?',
        text: 'It stops at its next report and its progress is lost.',
        okLabel: 'Stop training',
        danger: true,
      });
      if (!stop) return;
    }
    act(`/api/training/jobs/${j.id}/cancel`);
  };
  const jobs = q?.jobs || [];
  if (!jobs.length && !error) return null;
  const waiting = jobs.filter(j => j.status === 'queued');
  const tone = { running: 'var(--accent)', queued: 'var(--warn)', done: 'var(--ok)', failed: 'var(--bad)', cancelled: 'var(--muted)' };
  const pct = (n) => `${((n || 0) * 100).toFixed(1)}%`;
  return (
    <Section title="Training queue" description={`${jobs.filter(j => j.status === 'running').length ? 'running · ' : ''}${waiting.length} waiting`}>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {error && <Alert severity="error" sx={{ bgcolor: 'var(--bad-quiet)', color: 'var(--bad)' }}>{error}</Alert>}
        {jobs.map((j) => (
          <Panel key={j.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', p: 1.25 }}>
            <Chip label={j.cancelling ? 'cancelling' : j.status} size="small" sx={{ color: tone[j.status], bgcolor: 'transparent', border: `1px solid ${tone[j.status]}`, fontWeight: 700 }} />
            <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 620 }}>{j.label || j.title}</Typography>
              <Typography variant="caption" sx={{ color: 'var(--dim)' }}>
                {j.status === 'running'
                  ? [j.state?.phase || j.phase, j.state?.epoch ? `epoch ${j.state.epoch}/${j.state.total_epochs}` : null, j.progress != null ? `${Math.round(j.progress * 100)}%` : null, j.state?.val_acc ? `val ${pct(j.state.val_acc)}` : null].filter(Boolean).join(' · ')
                  : j.status === 'queued' ? 'waits for acm-gpu to be free'
                    : j.status === 'done' ? `best ${pct(j.result?.best_val_acc)}${j.result?.model ? ` · ${j.result.model}` : ''}`
                      : j.status === 'failed' ? (j.error || 'failed') : 'cancelled'}
              </Typography>
              {j.status === 'running' && j.progress != null && <LinearProgress variant="determinate" value={Math.round(j.progress * 100)} sx={{ mt: 0.75, height: 4, borderRadius: 2 }} />}
            </Box>
            {j.status === 'queued' && (
              <>
                <Tooltip title="Earlier"><IconButton sx={iconBtnSx()} onClick={() => act(`/api/training/jobs/${j.id}/bump`, 'POST', { dir: 'up' })}><ArrowUpward /></IconButton></Tooltip>
                <Tooltip title="Later"><IconButton sx={iconBtnSx()} onClick={() => act(`/api/training/jobs/${j.id}/bump`, 'POST', { dir: 'down' })}><ArrowDownward /></IconButton></Tooltip>
              </>
            )}
            {(j.status === 'queued' || j.status === 'running') && (
              <Button size="small" color="error" variant="outlined" disabled={j.cancelling} onClick={() => cancel(j)}>Cancel</Button>
            )}
            {j.trainable && (j.status === 'failed' || j.status === 'cancelled') && <Button size="small" variant="outlined" onClick={() => act(`/api/training/jobs/${j.id}/retry`)}>Run again</Button>}
            {!['queued', 'running'].includes(j.status) && <Button size="small" onClick={() => act(`/api/training/jobs/${j.id}`, 'DELETE')} sx={{ color: 'var(--dim)' }}>Remove</Button>}
          </Panel>
        ))}
      </Box>
    </Section>
  );
}
