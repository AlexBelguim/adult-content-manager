/**
 * Discover → Watchers: a card per watcher (its site, how it runs, its newest finds above the line, what it read and kept,
 * when it last ran, what stopped it), Open and Run now. A watcher opens at /discover/watchers/<id>: its performers as the one performer card (decided there, like the
 * Performers tab), and "What it read": every post or profile with its score, skip reason or wait. A watcher that only runs
 * by hand asks first. Filters, sub-view and the open drawer live in the URL, so Back and reload keep them.
 *
 * The sidebar: on a watcher's page, its facts, its site and Run now (the page's main action) in the 'watcher' section,
 * and Show with the sub-view (Performers | What it read) and that sub-view's search, sort and filters; the status or
 * result list is a second list. The View list's Watchers item, still highlighted, is the way back to the grid.
 */
import React, { useEffect, useState } from 'react';
import { CircularProgress, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import ListAltIcon from '@mui/icons-material/ListAlt';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useNavigate } from 'react-router-dom';
import {
  ContentLine, EmptyState, LoadingState, Panel, SIDE, SideButton, SideButtons, SideChecks, SideFacts, SideGroup, SideList, SideMain,
  SideNote, SideSearch, SideSegment, SideSelect
} from '../layout';
import {
  ago, Badge, ExternalLink, get, ListError, LoadMore, plural, post, SmallButton, SORT_OPTIONS, StalePill, useList, useOverlay,
  useQueryState, when
} from './shared';
import PerformerGrid from './PerformerGrid';
import { PerformerDrawerHost } from './PerformerDrawer';
import usePerformerActions from './usePerformerActions';
import { sortText } from './PerformersTab';
import './watchers.css';

/** Whether a run (by hand, or the timer's) is busy with this watcher */
function isRunning(w, job, watchJob) {
  return [job, watchJob].some(j => j?.running
    && (j.watcher === w.id || (j.mode === 'scan' && w.watch) || (j.mode === 'backlog' && w.kind === 'posts') || (j.mode === 'profiles' && w.kind === 'profiles') || j.mode === 'rescore'));
}

/** The run by hand has one slot; a watcher on watch also waits for the timer's run */
const blocked = (w, job, watchJob) => !!job?.running || (w.watch !== false && !!watchJob?.running);
const blockedTip = (w, job, watchJob) => (job?.running ? 'A run started by hand is going' : (w.watch !== false && watchJob?.running) ? 'The timer run is going' : undefined);
const runLabel = (w, running) => (w.resume_page && !running ? `Go on from page ${w.resume_page + 1}` : 'Run now');
// kept of checked, as the old card and the Kept by P tile ("55% of judged", where Judged adds up checked) count it
const pctOf = (w) => (w.checked ? Math.min(100, Math.round((w.kept || 0) / w.checked * 100)) : 0);
const Sep = () => <span className="dw-sep" aria-hidden="true">·</span>;

/** The one state chip of a watcher: running, failed, a profiles run paused part way, else how it runs (watching or by hand) */
function StateChip({ w, running, watch }) {
  if (running) return <Badge tone="accent"><CircularProgress size={10} thickness={6} sx={{ color: 'var(--accent)' }} />Running</Badge>;
  if (w.last_error) return <Badge tone="bad" title={w.last_error}>Failed</Badge>;
  if (w.kind === 'profiles' && w.resume_page) return <Badge tone="warn" title={`A run stopped part way: the next one goes on from page ${w.resume_page + 1}`}>Paused at page {w.resume_page}</Badge>;
  if (!w.watch) return <Badge title="It only runs when you start it">By hand</Badge>;
  return watch?.on
    ? <Badge tone="ok" title={`The timer runs it every ${watch.minutes ?? 20} min`}>Watching</Badge>
    : <Badge title={`It runs every ${watch?.minutes ?? 20} min while the timer is on`}>Timer off</Badge>;
}

/** The chip shows how it runs unless it has something more pressing to say; then the line under the name says it */
const chipIsSchedule = (w, running) => !running && !w.last_error && !(w.kind === 'profiles' && w.resume_page);
/** "leakshaven.com/models": the site and the list it reads, without the protocol, "www." or a closing slash */
const siteOf = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname}${u.search}`.replace(/\/+$/, '');
  } catch {
    return url || '';
  }
};

function RunButton({ w, job, watchJob, onRun, sx }) {
  const off = blocked(w, job, watchJob);
  return (
    <SmallButton disabled={off} tip={off ? blockedTip(w, job, watchJob) : undefined} sx={sx} onClick={(e) => { e.stopPropagation(); onRun(w); }}>
      {runLabel(w, isRunning(w, job, watchJob))}
    </SmallButton>
  );
}

// ── the grid ─────────────────────────────────────────────────
const THUMBS = 5;

/** Its newest finds above the line, for the strip of pictures on its card (none asked for when nothing is above the line) */
function useBestFinds(w, version) {
  const want = (w.kept || 0) > 0;
  const key = `${w.id}|${version}|${w.last_update || ''}|${w.kept || 0}`;
  const [s, setS] = useState({ key: null, items: [], failed: false });
  useEffect(() => {
    if (!want) return undefined;
    let live = true;
    get(`/watcher/${encodeURIComponent(w.id)}?list=above&sort=newest&limit=${THUMBS}`)
      .then((r) => { if (live) setS({ key, items: (r.items || []).filter(x => x.image).slice(0, THUMBS), failed: false }); })
      .catch(() => { if (live) setS(prev => ({ key, items: prev.items, failed: true })); });
    return () => { live = false; };
  }, [key, want, w.id]);
  // The ones from before stay up while the newer ones load, so the strip doesn't blink after a run
  return want ? { items: s.items, loaded: s.key != null && !s.failed } : { items: [], loaded: true };
}

const findName = (x) => x.name || x.performer_name || x.title || '';

function Thumb({ x }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="dw-thumb" title={[findName(x), x.score != null && `score ${x.score}`, x.found_at && `found ${ago(x.found_at)}`].filter(Boolean).join(' · ')}>
      {!broken && <img src={x.image} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />}
      {x.score != null && <span className="dw-thumb-score">{Math.round(x.score)}</span>}
    </div>
  );
}

/** Up to five of its newest finds above the line; the empty slots stay, so every card is the same height */
function FindStrip({ w, version }) {
  const { items, loaded } = useBestFinds(w, version);
  const note = !loaded || items.length ? null : w.checked ? 'Nothing above the line yet' : 'Nothing found yet';
  return (
    <div className={`dw-thumbs${note ? ' none' : ''}`} role={items.length ? 'img' : undefined}
      aria-label={items.length ? `Newest above the line: ${items.map(findName).filter(Boolean).join(', ')}` : undefined}>
      {Array.from({ length: THUMBS }, (_, i) => (items[i]
        ? <Thumb key={items[i].key || i} x={items[i]} />
        : <div key={`e${i}`} className="dw-thumb empty" aria-hidden="true" />))}
      {note && <span className="dw-thumbs-note">{note}</span>}
    </div>
  );
}

function Num({ value, label, tone, title }) {
  const n = value || 0;
  return (
    <div className="dw-n" title={title}>
      <span className={`dw-n-v${n ? (tone ? ` ${tone}` : '') : ' zero'}`}>{n}</span>
      <span className="dw-n-l">{label}</span>
    </div>
  );
}

/** One thin bar: above the line, below it, skipped, waiting, as parts of what it checked; after it, the share kept (of checked) */
function ReadBar({ w }) {
  const above = w.kept || 0;
  const below = Math.max(0, (w.judged || 0) - above);
  const skipped = w.kind === 'profiles' ? 0 : (w.skipped || 0);
  const waiting = w.waiting || 0;
  const all = above + below + skipped + waiting;
  const part = (n, cls) => (n > 0 ? <span className={`dw-bar-${cls}`} style={{ flexGrow: n }} /> : null);
  return (
    <div className="dw-barrow">
      <div className="dw-bar" aria-hidden="true"
        title={all ? [`${above} above the line`, `${below} below`, skipped && `${skipped} skipped`, waiting && `${waiting} waiting`].filter(Boolean).join(' · ') : undefined}>
        {part(above, 'above')}{part(below, 'below')}{part(skipped, 'skipped')}{part(waiting, 'waiting')}
      </div>
      <span className={`dw-pct${above ? '' : ' zero'}`}
        title={w.checked ? `${above} of the ${w.checked} checked kept: at or above the keep line` : 'Nothing checked yet'}>
        {pctOf(w)}% kept
      </span>
    </div>
  );
}

function WatcherCard({ w, watch, job, watchJob, version, isPhone, onOpen, onRun }) {
  const running = isRunning(w, job, watchJob);
  const failed = !!w.last_error;
  const profiles = w.kind === 'profiles';
  const schedule = w.watch ? `every ${watch?.minutes ?? 20} min` : chipIsSchedule(w, running) ? null : 'by hand';
  const tall = isPhone ? { minHeight: 40 } : undefined;
  const newest = w.last_update && <><Sep /><span className="dw-nb">newest find {ago(w.last_update)}</span></>;
  // Failed: when and the newest find on the first line, the error on the second (all of it on hover and on the watcher's page)
  const last = failed
    ? (
      <div className="dw-last failed" title={w.last_error}>
        <span className="dw-last-1"><span className="dw-nb dw-bad">Failed{w.last_checked ? ` ${ago(w.last_checked)}` : ''}</span>{newest}</span>
        <span className="dw-err">{w.last_error}</span>
      </div>
    )
    : (
      <div className="dw-last">
        <span className="dw-nb">{w.last_checked ? `Checked ${ago(w.last_checked)}${w.last_found != null ? `: ${w.last_found} new` : ''}` : 'Not run yet'}</span>
        {newest}
      </div>
    );
  return (
    <Panel padded={false} interactive tabIndex={0} role="link" aria-label={`${w.label}: open`} className="dw-card"
      onClick={() => onOpen(w)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(w); }}
      sx={{ p: isPhone ? '12px' : '14px', ...(failed && { borderColor: 'var(--bad)', '&:hover': { borderColor: 'var(--bad)', background: 'var(--raised)' } }) }}>
      <div className="dw-card-head">
        <h3 className="dw-card-title" title={w.label}>{w.label}</h3>
        <StateChip w={w} running={running} watch={watch} />
      </div>
      <div className="dw-kind">
        {w.url && (
          <span className="dw-site" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <ExternalLink href={w.url} title={w.url} sx={{ maxWidth: '100%', color: 'var(--dim)', '&:hover': { color: 'var(--text)', textDecoration: 'underline' } }}>
              <span className="dw-site-text">{siteOf(w.url)}</span>
            </ExternalLink>
          </span>
        )}
        {w.url && <Sep />}
        <span>{profiles ? 'Profiles' : 'Posts'}</span>
        {schedule && <><Sep /><span>{schedule}</span></>}
      </div>
      <FindStrip w={w} version={version} />
      <div className="dw-nums">
        <Num value={w.to_decide} label="to decide" tone="accent" title="Performers it found that are not decided yet" />
        <Num value={w.checked} label="checked"
          title={[`${w.checked || 0} ${profiles ? 'profiles' : 'posts'} checked: ${w.judged || 0} judged`, !profiles && `${w.skipped || 0} skipped`,
            `${w.waiting || 0} waiting`].filter(Boolean).join(', ')} />
        <Num value={w.kept} label="kept" tone="ok" title={`${w.kept || 0} of the ${w.checked || 0} checked kept by P: at or above the keep line`} />
        {profiles
          ? <Num value={w.with_data} label="with data" title="Profiles saved with their data (age, height and so on)" />
          : <Num value={w.skipped} label="skipped" tone="warn" title="Read but not judged: no picture, or not a performer" />}
        <Num value={w.waiting} label="waiting" tone="info" title="Saved but not judged yet: P could not judge them" />
      </div>
      <ReadBar w={w} />
      {last}
      <div className="dw-card-foot" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <SmallButton sx={tall} onClick={() => onOpen(w)}>Open</SmallButton>
        <RunButton w={w} job={job} watchJob={watchJob} onRun={onRun} sx={tall} />
      </div>
    </Panel>
  );
}

// ── one watcher: its performers ──────────────────────────────
const STATUS_VIEW = { decide: 'all', kept: 'kept', decided: 'decided', all: 'everyone' };
const STATUS_TEXT = { decide: 'to decide', kept: 'kept', decided: 'decided', all: 'performers' };
const STATUS_LABEL = { decide: 'To decide', kept: 'Kept', decided: 'Decided', all: 'All' };

function WatcherPerformers({ w, version, ask, notify, refresh, sourceLabel, runButton, subSwitch }) {
  // `view` (the sub-view) is not in the defaults on purpose: a change here must never drop it from the URL
  const [qs, setQs] = useQueryState({ status: 'decide', q: '', sort: 'score', new: '', pics: '' });
  const status = STATUS_VIEW[qs.status] ? qs.status : 'decide';
  const view = STATUS_VIEW[status];
  const sort = SORT_OPTIONS.some(o => o.value === qs.sort) ? qs.sort : 'score';
  const params = new URLSearchParams({ view, watcher: w.id, sort });
  if (qs.q) params.set('q', qs.q);
  if (qs.new) params.set('new', '1');
  if (qs.pics) params.set('pics', '1');
  const filtered = !!(qs.q || qs.new || qs.pics);
  const showOn = [qs.q, qs.new, qs.pics].filter(Boolean).length;

  const toolbar = (list) => {
    const counts = list.extra?.counts || {};
    return (
      <>
        <SideGroup id="show" title="Show" icon={<FilterListIcon />} badge={showOn} summary={showOn ? `${showOn} on` : 'no filters'} order={SIDE.show}>
          {subSwitch}
          <SideSearch value={qs.q} onChange={(q) => setQs({ q })} placeholder="Search names and aliases" />
          <SideSelect label="Sort" value={sort} onChange={(next) => setQs({ sort: next })} options={SORT_OPTIONS} />
          <SideChecks items={[
            { id: 'new', label: 'New only', checked: !!qs.new, onChange: (v) => setQs({ new: v ? '1' : '' }), title: 'Only the performers not in the library yet' },
            { id: 'pics', label: '3+ pictures', checked: !!qs.pics, onChange: (v) => setQs({ pics: v ? '1' : '' }), title: 'Only performers with 3 or more pictures' }
          ]} />
        </SideGroup>
        <SideGroup id="status" title="Status" icon={<ListAltIcon />} badge={status !== 'decide' ? 1 : 0} summary={STATUS_LABEL[status]} order={SIDE.list}>
          <SideList label="Status" value={status} onChange={(next) => setQs({ status: next })}
            items={Object.keys(STATUS_VIEW).map(id => ({ id, label: STATUS_LABEL[id], count: counts[id] ?? null }))} />
        </SideGroup>
        <ContentLine title={w.label} meta={list.loaded ? [
          `${list.total.toLocaleString()} ${STATUS_TEXT[status]}`, `${list.items.length.toLocaleString()} shown`, sortText(sort)
        ].join(' · ') : 'Loading…'} />
      </>
    );
  };

  const empty = status === 'decide' && !filtered
    ? {
      title: 'Nothing to decide from this watcher',
      description: `Everyone ${w.label} found is decided. A run that finds someone new puts her here.`,
      action: (
        <div className="dw-empty-actions">
          <SmallButton onClick={() => setQs({ status: 'all' })}>Show all</SmallButton>
          {runButton}
        </div>
      )
    }
    : { title: 'Nothing here', description: filtered ? 'Nothing matches the filters.' : 'Nothing yet.' };

  return (
    <PerformerGrid path={`/performers?${params}`} view={view} version={version} toolbar={toolbar} empty={empty}
      focusSource={w.source} focusLabel={w.label} sourceLabel={sourceLabel} ask={ask} notify={notify} refresh={refresh} />
  );
}

// ── one watcher: what it read ────────────────────────────────
function ScoreText({ r, profiles }) {
  if (r.score != null) return <span className={`dw-score${r.above ? ' above' : ''}`}>{r.score}</span>;
  if (r.waiting) return <span className="dw-info" title="Saved but not judged yet">Waiting</span>;
  return <span className="dw-warn">{profiles ? 'Not judged' : 'Skipped'}</span>;
}

function RowActions({ r, onOpen, tall }) {
  return (
    <div className="dw-acts">
      <SmallButton disabled={!r.key} tip={r.key ? undefined : 'Not judged: not a performer yet'} sx={tall ? { minHeight: 40 } : undefined}
        onClick={() => onOpen(r.key)}>Open her</SmallButton>
      {r.link && (
        <span className="dw-iconlink" title="Open on the site">
          <ExternalLink href={r.link} aria-label="Open on the site"><span className="dw-sr">Open on the site</span></ExternalLink>
        </span>
      )}
    </div>
  );
}

const rowName = (r) => r.title || r.name || r.performer_name || '';
const rowSub = (r) => (r.performer_name && r.performer_name !== rowName(r) ? r.performer_name : '');
const rowKey = (r, i) => `${r.kind}:${r.key || r.link || ''}:${i}`;

function WatcherRead({ w, version, ask, notify, refresh, sourceLabel, isPhone, onExtra, subSwitch }) {
  const [qs, setQs] = useQueryState({ list: 'all', q: '', sort: 'newest' });
  const profiles = w.kind === 'profiles';
  const which = ['all', 'above', 'below', 'skipped', 'waiting'].includes(qs.list) ? qs.list : 'all';
  const sort = SORT_OPTIONS.some(o => o.value === qs.sort) ? qs.sort : 'newest';
  const params = new URLSearchParams({ list: which, sort });
  if (qs.q) params.set('q', qs.q);
  const list = useList(`/watcher/${encodeURIComponent(w.id)}?${params}`, { version });
  const counts = list.extra?.counts || {};
  const drawer = useOverlay('p');
  const actions = usePerformerActions({ ask, notify, refresh, onPatched: () => {}, onRegroup: () => {} });

  const extraWatcher = list.extra?.watcher;
  useEffect(() => { if (extraWatcher) onExtra(extraWatcher); }, [extraWatcher, onExtra]);

  const chips = [
    { id: 'all', label: 'All' },
    { id: 'above', label: 'Above the line' },
    { id: 'below', label: 'Below the line' },
    { id: 'skipped', label: profiles ? 'Not judged' : 'Skipped' },
    { id: 'waiting', label: 'Waiting' }
  ].filter(c => c.id !== 'waiting' || !profiles || counts.waiting > 0 || which === 'waiting');
  const whichLabel = chips.find(c => c.id === which)?.label || 'All';

  return (
    <>
      <SideGroup id="show" title="Show" icon={<FilterListIcon />} badge={qs.q ? 1 : 0} summary={qs.q ? '1 on' : 'no filters'} order={SIDE.show}>
        {subSwitch}
        <SideSearch value={qs.q} onChange={(q) => setQs({ q })} placeholder="Search names and titles" />
        <SideSelect label="Sort" value={sort} onChange={(next) => setQs({ sort: next })} options={SORT_OPTIONS} />
      </SideGroup>
      <SideGroup id="result" title="Result" icon={<ListAltIcon />} badge={which !== 'all' ? 1 : 0} summary={whichLabel} order={SIDE.list}>
        <SideList label="Result" value={which} onChange={(id) => setQs({ list: id })}
          items={chips.map(c => ({ id: c.id, label: c.label, count: counts[c.id] ?? null }))} />
      </SideGroup>
      <ContentLine title={w.label} meta={list.loaded ? [
        `${list.total.toLocaleString()} ${which === 'all' ? `${profiles ? 'profiles' : 'posts'} read` : whichLabel.toLowerCase()}`,
        `${list.items.length.toLocaleString()} shown`, sortText(sort)
      ].join(' · ') : 'Loading…'} />

      <StalePill list={list} />
      {list.error && <ListError error={list.error} onRetry={list.retry} />}
      {!list.loaded && !list.error && <LoadingState label="Loading…" />}
      {list.loaded && !list.error && !list.items.length && (
        <EmptyState title="Nothing here" description={qs.q || which !== 'all' ? 'Nothing matches the filters.' : 'Nothing yet.'} />
      )}

      {list.items.length > 0 && !isPhone && (
        <Panel padded={false} sx={{ overflowX: 'auto', maxWidth: '100%' }}>
          <Table size="small" sx={{ '& .MuiTableCell-root': { fontSize: '.8rem', borderColor: 'var(--line)', py: '6px' }, '& th': { color: 'var(--muted)', fontWeight: 600 } }}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Score</TableCell>
                <TableCell>Why</TableCell>
                <TableCell>Found</TableCell>
                <TableCell align="right"><span className="dw-sr">Actions</span></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.items.map((r, i) => (
                <TableRow key={rowKey(r, i)} hover>
                  <TableCell sx={{ minWidth: 180 }}>
                    <span className="dw-name">{rowName(r)}</span>
                    {rowSub(r) && <span className="dw-sub">{rowSub(r)}</span>}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}><ScoreText r={r} profiles={profiles} /></TableCell>
                  <TableCell sx={{ color: 'var(--dim)' }}>{r.skip_reason || ''}</TableCell>
                  <TableCell sx={{ color: 'var(--dim)', whiteSpace: 'nowrap' }}>{ago(r.found_at || r.posted_at)}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}><RowActions r={r} onOpen={drawer.open} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      {list.items.length > 0 && isPhone && (
        <Panel padded={false} sx={{ overflow: 'hidden' }}>
          <ul className="dw-rows">
            {list.items.map((r, i) => (
              <li key={rowKey(r, i)} className="dw-row">
                <div className="dw-row-1">
                  <span className="dw-name" title={rowName(r)}>{rowName(r)}</span>
                  <ScoreText r={r} profiles={profiles} />
                </div>
                <div className="dw-row-2">
                  <span className="dw-sub">
                    {[rowSub(r), r.skip_reason, ago(r.found_at || r.posted_at)].filter(Boolean).join(' · ')}
                  </span>
                  <RowActions r={r} onOpen={drawer.open} tall />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <LoadMore list={list} />

      <PerformerDrawerHost actions={actions} find={() => null} focusSource={w.source} focusLabel={w.label} sourceLabel={sourceLabel} />
    </>
  );
}

// ── one watcher ──────────────────────────────────────────────
/** The watcher's own section: its facts, its site, Run now (the page's main action). */
function WatcherSection({ w, watch, job, watchJob, running, onRun }) {
  const profiles = w.kind === 'profiles';
  const off = blocked(w, job, watchJob);
  const minutes = watch?.minutes ?? 20;
  const timer = w.watch ? `every ${minutes} min${watch?.on ? '' : ', timer off'}` : 'by hand';
  const checked = w.last_checked
    ? `${ago(w.last_checked)}${w.last_found != null ? ` · found ${w.last_found} new` : ''}`
    : 'not run yet';
  const paused = profiles && !!w.resume_page && !running;
  const state = running ? 'running' : w.last_error ? 'failed' : paused ? `paused at page ${w.resume_page}` : timer;
  return (
    <SideGroup id="watcher" title={w.label} icon={<VisibilityIcon />} dot={w.last_error ? 'bad' : null} summary={state} order={SIDE.page}>
      <SideFacts rows={[
        { label: 'Kind', value: profiles ? 'Profiles' : 'Posts' },
        { label: 'Timer', value: timer, tone: w.watch && watch?.on ? 'ok' : undefined },
        running && { label: 'Now', value: 'running', tone: 'accent' },
        {
          label: 'Checked', value: w.last_error ? `failed ${ago(w.last_checked)}` : checked, tone: w.last_error ? 'bad' : undefined,
          title: w.last_checked ? when(w.last_checked) : undefined
        },
        w.last_update && { label: 'Newest find', value: ago(w.last_update), title: when(w.last_update) },
        !profiles && w.backlog_done && { label: 'Older posts', value: 'all read' },
        paused && {
          label: 'Paused at', value: `page ${w.resume_page}`, tone: 'warn',
          title: `A run stopped part way: the next one goes on from page ${w.resume_page + 1}`
        }
      ]} />
      {w.last_error && <SideNote sx={{ color: 'var(--bad)', overflowWrap: 'anywhere' }}>{w.last_error}</SideNote>}
      {w.url && (
        <SideButtons>
          <SideButton component="a" href={w.url} target="_blank" rel="noreferrer" icon={<OpenInNewIcon />} tip={w.url}>{siteOf(w.url)}</SideButton>
        </SideButtons>
      )}
      <SideMain label={runLabel(w, running)} icon={<PlayArrowIcon />} disabled={off} busy={running} busyLabel="Running"
        tip={off ? blockedTip(w, job, watchJob) : w.watch === false ? 'It only runs by hand: it asks first' : 'Reads its site now'}
        onClick={() => onRun(w)} />
    </SideGroup>
  );
}

function WatcherDetail({ id, info, watch, job, watchJob, version, ask, notify, refresh, sourceLabel, isPhone, onRun }) {
  const navigate = useNavigate();
  const [qs, setQs] = useQueryState({ view: 'performers', q: '', sort: '', status: '', list: '' });
  const [extra, setExtra] = useState(null);
  useEffect(() => { setExtra(null); }, [id]);

  if (!info) {
    return (
      <div className="dw-detail">
        <ContentLine title="No such watcher" />
        <EmptyState title="No such watcher" description="It may have been removed or renamed."
          action={<SmallButton onClick={() => navigate('/discover/watchers', { replace: true })}>All watchers</SmallButton>} />
      </div>
    );
  }

  const w = { id, label: id, ...extra, ...info };   // the summary's is the newer one (it says where a profiles run goes on)
  const running = isRunning(w, job, watchJob);
  const sub = qs.view === 'read' ? 'read' : 'performers';
  const subSwitch = (
    <SideSegment label="Watcher views" value={sub}
      onChange={(view) => { if (view !== sub) setQs({ view, q: '', sort: '', status: '', list: '' }); }}
      options={[{ id: 'performers', label: 'Performers' }, { id: 'read', label: 'What it read' }]} />
  );

  const shared = { w, version, ask, notify, refresh, sourceLabel, isPhone, subSwitch };
  return (
    <div className="dw-detail">
      <WatcherSection w={w} watch={watch} job={job} watchJob={watchJob} running={running} onRun={onRun} />
      {sub === 'read'
        ? <WatcherRead key={`read:${id}`} {...shared} onExtra={setExtra} />
        : <WatcherPerformers key={`performers:${id}`} {...shared} runButton={<RunButton w={w} job={job} watchJob={watchJob} onRun={onRun} />} />}
    </div>
  );
}

export default function WatchersTab({ summary, watcherId, version, ask, notify, refresh, sourceLabel, isPhone }) {
  const navigate = useNavigate();
  const { watchers = [], watch, job, watchJob } = summary || {};

  // A watcher that only runs by hand (Leakhaven models: all ~5,500 creators) asks first, so a stray click doesn't start it
  const run = async (w) => {
    if (w.watch === false) {
      const place = w.resume_page ? ` It goes on from page ${w.resume_page + 1}.` : '';
      const ok = await ask({
        title: `Run ${w.label} now?`,
        text: `It only runs by hand and takes hours: it reads its whole list (judged ones are skipped).${place}`,
        okLabel: 'Run it'
      });
      if (!ok) return;
    }
    try {
      await post('/scan', { mode: 'watcher', watcher: w.id });
    } catch (e) {
      notify(e.message, 'error');
    }
    refresh();
  };

  if (!summary) return <LoadingState label="Loading…" />;
  if (watcherId) {
    return (
      <WatcherDetail id={watcherId} info={watchers.find(w => w.id === watcherId)} watch={watch} job={job} watchJob={watchJob}
        version={version} ask={ask} notify={notify} refresh={refresh} sourceLabel={sourceLabel} isPhone={isPhone} onRun={run} />
    );
  }
  const failed = watchers.filter(w => w.last_error).length;
  const byHand = watchers.filter(w => w.watch === false).length;
  const meta = [
    plural(watchers.length, 'watcher'),
    watchers.length - byHand ? `${watchers.length - byHand} on the timer` : null,
    byHand ? `${byHand} by hand` : null,
    failed ? `${failed} failed` : null
  ].filter(Boolean).join(' · ');
  return (
    <>
      <ContentLine title="Watchers" meta={meta} />
      {!watchers.length && <EmptyState title="No watchers" description="A watcher reads a site for new performers." />}
      <div className="dw-grid">
        {watchers.map(w => (
          <WatcherCard key={w.id} w={w} watch={watch} job={job} watchJob={watchJob} version={version} isPhone={isPhone}
            onOpen={(x) => navigate(`/discover/watchers/${encodeURIComponent(x.id)}`, { state: { fromGrid: true } })} onRun={run} />
        ))}
      </div>
    </>
  );
}
