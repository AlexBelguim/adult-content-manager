import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, IconButton, Chip, Alert,
  LinearProgress, Stack, Card, CardContent, Collapse, Tooltip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Checkbox, Snackbar
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import QueueIcon from '@mui/icons-material/Queue';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditNoteIcon from '@mui/icons-material/EditNote';
import SettingsIcon from '@mui/icons-material/Settings';

// Status vocabulary comes from GET /api/funpipe/library — see backend/routes/funpipe.js
const STATUS_META = {
  running:      { label: 'Generating',    color: 'info',      help: 'funpipe is working on this now' },
  queued:       { label: 'Queued',        color: 'default',   help: 'Waiting in the funpipe queue' },
  needs_review: { label: 'Needs review',  color: 'warning',   help: 'funpipe made a script, nobody has reviewed it' },
  reviewed:     { label: 'Reviewed',      color: 'success',   help: 'funpipe script with human edits' },
  external:     { label: 'External',      color: 'secondary', help: 'Has a funscript that funpipe did not make' },
  no_script:    { label: 'No script',     color: 'error',     help: 'No funscript and no funpipe output yet' },
  incomplete:   { label: 'Incomplete',    color: 'warning',   help: 'funpipe started but never produced a signal' },
  failed:       { label: 'Failed',        color: 'error',     help: 'The funpipe job failed' }
};

const QUEUEABLE = ['no_script', 'incomplete', 'failed'];

function fmtBytes(b) {
  if (!b) return '—';
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`;
}

function fmtElapsed(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
}

export default function FunpipePage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState({ url: '', aiServerUrl: '' });

  const [queue, setQueue] = useState({ running: false, jobs: [], ok: true });
  const [library, setLibrary] = useState({ videos: [], counts: {}, total: 0 });
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState(null);
  const [toast, setToast] = useState(null);
  const [editor, setEditor] = useState({ running: false, url: null });
  const [editorBusy, setEditorBusy] = useState(false);

  const pollRef = useRef(null);

  // ── config ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/funpipe/config').then(r => r.json()).then(setConfig).catch(() => {});
  }, []);

  // ── data loading ──────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/funpipe/queue');
      setQueue(await res.json());
    } catch (err) {
      setQueue({ running: false, jobs: [], ok: false, error: err.message });
    }
  }, []);

  const loadLibrary = useCallback(async (refresh = false) => {
    setLibraryLoading(true);
    try {
      const res = await fetch(`/api/funpipe/library${refresh ? '?refresh=true' : ''}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLibrary(data);
    } catch (err) {
      setToast({ severity: 'error', msg: `Library scan failed: ${err.message}` });
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const loadEditor = useCallback(async () => {
    try {
      setEditor(await (await fetch('/api/funpipe/ui/status')).json());
    } catch { /* AI server offline — the banner already says so */ }
  }, []);

  const [gpuWarning, setGpuWarning] = useState(null);
  const loadGpu = useCallback(async () => {
    try {
      const g = await (await fetch('/api/funpipe/health')).json();
      setGpuWarning(g.gpu_warning || null);
    } catch { setGpuWarning(null); }
  }, []);

  useEffect(() => { loadQueue(); loadLibrary(); loadEditor(); loadGpu(); },
    [loadQueue, loadLibrary, loadEditor, loadGpu]);

  // The editor is a child process of the AI server; it can exit on its own.
  const toggleEditor = async () => {
    setEditorBusy(true);
    try {
      const res = await post(editor.running ? '/api/funpipe/ui/stop' : '/api/funpipe/ui/start');
      if (res.error) setToast({ severity: 'error', msg: res.error });
      else if (!editor.running) {
        setToast({ severity: 'success', msg: 'Review editor started' });
      }
      await loadEditor();
    } finally {
      setEditorBusy(false);
    }
  };

  // Poll fast while something is actually running, slowly otherwise.
  useEffect(() => {
    const active = queue.jobs?.some(j => j.status === 'running' || j.status === 'queued');
    const interval = active ? 3000 : 10000;
    pollRef.current = setInterval(loadQueue, interval);
    return () => clearInterval(pollRef.current);
  }, [queue.jobs, loadQueue]);

  // When the last job finishes, the on-disk state changed — re-read the library.
  const prevActive = useRef(false);
  useEffect(() => {
    const active = !!queue.jobs?.some(j => j.status === 'running' || j.status === 'queued');
    if (prevActive.current && !active) loadLibrary(true);
    prevActive.current = active;
  }, [queue.jobs, loadLibrary]);

  // ── queue controls ────────────────────────────────────────
  const post = async (path, body) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return res.json();
  };

  const queueSelected = async () => {
    const videos = library.videos.filter(v => selected.has(v.path)).map(v => v.path);
    if (videos.length === 0) return;
    const result = await post('/api/funpipe/queue/add', { videos });
    if (result.queued) {
      setToast({ severity: 'success', msg: `Queued ${result.added} video(s) with funpipe` });
      setSelected(new Set());
    } else {
      setToast({ severity: 'warning', msg: result.error || 'funpipe accepted nothing — already processed?' });
    }
    loadQueue();
    loadLibrary(true);
  };

  // ── derived ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const rows = statusFilter ? library.videos.filter(v => v.status === statusFilter) : library.videos;
    return [...rows].sort((a, b) =>
      a.performer.localeCompare(b.performer) || a.name.localeCompare(b.name));
  }, [library.videos, statusFilter]);

  const selectableInView = filtered.filter(v => QUEUEABLE.includes(v.status));
  const online = queue.ok !== false;

  const toggle = (path) => setSelected(s => {
    const next = new Set(s);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  // The editor resolves a video by its stem, so this deep-links straight to it —
  // but only once the editor process is actually up.
  const reviewUrl = (v) => `${editor.url}/?v=${encodeURIComponent(v.stem)}`;

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h4">Funpipe</Typography>
        <Chip
          size="small"
          color={online ? 'success' : 'error'}
          label={online ? `Online — ${config.url}` : 'Offline'}
        />
        <Box sx={{ flex: 1 }} />
        <Tooltip title={editor.running
          ? 'Shut the review editor down when you\'re done — it holds the video files open'
          : 'Start the funscript review editor on the GPU machine'}>
          <span>
            <Button
              size="small"
              variant={editor.running ? 'outlined' : 'contained'}
              color={editor.running ? 'inherit' : 'primary'}
              startIcon={<EditNoteIcon />}
              disabled={!online || editorBusy}
              onClick={toggleEditor}
            >
              {editorBusy ? 'Working…' : editor.running ? 'Stop editor' : 'Start review editor'}
            </Button>
          </span>
        </Tooltip>
        {editor.running && editor.url && (
          <Tooltip title="Open the review editor">
            <IconButton component="a" href={editor.url} target="_blank" rel="noreferrer">
              <OpenInNewIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Runs on the AI Inference App — change its address in the Training Hub">
          <IconButton onClick={() => navigate('/training-hub')}><SettingsIcon /></IconButton>
        </Tooltip>
        <Tooltip title="Rescan funscript folders">
          <span>
            <IconButton onClick={() => loadLibrary(true)} disabled={libraryLoading}><RefreshIcon /></IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Videos moved to a funscript folder are queued for generation automatically. This page
        shows what has a script, which scripts were generated here, and which still need a
        human review pass. Generation runs on the AI Inference App and shares its GPU, so it
        won't compete with image inference or training.
      </Typography>

      {!online && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Can't reach the AI Inference App at <strong>{config.aiServerUrl}</strong>. Start it on
          the GPU machine with <code>Run_AI.bat</code>. Moving videos to a funscript folder still
          works — they just won't be queued.
        </Alert>
      )}

      {online && gpuWarning && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>GPU is busy:</strong> {gpuWarning}. Generation will still run — it shares the
          card rather than waiting — but expect both to be slower.
        </Alert>
      )}

      {/* ── queue ── */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <QueueIcon />
            <Typography variant="h6">Queue</Typography>
            <Chip size="small" label={queue.running ? 'Worker running' : 'Idle'}
                  color={queue.running ? 'info' : 'default'} />
            <Box sx={{ flex: 1 }} />
            <Button size="small" startIcon={<PlayArrowIcon />} disabled={!online || queue.running}
                    onClick={() => post('/api/funpipe/queue/start').then(loadQueue)}>Start</Button>
            <Button size="small" startIcon={<StopIcon />} disabled={!online || !queue.running}
                    onClick={() => post('/api/funpipe/queue/stop').then(loadQueue)}>Stop</Button>
            <Button size="small" startIcon={<CleaningServicesIcon />} disabled={!online}
                    onClick={() => post('/api/funpipe/queue/clear-done').then(loadQueue)}>Clear done</Button>
          </Stack>

          {(!queue.jobs || queue.jobs.length === 0) && (
            <Typography variant="body2" color="text.secondary">Nothing queued.</Typography>
          )}

          <Stack divider={<Divider />}>
            {(queue.jobs || []).map(job => (
              <Box key={job.id} sx={{ py: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-all' }}>{job.name}</Typography>
                  {job.stage && <Chip size="small" label={job.stage} />}
                  <Chip size="small" label={job.status}
                        color={job.status === 'running' ? 'info'
                             : job.status === 'done' ? 'success'
                             : job.status === 'failed' ? 'error' : 'default'} />
                  {job.elapsed > 0 && (
                    <Typography variant="caption" color="text.secondary">{fmtElapsed(job.elapsed)}</Typography>
                  )}
                  <IconButton size="small" onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}>
                    {expandedJob === job.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                  <IconButton size="small" disabled={job.status === 'running'}
                              onClick={() => post('/api/funpipe/queue/remove', { id: job.id }).then(loadQueue)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>

                {job.status === 'running' && (
                  <LinearProgress
                    sx={{ mt: 0.5 }}
                    variant={job.progress != null ? 'determinate' : 'indeterminate'}
                    value={job.progress != null ? job.progress * 100 : undefined}
                  />
                )}
                {job.total_windows > 0 && job.status === 'running' && (
                  <Typography variant="caption" color="text.secondary">
                    window {job.windows_done || 0} / {job.total_windows}
                  </Typography>
                )}

                <Collapse in={expandedJob === job.id}>
                  <Box component="pre" sx={{
                    mt: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1,
                    fontSize: '0.75rem', overflowX: 'auto', maxHeight: 200
                  }}>
                    {(job.log_tail || []).join('\n') || 'no output yet'}
                  </Box>
                </Collapse>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {/* ── library ── */}
      <Card>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="h6">Funscript library</Typography>
            <Typography variant="body2" color="text.secondary">{library.total} video(s)</Typography>
            <Box sx={{ flex: 1 }} />
            {selected.size > 0 && (
              <Button variant="contained" size="small" startIcon={<QueueIcon />}
                      disabled={!online} onClick={queueSelected}>
                Queue {selected.size} with funpipe
              </Button>
            )}
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Chip label={`All (${library.total})`} size="small"
                  color={statusFilter === null ? 'primary' : 'default'}
                  onClick={() => setStatusFilter(null)} />
            {Object.entries(library.counts || {}).map(([status, count]) => (
              <Tooltip key={status} title={STATUS_META[status]?.help || status}>
                <Chip
                  size="small"
                  label={`${STATUS_META[status]?.label || status} (${count})`}
                  color={statusFilter === status ? 'primary' : STATUS_META[status]?.color || 'default'}
                  variant={statusFilter === status ? 'filled' : 'outlined'}
                  onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                />
              </Tooltip>
            ))}
          </Stack>

          {libraryLoading && <LinearProgress sx={{ mb: 1 }} />}

          {!libraryLoading && filtered.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No videos in any funscript folder yet. Use "Move to Funscript" while filtering a performer.
            </Typography>
          )}

          {filtered.length > 0 && (
            <TableContainer sx={{ maxHeight: 600, overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        disabled={selectableInView.length === 0}
                        checked={selectableInView.length > 0 && selectableInView.every(v => selected.has(v.path))}
                        indeterminate={selectableInView.some(v => selected.has(v.path))
                          && !selectableInView.every(v => selected.has(v.path))}
                        onChange={(e) => setSelected(e.target.checked
                          ? new Set(selectableInView.map(v => v.path))
                          : new Set())}
                      />
                    </TableCell>
                    <TableCell>Performer</TableCell>
                    <TableCell>Video</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Scripts</TableCell>
                    <TableCell align="right">Size</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map(v => {
                    const meta = STATUS_META[v.status] || { label: v.status, color: 'default' };
                    const queueable = QUEUEABLE.includes(v.status);
                    return (
                      <TableRow key={v.path} hover>
                        <TableCell padding="checkbox">
                          <Checkbox size="small" disabled={!queueable}
                                    checked={selected.has(v.path)} onChange={() => toggle(v.path)} />
                        </TableCell>
                        <TableCell>{v.performer}</TableCell>
                        <TableCell sx={{ maxWidth: 380, wordBreak: 'break-all' }}>{v.name}</TableCell>
                        <TableCell>
                          <Tooltip title={meta.help || ''}>
                            <Chip size="small" label={meta.label} color={meta.color} variant="outlined" />
                          </Tooltip>
                          {v.job?.stage && (
                            <Chip size="small" sx={{ ml: 0.5 }} label={v.job.stage} />
                          )}
                        </TableCell>
                        <TableCell>{v.funscripts.length || '—'}</TableCell>
                        <TableCell align="right">{fmtBytes(v.size)}</TableCell>
                        <TableCell align="right">
                          {v.fromFunpipe && editor.running && editor.url && (
                            <Tooltip title="Review this script in the editor">
                              <IconButton size="small" component="a" target="_blank"
                                          rel="noreferrer" href={reviewUrl(v)}>
                                <EditNoteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {queueable && (
                            <Tooltip title="Queue this one now">
                              <span>
                                <IconButton size="small" disabled={!online} onClick={async () => {
                                  const r = await post('/api/funpipe/queue/add', { videos: [v.path] });
                                  setToast(r.queued
                                    ? { severity: 'success', msg: `Queued ${v.name}` }
                                    : { severity: 'warning', msg: r.error || 'funpipe accepted nothing' });
                                  loadQueue();
                                }}>
                                  <QueueIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={!!toast} autoHideDuration={5000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
