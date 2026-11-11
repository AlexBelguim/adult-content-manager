/**
 * The Discover sidebar's Watch section (SideGroup 'watch'): the keep line, the watch timer, what the runs are doing (the
 * facts), Pause while a run goes, Scan now (the page's main action), Older posts, Re-judge and the Log. On a phone it is
 * in the Filters sheet; on the rail it is one icon with a dot (a watcher failed, or the timer is on).
 *
 *   compact   the short version (the Duplicates view): the keep line, the last and next run, Scan now
 *   main      false: Scan now is a plain button, for a view with a main action of its own (one watcher's Run now)
 *
 * act(path, body) POSTs, reloads the summary and says a refusal in a toast; it answers true when the POST went through.
 */
import React, { useEffect, useRef, useState } from 'react';
import { CircularProgress, Switch } from '@mui/material';
import RadarOutlinedIcon from '@mui/icons-material/RadarOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { SIDE, SideButton, SideButtons, SideFacts, SideField, SideGroup, SideMain, SideNote } from '../layout';
import { AppDialog } from '../ui';
import { when } from './shared';
import { runInfo, RunLog, useTick } from './RunLine';
import './page.css';

/** A number that takes effect when you leave the field or press Enter; anything out of range goes back. */
function NumberField({ value, min, max, whole, label, title, onCommit }) {
  const [text, setText] = useState(String(value ?? ''));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value ?? '')); }, [value]);
  const commit = () => {
    focused.current = false;
    const n = Number(text);
    const bad = text.trim() === '' || !Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n));
    if (bad) return setText(String(value ?? ''));
    if (n !== value) onCommit(n);
  };
  return (
    <input type="number" inputMode={whole ? 'numeric' : 'decimal'} min={min} max={max} aria-label={label} title={title} value={text}
      className="dp-num side"
      onChange={(e) => setText(e.target.value)} onFocus={() => { focused.current = true; }} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

const percent = (part, whole) => (whole ? `${Math.round(part / whole * 100)}%` : '');

export default function RunControls({ summary, ask, notify, act, compact = false, main = true }) {
  useTick();
  const [logOpen, setLogOpen] = useState(false);
  const [pausing, setPausing] = useState(null);

  const run = summary.run || {};
  const watch = summary.watch || {};
  const totals = summary.totals || {};
  const watchers = summary.watchers || [];
  const threshold = summary.threshold ?? run.threshold ?? 50;
  const minutes = watch.minutes ?? 20;
  const busy = !!(summary.job?.running || summary.watchJob?.running);
  const notNow = busy ? ' (a run is going)' : '';
  const next = summary.backlog?.next || null;
  const rejudge = totals.rejudge || {};
  const posts = rejudge.posts || 0;
  const profiles = rejudge.profiles || 0;
  const n = posts + profiles;
  const model = rejudge.model || run.current_model || 'the current one';
  const modelName = run.current_model || (run.models || []).join(', ') || '';
  const info = runInfo(summary);
  const failed = watchers.filter(w => w.last_error);

  const setLine = (value) => act('/settings', { threshold: value });

  const setWatch = async (on, mins) => {
    const ok = await act('/watch', { on, minutes: mins });
    if (ok && on && !watch.on) notify(`Watch on: a run starts now, then every ${mins} min.`, 'info');
  };

  const olderPosts = async () => {
    const yes = await ask({
      title: 'Read older posts?',
      text: `Reads up to 300 posts older than any read so far, starting with ${next}. Sites read to the end are skipped.`,
      okLabel: 'Read'
    });
    if (!yes) return;
    await act('/scan', { mode: 'backlog' });
  };

  const reJudge = async () => {
    const yes = await ask({
      title: `Re-judge ${n.toLocaleString()} pictures?`,
      text: `P judges again the ${posts.toLocaleString()} posts and ${profiles.toLocaleString()} profiles last judged by another model than ${model}. `
        + 'Scores and Liked can change. Pause stops it; starting again goes on with the ones left.',
      okLabel: 'Re-judge'
    });
    if (!yes) return;
    await act('/scan', { mode: 'rescore' });
  };

  const pause = async (slot) => {
    setPausing(slot);
    try { await act('/pause', { slot }); } finally { setPausing(null); }
  };

  const lineText = 'P likes a picture at this score or above. Liked follows at once.';
  const watchText = `Runs the watched sites every ${minutes} min. Switching it on starts a run now.`;
  const olderText = next ? `Reads up to 300 older posts, starting with ${next}` : 'Every site was read to the end';
  const rejudgeText = n ? `Judges again the ${n.toLocaleString()} posts and profiles judged by another model` : 'Everything is judged by the current model';
  const scanTip = `Runs every watcher on watch now${notNow}`;
  const scan = () => act('/scan', {});

  // The rail's icon: a dot for a failed watcher or the timer on; its tooltip and the flyout's head say the state
  const dot = failed.length ? 'bad' : watch.on ? 'ok' : null;
  const state = info.running.length
    ? `${info.running.map(s => s.label).join(', ')}…`
    : !watch.on ? 'off'
      : info.next === 'after the hand run' ? 'on, runs after the hand run'
        : info.next ? `on, next run ${info.next}` : 'on';
  const summaryText = failed.length ? `${state}, ${failed.length === 1 ? `${failed[0].label} failed` : `${failed.length} watchers failed`}` : state;

  const checked = watchers.reduce((s, w) => s + (w.checked || 0), 0);
  const kept = watchers.reduce((s, w) => s + (w.kept || 0), 0);
  const now = info.running.map(s => ({
    key: `now-${s.key}`,
    label: info.running.length === 1 ? 'Now' : s.key === 'hand' ? 'By hand' : 'Timer',
    value: (
      <span className="dp-now">
        <CircularProgress size={12} thickness={6} sx={{ color: 'var(--accent)', flex: 'none' }} aria-hidden />
        {s.label}
      </span>
    ),
    title: s.line || undefined
  }));
  const rows = [
    compact && { label: 'Keep line', value: threshold, title: lineText },
    ...now,
    { label: 'Last run', value: info.last.ago, tone: info.last.bad ? 'bad' : undefined, title: info.last.at ? when(info.last.at) : undefined },
    info.next && { label: 'Next run', value: info.next },
    !compact && { label: 'Judged', value: checked.toLocaleString(), title: `Checked by ${watchers.length} watchers: judged or skipped` },
    !compact && { label: 'Kept by P', value: `${kept.toLocaleString()}${checked ? ` · ${percent(kept, checked)}` : ''}`, tone: 'ok', title: 'At or above the line, of judged' },
    !compact && { label: 'New liked', value: (totals.new_performers || 0).toLocaleString(), tone: 'accent', title: 'Liked and not in the library yet' },
    !compact && { label: 'With profile data', value: (totals.performers_with_data || 0).toLocaleString() },
    !compact && modelName && { label: 'P model', value: modelName },
    ...info.notes
  ];
  // Under the facts: what the run is doing now, else how the last one ended
  const notes = info.running.length
    ? info.running.filter(s => s.line).map(s => ({ key: s.key, text: s.line }))
    : info.last.note ? [{ key: 'last', text: info.last.note, bad: info.last.bad }] : [];

  return (
    <SideGroup id="watch" title="Watch · P model" icon={<RadarOutlinedIcon />} dot={dot} summary={summaryText} order={SIDE.page + 1}>
      {!compact && (
        <>
          <SideField label="Keep at">
            <NumberField label="Keep line" title={lineText} value={threshold} min={0} max={100} onCommit={setLine} />
          </SideField>
          <SideField label="Every">
            <NumberField label="Minutes between runs" title={watchText} value={minutes} min={5} max={1440} whole
              onCommit={(mins) => setWatch(!!watch.on, mins)} />
            <span>min</span>
            <Switch size="small" checked={!!watch.on} title={watchText}
              inputProps={{ 'aria-label': 'Watch: run the watched sites on a timer' }}
              onChange={(e) => setWatch(e.target.checked, minutes)} />
          </SideField>
        </>
      )}
      <SideFacts rows={rows} />
      {notes.map(x => (
        <SideNote key={x.key} sx={{ overflowWrap: 'anywhere', ...(x.bad && { color: 'var(--bad)' }) }}>{x.text}</SideNote>
      ))}
      {info.running.length > 0 && (
        <SideButtons columns={info.running.length}>
          {info.running.map(s => (
            <SideButton key={s.key} disabled={pausing === s.key} onClick={() => pause(s.key)}
              tip={`Stops this run. ${s.j.mode === 'rescore' ? 'Re-judge goes on with the pictures left.' : 'The next run goes on from where it stopped.'}`}>
              {info.running.length === 1 ? 'Pause' : s.key === 'hand' ? 'Pause hand run' : 'Pause timer run'}
            </SideButton>
          ))}
        </SideButtons>
      )}
      {main
        ? <SideMain label="Scan now" icon={<SearchIcon />} disabled={busy} tip={scanTip} onClick={scan} />
        : <SideButtons><SideButton icon={<SearchIcon />} disabled={busy} tip={scanTip} onClick={scan}>Scan now</SideButton></SideButtons>}
      {!compact && (
        <>
          <SideButtons columns={2}>
            <SideButton disabled={busy || !next} onClick={olderPosts} tip={next ? `${olderText}${notNow}` : olderText}>Older posts</SideButton>
            <SideButton disabled={busy || !n} onClick={reJudge} tip={n ? `${rejudgeText}${notNow}` : rejudgeText}>Re-judge</SideButton>
          </SideButtons>
          <SideButtons>
            <SideButton plain aria-haspopup="dialog" onClick={() => setLogOpen(true)}>Log</SideButton>
          </SideButtons>
        </>
      )}
      <AppDialog open={logOpen} onClose={() => setLogOpen(false)} title="Log" subtitle={summaryText} size="md" cancelLabel="Close">
        <RunLog logs={info.logs} />
      </AppDialog>
    </SideGroup>
  );
}
