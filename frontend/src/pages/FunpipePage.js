import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, IconButton, Chip, Alert,
  LinearProgress, Stack, Tooltip,
  TextField, Checkbox, Snackbar
} from '@mui/material';
import { PageShell, Panel, StatRow, SPACE, iconBtnSx } from '../components/layout';
import useJobs, { isActive } from '../hooks/useJobs';
import MovieIcon from '@mui/icons-material/Movie';
import QueueIcon from '@mui/icons-material/Queue';
import RefreshIcon from '@mui/icons-material/Refresh';
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

/* MUI palette names don't reach plain CSS, and the rows need the colour as a
   var() for borders and text. One map, both uses. */
const STATUS_TONE = {
  running: 'accent', queued: 'default', needs_review: 'warn', reviewed: 'ok',
  external: 'info', no_script: 'bad', incomplete: 'warn', failed: 'bad'
};
const TONE_VAR = {
  accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)',
  bad: 'var(--bad)', info: 'var(--info)', default: 'var(--dim)'
};
/* Worst first — the summary should open on what needs attention, not on the
   videos that are already done. */
const STAT_ORDER = ['no_script', 'failed', 'incomplete', 'needs_review', 'running', 'queued', 'reviewed', 'external'];

const filterChipSx = (active, tone) => ({
  height: 24,
  fontSize: '0.7rem',
  fontWeight: active ? 650 : 550,
  cursor: 'pointer',
  bgcolor: active ? (tone || 'var(--accent)') : 'var(--bg)',
  color: active ? 'var(--bg)' : (tone || 'var(--dim)'),
  border: '1px solid',
  borderColor: tone || 'var(--line)',
  '&:hover': { bgcolor: active ? (tone || 'var(--accent)') : 'var(--raised)' }
});

/**
 * Poster frame for one video.
 *
 * The old table had no imagery at all — a video library rendered entirely as
 * text. Falls back to a toned tile when the frame grab fails, which it will for
 * codecs ffmpeg can't open, or files that moved since the last library scan.
 */
function VideoThumb({ path, tone }) {
  const [failed, setFailed] = useState(false);
  const box = {
    width: 64, height: 44, flexShrink: 0, borderRadius: 'var(--radius-sm, 4px)',
    overflow: 'hidden', bgcolor: 'var(--raised)',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  };
  if (failed) {
    return (
      <Box sx={{ ...box, color: tone, '& svg': { fontSize: 18, opacity: 0.7 } }}>
        <MovieIcon />
      </Box>
    );
  }
  return (
    <Box sx={box}>
      <Box
        component="img"
        loading="lazy"
        src={`/api/files/video-thumbnail?path=${encodeURIComponent(path)}`}
        alt=""
        onError={() => setFailed(true)}
        sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </Box>
  );
}

function fmtBytes(b) {
  if (!b) return '—';
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`;
}

/**
 * Funpipe — the funscript library and the review editor. The queue itself
 * (job list, Start / Stop / Clear done, log tail, worker state) lives on /jobs
 * under the Funscripts filter; this page only adds videos to it.
 */
export default function FunpipePage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState({ url: '', aiServerUrl: '' });

  const [library, setLibrary] = useState({ videos: [], counts: {}, total: 0 });
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [editor, setEditor] = useState({ running: false, url: null });
  const [editorBusy, setEditorBusy] = useState(false);

  // Slow poll: it only has to notice when the queue drains (to rescan the
  // library) and keep the Online / Offline chip and GPU banner honest.
  const { jobs, services, refresh: refreshJobs } = useJobs({ activeMs: 5000, idleMs: 20000, withServices: true });

  // ── config ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/funpipe/config').then(r => r.json()).then(setConfig).catch(() => {});
  }, []);

  // ── data loading ──────────────────────────────────────────
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

  useEffect(() => { loadLibrary(); loadEditor(); }, [loadLibrary, loadEditor]);

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

  // When the last funpipe job finishes, the on-disk state changed — re-read the library.
  const funpipeActive = jobs.some(j => j.type === 'funpipe' && isActive(j));
  const prevActive = useRef(false);
  useEffect(() => {
    if (prevActive.current && !funpipeActive) loadLibrary(true);
    prevActive.current = funpipeActive;
  }, [funpipeActive, loadLibrary]);

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
    refreshJobs();
    loadLibrary(true);
  };

  // ── derived ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = library.videos.filter(v => {
      if (statusFilter && v.status !== statusFilter) return false;
      if (!q) return true;
      return v.name.toLowerCase().includes(q) || (v.performer || '').toLowerCase().includes(q);
    });
    return [...rows].sort((a, b) =>
      a.performer.localeCompare(b.performer) || a.name.localeCompare(b.name));
  }, [library.videos, statusFilter, query]);

  const selectableInView = filtered.filter(v => QUEUEABLE.includes(v.status));
  const allInViewSelected = selectableInView.length > 0 && selectableInView.every(v => selected.has(v.path));
  // Optimistic until the first services poll answers, as the old queue poll was.
  const online = services ? services.funpipe.online : true;
  const gpuWarning = services?.gpu.warning || null;
  const funpipeCount = jobs.filter(j => j.type === 'funpipe' && isActive(j)).length;

  const toggle = (path) => setSelected(s => {
    const next = new Set(s);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  // The editor resolves a video by its stem, so this deep-links straight to it —
  // but only once the editor process is actually up.
  const reviewUrl = (v) => `${editor.url}/?v=${encodeURIComponent(v.stem)}`;

  return (
    <PageShell>
      {/* No title block and no back arrow: the toolbar logo is the way home,
          and "Funpipe" was stating what the Funscript library panel below
          already says. Just the controls. */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: SPACE.sm,
          flexWrap: 'wrap', mb: SPACE.md
        }}
      >
        <Chip
          size="small"
          variant="outlined"
          label={online ? `Online — ${config.url}` : 'Offline'}
          sx={{
            borderColor: online ? 'var(--ok)' : 'var(--bad)',
            color: online ? 'var(--ok)' : 'var(--bad)'
          }}
        />
        <Button
          size="small"
          variant="outlined"
          endIcon={<OpenInNewIcon sx={{ fontSize: '14px !important' }} />}
          onClick={() => navigate('/jobs')}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {funpipeCount > 0 ? `${funpipeCount} in queue — view in Jobs` : 'View queue in Jobs'}
        </Button>
        <Tooltip title={editor.running
          ? 'Shut the review editor down when you\'re done — it holds the video files open'
          : 'Start the funscript review editor on the GPU machine'}>
          <span>
            <Button
              size="small"
              variant={editor.running ? 'outlined' : 'contained'}
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
            <IconButton component="a" href={editor.url} target="_blank" rel="noreferrer" sx={{ color: 'var(--dim)' }}>
              <OpenInNewIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Runs on the AI Inference App — change its address in the Training Hub">
          <IconButton onClick={() => navigate('/training-hub')} sx={{ color: 'var(--dim)' }}><SettingsIcon /></IconButton>
        </Tooltip>
        <Tooltip title="Rescan funscript folders">
          <span>
            <IconButton onClick={() => loadLibrary(true)} disabled={libraryLoading} sx={{ color: 'var(--dim)' }}><RefreshIcon /></IconButton>
          </span>
        </Tooltip>
      </Box>

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

      {/* ── library ── */}
      {/* Status counts double as the filter. "What needs doing" is the only
          question this page exists to answer, and as a sortable column it was
          invisible — you had to scan every row to find the 24 that mattered. */}
      {library.total > 0 && (
        <StatRow
          min={132}
          sx={{ mb: SPACE.md }}
          items={STAT_ORDER
            .filter(s => library.counts?.[s])
            .map(s => ({
              label: STATUS_META[s].label,
              value: library.counts[s],
              tone: STATUS_TONE[s] || 'default'
            }))}
        />
      )}

      <Panel>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: SPACE.sm, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 620, color: 'var(--text)' }}>Funscript library</Typography>
            <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
              {filtered.length === library.total
                ? `${library.total} video(s)`
                : `${filtered.length} of ${library.total}`}
            </Typography>
            <Box sx={{ flex: 1 }} />
            {selected.size > 0 && (
              <Button variant="contained" size="small" startIcon={<QueueIcon />}
                      disabled={!online} onClick={queueSelected}>
                Queue {selected.size} with funpipe
              </Button>
            )}
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Chip label={`All ${library.total}`} size="small"
                  onClick={() => setStatusFilter(null)}
                  sx={filterChipSx(statusFilter === null)} />
            {Object.entries(library.counts || {}).map(([status, count]) => (
              <Tooltip key={status} title={STATUS_META[status]?.help || status}>
                <Chip
                  size="small"
                  label={`${STATUS_META[status]?.label || status} ${count}`}
                  onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                  sx={filterChipSx(statusFilter === status, TONE_VAR[STATUS_TONE[status]])}
                />
              </Tooltip>
            ))}
            <TextField
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search performer or file…"
              size="small"
              sx={{ flex: 1, minWidth: 180, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.75 } }}
            />
            {selectableInView.length > 0 && (
              <Button
                size="small"
                onClick={() => setSelected(allInViewSelected ? new Set() : new Set(selectableInView.map(v => v.path)))}
                sx={{ color: 'var(--dim)', textTransform: 'none', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
              >
                {allInViewSelected ? 'Clear' : `Select ${selectableInView.length}`}
              </Button>
            )}
          </Stack>

          {libraryLoading && <LinearProgress sx={{ mb: 1 }} />}

          {!libraryLoading && filtered.length === 0 && (
            <Typography variant="body2" sx={{ color: 'var(--dim)' }}>
              {library.total === 0
                ? 'No videos in any funscript folder yet. Use "Move to Funscript" while filtering a performer.'
                : 'Nothing matches those filters.'}
            </Typography>
          )}

          {filtered.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, maxHeight: 640, overflowY: 'auto', pr: 0.5 }}>
              {filtered.map(v => {
                const meta = STATUS_META[v.status] || { label: v.status };
                const queueable = QUEUEABLE.includes(v.status);
                const tone = TONE_VAR[STATUS_TONE[v.status]] || 'var(--dim)';
                const isSel = selected.has(v.path);
                return (
                  <Box
                    key={v.path}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1,
                      // Required. .App is a flex column (App.css), so these rows
                      // sit in a nested flex context where the default
                      // flex-shrink:1 collapsed them to 17px — all 28 squeezed
                      // into the 640px cap instead of scrolling — and the row's
                      // overflow:hidden then clipped the 44px thumbnail and the
                      // text to slivers. Measured: 17px before, 55px after.
                      flexShrink: 0,
                      background: isSel ? 'var(--accent-quiet)' : 'var(--bg)',
                      border: '1px solid',
                      borderColor: isSel ? 'var(--accent)' : 'var(--line)',
                      borderRadius: 'var(--radius-lg, 10px)',
                      overflow: 'hidden',
                      transition: 'border-color .16s ease, background-color .16s ease',
                      '&:hover': { borderColor: isSel ? 'var(--accent)' : 'var(--line-strong)' }
                    }}
                  >
                    <Checkbox
                      size="small" disabled={!queueable}
                      checked={isSel} onChange={() => toggle(v.path)}
                      sx={{ ml: 0.5, color: 'var(--muted)', '&.Mui-checked': { color: 'var(--accent)' } }}
                    />

                    <VideoThumb path={v.path} tone={tone} />

                    <Box sx={{ flex: 1, minWidth: 0, py: 0.75 }}>
                      {/* The filename is the thing you recognise a video by, so
                          it leads. It used to sit in a 380px cell with
                          wordBreak:'break-all', which shattered long names
                          mid-word across three lines. */}
                      <Typography
                        title={v.name}
                        sx={{
                          fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                        }}
                      >
                        {v.name}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25, flexWrap: 'wrap' }}>
                        <Typography sx={{ fontSize: '0.72rem', color: 'var(--dim)' }}>{v.performer}</Typography>
                        <Tooltip title={meta.help || ''}>
                          <Box component="span" sx={{
                            fontSize: '0.65rem', fontWeight: 700, color: tone,
                            border: '1px solid', borderColor: tone, opacity: 0.95,
                            borderRadius: 'var(--radius-sm, 4px)', px: 0.75, py: '1px'
                          }}>
                            {meta.label}
                          </Box>
                        </Tooltip>
                        {v.job?.stage && (
                          <Typography sx={{ fontSize: '0.68rem', color: 'var(--accent)' }}>{v.job.stage}</Typography>
                        )}
                        <Typography sx={{ fontSize: '0.7rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {v.funscripts.length
                            ? `${v.funscripts.length} script${v.funscripts.length > 1 ? 's' : ''}`
                            : 'no script'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.7rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtBytes(v.size)}
                        </Typography>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, pr: 1 }}>
                      {v.fromFunpipe && editor.running && editor.url && (
                        <Tooltip title="Review this script in the editor">
                          <IconButton size="small" component="a" target="_blank"
                                      rel="noreferrer" href={reviewUrl(v)} sx={iconBtnSx()}>
                            <EditNoteIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {queueable && (
                        <Tooltip title="Queue this one now">
                          <span>
                            <IconButton size="small" disabled={!online} sx={iconBtnSx()} onClick={async () => {
                              const r = await post('/api/funpipe/queue/add', { videos: [v.path] });
                              setToast(r.queued
                                ? { severity: 'success', msg: `Queued ${v.name}` }
                                : { severity: 'warning', msg: r.error || 'funpipe accepted nothing' });
                              refreshJobs();
                            }}>
                              <QueueIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </Panel>

      <Snackbar
        open={!!toast} autoHideDuration={5000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </PageShell>
  );
}
