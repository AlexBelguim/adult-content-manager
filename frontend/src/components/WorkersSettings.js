/**
 * Settings → Coordinator: this app connected to the home's coordinator (on the NAS), and what works for it.
 *
 *   coordinator  its address and Connect (this app pairs itself, routes/coordinator.js); once connected it hands this
 *                app's re-encodes, training runs and funscripts to its worker nodes, in the order and on the machines
 *                set there
 *   acm-gpu      ACM's GPU worker: where it is (the coordinator says, once connected; the address here is the one used
 *                otherwise, saved with the dialog's Save), whether it answers, and its worker node's lanes for it
 *   scenetest    labels and funscripts from scenes: its address and the share root it sees the library under
 *   re-encodes   this server's own encoder, and any worker linked straight to this app (Settings → Space)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, TextField, Typography } from '@mui/material';

const dot = (tone) => ({
  width: 8, height: 8, borderRadius: '50%', flex: 'none', display: 'inline-block',
  bgcolor: tone === 'ok' ? 'var(--ok)' : tone === 'busy' ? 'var(--accent)' : tone === 'warn' ? 'var(--warn)' : 'var(--muted)',
});
const rowSx = { display: 'flex', gap: 1.25, alignItems: 'flex-start', p: 1.25, borderRadius: 2, bgcolor: 'var(--raised)', border: '1px solid', borderColor: 'divider' };
const meta = { fontSize: '0.78rem', color: 'text.secondary', lineHeight: 1.5 };
const ago = (t) => { if (!t) return ''; const s = Math.round((Date.now() - t) / 1000); return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

/** what a worker's node is doing, in words */
function nodeWords(a) {
  if (!a) return null;
  if (a.url === null) return 'started without a worker node';
  if (a.up === true) {
    const lanes = a.lanes ? Object.entries(a.lanes) : [];
    return `its worker node answers${lanes.length ? ` · ${lanes.map(([n, l]) => `${n}: ${l.job || 'idle'}`).join(' · ')}` : ''}`;
  }
  if (a.up === false) return a.answered === false ? 'no worker node on its machine' : 'its worker node stopped answering';
  return null;
}

export default function WorkersSettings({ aiServerUrl, setAiServerUrl }) {
  const navigate = useNavigate();
  const [w, setW] = useState(null);
  const [co, setCo] = useState(null); // the coordinator: { url, connected, worker, gpu }
  const [coUrl, setCoUrl] = useState('');
  const [coMsg, setCoMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [st, setSt] = useState({ url: '', root: '' });
  const [saved, setSaved] = useState(null);

  const load = useCallback((fresh) => Promise.all([
    fetch(`/api/jobs/workers${fresh ? '?fresh=1' : ''}`).then(r => r.json()),
    fetch('/api/coordinator').then(r => r.json()),
  ]).then(([d, c]) => {
    setW(d);
    setCo(c);
    setError(null);
    setSt(s => (s.loaded ? s : { url: d.scenetest.ownUrl || '', root: d.scenetest.mediaRoot || '', loaded: true }));
  }).catch(e => setError(e.message)), []);
  useEffect(() => { load(true); const t = setInterval(() => load(false), 5000); return () => clearInterval(t); }, [load]);
  // where the coordinator says acm-gpu is: the address the pages use (saved with the dialog's Save)
  useEffect(() => { if (co?.connected && co.gpu?.url && co.gpu.url !== aiServerUrl) setAiServerUrl(co.gpu.url); }, [co]); // eslint-disable-line react-hooks/exhaustive-deps

  const coordinator = async (method, body) => {
    setBusy(true);
    setCoMsg(null);
    try {
      const r = await fetch('/api/coordinator', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      setCo(j);
      setCoMsg(method === 'POST' ? "Connected: the coordinator hands this app's work to its worker nodes now." : 'Disconnected from the coordinator.');
      load(true);
    } catch (e) { setCoMsg(e.message); } finally { setBusy(false); }
  };

  const saveScenetest = async () => {
    try {
      for (const [key, value] of [['scenetest_url', st.url.trim()], ['scenetest_media_root', st.root.trim()]]) {
        if (value) await fetch(`/api/settings/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
        else await fetch(`/api/settings/${key}`, { method: 'DELETE' });
      }
      setSaved('Saved');
      load(true);
    } catch (e) { setSaved(`Couldn't save: ${e.message}`); }
  };

  const ai = w?.ai;
  const sc = w?.scenetest;
  const direct = (w?.encode || []).filter(x => !x.local && x.id !== co?.workerId);
  const local = (w?.encode || []).find(x => x.local);
  const cw = co?.worker;

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {error && <Typography sx={{ ...meta, color: 'var(--bad)' }}>{error}</Typography>}

      {/* the coordinator */}
      <Box sx={rowSx}>
        <Box component="span" sx={{ ...dot(co?.connected ? (cw?.online ? (cw.job ? 'busy' : 'ok') : 'warn') : 'off'), mt: 0.75 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>{co?.connected ? 'Connected to the coordinator' : 'Coordinator'}</Typography>
          {co?.connected ? (
            <>
              <Typography sx={meta}>
                {[co.url.replace(/^https?:\/\//, ''), cw?.online ? 'answering' : cw?.lastSeen ? `not answering, last seen ${ago(cw.lastSeen)}` : "hasn't called yet",
                  cw?.job ? `${cw.job.phase || 'working'} ${cw.job.label}` : null].filter(Boolean).join(' · ')}
              </Typography>
              <Typography sx={meta}>It hands this app's re-encodes, training runs and funscripts to its worker nodes, in the order and on the machines set there.</Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button size="small" variant="outlined" component="a" href={co.url} target="_blank" rel="noopener noreferrer">Open it</Button>
                <Button size="small" variant="outlined" disabled={busy} onClick={() => window.confirm('Disconnect from the coordinator? Its jobs go back to this app; only this server encodes, and acm-gpu is found at the address below.') && coordinator('DELETE')}>Disconnect</Button>
              </Box>
            </>
          ) : (
            <>
              <Typography sx={meta}>The coordinator (on the NAS) hands this app's work to its worker nodes: the PC's GPU, the NAS. Enter its address; this app pairs itself.</Typography>
              <Box component="form" onSubmit={(e) => { e.preventDefault(); if (coUrl.trim()) coordinator('POST', { url: coUrl.trim() }); }} sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField size="small" fullWidth value={coUrl} onChange={(e) => setCoUrl(e.target.value)} placeholder="http://192.168.1.125:4700" InputProps={{ sx: { fontFamily: 'monospace' } }} />
                <Button type="submit" variant="contained" disabled={!coUrl.trim() || busy}>Connect</Button>
              </Box>
            </>
          )}
          {coMsg && <Typography sx={{ ...meta, mt: 0.5 }}>{coMsg}</Typography>}
        </Box>
      </Box>

      {/* acm-gpu */}
      <Box sx={rowSx}>
        <Box component="span" sx={{ ...dot(!ai ? 'off' : ai.online ? (ai.claiming ? 'ok' : 'warn') : 'off'), mt: 0.75 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>ACM GPU work (acm-gpu)</Typography>
          <Typography sx={meta}>
            {!ai ? '…' : ai.online
              ? [ai.device ? `running on the ${ai.device}` : 'running', ai.claiming ? 'taking training runs and funscripts' : 'not taking work yet (it pairs when this page or the Jobs page is open)'].join(' · ')
              : `not answering (${ai.error || 'off'}): its work waits for it`}
          </Typography>
          {ai?.online && nodeWords(ai.agent) && <Typography sx={meta}>{nodeWords(ai.agent)}</Typography>}
          {co?.connected && co.gpu?.url && <Typography sx={meta}>Found through the coordinator: on {co.gpu.node}, {co.gpu.url}</Typography>}
          <TextField fullWidth size="small" value={aiServerUrl} onChange={(e) => setAiServerUrl(e.target.value)} placeholder="http://localhost:3344"
            helperText={co?.connected ? 'The coordinator keeps this up to date; it is used when the coordinator is away. Saved with Save.' : 'Its address, for training, smart filtering and scoring. Saved with Save.'}
            sx={{ mt: 1 }} InputProps={{ sx: { fontFamily: 'monospace' } }} />
        </Box>
      </Box>

      {/* scenetest */}
      <Box sx={rowSx}>
        <Box component="span" sx={{ ...dot(!sc ? 'off' : sc.online ? (sc.paused ? 'warn' : 'ok') : 'off'), mt: 0.75 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>scenetest</Typography>
          <Typography sx={meta}>
            {!sc ? '…' : sc.online ? `answering at ${sc.url}${sc.paused ? ' · its queue is paused' : ''}` : `not answering at ${sc.url || 'its address'}${sc.error ? ` (${sc.error})` : ''}`}
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, mt: 1, alignItems: 'start' }}>
            <TextField size="small" label="Address" value={st.url} onChange={(e) => { setSt({ ...st, url: e.target.value }); setSaved(null); }}
              placeholder="its host, port 8199" InputProps={{ sx: { fontFamily: 'monospace' } }} />
            <TextField size="small" label="Library on its share" value={st.root} onChange={(e) => { setSt({ ...st, root: e.target.value }); setSaved(null); }}
              placeholder="Z:\Apps\adultManager\media\" InputProps={{ sx: { fontFamily: 'monospace' } }} />
            <Button variant="outlined" size="small" onClick={saveScenetest} sx={{ height: 40 }}>Save</Button>
          </Box>
          {saved && <Typography sx={{ ...meta, mt: 0.5 }}>{saved}</Typography>}
        </Box>
      </Box>

      {/* re-encodes: this server, and workers linked straight to this app */}
      <Box sx={rowSx}>
        <Box component="span" sx={{ ...dot(local ? 'ok' : 'off'), mt: 0.75 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', flex: 1 }}>Re-encodes</Typography>
            <Button size="small" variant="outlined" onClick={() => navigate('/settings/space')}>Space</Button>
          </Box>
          <Typography sx={meta}>{co?.connected ? "Through the coordinator's worker nodes" : 'Not through a coordinator'}{local ? ` · this server: ${local.note}` : ''}</Typography>
          {direct.length > 0 && <Typography sx={{ ...meta, mt: 0.5 }}>Linked straight to this app (Settings → Space):</Typography>}
          {direct.map((x) => (
            <Typography key={x.id} sx={meta}>
              <b>{x.name}</b>{' · '}
              {[x.online ? (x.job ? `${x.job.phase || 'working'} ${x.job.label}` : 'online, idle') : x.lastSeen ? `offline, seen ${ago(x.lastSeen)}` : 'not connected yet',
                x.enabled ? null : 'switched off', x.encoder].filter(Boolean).join(' · ')}
            </Typography>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
