/**
 * Discover: what the keep scanner found. The watchers read their sites, the P model judges the pictures, and this page is where
 * the performers are decided: Keep and Delete go to the profile page and P's training, Remove only takes her off here.
 *
 * Reads GET /api/discovery/summary (the totals, the watchers, the two runs and the timer) every few seconds while a run goes
 * and less often otherwise; a run that ends reloads the tab that is open. The tabs are in components/discover/.
 *
 * Route: /discover
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Snackbar, Switch, Tooltip, Typography } from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { PageShell, PageHeader, Panel, Section, StatRow, LoadingState, SPACE } from '../components/layout';
import { ago, get, meta, plural, post, smallBtnSx, sourceLabels, TabBar, useAsk } from '../components/discover/shared';
import PerformersTab from '../components/discover/PerformersTab';
import DuplicatesTab from '../components/discover/DuplicatesTab';
import WatchersTab from '../components/discover/WatchersTab';
import UploadTab from '../components/discover/UploadTab';
import { useNavigate } from 'react-router-dom';
import useIsPhone from '../mobile/useIsPhone';

const VIEW_KEY = 'discover.view';
const TABS = ['performers', 'liked', 'kept', 'duplicates', 'watchers', 'upload'];
const DEFAULT_VIEW = { tab: 'performers', sort: 'score', q: '', newOnly: false, hasData: false, hideHand: false, morePics: false, dupKind: '', uploadKind: 'performer' };
const POLL_RUNNING_MS = 4000;
const POLL_IDLE_MS = 15000;
const RECENT_MS = 30000;   // how long a finished run stays on the strip
const NO_WATCHERS = [];

// The view (tab, sort, search, filters) is remembered in this browser, so a refresh comes back to it
function restoreView() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch {}
  const view = { ...DEFAULT_VIEW };
  if (saved) for (const k of Object.keys(view)) if (typeof saved[k] === typeof view[k]) view[k] = saved[k];
  if (!TABS.includes(view.tab)) view.tab = 'performers';
  if (!['score', 'scoreAsc', 'newest', 'name'].includes(view.sort)) view.sort = 'score';
  if (!['', 'fallen', 'pair'].includes(view.dupKind)) view.dupKind = '';
  if (!['performer', 'picture'].includes(view.uploadKind)) view.uploadKind = 'performer';
  return view;
}

const running = (s) => !!(s?.job?.running || s?.watchJob?.running);

// ── the status strip ─────────────────────────────────────────
const MODE = { rescore: 'Re-judging', backlog: 'Going back', profiles: 'Judging profiles', pools: 'Judging pictures together' };

/** What a run is doing or how it ended, or null when there is nothing to say about it. */
function runLine(j, label) {
  const last = j.log[j.log.length - 1] || '';
  if (j.running) return { text: `${label}… ${last}`, spin: true };
  if (j.exitCode) return { text: `Stopped: ${j.error || last}`, bad: true };
  if (j.paused) return { text: `Paused ${ago(j.finishedAt)}: Run now on the watcher goes on from where it stopped` };
  if (j.finishedAt && Date.now() - new Date(j.finishedAt) < RECENT_MS) return { text: `Done ${ago(j.finishedAt)}: ${j.log.filter(l => /^This run/.test(l)).pop() || last}` };
  return null;
}

const monoSx = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.75rem' };

function StatusStrip({ summary, onPause }) {
  const [logOpen, setLogOpen] = useState(false);
  const { job, watchJob, totals, outbox } = summary;
  const handLabel = job.mode === 'watcher' ? `Running ${summary.watchers.find(w => w.id === job.watcher)?.label || job.watcher}` : MODE[job.mode] || 'Scanning';
  const runs = [
    { key: 'hand', j: job, line: runLine(job, handLabel) },
    { key: 'timer', j: watchJob, line: runLine(watchJob, 'Watching') }
  ].filter(r => r.line);

  // The newest run that says how long the NAS's CPU took a picture
  const cpu = [job, watchJob].filter(j => j.secondsPerPicture != null).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0];
  const notes = [
    totals.waiting > 0 && {
      text: `${totals.waiting} waiting for P`, tone: 'var(--warn)',
      tip: 'Saved but not judged: neither acm-gpu nor the NAS\'s CPU service answered. A later run judges them'
    },
    cpu && { text: `NAS CPU: ${cpu.secondsPerPicture.toFixed(1)} s a picture`, tip: 'From the last run that used the CPU' },
    outbox?.queued > 0 && {
      text: `${outbox.queued} waiting for the profile page`, tone: outbox.failing ? 'var(--bad)' : undefined,
      tip: `${plural(outbox.queued, 'decision')} not on the profile page yet; tried again after each run`
    }
  ].filter(Boolean);

  if (!runs.length && !notes.length) return null;
  return (
    <Panel padded={false} sx={{ mt: -1, mb: SPACE.md, px: 1.5, py: 1.25, display: 'grid', gap: 0.75, ...(runs.some(r => r.line.bad) && { borderColor: 'var(--bad)' }) }}>
      {runs.map(({ key, line }, i) => (
        <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, color: line.bad ? 'var(--bad)' : 'var(--dim)' }}>
          {line.spin && <CircularProgress size={14} sx={{ color: 'var(--accent)', flexShrink: 0 }} />}
          <Typography title={line.text} sx={{ ...monoSx, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit' }}>
            {line.text}
          </Typography>
          {key === 'hand' && job.running && (
            <Tooltip title="Stop this run; a profiles run goes on from its page with Run now">
              <Button size="small" variant="outlined" sx={smallBtnSx} onClick={onPause}>Pause</Button>
            </Tooltip>
          )}
          {i === 0 && <Button size="small" sx={{ ...smallBtnSx, border: 0 }} onClick={() => setLogOpen(o => !o)}>{logOpen ? 'Hide log' : 'Log'}</Button>}
        </Box>
      ))}
      {logOpen && runs.map(({ key, j }) => (
        <Box key={key} component="pre" sx={{
          m: 0, p: '8px 10px', maxHeight: 240, overflow: 'auto', bgcolor: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)',
          ...monoSx, fontSize: '.72rem', lineHeight: 1.5, color: 'var(--dim)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>
          {j.log.join('\n')}
        </Box>
      ))}
      {notes.length > 0 && (
        <Box sx={{ display: 'flex', gap: '4px 16px', flexWrap: 'wrap', ...meta, fontSize: '.78rem' }}>
          {notes.map(n => (
            <Tooltip key={n.text} title={n.tip}>
              <Box component="span" sx={{ color: n.tone }}>{n.text}</Box>
            </Tooltip>
          ))}
        </Box>
      )}
    </Panel>
  );
}

// ── the header's controls ────────────────────────────────────
/** A number that takes effect when you leave the field or press Enter; anything out of range goes back. */
function NumberField({ value, min, max, label, onCommit }) {
  const [text, setText] = useState(String(value ?? ''));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value ?? '')); }, [value]);
  const commit = () => {
    focused.current = false;
    const n = Number(text);
    if (text === '' || !Number.isFinite(n) || n < min || n > max) return setText(String(value ?? ''));
    if (n !== value) onCommit(n);
  };
  return (
    <Box component="input" type="number" min={min} max={max} aria-label={label} value={text}
      onChange={(e) => setText(e.target.value)} onFocus={() => { focused.current = true; }} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
      sx={{
        width: 48, height: 22, px: '4px', textAlign: 'right', color: 'var(--text)', font: 'inherit', fontVariantNumeric: 'tabular-nums',
        bgcolor: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 4px)',
        '&:focus': { outline: 'none', borderColor: 'var(--accent)' }
      }} />
  );
}

const controlSx = {
  display: 'inline-flex', alignItems: 'center', gap: 0.75, height: 32, px: 1, border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)',
  color: 'var(--dim)', fontSize: '.8rem', whiteSpace: 'nowrap'
};

function RunButton({ tip, children, ...rest }) {
  return (
    <Tooltip title={tip}>
      <span>
        <Button size="small" sx={{ height: 32, whiteSpace: 'nowrap', ...(rest.variant === 'contained' ? {} : smallBtnSx) }} {...rest}>{children}</Button>
      </span>
    </Tooltip>
  );
}

// ── the page ─────────────────────────────────────────────────
export default function DiscoverPage() {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(restoreView);
  const [version, setVersion] = useState(0);   // bumped when a run ends: the open tab loads again
  const [toast, setToast] = useState(null);
  const [ask, askDialog] = useAsk();
  const alive = useRef(true);
  const wasRunning = useRef(false);
  const loaded = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);

  const notify = useCallback((msg, severity = 'info') => setToast({ msg, severity }), []);
  const patch = useCallback((changes) => setView(v => ({ ...v, ...changes })), []);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {}
  }, [view]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await get('/summary');
      if (!alive.current) return;
      loaded.current = true;
      setSummary(s);
      setError(null);
      const now = running(s);
      if (wasRunning.current && !now) setVersion(v => v + 1);
      wasRunning.current = now;
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    let timer;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden || !loaded.current) await loadSummary();   // the first load always; a page in the background then rests
      if (!stopped) timer = setTimeout(tick, wasRunning.current ? POLL_RUNNING_MS : POLL_IDLE_MS);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [loadSummary]);

  // A picture dropped outside the Upload tab's zone: the browser shouldn't open it
  useEffect(() => {
    const stop = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', stop);
    return () => { document.removeEventListener('dragover', stop); document.removeEventListener('drop', stop); };
  }, []);

  /** A POST, then the counts; a refusal is said in the toast. */
  const act = useCallback(async (path, body) => {
    try { await post(path, body); } catch (e) { notify(e.message, 'error'); }
    await loadSummary();
  }, [loadSummary, notify]);

  const saveThreshold = async (threshold) => {
    await act('/settings', { threshold });
    setVersion(v => v + 1);
  };

  const watchers = summary?.watchers || NO_WATCHERS;
  const labelsKey = watchers.map(w => `${w.site}:${w.kind}:${w.label}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sourceLabel = useMemo(() => sourceLabels(watchers), [labelsKey]);

  const t = summary?.totals;
  const busy = running(summary);
  const threshold = summary?.threshold ?? 50;
  const checked = watchers.reduce((n, w) => n + w.checked, 0);
  const kept = watchers.reduce((n, w) => n + w.kept, 0);

  const subtitle = summary ? [
    plural(watchers.length, 'watcher'),
    summary.run.models?.length ? `P model ${summary.run.models.join(', ')}` : 'P model',
    summary.run.last_scan ? `last scan ${ago(summary.run.last_scan)}` : 'never scanned'
  ].join(' · ') : 'Loading…';

  const tabs = [
    { id: 'performers', label: 'Performers', count: t?.performers },
    { id: 'liked', label: 'Liked', count: t?.performers_with_keeps },
    { id: 'kept', label: 'Kept', count: t?.kept_tab },
    { id: 'duplicates', label: 'Duplicates', count: t?.duplicates },
    { id: 'watchers', label: 'Watchers', count: summary ? watchers.length : undefined },
    { id: 'upload', label: 'Upload', count: summary?.uploads }
  ];

  const stats = t ? [
    { label: 'Performers', value: t.performers, hint: `${t.performers_with_data} with profile data` },
    { label: 'Liked', value: t.performers_with_keeps, tone: 'ok', hint: t.performers ? `${Math.round(t.performers_with_keeps / t.performers * 100)}% of performers` : '' },
    { label: 'New liked', value: t.new_performers, tone: 'accent', hint: `${t.performers_with_keeps - t.new_performers} already in library` },
    {
      label: 'Duplicates', value: t.duplicates, tone: t.duplicates_fallen ? 'warn' : 'default',
      hint: t.duplicates_fallen ? `${t.duplicates_pairs} pairs, ${t.duplicates_fallen} below the line` : 'to combine or keep apart'
    },
    { label: 'Judged', value: checked, hint: `by ${plural(watchers.length, 'watcher')}` },
    { label: 'Kept by P', value: kept, tone: 'ok', hint: checked ? `${Math.round(kept / checked * 100)}% of judged` : '' }
  ] : [];

  const notWhileRunning = busy ? ' (a run is going)' : '';
  const actions = summary && (
    <>
      <Tooltip title="P keeps a picture at this score or above. New judging uses it right away; Re-judge applies it to what is already judged">
        <Box component="label" sx={controlSx}>
          Keep at <NumberField label="Keep line" value={threshold} min={0} max={100} onCommit={saveThreshold} />+
        </Box>
      </Tooltip>
      <Tooltip title={`Run the watchers on watch every ${summary.watch.minutes} minutes. It stays on across restarts`}>
        <Box sx={{ ...controlSx, pl: 0.25 }}>
          <Switch size="small" checked={summary.watch.on} inputProps={{ 'aria-label': 'Watch: run the watchers on a timer' }}
            onChange={(e) => act('/watch', { on: e.target.checked, minutes: summary.watch.minutes })} />
          Watch every <NumberField label="Minutes between runs" value={summary.watch.minutes} min={5} max={1440}
            onCommit={(minutes) => act('/watch', { on: summary.watch.on, minutes })} /> min
        </Box>
      </Tooltip>
      <RunButton variant="outlined" startIcon={<ArrowDownwardIcon />} disabled={busy} onClick={() => act('/scan', { mode: 'backlog' })}
        tip={`Judge older posts, going on from where the last backlog run stopped${notWhileRunning}`}>
        Older posts
      </RunButton>
      <RunButton variant="outlined" startIcon={<RefreshIcon />} disabled={busy} onClick={() => act('/scan', { mode: 'rescore' })}
        tip={`Judge every cached picture again with the current P model${notWhileRunning}`}>
        Re-judge
      </RunButton>
      <RunButton variant="contained" startIcon={<SearchIcon />} disabled={busy} onClick={() => act('/scan', {})}
        tip={`Run the watchers on watch now${notWhileRunning}`}>
        Scan now
      </RunButton>
    </>
  );

  const tabProps = { view, patch, version, notify, refresh: loadSummary };
  const { tab } = view;

  return (
    <PageShell>
      {/* on a phone there's no app bar: Back leads to the phone app's lists */}
      <PageHeader title="Discover" subtitle={subtitle} actions={actions} back={isPhone} onBack={() => navigate('/')} />

      {error && <Alert severity="error" sx={{ mb: SPACE.md }}>{error}</Alert>}
      {!summary && !error && <LoadingState label="Loading…" />}

      {summary && (
        <>
          <StatusStrip summary={summary} onPause={() => act('/pause')} />
          <StatRow items={stats} />
          <TabBar label="Discover" tabs={tabs} value={tab} onChange={(id) => patch({ tab: id })} />
          <Section sx={{ mb: 0 }}>
            {(tab === 'performers' || tab === 'liked' || tab === 'kept') && (
              <PerformersTab key={tab} tab={tab} watchers={watchers} sourceLabel={sourceLabel} ask={ask} {...tabProps} />
            )}
            {tab === 'duplicates' && <DuplicatesTab totals={t} sourceLabel={sourceLabel} {...tabProps} />}
            {tab === 'watchers' && <WatchersTab summary={summary} ask={ask} {...tabProps} />}
            <UploadTab active={tab === 'upload'} threshold={threshold} ask={ask} {...tabProps} />
          </Section>
        </>
      )}

      {askDialog}

      <Snackbar open={!!toast} autoHideDuration={7000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%', whiteSpace: 'pre-line' }}>{toast.msg}</Alert> : <span />}
      </Snackbar>
    </PageShell>
  );
}
