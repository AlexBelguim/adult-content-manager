/**
 * Jobs — one screen for everything the server runs in the background.
 *
 * Reads the shared jobs store (hooks/useJobs: GET /api/jobs?v=2, plus the browser uploads). The server says what
 * each row's six buttons may do (job.actions); components/jobs/jobActions carries them out. The page owns no queue.
 *
 * Layout: SidebarPage. Its View list is the State (All, Running, Queued, Failed, Finished, with counts); then Kind,
 * Services and Start. On the content line: Clear finished and Retry failed. On a phone the State is the tab row and
 * the rest opens from Filters.
 *
 * Route: /jobs   URL: ?kind=all|import|hash|…  &state=all|running|queued|failed|finished  &job=<row id>
 * (a legacy ?type= is read as kind).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, useMediaQuery } from '@mui/material';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import AddIcon from '@mui/icons-material/Add';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  SidebarPage, SideGroup, SideList, ContentLine, SIDE, Panel, EmptyState, LoadingState, SPACE
} from '../components/layout';
import { useAsk, useNotify, errorText } from '../components/ui';
import { SmallButton, ListError, useQueryState } from '../components/discover/shared';
import useJobs from '../hooks/useJobs';
import PipelineDialog from '../components/PipelineDialog';
import { useUploads } from '../components/import/UploadsProvider';
import { KIND_ORDER, KIND_LABEL, KIND_SHORT, KIND_ICON, STATE_FILTERS, inState } from '../components/jobs/kinds';
import JobRow, { detailText } from '../components/jobs/JobRow';
import QueueBars from '../components/jobs/QueueBars';
import { ServicesList, StartLinks, servicesShort, servicesTone, gpuState } from '../components/jobs/ServicesPanel';
import { runSlot, bulkClear, bulkRetry, post } from '../components/jobs/jobActions';

const KINDS = new Set(['all', ...KIND_ORDER]);
const STATES = new Set(STATE_FILTERS.map(([k]) => k));
const STATE_LABEL = Object.fromEntries(STATE_FILTERS);
const STATE_ICON = { all: ListAltIcon, running: PlayArrowIcon, queued: ScheduleIcon, failed: ErrorOutlineIcon, finished: TaskAltIcon };

// The sidebar groups' icons: one element each, so the rail sees the same icon on every render.
const KIND_GROUP_ICON = <LocalOfferOutlinedIcon />;
const SERVICES_ICON = <MonitorHeartOutlinedIcon />;
const START_ICON = <AddIcon />;

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

export default function JobsPage() {
  const { jobs, capped, services, loaded, error, updatedAt, refresh } = useJobs({ withServices: true });
  const uploads = useUploads();
  const ask = useAsk();
  const notify = useNotify();
  const navigate = useNavigate();
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

  // ── the content line's actions ────────────────────────
  const lineActions = (
    <>
      <SmallButton disabled={clearN === 0 || bulkBusy} onClick={clearFinished}>
        Clear finished ({clearN.toLocaleString()})
      </SmallButton>
      <SmallButton disabled={retryN === 0 || bulkBusy} onClick={retryFailed}>
        Retry failed ({retryN.toLocaleString()})
      </SmallButton>
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
        <Box className="jobs-sec-head" sx={sectionHeadSx}>
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
      {loaded && (
        <Box sx={{ '& > section:first-of-type > .jobs-sec-head': { mt: 0 } }}>{sections}</Box>
      )}
    </>
  );

  // ── the sidebar ───────────────────────────────────────────
  const kindLink = kind === 'all' ? '' : `kind=${kind}`;
  const views = STATE_FILTERS.map(([key, label]) => {
    const Icon = STATE_ICON[key];
    const count = stateCount(key);
    const query = [key === 'all' ? '' : `state=${key}`, kindLink].filter(Boolean).join('&');
    return {
      id: key,
      label,
      count,
      icon: <Icon />,
      dot: key === 'failed' && count > 0 ? 'bad' : undefined,
      to: `/jobs${query ? `?${query}` : ''}`,
      replace: true,
      onClick: (e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;   // a new tab: the link's own way
        e.preventDefault();
        setState(key);
      }
    };
  });

  const kindItems = [
    { id: 'all', label: 'All', icon: <ListAltIcon />, count: kindCount('all') },
    ...KIND_ORDER.map(k => {
      const Icon = KIND_ICON[k];
      const count = kindCount(k);
      return { id: k, label: KIND_SHORT[k], title: KIND_LABEL[k], icon: <Icon />, count, dim: count === 0 };
    })
  ];

  const tone = servicesTone(services, jobs);
  const stateWord = STATE_LABEL[state] || 'All';
  const lineTitle = kind === 'all'
    ? `${stateWord} jobs`
    : state === 'all' ? `${KIND_SHORT[kind]} jobs` : `${KIND_SHORT[kind]} · ${stateWord} jobs`;
  const lineMeta = loaded ? `${stateCount(state).toLocaleString()} · newest first` : '';

  return (
    <SidebarPage title="Jobs" viewsTitle="State" views={views} view={state}>
      <SideGroup
        id="kind"
        title="Kind"
        icon={KIND_GROUP_ICON}
        order={SIDE.list}
        badge={kind === 'all' ? 0 : 1}
        summary={kind === 'all' ? 'all kinds' : KIND_LABEL[kind]}
      >
        <SideList label="Kind" items={kindItems} value={kind} onChange={setKind} />
      </SideGroup>

      <SideGroup
        id="services"
        title="Services"
        icon={SERVICES_ICON}
        order={SIDE.list + 1}
        dot={tone === 'off' ? 'bad' : tone === 'warn' ? 'warn' : null}
        summary={servicesShort(services, jobs)}
      >
        <ServicesList services={services} jobs={jobs} />
      </SideGroup>

      <SideGroup id="start" title="Start" icon={START_ICON} order={SIDE.page} summary="where new jobs start">
        <StartLinks onPipeline={() => setPipelineOpen(true)} />
      </SideGroup>

      <ContentLine title={lineTitle} meta={lineMeta} actions={lineActions} />

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

      <PipelineDialog
        open={pipelineOpen}
        onClose={() => setPipelineOpen(false)}
        onQueued={(msg) => { notify(msg); refresh(); }}
      />
    </SidebarPage>
  );
}
