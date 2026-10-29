/**
 * Settings → Coordinator: this app connected to the home's coordinator (on the NAS). Only its address to fill in;
 * the rest is what runs for ACM, read-only, and the addresses used without a coordinator, folded away.
 *
 *   coordinator  its address and Connect (this app pairs itself, routes/coordinator.js); once connected it hands this
 *                app's re-encodes, training runs and funscripts to its worker nodes, in the order and on the machines
 *                set there, and says where acm-gpu is
 *   what runs    re-encodes, ACM GPU work (acm-gpu) and scenetest: whether each answers and what it's doing
 *   without it   acm-gpu's address (saved with the dialog's Save), scenetest's address and the share root it sees the
 *                library under, and machines linked straight to this app (Settings → Space)
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
const head = { fontSize: '0.7rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary', mt: 0.5 };
const ago = (t) => { if (!t) return ''; const s = Math.round((Date.now() - t) / 1000); return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

/** One read-only line: a dot, a name, what it's doing. */
function Line({ tone, name, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'baseline' }}>
      <Box component="span" sx={{ ...dot(tone), transform: 'translateY(-1px)' }} />
      <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', flex: 'none' }}>{name}</Typography>
      <Typography sx={{ ...meta, minWidth: 0 }}>{children}</Typography>
    </Box>
  );
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

      {/* the coordinator: the one thing to set */}
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
              <Typography sx={meta}>It hands ACM's re-encodes, training runs and funscripts to its worker nodes, in the order and on the machines set there.</Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button size="small" variant="outlined" component="a" href={co.url} target="_blank" rel="noopener noreferrer">Open it</Button>
                <Button size="small" variant="outlined" disabled={busy} onClick={() => window.confirm("Disconnect from the coordinator? Its jobs go back to ACM; only this server encodes, and acm-gpu is found at the address under \"Without the coordinator\".") && coordinator('DELETE')}>Disconnect</Button>
              </Box>
            </>
          ) : (
            <>
              <Typography sx={meta}>The coordinator (on the NAS) hands ACM's work to its worker nodes: the PC's GPU, the NAS. Enter its address; ACM pairs itself.</Typography>
              <Box component="form" onSubmit={(e) => { e.preventDefault(); if (coUrl.trim()) coordinator('POST', { url: coUrl.trim() }); }} sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField size="small" fullWidth value={coUrl} onChange={(e) => setCoUrl(e.target.value)} placeholder="http://192.168.1.125:4700" InputProps={{ sx: { fontFamily: 'monospace' } }} />
                <Button type="submit" variant="contained" disabled={!coUrl.trim() || busy}>Connect</Button>
              </Box>
            </>
          )}
          {coMsg && <Typography sx={{ ...meta, mt: 0.5 }}>{coMsg}</Typography>}
        </Box>
      </Box>

      {/* what runs for ACM: read only */}
      <Typography sx={head}>What runs for ACM</Typography>
      <Box sx={{ ...rowSx, display: 'grid', gap: 0.75 }}>
        <Line tone={co?.connected || local ? 'ok' : 'off'} name="Re-encodes">
          {[co?.connected ? "on the coordinator's worker nodes" : direct.length ? `on ${direct.map(x => x.name).join(', ')} (linked straight)` : null,
            local ? `this server: ${local.note}` : null].filter(Boolean).join(' · ') || 'nothing set up'}
          {' · '}<Box component="a" onClick={() => navigate('/settings/space')} sx={{ color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>Space</Box>
        </Line>
        <Line tone={!ai ? 'off' : ai.online ? (ai.claiming ? 'ok' : 'warn') : 'off'} name="ACM GPU work">
          {!ai ? '…' : ai.online
            ? [co?.connected && co.gpu?.node ? `on ${co.gpu.node}` : null, ai.device ? `on the ${ai.device}` : 'running',
              ai.claiming ? 'taking training runs and funscripts' : 'not taking work yet (it pairs when this page or the Jobs page is open)'].filter(Boolean).join(' · ')
            : `not answering (${ai.error || 'off'}): its work waits for it`}
        </Line>
        <Line tone={!sc ? 'off' : sc.online ? (sc.paused ? 'warn' : 'ok') : 'off'} name="scenetest">
          {!sc ? '…' : sc.online ? `answering${sc.paused ? ' · its queue is paused' : ''}` : sc.url ? `not answering${sc.error ? ` (${sc.error})` : ''}` : 'not set up'}
        </Line>
      </Box>

      {/* the addresses used without a coordinator, folded away */}
      <Box component="details" sx={{ '& > summary': { cursor: 'pointer', fontSize: '0.78rem', color: 'text.secondary', fontWeight: 700 } }}>
        <summary>Without the coordinator: acm-gpu's and scenetest's addresses{direct.length ? `, machines linked straight (${direct.length})` : ''}</summary>
        <Box sx={{ display: 'grid', gap: 1.25, mt: 1 }}>
          <Box sx={{ ...rowSx, display: 'block' }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.85rem' }}>acm-gpu's address</Typography>
            <TextField fullWidth size="small" value={aiServerUrl} onChange={(e) => setAiServerUrl(e.target.value)} placeholder="http://localhost:3344"
              helperText={co?.connected ? 'The coordinator keeps this up to date; it is used when the coordinator is away. Saved with Save.' : 'For training, smart filtering and scoring. Saved with Save.'}
              sx={{ mt: 1 }} InputProps={{ sx: { fontFamily: 'monospace' } }} />
          </Box>

          <Box sx={{ ...rowSx, display: 'block' }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.85rem' }}>scenetest</Typography>
            <Typography sx={meta}>Labels and funscripts from scenes; it runs on its own, not through the coordinator.</Typography>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, mt: 1, alignItems: 'start' }}>
              <TextField size="small" label="Address" value={st.url} onChange={(e) => { setSt({ ...st, url: e.target.value }); setSaved(null); }}
                placeholder="its host, port 8199" InputProps={{ sx: { fontFamily: 'monospace' } }} />
              <TextField size="small" label="Library on its share" value={st.root} onChange={(e) => { setSt({ ...st, root: e.target.value }); setSaved(null); }}
                placeholder="Z:\Apps\adultManager\media\" InputProps={{ sx: { fontFamily: 'monospace' } }} />
              <Button variant="outlined" size="small" onClick={saveScenetest} sx={{ height: 40 }}>Save</Button>
            </Box>
            {saved && <Typography sx={{ ...meta, mt: 0.5 }}>{saved}</Typography>}
          </Box>

          {direct.length > 0 && (
            <Box sx={{ ...rowSx, display: 'block' }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.85rem' }}>Machines linked straight to ACM</Typography>
              {direct.map((x) => (
                <Typography key={x.id} sx={meta}>
                  <b>{x.name}</b>{' · '}
                  {[x.online ? (x.job ? `${x.job.phase || 'working'} ${x.job.label}` : 'online, idle') : x.lastSeen ? `offline, seen ${ago(x.lastSeen)}` : 'not connected yet',
                    x.enabled ? null : 'switched off', x.encoder].filter(Boolean).join(' · ')}
                </Typography>
              ))}
              <Typography sx={meta}>Added and removed in Settings → Space.</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
