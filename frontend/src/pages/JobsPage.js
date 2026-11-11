/**
 * Jobs — one screen for everything the server runs in the background.
 *
 * Reads the shared jobs store (hooks/useJobs: GET /api/jobs?v=2, plus the browser uploads). The server says what
 * each row's six buttons may do (job.actions); components/jobs/jobActions carries them out. The page owns no queue.
 *
 * Route: /jobs   URL: ?kind=all|import|hash|…  &state=all|running|queued|failed|finished  &job=<row id>
 * (a legacy ?type= is read as kind).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ButtonBase, useMediaQuery } from '@mui/material';
import ListAltIcon from '@mui/icons-material/ListAlt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { PageShell, PageHeader, Panel, EmptyState, LoadingState, SPACE } from '../components/layout';
import { AppDialog, useAsk, useNotify, errorText } from '../components/ui';
import { SmallButton, FilterChip, ListError, useQueryState } from '../components/discover/shared';
import { useChrome } from '../nav';
import useJobs from '../hooks/useJobs';
import PipelineDialog from '../components/PipelineDialog';
import { useUploads } from '../components/import/UploadsProvider';
import { KIND_ORDER, KIND_LABEL, KIND_ICON, STATE_FILTERS, inState } from '../components/jobs/kinds';
import JobRow, { detailText } from '../components/jobs/JobRow';
import QueueBars from '../components/jobs/QueueBars';
import { ServicesList, StartLinks, RailItem, railHeadSx, servicesSummary, servicesTone, gpuState, Dot } from '../components/jobs/ServicesPanel';
import { runSlot, bulkClear, bulkRetry, post } from '../components/jobs/jobActions';

const KINDS = new Set(['all', ...KIND_ORDER]);
const STATES = new Set(STATE_FILTERS.map(([k]) => k));

const SECTIONS = [
  ['running', 'Running', null],
  ['failed', 'Failed', 'failed rows stay until you retry or remove them'],
  ['queued', 'Queued', null],
  ['finished', 'Finished', 'Clear finished removes these']
];

const sectionOf = (status) => (status === 'done' || status === 'cancelled' ? 'finished' : status);

/** What a kind's rows are called in the "shown of total" line, and where the rest are. */
const CAPPED_TEXT = {
  encode: { noun: 're-encodes', rest: 'the rest are on the Space page', to: '/settings/space', link: 'Space' },
  hash: { noun: 'hash builds', rest: 'the rest run after these', to: null, link: null }
};
const STATUS_WORD = { running: 'running', queued: 'queued', failed: 'failed', done: 'finished', cancelled: 'cancelled' };

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const sectionHeadSx = {
  display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75, mt: SPACE.md,
  fontSize: '.75rem', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)'
};

const chipRowSx = {
  display: 'flex', gap: 0.75, overflowX: 'auto', flexWrap: 'nowrap', pb: 0.5, mb: SPACE.sm,
  scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' }, '& > *': { flexShrink: 0 }
};

export default function JobsPage() {
  const { jobs, capped, services, loaded, error, updatedAt, refresh } = useJobs({ withServices: true });
  const uploads = useUploads();
  const ask = useAsk();
  const notify = useNotify();
  const navigate = useNavigate();
  const phone = useChrome() === 'phone';
  const narrow = useMediaQuery('(max-width:859.98px)');
  const compact = useMediaQuery('(max-width:699.98px)');

  const [q, setQ] = useQueryState({ kind: 'all', state: 'all', job: '', type: '' });
  const kind = KINDS.has(q.kind) ? q.kind : 'all';
  const state = STATES.has(q.state) ? q.state : 'all';

  // A legacy ?type= is read as kind, once.
  useEffect(() => {
    if (!q.type) return;
    setQ({ type: '', ...(q.kind === 'all' && KINDS.has(q.type) ? { kind: q.type } : {}) });
  }, [q.type, q.kind, setQ]);

  const setKind = useCallback((k) => setQ({ kind: k, job: '' }), [setQ]);
  const setState = useCallback((s) => setQ({ state: s, job: '' }), [setQ]);

  const [openRows, setOpenRows] = useState({});
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [barBusy, setBarBusy] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [highlight, setHighlight] = useState(null);

  const offline = !!error && loaded;

  // ── counts, with the rows the server left out ─────────────
  const extras = useMemo(() => (capped || [])
    .map(c => ({ ...c, extra: Math.max(0, (c.total || 0) - (c.shown || 0)) }))
    .filter(c => c.extra > 0), [capped]);

  const kindCount = useCallback((k) => (k === 'all'
    ? jobs.length + extras.reduce((s, c) => s + c.extra, 0)
    : jobs.filter(j => j.type === k).length + extras.filter(c => c.kind === k).reduce((s, c) => s + c.extra, 0)), [jobs, extras]);

  const typed = useMemo(() => (kind === 'all' ? jobs : jobs.filter(j => j.type === kind)), [jobs, kind]);
  const typedExtras = useMemo(() => (kind === 'all' ? extras : extras.filter(c => c.kind === kind)), [extras, kind]);
  const visible = useMemo(() => typed.filter(j => inState(j, state)), [typed, state]);

  const stateCount = (s) => typed.filter(j => inState(j, s)).length
    + typedExtras.filter(c => inState({ status: c.status }, s)).reduce((sum, c) => sum + c.extra, 0);

  const clearN = typed.filter(j => !j.local && (j.status === 'done' || j.status === 'cancelled') && j.actions?.remove?.on).length;
  const retryN = typed.filter(j => !j.local && j.status === 'failed' && j.actions?.retry?.on).length;

  // ── actions ───────────────────────────────────────────────
  const onSlot = useCallback(async (job, key) => {
    setBusyIds(prev => new Set(prev).add(job.id));
    try {
      await runSlot(job, key, { ask, notify, uploads, refresh, navigate });
    } finally {
      setBusyIds(prev => { const next = new Set(prev); next.delete(job.id); return next; });
    }
  }, [ask, notify, uploads, refresh, navigate]);

  const scopeKind = kind === 'all' ? undefined : kind;
  const clearFinished = useCallback(async () => {
    setBulkBusy(true);
    try { await bulkClear(scopeKind, { notify, refresh }); } finally { setBulkBusy(false); }
  }, [scopeKind, notify, refresh]);
  const retryFailed = useCallback(async () => {
    setBulkBusy(true);
    try { await bulkRetry(scopeKind, { notify, refresh }); } finally { setBulkBusy(false); }
  }, [scopeKind, notify, refresh]);

  const onBarAction = useCallback(async ({ url, body, message }) => {
    setBarBusy(true);
    try {
      await post(url, body);
      if (message) notify(message);
    } catch (err) {
      notify({ severity: 'error', message: errorText(err) });
    } finally {
      await refresh().catch(() => {});
      setBarBusy(false);
    }
  }, [notify, refresh]);

  const toggleRow = useCallback((id) => setOpenRows(o => ({ ...o, [id]: !o[id] })), []);

  // ── ?job=<id>: bring that row into view ───────────────────
  const handledJob = useRef('');
  useEffect(() => {
    const id = q.job;
    if (!id) { handledJob.current = ''; return undefined; }
    if (!loaded || handledJob.current === id) return undefined;
    const row = jobs.find(j => j.id === id);
    if (!row) {
      handledJob.current = id;
      notify({ severity: 'info', message: 'That job is no longer in the list' });
      setQ({ job: '' });
      return undefined;
    }
    if (!visible.some(j => j.id === id)) {
      // Filtered out: show everything, keep the job.
      setQ({ kind: 'all', state: 'all' });
      return undefined;
    }
    handledJob.current = id;
    if (detailText(row) || compact) setOpenRows(o => ({ ...o, [id]: true }));
    setHighlight(id);
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`job-${id}`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [q.job, loaded, jobs, visible, compact, notify, setQ]);

  useEffect(() => {
    if (!highlight) return undefined;
    const t = setTimeout(() => setHighlight(null), 3000);
    return () => clearTimeout(t);
  }, [highlight]);

  // ── header actions ────────────────────────────────────────
  const clearLabel = `Clear finished (${clearN.toLocaleString()})`;
  const retryLabel = `Retry failed (${retryN.toLocaleString()})`;
  const barMenu = useMemo(() => (phone ? [
    { label: clearLabel, onClick: clearFinished, disabled: clearN === 0 || bulkBusy },
    { label: retryLabel, onClick: retryFailed, disabled: retryN === 0 || bulkBusy },
    { label: 'Labels & funscripts…', onClick: () => setPipelineOpen(true) },
    { label: 'Services', onClick: () => setServicesOpen(true) }
  ] : undefined), [phone, clearLabel, retryLabel, clearN, retryN, bulkBusy, clearFinished, retryFailed]);

  const headerActions = phone ? null : (
    <>
      <SmallButton disabled={clearN === 0 || bulkBusy} onClick={clearFinished}>{clearLabel}</SmallButton>
      <SmallButton disabled={retryN === 0 || bulkBusy} onClick={retryFailed}>{retryLabel}</SmallButton>
      <SmallButton onClick={() => setPipelineOpen(true)}>Labels &amp; funscripts…</SmallButton>
    </>
  );

  // ── pieces ────────────────────────────────────────────────
  const gpu = gpuState(services, jobs);
  const gpuBanner = (gpu.shared || gpu.warning) && (
    <Panel role="status" sx={{
      display: 'flex', gap: 1.25, alignItems: 'center', mb: SPACE.md, py: 1, px: 1.5, fontSize: '.8125rem',
      bgcolor: 'var(--warn-quiet)', borderColor: 'var(--warn)', color: 'var(--text)'
    }}>
      <WarningAmberIcon sx={{ fontSize: 18, color: 'var(--warn)', flexShrink: 0 }} />
      <span>
        {gpu.shared
          ? 'The GPU is shared: training and funscript generation both run, so each is slower and funpipe may run out of memory.'
          : `The GPU is busy: ${gpu.warning}. Funscript generation still runs on the same card, so expect both to be slower.`}
      </span>
    </Panel>
  );

  const offlineBanner = offline && (
    <Panel role="alert" sx={{
      display: 'flex', gap: 1.25, alignItems: 'center', mb: SPACE.md, py: 1, px: 1.5, fontSize: '.8125rem',
      bgcolor: 'var(--warn-quiet)', borderColor: 'var(--warn)', color: 'var(--text)'
    }}>
      <WarningAmberIcon sx={{ fontSize: 18, color: 'var(--warn)', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {String(error).replace(/\.$/, '')}. Last update {updatedAt ? fmtTime(updatedAt) : 'none'}: the rows may be
        out of date. Trying again every 10 s.
      </Box>
      <SmallButton onClick={() => refresh()}>Try now</SmallButton>
    </Panel>
  );

  const tiles = (
    <Box sx={{ display: 'flex', gap: 1, mb: SPACE.md, flexWrap: 'wrap' }}>
      {STATE_FILTERS.map(([key, label]) => {
        const on = state === key;
        const count = stateCount(key);
        return (
          <ButtonBase key={key} aria-pressed={on} onClick={() => setState(on && key !== 'all' ? 'all' : key)} sx={{
            display: 'block', textAlign: 'left', flex: '1 1 96px', minWidth: 96, maxWidth: 180, height: 56,
            bgcolor: 'var(--surface)', border: '1px solid', borderColor: on ? 'var(--accent)' : 'var(--line)',
            borderRadius: 'var(--radius-lg, 10px)', px: 1.5, py: 0.75,
            '&:hover': { borderColor: on ? 'var(--accent)' : 'var(--line-strong)' },
            '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
          }}>
            <Box sx={{
              fontSize: '1.125rem', fontWeight: 650, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums',
              color: key === 'failed' && count > 0 ? 'var(--bad)' : 'var(--text)'
            }}>{count.toLocaleString()}</Box>
            <Box sx={{ fontSize: '.75rem', color: 'var(--muted)' }}>{label}</Box>
          </ButtonBase>
        );
      })}
    </Box>
  );

  const narrowFilters = (
    <>
      <Box sx={chipRowSx} role="group" aria-label="Kind">
        <FilterChip on={kind === 'all'} onClick={() => setKind('all')}>All {kindCount('all').toLocaleString()}</FilterChip>
        {KIND_ORDER.filter(k => k === kind || kindCount(k) > 0).map(k => (
          <FilterChip key={k} on={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]} {kindCount(k).toLocaleString()}</FilterChip>
        ))}
      </Box>
      <Box sx={chipRowSx} role="group" aria-label="State">
        {STATE_FILTERS.map(([key, label]) => (
          <FilterChip key={key} on={state === key} onClick={() => setState(key)}>{label} {stateCount(key).toLocaleString()}</FilterChip>
        ))}
      </Box>
      <ButtonBase onClick={() => setServicesOpen(true)} sx={{
        display: 'flex', alignItems: 'center', gap: 1, width: '100%', height: 36, px: 1.25, mb: SPACE.md,
        justifyContent: 'flex-start', textAlign: 'left',
        bgcolor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg, 10px)',
        fontSize: '.8125rem', color: 'var(--dim)',
        '&:hover': { borderColor: 'var(--line-strong)' },
        '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
      }}>
        <Dot tone={servicesTone(services, jobs)} />
        <Box component="span" sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {servicesSummary(services, jobs)}
        </Box>
        <ChevronRightIcon sx={{ fontSize: 18, color: 'var(--muted)', flexShrink: 0 }} />
      </ButtonBase>
    </>
  );

  const rail = (
    <Box component="aside" sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, minWidth: 0 }}>
      <Box role="group" aria-label="Kind">
        <Box sx={railHeadSx}>Kind</Box>
        <RailItem active={kind === 'all'} icon={<ListAltIcon />} label="All" count={kindCount('all')} onClick={() => setKind('all')} />
        {KIND_ORDER.map(k => {
          const Icon = KIND_ICON[k];
          const count = kindCount(k);
          return (
            <RailItem key={k} active={kind === k} dim={count === 0} icon={<Icon />} label={KIND_LABEL[k]}
              count={count} onClick={() => setKind(k)} />
          );
        })}
      </Box>
      <Box>
        <Box sx={railHeadSx}>Services</Box>
        <ServicesList services={services} jobs={jobs} />
      </Box>
      <Box>
        <Box sx={railHeadSx}>Start something</Box>
        <StartLinks onPipeline={() => setPipelineOpen(true)} />
      </Box>
    </Box>
  );

  const cappedLine = (sectionKey) => typedExtras
    .filter(c => sectionOf(c.status) === sectionKey)
    .map(c => {
      const t = CAPPED_TEXT[c.kind] || { noun: `${KIND_LABEL[c.kind] || c.kind} jobs`, rest: null, to: null, link: null };
      return (
        <Box key={`${c.kind}:${c.status}`} sx={{
          display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.75, px: 0.5, fontSize: '.75rem', color: 'var(--dim)'
        }}>
          <span>
            {(c.shown || 0).toLocaleString()} of {(c.total || 0).toLocaleString()} {STATUS_WORD[c.status] || c.status} {t.noun} shown
            {t.rest ? `, ${t.rest}` : ''}
          </span>
          {t.to && <SmallButton onClick={() => navigate(t.to)}>{t.link}</SmallButton>}
        </Box>
      );
    });

  const sections = SECTIONS.map(([key, title, hint]) => {
    if (state !== 'all' && state !== key) return null;
    const rows = visible.filter(j => sectionOf(j.status) === key);
    const extra = typedExtras.filter(c => sectionOf(c.status) === key).reduce((s, c) => s + c.extra, 0);
    if (rows.length === 0 && extra === 0) return null;
    return (
      <Box component="section" key={key} aria-label={title}>
        <Box sx={sectionHeadSx}>
          <span>{title} ({(rows.length + extra).toLocaleString()})</span>
          {hint && (
            <Box component="span" sx={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hint}
            </Box>
          )}
        </Box>
        {rows.length > 0 && (
          <Panel padded={false} sx={{ '& > .job-row + .job-row': { borderTop: '1px solid var(--line)' }, overflow: 'hidden' }}>
            {rows.map(j => (
              <JobRow
                key={j.id}
                job={j}
                compact={compact}
                busy={busyIds.has(j.id)}
                offline={offline}
                open={!!openRows[j.id]}
                onToggle={() => toggleRow(j.id)}
                highlight={highlight === j.id}
                showKind={kind === 'all'}
                onSlot={(slotKey) => onSlot(j, slotKey)}
              />
            ))}
          </Panel>
        )}
        {cappedLine(key)}
      </Box>
    );
  });

  const nothingAtAll = loaded && jobs.length === 0 && extras.length === 0;
  const nothingHere = loaded && !nothingAtAll && visible.length === 0
    && !typedExtras.some(c => inState({ status: c.status }, state));

  const list = (
    <>
      {!loaded && !error && <LoadingState label="Loading jobs…" />}
      {!loaded && error && <ListError error={error} onRetry={() => refresh()} />}
      {nothingAtAll && (
        <EmptyState
          icon={<ListAltIcon />}
          title="No background jobs"
          description="Imports, hash builds, re-encodes, funscripts and training show here while they run and after they end."
        />
      )}
      {nothingHere && (
        <EmptyState
          title="No jobs match this filter"
          action={<SmallButton onClick={() => setQ({ kind: 'all', state: 'all', job: '' })}>Show all</SmallButton>}
        />
      )}
      {loaded && sections}
    </>
  );

  const main = (
    <Box sx={{ minWidth: 0 }}>
      {narrow ? narrowFilters : tiles}
      {offlineBanner}
      {gpuBanner}
      <QueueBars
        jobs={jobs}
        capped={capped}
        services={services}
        kind={kind}
        compact={compact}
        busy={barBusy}
        onAction={onBarAction}
        onAdd={() => setPipelineOpen(true)}
      />
      {list}
    </Box>
  );

  return (
    <PageShell>
      <PageHeader
        title="Jobs"
        subtitle="Run by the server, so every browser and phone sees the same list"
        actions={headerActions}
        barMenu={barMenu}
      />

      {narrow ? main : (
        <Box sx={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: SPACE.lg, alignItems: 'start' }}>
          <Box sx={{ pr: SPACE.md, borderRight: '1px solid var(--line)' }}>{rail}</Box>
          {main}
        </Box>
      )}

      <AppDialog
        open={servicesOpen}
        onClose={() => setServicesOpen(false)}
        title="Services"
        subtitle="What the jobs depend on, and where new ones start"
        size="md"
        sheet
        cancelLabel="Close"
      >
        <Box sx={{ mx: -1 }}>
          <ServicesList services={services} jobs={jobs} />
          <Box sx={{ ...railHeadSx, mt: SPACE.md }}>Start something</Box>
          <StartLinks
            onPipeline={() => { setServicesOpen(false); setPipelineOpen(true); }}
            onNavigate={() => setServicesOpen(false)}
          />
        </Box>
      </AppDialog>

      <PipelineDialog
        open={pipelineOpen}
        onClose={() => setPipelineOpen(false)}
        onQueued={(msg) => { notify(msg); refresh(); }}
      />
    </PageShell>
  );
}
