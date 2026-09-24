/**
 * Jobs — one screen for everything running in the background.
 *
 * Reads GET /api/jobs (through useJobs, which also merges App's hash / CLIP
 * queue). This page owns no queue: every action goes to the endpoint of the
 * source the job came from, picked by job.type.
 *
 * Route: /jobs   Props: hashQueue, setHashQueue (the App.js hash / CLIP queue)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, ButtonBase, Tooltip, Snackbar, Alert, Collapse } from '@mui/material';
import ListAltIcon from '@mui/icons-material/ListAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { PageShell, PageHeader, LoadingState, SPACE } from '../components/layout';
import useJobs, { JOB_TYPES, jobPercent } from '../hooks/useJobs';
import { JOB_TYPE_ICONS, JobBar } from '../components/JobsIndicator';

const STACK = '@media (max-width: 860px)';

const STATUS_TONE = {
  running: ['var(--accent)', 'var(--accent-quiet)'],
  done: ['var(--ok)', 'var(--ok-quiet)'],
  failed: ['var(--bad)', 'var(--bad-quiet)'],
  queued: ['var(--info)', 'var(--info-quiet)']
};

const SECTIONS = [
  ['running', 'Running'],
  ['failed', 'Failed'],
  ['queued', 'Queued'],
  ['done', 'Finished']
];

const START_LINKS = [
  ['import', 'Import a folder', '/local-import'],
  ['funpipe', 'Queue funscripts', '/funpipe'],
  ['hash', 'Build hash DB', '/hash-management']
];

// ── formatting ───────────────────────────────────────────────
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** Linear extrapolation — rough on purpose, and only once there is something to extrapolate from. */
function etaText(j) {
  if (j.status !== 'running' || !j.elapsedMs || !j.progress || j.progress < 0.02 || j.progress >= 1) return '';
  return ` · about ${fmtDuration(j.elapsedMs * (1 - j.progress) / j.progress)} left`;
}

function progressText(j) {
  const pct = jobPercent(j);
  const count = j.total ? `${j.done ?? 0} / ${j.total} ${j.unit || ''}`.trim() : '';
  if (count && pct != null) return `${count} · ${pct}%`;
  return count || (pct != null ? `${pct}%` : '');
}

const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── requests ─────────────────────────────────────────────────
async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
const post = (url, body) => send('POST', url, body || {});

/**
 * What can be done to a job, decided by its source. `why` is the tooltip for a
 * disabled button: the button stays where it is, the reason says why it is off.
 */
function capabilities(j) {
  const finished = j.status === 'done' || j.status === 'failed';
  const cap = { cancel: false, remove: false, retry: false, why: '' };

  switch (j.type) {
    case 'import':
      cap.remove = j.status !== 'running';
      cap.why = 'An import can\'t be interrupted once it is moving files';
      // Only local imports can be re-queued: their files are still in "before upload".
      cap.retry = j.status === 'failed' && !!j.raw?.isLocalImport && !!j.raw?.basePath;
      break;
    case 'funpipe':
      cap.remove = j.status !== 'running';
      cap.why = 'funpipe finishes the current video — use Stop in the Funscripts bar to halt after it';
      // `src` is the path ACM sent; `video` is the GPU box's remapped view of it.
      cap.retry = j.status === 'failed' && !!j.raw?.src;
      break;
    case 'hash':
      if (j.local) {
        cap.cancel = j.status === 'running';
        cap.remove = j.status !== 'running';
        cap.retry = j.status === 'failed';
      } else {
        cap.remove = finished;
        cap.why = 'Started outside this browser — the server runs it to the end';
      }
      break;
    case 'encode':
      cap.remove = j.status === 'queued';
      cap.why = j.status === 'running'
        ? 'The encode queue can only cancel jobs that have not started'
        : 'Finished encodes are removed together — use Clear finished';
      break;
    case 'cleanup':
      cap.remove = finished;
      cap.why = 'File operations run to the end once started';
      break;
    default: // train
      cap.why = 'Training is controlled from the Training Hub';
  }
  return cap;
}

// ── small pieces ─────────────────────────────────────────────
const smallBtnSx = {
  minWidth: 0, px: '9px', py: '2px', fontSize: '.78rem', lineHeight: 1.5,
  textTransform: 'none', whiteSpace: 'nowrap',
  color: 'var(--text)', borderColor: 'var(--line-strong)',
  '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' }
};
const dangerBtnSx = {
  ...smallBtnSx, color: 'var(--bad)', borderColor: 'var(--bad)',
  '&:hover': { borderColor: 'var(--bad)', bgcolor: 'var(--bad-quiet)' }
};

function SmallButton({ tip, danger, children, ...rest }) {
  const btn = <Button size="small" variant="outlined" sx={danger ? dangerBtnSx : smallBtnSx} {...rest}>{children}</Button>;
  // A disabled button fires no events, so the tooltip needs the span.
  return tip ? <Tooltip title={tip}><span>{btn}</span></Tooltip> : btn;
}

function JobChip({ tone, children }) {
  const [fg, bg] = tone || ['var(--dim)', 'transparent'];
  return (
    <Box component="span" sx={{
      fontSize: '.68rem', fontWeight: 700, letterSpacing: '.03em', whiteSpace: 'nowrap',
      borderRadius: 99, px: 1, py: '1px', border: '1px solid',
      borderColor: tone ? fg : 'var(--line-strong)', color: fg, bgcolor: bg
    }}>
      {children}
    </Box>
  );
}

const railHeadSx = {
  fontSize: '.68rem', fontWeight: 700, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--muted)', mb: 0.75
};

function RailButton({ active, icon, label, count, onClick }) {
  return (
    <ButtonBase onClick={onClick} sx={{
      display: 'flex', alignItems: 'center', gap: 1, width: '100%', justifyContent: 'flex-start',
      textAlign: 'left', borderRadius: 'var(--radius, 6px)', px: 1, py: 0.75, fontSize: '.86rem',
      color: active ? 'var(--text)' : 'var(--dim)',
      bgcolor: active ? 'var(--accent-quiet)' : 'transparent',
      boxShadow: active ? 'inset 2px 0 0 var(--accent)' : 'none',
      '&:hover': { bgcolor: active ? 'var(--accent-quiet)' : 'var(--raised)' },
      '& svg': { fontSize: 16, flexShrink: 0 }
    }}>
      {icon}
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{label}</Box>
      {count != null && (
        <Box component="span" sx={{ fontSize: '.76rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{count}</Box>
      )}
    </ButtonBase>
  );
}

function ServiceRow({ tone, children }) {
  const color = { ok: 'var(--ok)', warn: 'var(--warn)', off: 'var(--bad)', idle: 'var(--faint)' }[tone];
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '.8rem', px: 1, py: '3px', color: 'var(--dim)' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: color }} />
      <span>{children}</span>
    </Box>
  );
}

function JobThumb({ job }) {
  const [failed, setFailed] = useState(false);
  const Icon = JOB_TYPE_ICONS[job.type] || ListAltIcon;
  const size = { width: 56, height: 56, [STACK]: { width: 44, height: 44 } };
  return (
    <Box sx={{
      ...size, gridRow: 'span 2', borderRadius: 'var(--radius, 6px)', overflow: 'hidden',
      bgcolor: 'var(--raised)', display: 'grid', placeItems: 'center', color: 'var(--dim)'
    }}>
      {job.thumbPath && !failed ? (
        <Box
          component="img" loading="lazy" alt=""
          src={`/api/files/video-thumbnail?path=${encodeURIComponent(job.thumbPath)}`}
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : <Icon sx={{ fontSize: 24 }} />}
    </Box>
  );
}

function JobRow({ job, open, busy, onToggle, onCancel, onRemove, onRetry, onLink }) {
  const cap = capabilities(job);
  const log = job.type === 'funpipe' ? (job.raw?.log_tail || []) : null;
  const hasDetail = !!log || !!job.error;
  const showBar = job.status === 'running' || (job.status === 'failed' && job.progress != null);
  const running = job.status === 'running';

  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr) auto', gap: '4px 12px', alignItems: 'center',
      bgcolor: 'var(--surface)', border: '1px solid',
      borderColor: job.status === 'failed' ? 'var(--bad)' : 'var(--line)',
      borderRadius: 'var(--radius-lg, 10px)', p: '10px 12px', mb: 0.75,
      [STACK]: { gridTemplateColumns: '44px minmax(0, 1fr)' }
    }}>
      <JobThumb job={job} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <Box component="b" title={job.title} sx={{
          fontWeight: 600, color: 'var(--text)', maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {job.title}
        </Box>
        <JobChip tone={STATUS_TONE[job.status]}>{job.status}</JobChip>
        <JobChip>{JOB_TYPES[job.type] || job.type}</JobChip>
        {job.chips.map(c => <JobChip key={c}>{c}</JobChip>)}
      </Box>

      <Box sx={{
        display: 'flex', gap: 0.5, gridRow: 'span 2', alignItems: 'center',
        [STACK]: { gridColumn: '1 / -1', gridRow: 'auto', justifyContent: 'flex-end', flexWrap: 'wrap' }
      }}>
        {hasDetail && (
          <SmallButton onClick={onToggle}>{open ? 'Hide' : log ? 'Log' : 'Details'}</SmallButton>
        )}
        {job.link && (
          <SmallButton onClick={onLink} endIcon={<OpenInNewIcon sx={{ fontSize: '13px !important' }} />}>
            Training Hub
          </SmallButton>
        )}
        {cap.retry && <SmallButton disabled={busy} onClick={onRetry}>Retry</SmallButton>}
        {running
          ? <SmallButton danger disabled={busy || !cap.cancel} tip={cap.cancel ? '' : cap.why} onClick={onCancel}>Cancel</SmallButton>
          : <SmallButton disabled={busy || !cap.remove} tip={cap.remove ? '' : cap.why} onClick={onRemove}>Remove</SmallButton>}
      </Box>

      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', minWidth: 0,
        fontSize: '.78rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums'
      }}>
        {job.subtitle && <span>{job.subtitle}</span>}
        {showBar && <JobBar job={job} sx={{ flex: '1 1 120px', minWidth: 80 }} />}
        {showBar && progressText(job) && <span>{progressText(job)}</span>}
        {running && job.stage && <span>{job.stage}</span>}
        {running && job.currentFile && (
          <Box component="span" title={job.currentFile} sx={{
            maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {job.currentFile}
          </Box>
        )}
        {job.status === 'queued'
          ? <span>waiting{job.total ? ` · ${job.total} ${job.unit || ''}` : ''}</span>
          : job.elapsedMs != null && <span>{fmtDuration(job.elapsedMs)}{etaText(job)}</span>}
        {job.note && (running || job.type === 'encode') && <span>{job.note}</span>}
        {job.status === 'done' && job.finishedAt && <span>finished {fmtClock(job.finishedAt)}</span>}
        {job.result && <Box component="span" sx={{ color: 'var(--ok)' }}>{job.result}</Box>}
        {job.error && <Box component="span" sx={{ color: 'var(--bad)' }}>{job.error}</Box>}
      </Box>

      {hasDetail && (
        <Collapse in={open} unmountOnExit sx={{ gridColumn: '1 / -1' }}>
          <Box component="pre" sx={{
            m: 0, mt: 0.5, p: '8px 10px', bgcolor: 'var(--bg)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius, 6px)', color: 'var(--dim)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.74rem', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 170, overflowY: 'auto'
          }}>
            {log ? (log.join('\n') || 'no output yet') : job.error}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

// ── page ─────────────────────────────────────────────────────
export default function JobsPage({ hashQueue, setHashQueue }) {
  const navigate = useNavigate();
  const { jobs, services, loaded, refresh } = useJobs({ hashQueue, withServices: true });

  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openRows, setOpenRows] = useState({});
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const [editor, setEditor] = useState(null);

  // The hash queue in App.js only learns that a job ended from its own poll.
  // The server list is authoritative, so hand the final state back — otherwise
  // a finished job sits at "processing" and blocks everything queued behind it.
  useEffect(() => {
    if (!setHashQueue) return;
    const ended = jobs.filter(j => j.type === 'hash' && j.local
      && j.raw.status === 'processing' && (j.status === 'done' || j.status === 'failed'));
    if (ended.length === 0) return;
    const byId = new Map(ended.map(j => [j.sourceId, j]));
    setHashQueue(prev => prev.map(q => {
      const j = byId.get(q.id);
      if (!j) return q;
      return {
        ...q, status: j.status === 'done' ? 'completed' : 'error',
        processed: j.done ?? q.processed, total: j.total ?? q.total,
        progress: j.status === 'done' ? 100 : q.progress, error: j.error || q.error
      };
    }));
  }, [jobs, setHashQueue]);

  // Review editor state is only needed for the Funscripts bar.
  useEffect(() => {
    if (typeFilter !== 'funpipe') return;
    let alive = true;
    fetch('/api/funpipe/ui/status').then(r => r.json())
      .then(d => { if (alive) setEditor(d); }).catch(() => {});
    return () => { alive = false; };
  }, [typeFilter]);

  // ── derived ────────────────────────────────────────────────
  const inType = useCallback((j) => typeFilter === 'all' || j.type === typeFilter, [typeFilter]);
  const typed = useMemo(() => jobs.filter(inType), [jobs, inType]);
  const visible = useMemo(
    () => typed.filter(j => statusFilter === 'all' || j.status === statusFilter),
    [typed, statusFilter]
  );
  const countBy = (list, key, val) => list.filter(j => j[key] === val).length;

  const retryable = typed.filter(j => capabilities(j).retry);
  const finishedInScope = typed.filter(j => j.status === 'done');

  const fpOnline = services ? services.funpipe.online : null;
  const fpRunning = !!services?.funpipe.workerRunning;
  const trainingOn = jobs.some(j => j.type === 'train' && j.status === 'running');
  const funpipeOn = jobs.some(j => j.type === 'funpipe' && j.status === 'running');
  const gpuWarning = services?.gpu.warning || null;
  const gpuShared = trainingOn && funpipeOn;

  // ── actions ────────────────────────────────────────────────
  const fail = (err) => setToast({ severity: 'error', msg: err.message });

  const withBusy = async (ids, work) => {
    setBusyIds(prev => new Set([...prev, ...ids]));
    try { await work(); } catch (err) { fail(err); } finally {
      setBusyIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
      refresh();
    }
  };

  const dropLocalHash = (ids) => setHashQueue && setHashQueue(prev => prev.filter(q => !ids.includes(q.id)));

  const removeOne = async (j) => {
    if (j.type === 'import') return send('DELETE', `/api/upload-queue/${encodeURIComponent(j.sourceId)}`);
    if (j.type === 'funpipe') return post('/api/funpipe/queue/remove', { id: j.sourceId });
    if (j.type === 'encode') return send('DELETE', `/api/encode/jobs/${j.sourceId}`);
    if (j.type === 'hash' && j.local) return dropLocalHash([j.sourceId]);
    return post('/api/jobs/dismiss', { ids: [j.id] });
  };

  const retryOne = async (j) => {
    if (j.type === 'hash') {
      if (!setHashQueue) throw new Error('The hash queue is not available on this page');
      // Back to "queued": App.js starts it as soon as nothing else is hashing.
      setHashQueue(prev => prev.map(q => (q.id === j.sourceId
        ? { ...q, status: 'queued', processed: 0, total: 0, progress: 0, error: undefined, backendJobId: undefined }
        : q)));
      return;
    }
    if (j.type === 'import') {
      const r = j.raw;
      await post('/api/folders/local-import', {
        performers: [{ folderName: r.folderName || r.performerName, name: r.performerName, totalFiles: r.totalFiles }],
        basePath: r.basePath, createHashes: !!r.createHashes
      });
      await send('DELETE', `/api/upload-queue/${encodeURIComponent(j.sourceId)}`);
      return;
    }
    // funpipe: re-add the video (a failed row does not count as "already
    // queued"), and drop the failed row only once the new one is in.
    const res = await fetch('/api/funpipe/queue/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos: [j.raw.src] })
    }).then(r => r.json());
    if (!res.queued) throw new Error(res.error || res.reason || 'funpipe accepted nothing');
    await post('/api/funpipe/queue/remove', { id: j.sourceId });
  };

  const handleRemove = (j) => withBusy([j.id], () => removeOne(j));
  const handleRetry = (j) => withBusy([j.id], async () => {
    await retryOne(j);
    setToast({ severity: 'success', msg: `Re-queued ${j.title}` });
  });

  const retryAll = () => withBusy(retryable.map(j => j.id), async () => {
    let ok = 0;
    const errors = [];
    for (const j of retryable) {
      try { await retryOne(j); ok++; } catch (err) { errors.push(`${j.title}: ${err.message}`); }
    }
    setToast(errors.length
      ? { severity: 'warning', msg: `Re-queued ${ok}, ${errors.length} failed — ${errors[0]}` }
      : { severity: 'success', msg: `Re-queued ${ok} job(s)` });
  });

  const clearFinished = () => withBusy([], async () => {
    const types = new Set(finishedInScope.map(j => j.type));
    const calls = [];
    if (types.has('import')) calls.push(post('/api/upload-queue/clear-completed'));
    if (types.has('funpipe')) calls.push(post('/api/funpipe/queue/clear-done'));
    if (types.has('encode')) calls.push(post('/api/encode/clear'));
    const dismissIds = finishedInScope.filter(j => (j.type === 'hash' && !j.local) || j.type === 'cleanup').map(j => j.id);
    if (dismissIds.length) calls.push(post('/api/jobs/dismiss', { ids: dismissIds }));
    dropLocalHash(finishedInScope.filter(j => j.type === 'hash' && j.local).map(j => j.sourceId));
    const results = await Promise.allSettled(calls);
    const bad = results.find(r => r.status === 'rejected');
    if (bad) throw bad.reason;
  });

  const funpipeCall = (path) => withBusy(['funpipe-bar'], () => post(path));

  // ── render ─────────────────────────────────────────────────
  const stats = [
    ['all', 'Total', typed.length],
    ['running', 'Running', countBy(typed, 'status', 'running')],
    ['queued', 'Queued', countBy(typed, 'status', 'queued')],
    ['done', 'Finished', countBy(typed, 'status', 'done')],
    ['failed', 'Failed', countBy(typed, 'status', 'failed')]
  ];
  const barBusy = busyIds.has('funpipe-bar');

  return (
    <PageShell>
      <PageHeader
        title="Jobs"
        subtitle="Everything running in the background — imports, funscripts, hashing, encoding, cleanup and training"
        actions={(
          <>
            <Button size="small" variant="outlined" disabled={finishedInScope.length === 0} onClick={clearFinished}>
              Clear finished
            </Button>
            <Button size="small" variant="outlined" disabled={retryable.length === 0} onClick={retryAll}>
              Retry failed
            </Button>
          </>
        )}
      />

      <Box sx={{
        display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr)', gap: SPACE.lg, alignItems: 'start',
        [STACK]: { gridTemplateColumns: 'minmax(0, 1fr)', gap: SPACE.md }
      }}>
        {/* ── rail ── */}
        <Box component="aside" sx={{
          display: 'flex', flexDirection: 'column', gap: SPACE.md,
          pr: SPACE.md, borderRight: '1px solid var(--line)',
          [STACK]: {
            flexDirection: 'row', flexWrap: 'wrap', gap: '10px 20px', pr: 0, pb: SPACE.md,
            borderRight: 0, borderBottom: '1px solid var(--line)', '& > div': { flex: '1 1 200px', minWidth: 0 }
          }
        }}>
          <Box>
            <Box sx={railHeadSx}>Type</Box>
            <RailButton active={typeFilter === 'all'} icon={<ListAltIcon />} label="All jobs"
              count={jobs.length} onClick={() => setTypeFilter('all')} />
            {Object.entries(JOB_TYPES).map(([key, label]) => {
              const Icon = JOB_TYPE_ICONS[key];
              return (
                <RailButton key={key} active={typeFilter === key} icon={<Icon />} label={label}
                  count={countBy(jobs, 'type', key)} onClick={() => setTypeFilter(key)} />
              );
            })}
          </Box>

          <Box>
            <Box sx={railHeadSx}>Services</Box>
            <ServiceRow tone={fpOnline == null ? 'idle' : !fpOnline ? 'off' : fpRunning ? 'ok' : 'idle'}>
              Funpipe worker — {fpOnline == null ? 'checking…' : !fpOnline ? 'offline' : fpRunning ? 'running' : 'idle'}
            </ServiceRow>
            <ServiceRow tone={!services?.ai.online ? 'idle' : (gpuWarning || gpuShared || trainingOn) ? 'warn' : 'ok'}>
              GPU — {!services?.ai.online ? 'unknown' : trainingOn ? 'busy (training)' : (gpuWarning || gpuShared) ? 'busy' : 'free'}
            </ServiceRow>
            <ServiceRow tone={!services ? 'idle' : services.ffmpeg.available ? 'ok' : 'off'}>
              FFmpeg — {!services ? 'checking…' : services.ffmpeg.available ? 'ready' : 'not found'}
            </ServiceRow>
            <ServiceRow tone={!services ? 'idle' : services.ai.online ? 'ok' : 'off'}>
              AI inference server — {!services ? 'checking…' : services.ai.online ? 'online' : 'offline'}
            </ServiceRow>
          </Box>

          <Box>
            <Box sx={railHeadSx}>Start something</Box>
            {START_LINKS.map(([key, label, to]) => {
              const Icon = JOB_TYPE_ICONS[key];
              return <RailButton key={to} icon={<Icon />} label={`${label} ↗`} onClick={() => navigate(to)} />;
            })}
          </Box>
        </Box>

        {/* ── main ── */}
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: SPACE.md }}>
            {stats.map(([key, label, n]) => {
              const on = statusFilter === key;
              return (
                <ButtonBase key={key}
                  onClick={() => setStatusFilter(on ? 'all' : key)}
                  sx={{
                    display: 'block', textAlign: 'left', flex: '1 1 104px', minWidth: 104, maxWidth: 180,
                    bgcolor: 'var(--surface)', border: '1px solid', borderColor: on ? 'var(--accent)' : 'var(--line)',
                    borderRadius: 'var(--radius-lg, 10px)', p: '8px 14px',
                    '&:hover': { borderColor: on ? 'var(--accent)' : 'var(--line-strong)' }
                  }}>
                  <Box sx={{
                    fontSize: '1.25rem', fontWeight: 680, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
                    color: key === 'failed' && n > 0 ? 'var(--bad)' : 'var(--text)'
                  }}>{n}</Box>
                  <Box sx={{ fontSize: '.72rem', color: 'var(--muted)' }}>{label}</Box>
                </ButtonBase>
              );
            })}
          </Box>

          {(gpuShared || gpuWarning) && (
            <Box sx={{
              display: 'flex', gap: 1.25, alignItems: 'center', mb: SPACE.md, p: '8px 12px', fontSize: '.82rem',
              bgcolor: 'var(--warn-quiet)', border: '1px solid var(--warn)', color: 'var(--text)',
              borderRadius: 'var(--radius-lg, 10px)'
            }}>
              <WarningAmberIcon sx={{ fontSize: 18, color: 'var(--warn)', flexShrink: 0 }} />
              <span>
                {gpuShared
                  ? 'The GPU is shared: training and funscript generation are both running, so each is slower and funpipe may run out of memory.'
                  : `GPU is busy: ${gpuWarning}. Funscript generation still runs — it shares the card — but expect both to be slower.`}
              </span>
            </Box>
          )}

          {typeFilter === 'funpipe' && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: SPACE.md, p: '8px 12px',
              fontSize: '.84rem', bgcolor: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-lg, 10px)'
            }}>
              <Box sx={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                bgcolor: !fpOnline ? 'var(--bad)' : fpRunning ? 'var(--ok)' : 'var(--faint)'
              }} />
              <b>{!fpOnline ? 'AI server offline' : fpRunning ? 'Worker running' : 'Worker stopped'}</b>
              <Box sx={{ flex: 1 }} />
              <SmallButton disabled={!fpOnline || fpRunning || barBusy} onClick={() => funpipeCall('/api/funpipe/queue/start')}>Start</SmallButton>
              <SmallButton disabled={!fpOnline || !fpRunning || barBusy} onClick={() => funpipeCall('/api/funpipe/queue/stop')}>Stop</SmallButton>
              <SmallButton disabled={!fpOnline || barBusy} onClick={() => funpipeCall('/api/funpipe/queue/clear-done')}>Clear done</SmallButton>
              {editor?.running && editor.url ? (
                <SmallButton component="a" href={editor.url} target="_blank" rel="noreferrer"
                  endIcon={<OpenInNewIcon sx={{ fontSize: '13px !important' }} />}>
                  Review editor
                </SmallButton>
              ) : (
                <SmallButton tip="The review editor is not running — start it from the Funpipe page"
                  onClick={() => navigate('/funpipe')}>
                  Review editor ↗
                </SmallButton>
              )}
            </Box>
          )}

          {!loaded && <LoadingState label="Loading jobs…" />}

          {loaded && visible.length === 0 && (
            <Box sx={{ py: 6, px: 2.5, textAlign: 'center', color: 'var(--muted)' }}>
              {jobs.length === 0 ? 'No background jobs. Start one from the links on the left.' : 'No jobs match this filter.'}
            </Box>
          )}

          {SECTIONS.map(([status, title]) => {
            const rows = visible.filter(j => j.status === status);
            if (rows.length === 0) return null;
            return (
              <Box key={status} sx={{ mt: SPACE.md }}>
                <Box sx={{ ...railHeadSx, display: 'flex', gap: 1, alignItems: 'center' }}>
                  <span>{title} ({rows.length})</span>
                  <Box sx={{ flex: 1 }} />
                  {status === 'queued' && (
                    <Box component="span" sx={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                      each type runs one at a time, in this order
                    </Box>
                  )}
                </Box>
                {rows.map(j => (
                  <JobRow
                    key={j.id}
                    job={j}
                    open={!!openRows[j.id]}
                    busy={busyIds.has(j.id)}
                    onToggle={() => setOpenRows(o => ({ ...o, [j.id]: !o[j.id] }))}
                    onCancel={() => handleRemove(j)}
                    onRemove={() => handleRemove(j)}
                    onRetry={() => handleRetry(j)}
                    onLink={() => navigate(j.link)}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Snackbar
        open={!!toast} autoHideDuration={5000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </PageShell>
  );
}
