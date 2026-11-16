/**
 * Funscripts (/funpipe): every After performer (filtered and kept) with what is left to do for her funscripts, and
 * her funscript folder. Before performers are left out of the list, the counts and the totals.
 *
 * The frame is SidebarPage (components/layout), like Performer Management. Its View list is what needs doing, with a
 * count of performers each: All, Unlabelled (videos without labelmaster's scenes), No script yet (videos in her
 * funscript folder without a .funscript), Needs review (funpipe scripts nobody reviewed), Funscript folder (has one).
 * Then, in the sidebar: Show (search, sort) and Funscripts (the review editor as the main action, the library's
 * totals, acm-gpu's state, Jobs, Rescan, Worker settings).
 *
 * A performer row: her picture, name and Before / After, then one facts line: videos, unlabelled, in her funscript
 * folder, no script yet, need review. On the right her actions (labels & funscripts through scenetest, queue her
 * unscripted funscript-folder videos with funpipe) and the chevron that opens her funscript folder under the row.
 * A search that matches only file names lists those videos, opened. Ticked videos are queued from the content line.
 *
 * The URL holds view (v), sort and search (q), all replace. Data: GET /api/funpipe/library ({ videos, counts,
 * performers }, backend/routes/funpipe.js); the queue lives on /jobs.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, ButtonBase, Checkbox, IconButton, LinearProgress, Tooltip } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import TuneIcon from '@mui/icons-material/Tune';
import PeopleIcon from '@mui/icons-material/People';
import LabelOffIcon from '@mui/icons-material/LabelOff';
import ScheduleIcon from '@mui/icons-material/Schedule';
import RateReviewIcon from '@mui/icons-material/RateReview';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import MovieIcon from '@mui/icons-material/Movie';
import QueueIcon from '@mui/icons-material/Queue';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditNoteIcon from '@mui/icons-material/EditNote';
import SettingsIcon from '@mui/icons-material/Settings';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import {
  ContentLine, EmptyState, LoadingState, Panel, SIDE, SidebarPage, SideButton, SideButtons, SideFacts, SideGroup,
  SideMain, SideNote, SideSearch, SideSelect, iconBtnSx
} from '../components/layout';
import { SmallButton, useQueryState } from '../components/discover/shared';
import { useNotify } from '../components/ui';
import { useShell } from '../nav';
import PipelineQuickButton from '../components/PipelineQuickButton';
import { useRunOn } from '../components/RunOnSelect';
import { queuePipeline } from '../utils/pipelines';
import PipelineDialog from '../components/PipelineDialog';
import useJobs, { isActive } from '../hooks/useJobs';

const TITLE = 'Funscripts';

// Status vocabulary comes from GET /api/funpipe/library — see backend/routes/funpipe.js
const STATUS_META = {
  running:      { label: 'Generating',    help: 'funpipe is working on this now' },
  queued:       { label: 'Queued',        help: 'Waiting in the funpipe queue' },
  needs_review: { label: 'Needs review',  help: 'funpipe made a script, nobody has reviewed it' },
  reviewed:     { label: 'Reviewed',      help: 'funpipe script with human edits' },
  external:     { label: 'External',      help: 'Has a funscript that funpipe did not make' },
  no_script:    { label: 'No script',     help: 'No funscript and no funpipe output yet' },
  incomplete:   { label: 'Incomplete',    help: 'funpipe started but never produced a signal' },
  failed:       { label: 'Failed',        help: 'The funpipe job failed' }
};
const STATUS_TONE = {
  running: 'var(--accent)', queued: 'var(--dim)', needs_review: 'var(--warn)', reviewed: 'var(--ok)',
  external: 'var(--info)', no_script: 'var(--bad)', incomplete: 'var(--warn)', failed: 'var(--bad)'
};
const QUEUEABLE = ['no_script', 'incomplete', 'failed'];

/* The views: what still needs doing, counted in performers. */
const VIEWS = [
  { id: 'all',        label: 'All performers',   icon: PeopleIcon,        test: () => true },
  { id: 'unlabelled', label: 'Unlabelled',       icon: LabelOffIcon,      test: p => p.unlabelled > 0,
    title: 'Has videos without labelmaster\'s scenes' },
  { id: 'noscript',   label: 'No script yet',    icon: ScheduleIcon,      test: p => p.noScript > 0,
    title: 'Has videos in her funscript folder with no script yet' },
  { id: 'review',     label: 'Needs review',     icon: RateReviewIcon,    test: p => (p.counts?.needs_review || 0) > 0,
    title: 'Has funpipe scripts nobody has reviewed' },
  { id: 'folder',     label: 'Funscript folder', icon: FolderSpecialIcon, test: p => p.funscript > 0,
    title: 'Has videos in a funscript folder' }
];
const SORTS = [
  { id: 'name',       label: 'Name',                cmp: () => 0 },
  { id: 'noscript',   label: 'Most without script', cmp: (a, b) => b.noScript - a.noScript },
  { id: 'unlabelled', label: 'Most unlabelled',     cmp: (a, b) => b.unlabelled - a.unlabelled },
  { id: 'videos',     label: 'Most videos',         cmp: (a, b) => b.videos - a.videos }
];
const NOTHING = {
  unlabelled: 'Every performer\'s videos are labelled.',
  noscript: 'Every video in a funscript folder has a script.',
  review: 'Nothing waits for review.',
  folder: 'No performer has a funscript folder yet. Use "Move to Funscript" while filtering a performer.'
};

const n = (v) => Number(v || 0).toLocaleString();
const thumbUrl = (p) => (p?.thumbnail ? `/api/files/preview?path=${encodeURIComponent(p.thumbnail)}` : null);

// ── styles (the row is Performer Management's: components/performers/PerformerRow.js) ──
const PHONE = '@media (max-width: 699.98px)';
const MID = '@media (max-width: 1099.98px)';
const rowSx = { '&:not(:first-of-type)': { borderTop: '1px solid var(--line)' } };
const headSx = (open) => ({
  boxSizing: 'border-box', display: 'grid', minHeight: 64, px: 1.5, py: 0.75,
  gridTemplateColumns: '48px minmax(0, 1fr) auto auto',
  gridTemplateAreas: '"pic name ctl chev" "pic facts ctl chev"',
  alignContent: 'center', alignItems: 'center', columnGap: 1.5, rowGap: '2px',
  color: 'var(--text)', bgcolor: open ? 'var(--raised)' : 'transparent',
  transition: 'background-color .12s ease',
  '@media (hover: hover)': { '&:hover': { bgcolor: 'var(--raised)' } },
  [MID]: {
    gridTemplateColumns: '48px minmax(0, 1fr) auto',
    gridTemplateAreas: '"pic name chev" "pic facts chev" "ctl ctl ctl"', rowGap: '4px'
  },
  [PHONE]: { px: 1.25, columnGap: 1, gridTemplateColumns: '40px minmax(0, 1fr) auto' }
});
const picSx = {
  gridArea: 'pic', boxSizing: 'border-box', width: 48, height: 48, overflow: 'hidden',
  borderRadius: 'var(--radius-sm, 4px)', bgcolor: 'var(--raised)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--dim)', fontSize: '1rem', fontWeight: 600, userSelect: 'none',
  '& img': { display: 'block', width: '100%', height: '100%', objectFit: 'cover' },
  [PHONE]: { width: 40, height: 40 }
};
const nameLineSx = { gridArea: 'name', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, height: 24 };
const nameSx = {
  flex: '0 1 auto', minWidth: 48, maxWidth: '100%', display: 'block', textAlign: 'left',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  font: 'inherit', fontSize: '.875rem', fontWeight: 620, lineHeight: '24px', color: 'var(--text)',
  borderRadius: 'var(--radius-sm, 4px)',
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
};
const pillSx = (tone) => ({
  flex: 'none', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', height: 20, px: 0.75,
  border: '1px solid', borderColor: tone, color: tone, borderRadius: 'var(--radius-sm, 4px)',
  fontSize: '.75rem', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap'
});
const factsSx = {
  gridArea: 'facts', display: 'flex', alignItems: 'center', columnGap: 1.25, rowGap: '2px', minWidth: 0,
  flexWrap: 'wrap', fontSize: '.75rem', lineHeight: '20px', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums',
  '& > span': { whiteSpace: 'nowrap' },
  '& b': { color: 'var(--text)', fontWeight: 600 }
};
const toneB = (tone) => ({ '& b': { color: tone } });
const dotSx = (tone) => ({
  display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
  '&::before': { content: '""', width: 6, height: 6, borderRadius: '50%', bgcolor: tone, flexShrink: 0 }
});
const ctlSx = { gridArea: 'ctl', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, [MID]: { flexWrap: 'wrap' } };
const groupSx = {
  display: 'flex', alignItems: 'center', gap: '2px', px: '2px', py: '1px', flexShrink: 0,
  border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', bgcolor: 'var(--bg)'
};
const btnSx = {
  ...iconBtnSx(),
  '&.Mui-disabled': { color: 'var(--faint)' },
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
};
const chevSx = { gridArea: 'chev', ...btnSx };
const videosSx = {
  display: 'flex', flexDirection: 'column', bgcolor: 'var(--bg)', borderTop: '1px solid var(--line)',
  pl: { xs: 1, sm: 'calc(48px + 24px)' }, pr: 1.5, py: 0.5
};
const videoSx = (selected) => ({
  display: 'grid', gridTemplateColumns: 'auto 64px minmax(0, 1fr) auto', alignItems: 'center', columnGap: 1,
  py: 0.5, borderRadius: 'var(--radius, 6px)', bgcolor: selected ? 'var(--accent-quiet)' : 'transparent',
  '&:not(:first-of-type)': { borderTop: '1px solid var(--line)' },
  [PHONE]: { gridTemplateColumns: 'auto 56px minmax(0, 1fr)', '& .fp-video-ctl': { gridColumn: '2 / -1', justifySelf: 'start' } }
});

/** Her picture, or her initial. */
function Picture({ p }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : thumbUrl(p);
  return src
    ? <Box sx={picSx}><img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /></Box>
    : <Box sx={picSx} aria-hidden>{(p.name || '?').trim().charAt(0).toUpperCase() || '?'}</Box>;
}

/** A video's poster frame, or a toned tile when ffmpeg can't open it. */
function VideoThumb({ path, tone }) {
  const [failed, setFailed] = useState(false);
  const box = {
    width: 64, height: 40, borderRadius: 'var(--radius-sm, 4px)', overflow: 'hidden', bgcolor: 'var(--raised)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', [PHONE]: { width: 56, height: 36 }
  };
  if (failed) return <Box sx={{ ...box, color: tone, '& svg': { fontSize: 18, opacity: 0.7 } }}><MovieIcon /></Box>;
  return (
    <Box sx={box}>
      <Box component="img" loading="lazy" alt="" onError={() => setFailed(true)}
        src={`/api/files/video-thumbnail?path=${encodeURIComponent(path)}`}
        sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </Box>
  );
}

function fmtBytes(b) {
  if (!b) return '—';
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`;
}

/** One video of her funscript folder: tick to queue, its script state and labels, then its buttons. */
function VideoRow({ v, selected, onToggle, reviewUrl, onQueue, online, runOn }) {
  const meta = STATUS_META[v.status] || { label: v.status };
  const tone = STATUS_TONE[v.status] || 'var(--dim)';
  const queueable = QUEUEABLE.includes(v.status);
  return (
    <Box sx={videoSx(selected)}>
      <Checkbox size="small" disabled={!queueable} checked={selected} onChange={onToggle}
        inputProps={{ 'aria-label': `Select ${v.name}` }}
        sx={{ p: 0.5, color: 'var(--muted)', '&.Mui-checked': { color: 'var(--accent)' } }} />
      <VideoThumb path={v.path} tone={tone} />
      <Box sx={{ minWidth: 0 }}>
        <Box title={v.name} sx={{
          fontSize: '.8125rem', fontWeight: 600, color: 'var(--text)', lineHeight: '20px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {v.name}
        </Box>
        <Box sx={factsSx}>
          <Tooltip title={meta.help || ''}><Box component="span" sx={pillSx(tone)}>{meta.label}</Box></Tooltip>
          {v.job?.stage && <Box component="span" sx={{ color: 'var(--accent)' }}>{v.job.stage}</Box>}
          <Tooltip title={v.labelled ? 'Has labelmaster\'s scenes' : 'No labelmaster scenes yet'}>
            <Box component="span" sx={dotSx(v.labelled ? 'var(--ok)' : 'var(--warn)')}>{v.labelled ? 'labelled' : 'unlabelled'}</Box>
          </Tooltip>
          <span>{v.funscripts.length ? `${v.funscripts.length} script${v.funscripts.length > 1 ? 's' : ''}` : 'no script'}</span>
          <span>{fmtBytes(v.size)}</span>
        </Box>
      </Box>
      <Box className="fp-video-ctl" sx={groupSx}>
        <PipelineQuickButton target={{ paths: [v.path] }} title="Labels & funscripts" runOn={runOn}
          hint={v.labelled ? 'labelled' : 'not labelled yet'} sx={btnSx} />
        {reviewUrl && (
          <Tooltip title="Review this script in the editor">
            <IconButton size="small" component="a" target="_blank" rel="noreferrer" href={reviewUrl} sx={btnSx}
              aria-label={`Review ${v.name}`}>
              <EditNoteIcon />
            </IconButton>
          </Tooltip>
        )}
        {queueable && (
          <Tooltip title={online ? 'Labels + funscript for this one' : 'Labels + funscript for this one (runs when a worker is back)'}>
            <IconButton size="small" sx={btnSx} onClick={onQueue} aria-label={`Labels + funscript for ${v.name}`}>
              <QueueIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

/** One performer: picture, name, Before / After, the facts line, her buttons; her funscript folder when open. */
function PerformerLine({ p, videos, open, onToggle, onMore, onQueue, runOn, children }) {
  const queueable = videos.filter(v => QUEUEABLE.includes(v.status)).map(v => v.path);
  const review = p.counts?.needs_review || 0;
  const canOpen = p.funscript > 0;
  return (
    <Box sx={rowSx}>
      <Box sx={{ ...headSx(open), cursor: canOpen ? 'pointer' : 'default' }} onClick={canOpen ? onToggle : undefined}>
        <Picture key={p.thumbnail || ''} p={p} />
        <Box sx={nameLineSx}>
          <ButtonBase sx={nameSx} title={p.name} disabled={!canOpen} aria-expanded={canOpen ? open : undefined}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {p.name}
          </ButtonBase>
        </Box>
        <Box sx={factsSx}>
          <span><b>{n(p.videos)}</b> vids</span>
          <Tooltip title={`${n(p.labelled)} of ${n(p.videos)} videos labelled (scenes, dress state, tags)`}>
            <Box component="span" sx={dotSx(p.unlabelled ? 'var(--warn)' : 'var(--ok)')}>
              {p.unlabelled ? `${n(p.unlabelled)} unlabelled` : 'all labelled'}
            </Box>
          </Tooltip>
          <Box component="span" sx={p.funscript ? toneB('var(--info)') : { color: 'var(--muted)' }}>
            <b>{n(p.funscript)}</b> in funscript folder
          </Box>
          {p.funscript > 0 && (
            <Box component="span" sx={toneB(p.noScript ? 'var(--bad)' : 'var(--ok)')}><b>{n(p.noScript)}</b> no script yet</Box>
          )}
          {review > 0 && <Box component="span" sx={toneB('var(--warn)')}><b>{n(review)}</b> need review</Box>}
        </Box>
        <Box sx={ctlSx} onClick={(e) => e.stopPropagation()}>
          <Box sx={groupSx} role="group" aria-label="Labels & funscripts">
            <PipelineQuickButton target={{ performerIds: [p.id] }} title="Labels & funscripts" runOn={runOn}
              hint={`${n(p.unlabelled)} of ${n(p.videos)} videos unlabelled`} onMore={onMore} sx={btnSx} />
            <Tooltip title={queueable.length
              ? `Labels + funscript for her ${queueable.length} unscripted funscript-folder video${queueable.length === 1 ? '' : 's'}`
              : 'Every video in her funscript folder has a script'}>
              <span style={{ display: 'inline-flex' }}>
                <IconButton size="small" sx={btnSx} disabled={!queueable.length} aria-label="Labels + funscript for her unscripted videos"
                  onClick={() => onQueue(queueable)}>
                  <QueueIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        <Tooltip title={!canOpen ? 'No funscript folder' : open ? 'Hide her funscript folder' : 'Show her funscript folder'}>
          <span style={{ gridArea: 'chev', display: 'inline-flex' }}>
            <IconButton size="small" sx={chevSx} disabled={!canOpen} aria-expanded={canOpen ? open : undefined}
              aria-label={`Funscript folder of ${p.name}`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {open && videos.length > 0 && <Box sx={videosSx}>{children}</Box>}
    </Box>
  );
}

export default function FunpipePage() {
  const { openSettings } = useShell();
  const notify = useNotify();
  const [qs, setQs] = useQueryState({ v: 'all', sort: 'name', q: '' });
  const view = VIEWS.some(x => x.id === qs.v) ? qs.v : 'all';
  const sort = SORTS.some(x => x.id === qs.sort) ? qs.sort : 'name';
  const q = qs.q;

  const [config, setConfig] = useState({ url: '', aiServerUrl: '' });
  const [library, setLibrary] = useState({ videos: [], counts: {}, total: 0, performers: [] });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [pipelineFor, setPipelineFor] = useState(null);
  const [runOn, setRunOn] = useState(null);   // "Run on" for everything queued from this page: null = the coordinator's order
  const runChoices = useRunOn(['label', 'funscript']);
  const [editor, setEditor] = useState({ running: false, url: null });
  const [editorBusy, setEditorBusy] = useState(false);

  // Slow poll: it only has to notice when the queue drains (to rescan the
  // library) and keep acm-gpu's state and the GPU note honest.
  const { jobs, services, refresh: refreshJobs } = useJobs({ activeMs: 5000, idleMs: 20000, withServices: true });

  useEffect(() => {
    fetch('/api/funpipe/config').then(r => r.json()).then(setConfig).catch(() => {});
  }, []);

  const loadLibrary = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/funpipe/library${refresh ? '?refresh=true' : ''}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLibrary({ performers: [], ...data });
    } catch (err) {
      notify({ severity: 'error', message: `Library scan failed: ${err.message}` });
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [notify]);

  const loadEditor = useCallback(async () => {
    try {
      setEditor(await (await fetch('/api/funpipe/ui/status')).json());
    } catch { /* acm-gpu offline: the sidebar says so */ }
  }, []);

  useEffect(() => { loadLibrary(); loadEditor(); }, [loadLibrary, loadEditor]);

  const post = async (path, body) => {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    });
    return res.json();
  };

  // The editor is a child process of acm-gpu; it can exit on its own.
  const toggleEditor = async () => {
    setEditorBusy(true);
    try {
      const res = await post(editor.running ? '/api/funpipe/ui/stop' : '/api/funpipe/ui/start');
      if (res.error) notify({ severity: 'error', message: res.error });
      else if (!editor.running) notify('Review editor started');
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

  // labels + a funscript from them, on the machines in the coordinator's order or the one picked in the sidebar
  const queueVideos = async (videos) => {
    if (!videos.length) return;
    try {
      notify(await queuePipeline({ paths: videos, steps: ['labels', 'funscript'], runOn }));
      setSelected(s => {
        const next = new Set(s);
        videos.forEach(p => next.delete(p));
        return next;
      });
    } catch (err) {
      notify({ severity: 'warning', message: err.message });
    }
    refreshJobs();
    loadLibrary(true);
  };

  // ── derived ──
  // only After performers: the ones that are filtered and kept (Before ones are still being sorted)
  const performers = useMemo(() => library.performers.filter(p => p.where === 'after'), [library.performers]);
  const videosOf = useMemo(() => {
    const by = new Map();
    for (const v of library.videos) {
      if (!by.has(v.performerId)) by.set(v.performerId, []);
      by.get(v.performerId).push(v);
    }
    for (const list of by.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return by;
  }, [library.videos]);

  const viewCounts = useMemo(
    () => Object.fromEntries(VIEWS.map(x => [x.id, performers.filter(x.test).length])),
    [performers]
  );

  /* A performer shows when she is in the view and her name or one of her funscript videos matches the search; a
     search that matched only videos lists just those, opened. */
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const test = VIEWS.find(x => x.id === view).test;
    const cmp = SORTS.find(x => x.id === sort).cmp;
    const out = [];
    for (const p of performers) {
      if (!test(p)) continue;
      const own = videosOf.get(p.id) || [];
      if (!needle || p.name.toLowerCase().includes(needle)) { out.push({ p, videos: own, byVideo: false }); continue; }
      const hits = own.filter(v => v.name.toLowerCase().includes(needle));
      if (hits.length) out.push({ p, videos: hits, byVideo: true });
    }
    return out.sort((a, b) => cmp(a.p, b.p) || a.p.name.localeCompare(b.p.name));
  }, [performers, videosOf, view, sort, q]);

  const totals = useMemo(() => performers.reduce((t, p) => ({
    performers: t.performers + 1,
    videos: t.videos + p.videos,
    unlabelled: t.unlabelled + p.unlabelled,
    funscript: t.funscript + p.funscript,
    noScript: t.noScript + p.noScript,
    review: t.review + (p.counts?.needs_review || 0)
  }), { performers: 0, videos: 0, unlabelled: 0, funscript: 0, noScript: 0, review: 0 }), [performers]);

  // Optimistic until the first services poll answers.
  const online = services ? services.funpipe.online : true;
  const gpuWarning = services?.gpu.warning || null;
  const queued = jobs.filter(j => j.type === 'funpipe' && isActive(j)).length;
  const reviewUrl = (v) => (v.fromFunpipe && editor.running && editor.url
    ? `${editor.url}/?v=${encodeURIComponent(v.stem)}` : null);

  const toggle = (path) => setSelected(s => {
    const next = new Set(s);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });
  const toggleExpanded = (id) => setExpanded(s => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── the sidebar ──
  const views = VIEWS.map(x => {
    const Icon = x.icon;
    return {
      id: x.id, label: x.label, count: viewCounts[x.id] ?? 0, icon: <Icon />, title: x.title,
      dot: x.id === 'noscript' && viewCounts.noscript > 0 ? 'bad' : undefined,
      onClick: () => setQs({ v: x.id })
    };
  });
  const sortLabel = SORTS.find(x => x.id === sort).label;
  const showGroup = (
    <SideGroup id="show" title="Show" icon={<FilterListIcon />} order={SIDE.show}
      badge={q ? 1 : 0} summary={q ? `"${q.trim()}" · ${sortLabel}` : sortLabel}>
      <SideSearch value={q} onChange={(value) => setQs({ q: value })} placeholder="Search performer or file" />
      <SideSelect label="Sort" value={sort} onChange={(value) => setQs({ sort: value })}
        options={SORTS.map(x => ({ value: x.id, label: x.label }))} />
    </SideGroup>
  );
  const pageGroup = (
    <SideGroup id="page" title="Funscripts" icon={<TuneIcon />} order={SIDE.page}
      dot={online ? null : 'bad'} summary={online ? (queued ? `${queued} in queue` : 'acm-gpu online') : 'acm-gpu offline'}>
      {editor.running
        ? <SideMain icon={<EditNoteIcon />} label="Stop review editor" onClick={toggleEditor} busy={editorBusy} busyLabel="Stopping…"
            tip="Shut the editor down when you're done: it holds the video files open" />
        : <SideMain icon={<EditNoteIcon />} label="Start review editor" onClick={toggleEditor} busy={editorBusy} busyLabel="Starting…"
            disabled={!online} tip={online ? 'Start the funscript review editor on the GPU machine' : 'acm-gpu is offline'} />}
      {runChoices.connected && runChoices.nodes.length > 0 && (
        <SideSelect label="Run on" value={runOn || ''} onChange={(value) => setRunOn(value || null)}
          options={[{ value: '', label: 'Follow the order' },
            ...runChoices.nodes.map(n => ({ value: n.id, label: `${n.name}${n.online ? '' : ' (away)'}` }))]} />
      )}
      <SideFacts rows={[
        { label: 'acm-gpu', value: online ? 'Online' : 'Offline', tone: online ? 'ok' : 'bad', title: online ? config.url : config.aiServerUrl }
      ]} />
      <SideFacts rows={[
        { label: 'After performers', value: n(totals.performers) },
        { label: 'Videos', value: n(totals.videos) },
        { label: 'Unlabelled', value: n(totals.unlabelled), tone: totals.unlabelled ? 'warn' : 'ok' },
        { label: 'In funscript folders', value: n(totals.funscript), tone: 'info' },
        { label: 'No script yet', value: n(totals.noScript), tone: totals.noScript ? 'bad' : 'ok' },
        { label: 'Needs review', value: n(totals.review), tone: totals.review ? 'warn' : undefined }
      ]} />
      <SideButtons>
        {editor.running && editor.url && (
          <SideButton icon={<OpenInNewIcon />} component="a" href={editor.url} target="_blank" rel="noreferrer">Open review editor</SideButton>
        )}
        <SideButton icon={<ListAltIcon />} component={RouterLink} to="/jobs">
          {queued ? `${queued} in queue · Jobs` : 'Queue in Jobs'}
        </SideButton>
        <SideButton icon={<RefreshIcon />} onClick={() => loadLibrary(true)} disabled={loading}>
          {loading ? 'Rescanning…' : 'Rescan folders'}
        </SideButton>
        <SideButton plain icon={<SettingsIcon />} onClick={() => openSettings('workers')}>Worker settings</SideButton>
      </SideButtons>
      {!online && (
        <SideNote>
          Start acm-gpu from the host agent on the GPU machine (tray → acm-gpu → Start). Queueing still works: jobs run
          once it is back.
        </SideNote>
      )}
    </SideGroup>
  );

  const dialog = (
    <PipelineDialog
      open={pipelineFor != null}
      initialPerformerIds={pipelineFor != null ? [pipelineFor] : []}
      onClose={() => setPipelineFor(null)}
      onQueued={(msg) => notify(`${msg} — follow them on the Jobs page`)}
    />
  );

  if (!loaded) {
    return (
      <SidebarPage title={TITLE} views={views} view={view}>
        {showGroup}
        {pageGroup}
        <LoadingState label="Reading the funscript folders…" />
      </SidebarPage>
    );
  }

  // ── the content line ──
  const viewDef = VIEWS.find(x => x.id === view);
  const total = viewCounts[view] ?? 0;
  const meta = [
    `${q ? `${n(rows.length)} of ` : ''}${n(total)} ${total === 1 ? 'performer' : 'performers'}`,
    `${n(totals.funscript)} videos in funscript folders`
  ].join(' · ');
  const line = (
    <ContentLine title={viewDef.label} meta={meta} actions={selected.size > 0 ? (
      <>
        <SmallButton onClick={() => setSelected(new Set())}>Clear</SmallButton>
        <SmallButton primary startIcon={<QueueIcon />} onClick={() => queueVideos([...selected], `${selected.size} video(s)`)}>
          Labels + funscript for {selected.size}
        </SmallButton>
      </>
    ) : null} />
  );

  let body;
  if (performers.length === 0) {
    body = <EmptyState title="No After performers yet" description="Performers you have filtered (After) show here." />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState title="Nothing here"
        description={q ? `Nothing matches "${q.trim()}" here.` : (NOTHING[view] || 'Nothing matches.')}
        action={(q || view !== 'all') ? <SmallButton onClick={() => setQs({ v: 'all', q: '' })}>Show all</SmallButton> : undefined} />
    );
  } else {
    body = (
      <Panel padded={false} sx={{ overflow: 'hidden' }}>
        {rows.map(({ p, videos, byVideo }) => (
          <PerformerLine key={p.id} p={p} videos={videos} runOn={runOn} open={byVideo || expanded.has(p.id)}
            onToggle={() => toggleExpanded(p.id)} onMore={() => setPipelineFor(p.id)}
            onQueue={(paths) => queueVideos(paths, `${paths.length} of ${p.name}'s videos`)}>
            {videos.map(v => (
              <VideoRow key={v.path} v={v} online={online} runOn={runOn} selected={selected.has(v.path)} onToggle={() => toggle(v.path)}
                reviewUrl={reviewUrl(v)} onQueue={() => queueVideos([v.path], v.name)} />
            ))}
          </PerformerLine>
        ))}
      </Panel>
    );
  }

  return (
    <SidebarPage title={TITLE} views={views} view={view}>
      {showGroup}
      {pageGroup}
      {line}
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {online && gpuWarning && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          <strong>GPU is busy:</strong> {gpuWarning}. Generation still runs, sharing the card, but expect both to be slower.
        </Alert>
      )}
      {body}
      {dialog}
    </SidebarPage>
  );
}
