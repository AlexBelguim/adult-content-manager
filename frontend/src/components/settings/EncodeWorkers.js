/**
 * Settings → Workers → Re-encode workers: the machines that encode for this app over HTTP with Hikari's worker
 * program (moved here from the Space page). This server is one of them, read-only (Space says who encodes); the
 * coordinator's worker is managed by the coordinator and has no buttons (the server refuses them too, 409).
 *
 *   GET    /api/encode/workers              -> [{ id, name, local, online, enabled, lastSeen, note, info, job }]
 *   POST   /api/encode/workers { name }     -> { id, name, link }
 *   POST   /api/encode/workers/:id/relink   -> { link }
 *   PUT    /api/encode/workers/:id { enabled }
 *   DELETE /api/encode/workers/:id
 *
 * A link is shown once, in a dialog with the command that starts the worker.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { AppDialog, DialogText, useAsk, useNotify, errorText } from '../ui';
import { SmallButton, Badge } from '../discover/shared';
import { metaSx, rowSx, Rows, getJson, sendJson, SectionError } from './kit';

const PHASE = { starting: 'starting', downloading: 'downloading', encoding: 'encoding', uploading: 'uploading', paused: 'paused', waiting: 'waiting for the GPU', verifying: 'checking', swapping: 'swapping in' };
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
const workerCmd = (l) => `node hikari-worker.mjs "${l}" --ffmpeg <path to ffmpeg>`;

function metaOf(w) {
  const base = w.local
    ? [w.note, w.info?.encoder].filter(Boolean).join(' · ')
    : [w.online ? 'online' : w.lastSeen ? `last seen ${new Date(w.lastSeen).toLocaleString()}` : 'never called in yet',
      w.info ? (w.info.nvenc ? `GPU: ${w.info.gpu || 'NVENC'}` : `CPU: ${w.info.threads} threads`) : null,
      w.enabled ? null : 'switched off'].filter(Boolean).join(' · ');
  return `${base}${w.job ? ` · ${PHASE[w.job.phase] || w.job.phase} ${w.job.label}` : ''}`;
}

export default function EncodeWorkers({ coordinatorWorkerId = null }) {
  const ask = useAsk();
  const notify = useNotify();
  const [workers, setWorkers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(() => new Set());   // ids of workers with a request out
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(() => getJson('/api/encode/workers')
    .then((d) => { if (alive.current) { setWorkers(Array.isArray(d) ? d : []); setError(null); } })
    .catch((e) => { if (alive.current) setError(errorText(e, 'Could not load the workers')); }), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const mark = (id, on) => setBusy((prev) => {
    const n = new Set(prev);
    if (on) n.add(id); else n.delete(id);
    return n;
  });

  // one request for one worker: its buttons are off while it is out; a link in the answer is shown once
  const act = async (w, method, url, body, failed) => {
    mark(w.id, true);
    try {
      const r = await sendJson(method, url, body);
      if (alive.current && r?.link) setLink(r.link);
    } catch (e) {
      notify({ severity: 'error', message: errorText(e, failed) });
    } finally {
      if (alive.current) { mark(w.id, false); load(); }
    }
  };

  const relink = async (w) => {
    const ok = await ask({ title: `Make a new link for ${w.name}?`, text: 'The old link stops working on that machine.', okLabel: 'Make new link' });
    if (ok) act(w, 'POST', `/api/encode/workers/${w.id}/relink`, undefined, 'Could not make a new link');
  };

  const remove = async (w) => {
    const ok = await ask({
      title: `Remove the worker ${w.name}?`,
      text: 'Its link stops working on that machine. A job it holds goes back in the queue.',
      okLabel: 'Remove worker',
      danger: true,
    });
    if (ok) act(w, 'DELETE', `/api/encode/workers/${w.id}`, undefined, 'Could not remove the worker');
  };

  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || adding) return;
    setAdding(true);
    try {
      const r = await sendJson('POST', '/api/encode/workers', { name: n });
      if (!alive.current) return;
      setName('');
      if (r?.link) setLink(r.link);
    } catch (err) {
      notify({ severity: 'error', message: errorText(err, 'Could not add the worker') });
    } finally {
      if (alive.current) { setAdding(false); load(); }
    }
  };

  const copy = () => {
    const byHand = () => notify({ severity: 'warning', message: 'Could not copy: select the line and copy it by hand' });
    const done = navigator.clipboard?.writeText(workerCmd(link || ''));
    if (!done) byHand();
    else done.then(() => notify('Copied'), byHand);
  };

  return (
    <Box>
      {error && <SectionError error={error} onRetry={load} />}
      {workers && workers.length > 0 && (
        <Rows>
          {workers.map((w) => {
            const managed = coordinatorWorkerId != null && w.id === coordinatorWorkerId;
            const out = busy.has(w.id);
            const tone = w.local ? (w.enabled ? 'var(--ok)' : 'var(--muted)') : w.online ? 'var(--ok)' : 'var(--muted)';
            const text = metaOf(w);
            return (
              <Box key={w.id} sx={{ ...rowSx, display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Box aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', bgcolor: tone }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '.8125rem', fontWeight: 600, color: 'var(--text)', ...ellipsis }}>{w.name}</Typography>
                  <Typography sx={{ ...metaSx, ...ellipsis }} title={text}>{text}</Typography>
                </Box>
                {managed ? (
                  <Badge>managed by the coordinator</Badge>
                ) : !w.local && (
                  <Box sx={{ display: 'flex', gap: 0.75, flex: 'none' }}>
                    <SmallButton disabled={out}
                      onClick={() => act(w, 'PUT', `/api/encode/workers/${w.id}`, { enabled: !w.enabled }, w.enabled ? 'Could not switch it off' : 'Could not switch it on')}>
                      {w.enabled ? 'Switch off' : 'Switch on'}
                    </SmallButton>
                    <SmallButton disabled={out} onClick={() => relink(w)}>New link…</SmallButton>
                    <SmallButton danger disabled={out} onClick={() => remove(w)}>Remove…</SmallButton>
                  </Box>
                )}
              </Box>
            );
          })}
        </Rows>
      )}
      {!workers && !error && <Typography sx={metaSx}>Loading…</Typography>}

      <Box component="form" onSubmit={add} sx={{ display: 'flex', gap: 1, mt: 1.25, alignItems: 'center' }}>
        <TextField size="small" placeholder="Name, for example GPU PC" value={name} onChange={(e) => setName(e.target.value)}
          disabled={adding} inputProps={{ 'aria-label': 'New worker name' }} sx={{ flex: 1, maxWidth: { sm: 300 } }} />
        <SmallButton type="submit" disabled={!name.trim() || adding}>{adding ? 'Adding…' : 'Add worker'}</SmallButton>
      </Box>

      <AppDialog open={!!link} onClose={() => setLink(null)} size="sm" persistent title="The worker's link" cancelLabel="Done"
        primary={{ label: 'Copy', onClick: copy }}>
        <DialogText>
          Shown once. Start the worker with it on the machine that encodes (it only ever calls out to this app):
        </DialogText>
        <TextField fullWidth multiline value={workerCmd(link || '')} sx={{ mt: 1 }}
          InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: '.8125rem' } }}
          onFocus={(e) => e.target.select()} />
      </AppDialog>
    </Box>
  );
}
