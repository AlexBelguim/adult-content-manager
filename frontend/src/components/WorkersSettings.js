/**
 * Settings → Workers: every machine that works for this app (GET /api/jobs/workers), each with its host agent.
 *
 *   AI app      the AI Inference App on the GPU PC: its address (saved with the dialog's Save), whether it answers,
 *               whether it's claiming funpipe and training work, and the host agent's lanes for it (training,
 *               funpipe, P and P2)
 *   scenetest   labels and funscripts from scenes: its address and the share root it sees the library under
 *   re-encode   the encode workers that took a link from Settings → Space (managed there), with their host agents
 *
 * A host agent (F:\git\host-agent, the tray icon on the PC) shares the GPU between them; its own status page opens only
 * on its machine.
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

/** what a worker's host agent is doing, in words */
function agentWords(a) {
  if (!a) return 'host agent: not reported (an older worker, or the AI app not running)';
  if (a.url === null) return 'started without a host agent (--no-agent)';
  if (a.up === true) {
    const lanes = a.lanes ? Object.entries(a.lanes) : [];
    return `host agent: answering${lanes.length ? ` · ${lanes.map(([n, l]) => `${n}: ${l.job || 'idle'}`).join(' · ')}` : ''}`;
  }
  if (a.up === false) return a.answered === false ? 'host agent: none on that machine' : 'host agent: stopped answering';
  return 'host agent: not asked yet';
}

export default function WorkersSettings({ aiServerUrl, setAiServerUrl }) {
  const navigate = useNavigate();
  const [w, setW] = useState(null);
  const [error, setError] = useState(null);
  const [st, setSt] = useState({ url: '', root: '' });
  const [saved, setSaved] = useState(null);

  const load = useCallback((fresh) => fetch(`/api/jobs/workers${fresh ? '?fresh=1' : ''}`).then(r => r.json())
    .then(d => { setW(d); setError(null); setSt(s => (s.loaded ? s : { url: d.scenetest.ownUrl || '', root: d.scenetest.mediaRoot || '', loaded: true })); })
    .catch(e => setError(e.message)), []);
  useEffect(() => { load(true); const t = setInterval(() => load(false), 5000); return () => clearInterval(t); }, [load]);

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
  const remote = (w?.encode || []).filter(x => !x.local);
  const local = (w?.encode || []).find(x => x.local);

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <Typography sx={meta}>
        The machines that work for this app. On the GPU PC a host agent (its tray icon) starts them with no windows and
        shares the GPU between them: a training run, a funscript and a re-encode wait for each other instead of fighting.
      </Typography>
      {error && <Typography sx={{ ...meta, color: 'var(--bad)' }}>{error}</Typography>}

      {/* the AI app */}
      <Box sx={rowSx}>
        <Box component="span" sx={{ ...dot(!ai ? 'off' : ai.online ? (ai.claiming ? 'ok' : 'warn') : 'off'), mt: 0.75 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>AI app</Typography>
          <Typography sx={meta}>
            {!ai ? '…' : ai.online
              ? [ai.device ? `running on the ${ai.device}` : 'running', ai.claiming ? 'claiming funscripts and training runs' : 'not claiming work yet (pairs when this page or the Jobs page is open)'].join(' · ')
              : `not answering (${ai.error || 'off'}): queued work waits for it`}
          </Typography>
          {ai?.online && <Typography sx={meta}>{agentWords(ai.agent)}</Typography>}
          <TextField fullWidth size="small" value={aiServerUrl} onChange={(e) => setAiServerUrl(e.target.value)} placeholder="http://localhost:3344"
            helperText="Its address, for training, smart filtering and scoring. Saved when you click Save."
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
              placeholder="the AI app's host, port 8199" InputProps={{ sx: { fontFamily: 'monospace' } }} />
            <TextField size="small" label="Library on its share" value={st.root} onChange={(e) => { setSt({ ...st, root: e.target.value }); setSaved(null); }}
              placeholder="Z:\Apps\adultManager\media\" InputProps={{ sx: { fontFamily: 'monospace' } }} />
            <Button variant="outlined" size="small" onClick={saveScenetest} sx={{ height: 40 }}>Save</Button>
          </Box>
          {saved && <Typography sx={{ ...meta, mt: 0.5 }}>{saved}</Typography>}
        </Box>
      </Box>

      {/* re-encode workers */}
      <Box sx={rowSx}>
        <Box component="span" sx={{ ...dot(remote.some(x => x.online) ? (remote.some(x => x.job) ? 'busy' : 'ok') : 'off'), mt: 0.75 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', flex: 1 }}>Re-encode workers</Typography>
            <Button size="small" variant="outlined" onClick={() => navigate('/settings/space')}>Manage in Space</Button>
          </Box>
          {!remote.length && <Typography sx={meta}>None linked yet: add one in Settings → Space (Hikari's worker program runs this app's re-encodes too).</Typography>}
          {remote.map((x) => (
            <Typography key={x.id} sx={meta}>
              <b>{x.name}</b>{' · '}
              {[x.online ? (x.job ? `${x.job.phase || 'working'} ${x.job.label}` : 'online, idle') : x.lastSeen ? `offline, seen ${ago(x.lastSeen)}` : 'not connected yet',
                x.enabled ? null : 'switched off', x.encoder, x.online ? agentWords(x.agent) : null].filter(Boolean).join(' · ')}
            </Typography>
          ))}
          {local && <Typography sx={meta}><b>This server</b> · {local.note}</Typography>}
        </Box>
      </Box>
    </Box>
  );
}
