/**
 * Settings → Space: what the library's videos take up, where a re-encode would save the most, and the re-encode queue.
 *
 * Reads GET /api/encode/space (every performer, before and after filter, and every content genre, with what a
 * re-encode to HEVC 10-bit would take off) and GET /api/encode/queue. Opening a performer or genre lists its folders
 * (vids, vids/funscript/<scene>, a genre's sub-folders) and files from GET /api/encode/space/group. Queueing goes to
 * POST /api/encode/queue: everything, one performer or genre, one folder, or the files ticked.
 *
 * The estimate is from each file's length, bitrate and height, corrected by the median of real / estimated size over
 * the last 40 re-encodes once three have finished. A file is queued only when it comes out at least a fifth smaller by
 * the estimate, and the new file is thrown away when it isn't really 5% smaller. Every original is kept 14 days in
 * the base folder's .originals, with Undo.
 *
 * Route: /settings/space
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, ButtonBase, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  LinearProgress, MenuItem, Select, Snackbar, Alert, TextField, Tooltip, Typography
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import UndoIcon from '@mui/icons-material/Undo';
import ReplayIcon from '@mui/icons-material/Replay';
import RefreshIcon from '@mui/icons-material/Refresh';
import { PageShell, PageHeader, Section, Panel, StatRow, LoadingState, SPACE, iconBtnSx } from '../components/layout';

const LIMIT = 30;
const TOP_LABEL = { before: 'Before filter', after: 'After filter', content: 'Content' };

// ── formatting ───────────────────────────────────────────────
function fmtSize(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(Math.abs(b)) / Math.log(1024)));
  const v = b / 1024 ** i;
  return `${v >= 100 || i < 2 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
const files = (n) => `${n} video${n === 1 ? '' : 's'}`;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const dateOf = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtSecs = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
const PHASE = { starting: 'starting', downloading: 'downloading', encoding: 'encoding', uploading: 'uploading', paused: 'paused', waiting: 'waiting for the GPU', verifying: 'checking', swapping: 'swapping in' };

async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const post = (url, body) => send('POST', url, body || {});

/** What a queue answer says, in a line: added, and why the rest weren't. */
function queuedText(r) {
  const why = Object.entries(r.skipped || {}).map(([reason, n]) => `${n} ${reason.toLowerCase()}`).join(', ');
  if (!r.added) return `Nothing new to queue${why ? `: ${why}` : ''}.`;
  return `Queued ${files(r.added)}${why ? ` (left out: ${why})` : ''}.`;
}

// ── small pieces ─────────────────────────────────────────────
const smallBtnSx = {
  minWidth: 0, px: '9px', py: '2px', fontSize: '.78rem', lineHeight: 1.5, textTransform: 'none', whiteSpace: 'nowrap',
  color: 'var(--text)', borderColor: 'var(--line-strong)', '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' }
};
const meta = { fontSize: '.74rem', color: 'var(--dim)' };

function QueueButton({ n, busy, onClick, label }) {
  if (!n) return null;
  return (
    <Button size="small" variant="outlined" sx={smallBtnSx} disabled={busy}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {label || `Re-encode ${n}`}
    </Button>
  );
}

/** What a performer, genre or folder shows on the tab it's in. */
function line(x, tab) {
  const parts = tab === 'gain'
    ? [x.gainFiles ? `~${fmtSize(x.gain)} (${pct(x.gain, x.size)}%) from ${files(x.gainFiles)}` : null, `${fmtSize(x.size)} now`]
    : [fmtSize(x.size), files(x.files), x.gain ? `~${fmtSize(x.gain)} to gain` : null];
  return [...parts, x.queued ? `${x.queued} queued` : null, x.unprobed ? `${x.unprobed} not looked at yet` : null].filter(Boolean).join(' · ');
}

function jobNote(j) {
  if (!j) return null;
  if (j.status === 'queued') return { text: 'queued', tone: 'var(--info)' };
  if (j.status === 'running') return { text: 'encoding now', tone: 'var(--accent)' };
  if (j.status === 'done') return { text: `re-encoded${j.heldUntil ? ` · original kept until ${dateOf(j.heldUntil)}` : ''}`, tone: 'var(--ok)' };
  if (j.status === 'skipped') return { text: j.error || 'not smaller: kept as it was', tone: 'var(--dim)' };
  if (j.status === 'undone') return { text: 'undone', tone: 'var(--dim)' };
  if (j.status === 'failed') return { text: `failed: ${j.error || ''}`, tone: 'var(--bad)' };
  return null;
}

/** One performer's or genre's folders and files, loaded when it's opened. */
function GroupDetail({ group, busy, onQueue, version }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  useEffect(() => {
    let alive = true;
    fetch(`/api/encode/space/group?key=${encodeURIComponent(group.key)}`).then(r => r.json())
      .then(d => { if (alive) { if (d.ok === false) setError(d.error); else setData(d); } })
      .catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [group.key, version]);

  if (error) return <Typography sx={{ ...meta, color: 'var(--bad)', p: 1 }}>{error}</Typography>;
  if (!data) return <Typography sx={{ ...meta, p: 1 }}>Loading…</Typography>;
  const toggle = (p) => setPicked(prev => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const byFolder = data.folders.map(f => ({ ...f, files: data.files.filter(x => x.folder === f.folder) }));

  return (
    <Box sx={{ px: 1.5, pb: 1.25, pt: 0.5 }}>
      {picked.size > 0 && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
          <Button size="small" variant="contained" disabled={busy} sx={{ textTransform: 'none' }}
            onClick={() => onQueue({ paths: [...picked] }, `${picked.size} file${picked.size === 1 ? '' : 's'}`).then(() => setPicked(new Set()))}>
            Re-encode {picked.size} ticked
          </Button>
          <Button size="small" sx={{ textTransform: 'none', color: 'var(--dim)' }} onClick={() => setPicked(new Set())}>Clear</Button>
        </Box>
      )}
      {byFolder.map(f => (
        <Box key={f.folder} sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid var(--line)' }}>
            <Typography sx={{ fontSize: '.8rem', fontWeight: 620, color: 'var(--text)', flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.folder || '(top level)'}
            </Typography>
            <Typography sx={meta}>{line(f, 'gain')}</Typography>
            <QueueButton n={f.gainFiles} busy={busy} onClick={() => onQueue({ group: group.key, folder: f.folder }, `${group.name} / ${f.folder || 'top level'}`)} />
          </Box>
          {f.files.map(x => {
            const note = jobNote(x.job);
            const can = x.gain > 0 && !(x.job && (x.job.status === 'queued' || x.job.status === 'running'));
            return (
              <Box key={x.path} sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 0.5, py: '2px', '&:hover': { bgcolor: 'var(--raised)' } }}>
                <Checkbox size="small" checked={picked.has(x.path)} disabled={!can} onChange={() => toggle(x.path)} sx={{ p: '3px' }}
                  inputProps={{ 'aria-label': `Pick ${x.name}` }} />
                <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
                  <Typography sx={{ fontSize: '.8rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.path}>
                    {x.name}
                  </Typography>
                  <Typography sx={{ ...meta, fontSize: '.7rem' }}>
                    {[fmtSize(x.size), x.codec ? x.codec.toUpperCase() : null, x.height ? `${x.height}p` : null,
                      x.bitrate ? `${(x.bitrate / 1e6).toFixed(1)} Mb/s` : null, x.duration ? fmtSecs(Math.round(x.duration)) : null].filter(Boolean).join(' · ')}
                    {' — '}
                    {x.gain > 0 ? <span style={{ color: 'var(--ok)' }}>~{fmtSize(x.gain)} to gain ({x.why.slice(0, -1).join(', ')})</span> : x.reason}
                    {note && <span style={{ color: note.tone }}> · {note.text}</span>}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function GroupRow({ g, tab, busy, onQueue, version }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel padded={false} sx={{ overflow: 'hidden' }}>
      <ButtonBase component="div" onClick={() => setOpen(o => !o)}
        sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, textAlign: 'left', '&:hover': { bgcolor: 'var(--raised)' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="div" sx={{ fontSize: '.88rem', fontWeight: 620, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {g.name}
            <Chip size="small" label={TOP_LABEL[g.top]} sx={{ ml: 1, height: 18, fontSize: '.66rem', color: 'var(--dim)', bgcolor: 'var(--raised)' }} />
          </Typography>
          <Typography sx={meta}>{line(g, tab)}</Typography>
        </Box>
        <QueueButton n={g.gainFiles} busy={busy} onClick={() => onQueue({ group: g.key }, g.name)} />
        <Box component="span" aria-hidden="true" sx={{ color: 'var(--dim)', width: 14, textAlign: 'center' }}>{open ? '▾' : '▸'}</Box>
      </ButtonBase>
      {open && <GroupDetail group={g} busy={busy} onQueue={onQueue} version={version} />}
    </Panel>
  );
}

// ── the queue ────────────────────────────────────────────────
function ActiveJob({ j, act }) {
  const paused = j.hold || j.held;
  const label = paused ? (j.held ? 'paused' : 'pausing…') : (PHASE[j.phase] || j.phase);
  return (
    <Box sx={{ py: 1, borderBottom: '1px solid var(--line)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '.84rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.path}>{j.label}</Typography>
          <Typography sx={meta}>
            {[`${label} on ${j.worker.name}`, `${Math.round((j.progress || 0) * 100)}%`, j.speed ? `${j.speed.toFixed(2)}×` : null,
              j.eta ? `about ${fmtSecs(j.eta)} left` : null, j.offline ? 'its worker is offline' : null].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Tooltip title={paused ? 'Resume' : 'Pause (frozen where it is)'}>
          <IconButton sx={iconBtnSx()} onClick={() => act(`/api/encode/jobs/${j.id}/${paused ? 'resume' : 'pause'}`)}>
            {paused ? <PlayArrowIcon /> : <PauseIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Stop and remove">
          <IconButton sx={iconBtnSx()} onClick={() => act(`/api/encode/jobs/${j.id}`, 'DELETE')}><CloseIcon /></IconButton>
        </Tooltip>
      </Box>
      <LinearProgress variant="determinate" value={Math.round((j.progress || 0) * 100)} sx={{ mt: 0.75, height: 4, borderRadius: 2 }} />
    </Box>
  );
}

function QueuePanel({ q, act, onMode }) {
  const [showAll, setShowAll] = useState(false);
  const queued = showAll ? q.queued : q.queued.slice(0, 10);
  return (
    <Panel>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography sx={{ fontWeight: 620, color: 'var(--text)', flex: '1 1 auto' }}>
          {q.running ? 'Running' : 'Paused'} · {q.counts.queued} queued{q.queuedSize ? ` (${fmtSize(q.queuedSize)})` : ''}
        </Typography>
        <Button size="small" variant="outlined" sx={smallBtnSx} startIcon={q.running ? <PauseIcon /> : <PlayArrowIcon />}
          onClick={() => act(`/api/encode/queue/${q.running ? 'pause' : 'start'}`)}>
          {q.running ? 'Pause all' : 'Start'}
        </Button>
        <Tooltip title="Who encodes: a linked worker (the GPU PC) takes the next job whenever it's free">
          <Select size="small" value={q.mode} onChange={(e) => onMode(e.target.value)} sx={{ fontSize: '.78rem', height: 28 }}>
            <MenuItem value="auto">This server too, while no worker is online</MenuItem>
            <MenuItem value="local">This server always, beside workers</MenuItem>
            <MenuItem value="remote">Only linked workers</MenuItem>
          </Select>
        </Tooltip>
      </Box>
      {!q.local.ok && <Alert severity="warning" sx={{ mb: 1 }}>This server can't encode: {q.local.error}. Link a worker below.</Alert>}
      {q.active.map(j => <ActiveJob key={j.id} j={j} act={act} />)}
      {queued.map((j, i) => (
        <Box key={j.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid var(--line)' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '.8rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.path}>{j.label}</Typography>
            <Typography sx={{ ...meta, fontSize: '.7rem' }}>
              {[fmtSize(j.size), j.why.join(', '), j.priority ? `priority ${j.priority}` : null].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <Tooltip title="First"><span><IconButton sx={iconBtnSx()} disabled={i === 0 && !q.active.length} onClick={() => act(`/api/encode/jobs/${j.id}/bump`, 'POST', { dir: 'up' })}><ArrowUpwardIcon /></IconButton></span></Tooltip>
          <Tooltip title="Last"><IconButton sx={iconBtnSx()} onClick={() => act(`/api/encode/jobs/${j.id}/bump`, 'POST', { dir: 'down' })}><ArrowDownwardIcon /></IconButton></Tooltip>
          <Tooltip title="Remove"><IconButton sx={iconBtnSx()} onClick={() => act(`/api/encode/jobs/${j.id}`, 'DELETE')}><CloseIcon /></IconButton></Tooltip>
        </Box>
      ))}
      {q.queued.length > 10 && (
        <Button size="small" sx={{ ...smallBtnSx, mt: 1, border: 0 }} onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show fewer' : `Show all ${q.queued.length}`}
        </Button>
      )}
      {!q.active.length && !q.queued.length && <Typography sx={meta}>Nothing waiting.</Typography>}
    </Panel>
  );
}

function RecentPanel({ q, act }) {
  if (!q.recent.length) return null;
  return (
    <Panel>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography sx={{ fontWeight: 620, color: 'var(--text)', flex: 1 }}>Finished</Typography>
        <Tooltip title="Off the list: failed, not smaller, undone, and done ones whose original is already gone">
          <Button size="small" sx={{ ...smallBtnSx, border: 0 }} onClick={() => act('/api/encode/clear')}>Clear finished</Button>
        </Tooltip>
      </Box>
      {q.recent.map(j => {
        const saved = j.outSize && j.size ? j.size - j.outSize : null;
        const text = j.status === 'done'
          ? `${fmtSize(j.size)} → ${fmtSize(j.outSize)}${saved != null ? `, ${fmtSize(saved)} saved` : ''}${j.heldUntil ? ` · original kept until ${dateOf(j.heldUntil)}` : ''}`
          : j.status === 'undone' ? 'Undone: the original is back' : j.error;
        const tone = { done: 'var(--ok)', failed: 'var(--bad)' }[j.status] || 'var(--dim)';
        return (
          <Box key={j.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid var(--line)' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '.8rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.path}>{j.label}</Typography>
              <Typography sx={{ ...meta, fontSize: '.7rem', color: tone }}>{text}</Typography>
            </Box>
            {j.status === 'done' && j.heldUntil && (
              <Tooltip title="Put the original back (the new file is deleted)">
                <Button size="small" variant="outlined" sx={smallBtnSx} startIcon={<UndoIcon />} onClick={() => act(`/api/encode/jobs/${j.id}/undo`)}>Undo</Button>
              </Tooltip>
            )}
            {j.status === 'failed' && (
              <Button size="small" variant="outlined" sx={smallBtnSx} startIcon={<ReplayIcon />} onClick={() => act(`/api/encode/jobs/${j.id}/retry`)}>Retry</Button>
            )}
          </Box>
        );
      })}
    </Panel>
  );
}

function WorkersPanel({ q, act, reload }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState(null);
  const add = async (url, body) => {
    const r = await post(url, body);
    setLink(r.link);
    setName('');
    reload();
  };
  const workerCmd = (l) => `node hikari-worker.mjs "${l}" --ffmpeg <path to ffmpeg>`;
  return (
    <Panel>
      <Typography sx={{ fontWeight: 620, color: 'var(--text)', mb: 0.5 }}>Workers</Typography>
      <Typography sx={{ ...meta, mb: 1 }}>
        A worker is another machine that encodes for this app over HTTP: it downloads the original, encodes it (on the
        card when it has NVENC) and uploads the new file, which is checked here before it's swapped in. It's Hikari's worker
        program, run with a link from here.
      </Typography>
      {q.workers.map(w => (
        <Box key={w.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid var(--line)' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', bgcolor: w.local ? (w.enabled ? 'var(--ok)' : 'var(--muted)') : w.online ? 'var(--ok)' : 'var(--muted)' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '.82rem', color: 'var(--text)' }}>{w.name}</Typography>
            <Typography sx={{ ...meta, fontSize: '.7rem' }}>
              {w.local ? [w.note, w.info?.encoder].filter(Boolean).join(' · ')
                : [w.online ? 'online' : w.lastSeen ? `last seen ${new Date(w.lastSeen).toLocaleString()}` : 'never called in yet',
                  w.info ? (w.info.nvenc ? `GPU: ${w.info.gpu || 'NVENC'}` : `CPU: ${w.info.threads} threads`) : null,
                  !w.enabled ? 'switched off' : null].filter(Boolean).join(' · ')}
              {w.job ? ` · ${PHASE[w.job.phase] || w.job.phase} ${w.job.label}` : ''}
            </Typography>
          </Box>
          {!w.local && (
            <>
              <Button size="small" sx={{ ...smallBtnSx, border: 0 }} onClick={() => act(`/api/encode/workers/${w.id}`, 'PUT', { enabled: !w.enabled })}>
                {w.enabled ? 'Switch off' : 'Switch on'}
              </Button>
              <Tooltip title="A new link; the old one stops working">
                <Button size="small" sx={{ ...smallBtnSx, border: 0 }} onClick={() => add(`/api/encode/workers/${w.id}/relink`).catch(() => {})}>New link</Button>
              </Tooltip>
              <Tooltip title="Remove: its link stops working, its job goes back in the queue">
                <IconButton sx={iconBtnSx()} onClick={() => act(`/api/encode/workers/${w.id}`, 'DELETE')}><CloseIcon /></IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 1, mt: 1.25, alignItems: 'center' }}>
        <TextField size="small" placeholder="Name, e.g. GPU PC" value={name} onChange={(e) => setName(e.target.value)} sx={{ flex: 1, '& input': { fontSize: '.82rem' } }} />
        <Button size="small" variant="outlined" sx={smallBtnSx} disabled={!name.trim()} onClick={() => add('/api/encode/workers', { name })}>Add worker</Button>
      </Box>
      <Dialog open={!!link} onClose={() => setLink(null)} maxWidth="sm" fullWidth>
        <DialogTitle>The worker's link</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'var(--dim)', mb: 1 }}>
            Shown once. Start the worker with it on the machine that encodes (it only ever calls out to this app):
          </Typography>
          <TextField fullWidth multiline value={workerCmd(link || '')} InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: '.78rem' } }}
            onFocus={(e) => e.target.select()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => navigator.clipboard?.writeText(workerCmd(link || '')).catch(() => {})}>Copy</Button>
          <Button onClick={() => setLink(null)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Panel>
  );
}

// ── the page ─────────────────────────────────────────────────
export default function SpacePage() {
  const [space, setSpace] = useState(null);
  const [q, setQ] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('gain');
  const [showAll, setShowAll] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [version, setVersion] = useState(0);   // bumped after an action: open performers load their files again
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const loadSpace = useCallback(() => fetch('/api/encode/space').then(r => r.json())
    .then(d => { if (alive.current) { if (d.ok === false) setError(d.error); else { setSpace(d); setError(null); } } })
    .catch(e => alive.current && setError(e.message)), []);
  const loadQueue = useCallback(() => fetch('/api/encode/queue').then(r => r.json())
    .then(d => alive.current && d.ok !== false && setQ(d)).catch(() => {}), []);

  useEffect(() => { loadSpace(); loadQueue(); }, [loadSpace, loadQueue]);
  useEffect(() => {
    const t = setInterval(loadQueue, 3000);
    const s = setInterval(loadSpace, space?.scan?.running ? 3000 : 20000);
    return () => { clearInterval(t); clearInterval(s); };
  }, [loadQueue, loadSpace, space?.scan?.running]);

  const refreshAll = () => { loadSpace(); loadQueue(); setVersion(v => v + 1); };

  // a job finished (here or on a worker): the numbers and any open performer's files are stale
  const finished = q ? q.counts.done + q.counts.failed + q.counts.skipped + q.recent.length : null;
  useEffect(() => {
    if (finished == null) return;
    loadSpace();
    setVersion(v => v + 1);
  }, [finished, loadSpace]);

  const act = async (url, method = 'POST', body) => {
    try { await send(method, url, method === 'DELETE' ? undefined : (body || {})); } catch (e) { setToast({ severity: 'error', msg: e.message }); }
    refreshAll();
  };

  const queue = async (body, what) => {
    setBusy(true);
    try {
      const r = await post('/api/encode/queue', body);
      setToast({ severity: r.added ? 'success' : 'info', msg: `${what}: ${queuedText(r)}` });
    } catch (e) {
      setToast({ severity: 'error', msg: e.message });
    } finally {
      if (alive.current) setBusy(false);
      refreshAll();
    }
  };

  useEffect(() => { setShowAll(false); }, [tab]);
  const list = useMemo(() => {
    const all = space?.groups || [];
    if (tab === 'gain') return all.filter(g => g.gain > 0 || g.queued).sort((a, b) => b.gain - a.gain || b.size - a.size);
    return [...all].sort((a, b) => b.size - a.size);
  }, [space, tab]);
  const shown = showAll ? list : list.slice(0, LIMIT);
  const t = space?.totals;
  const cal = space?.calibration;
  const scan = space?.scan;

  const scanLine = !scan ? '' : scan.running
    ? `Looking at the library… ${scan.probed} of ${scan.toProbe || '?'} new videos probed`
    : `${scan.known} videos known${scan.unprobed ? `, ${scan.unprobed} not looked at yet` : ''}${scan.errors ? `, ${scan.errors} unreadable` : ''}${scan.finishedAt ? ` · last looked ${new Date(scan.finishedAt).toLocaleString()}` : ''}`;

  return (
    <PageShell>
      <PageHeader back title="Space"
        subtitle="What the library's videos take up, where a re-encode saves the most, and the queue that does it."
        actions={(
          <Tooltip title="Walk the library again and probe what's new or changed">
            <span>
              <Button size="small" variant="outlined" sx={smallBtnSx} startIcon={<RefreshIcon />} disabled={!!scan?.running}
                onClick={() => post('/api/encode/space/rescan').then(loadSpace).catch(e => setToast({ severity: 'error', msg: e.message }))}>
                Rescan
              </Button>
            </span>
          </Tooltip>
        )} />

      <Typography sx={{ ...meta, mb: SPACE.md, maxWidth: 900, lineHeight: 1.6 }}>
        A re-encode makes a video HEVC 10-bit (at most 10 Mb/s, and 1080p when it's bigger) and keeps every audio and
        subtitle track; only audio a browser can't play becomes AAC. A file is queued only when it comes out at least a fifth
        smaller by the estimate, and the new file is thrown away when it isn't really 5% smaller. It has to be exactly as long as the
        original (funscripts stay in sync). Every original is kept 14 days in the base folder's <code>.originals</code>, with Undo.
        HEVC files, VR videos, and files the queue already made or couldn't shrink are left alone. Pictures aren't touched.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: SPACE.md }}>{error}</Alert>}
      {!space && !error && <LoadingState label="Working it out…" />}

      {t && (
        <StatRow min={190} items={[
          { label: 'Videos in the library', value: fmtSize(t.size), hint: `${files(t.files)}${t.unprobed ? ` · ${t.unprobed} not looked at yet` : ''} · pictures not counted` },
          {
            label: 'Could save', value: `~${fmtSize(t.gain)}`, tone: t.gain ? 'accent' : 'default',
            hint: `${files(t.gainFiles)} · ${cal?.jobs >= 3 ? `estimate corrected by ${cal.jobs} finished re-encodes (×${cal.factor.toFixed(2)})` : `rough estimate until ${3 - (cal?.jobs || 0)} more re-encodes finish`}`
          },
          {
            label: 'Saved so far', value: fmtSize(t.saved), tone: t.saved ? 'ok' : 'default',
            hint: t.pending ? `${fmtSize(t.freed)} freed · ${fmtSize(t.held)} of originals still held in .originals, the first freed ${dateOf(t.nextFree)}`
              : t.jobs ? `by ${t.jobs} re-encodes, all freed` : 'nothing re-encoded yet'
          },
          { label: 'Queued', value: q ? String(q.counts.queued + q.counts.running) : '…', hint: q ? `${q.running ? 'running' : 'paused'}${q.active.length ? ` · ${q.active.length} encoding now` : ''}` : '' }
        ]} />
      )}

      {scan && <Typography sx={{ ...meta, mt: -1, mb: SPACE.md }}>{scanLine}</Typography>}

      <Box sx={{ display: 'grid', gap: SPACE.md, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 3fr) minmax(320px, 2fr)' }, alignItems: 'start' }}>
        <Section sx={{ mb: 0 }}>
          <Box role="tablist" aria-label="Lists" sx={{ display: 'flex', gap: 0.5, mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {[['gain', 'Most to gain'], ['size', 'Biggest']].map(([id, label]) => (
              <ButtonBase key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                sx={{ height: 28, px: 1.5, borderRadius: 'var(--radius-sm, 4px)', fontSize: '.8rem', fontWeight: 620,
                  bgcolor: tab === id ? 'var(--text)' : 'var(--raised)', color: tab === id ? 'var(--bg)' : 'var(--dim)' }}>
                {label}
              </ButtonBase>
            ))}
            {t?.gainFiles > 0 && (
              <Button size="small" variant="contained" sx={{ ml: 'auto', textTransform: 'none' }} disabled={busy} onClick={() => setConfirmAll(true)}>
                Re-encode all {t.gainFiles}
              </Button>
            )}
          </Box>
          <Typography sx={{ ...meta, mb: 1 }}>
            {tab === 'gain' ? 'Performers and genres by what a re-encode would take off. Open one for its folders and files.' : 'Performers and genres by the size of their videos.'}
          </Typography>
          {space && !list.length && (
            <Typography sx={meta}>{tab === 'gain' ? 'Nothing a re-encode would make much smaller.' : 'No videos found yet.'}</Typography>
          )}
          <Box sx={{ display: 'grid', gap: '4px' }}>
            {shown.map(g => <GroupRow key={g.key} g={g} tab={tab} busy={busy} onQueue={queue} version={version} />)}
          </Box>
          {list.length > LIMIT && (
            <Button size="small" sx={{ ...smallBtnSx, mt: 1, border: 0 }} onClick={() => setShowAll(s => !s)}>
              {showAll ? 'Show fewer' : `Show all ${list.length}`}
            </Button>
          )}
        </Section>

        <Box sx={{ display: 'grid', gap: SPACE.md }}>
          {q && <QueuePanel q={q} act={act} onMode={(mode) => act('/api/encode/mode', 'PUT', { mode })} />}
          {q && <RecentPanel q={q} act={act} />}
          <Collapse in={!!q}>{q && <WorkersPanel q={q} act={act} reload={refreshAll} />}</Collapse>
        </Box>
      </Box>

      <Dialog open={confirmAll} onClose={() => setConfirmAll(false)}>
        <DialogTitle>Re-encode the whole library?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Queue {t ? files(t.gainFiles) : ''} for about {t ? fmtSize(t.gain) : ''}. Each original is kept 14 days in .originals (that
            room is needed until then), and a file that doesn't come out smaller keeps its original.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => { setConfirmAll(false); queue({ all: true }, 'The library'); }}>Queue them</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={7000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>{toast.msg}</Alert> : <span />}
      </Snackbar>
    </PageShell>
  );
}
