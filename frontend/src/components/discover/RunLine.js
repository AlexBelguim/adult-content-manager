/**
 * What the Discover runs are doing, for the sidebar's Watch section (RunControls.js): runInfo(summary) reads the two run
 * slots (summary.job, started by hand, and summary.watchJob, the timer), how the newest run ended, when the timer runs
 * next and what is waiting; RunLog draws the run logs (the Log dialog); useTick re-renders every half minute so the
 * minutes and the "ago" texts count on between two summaries.
 */
import React, { useEffect, useState } from 'react';
import { ago } from './shared';
import './page.css';

const HAND = {
  scan: 'Scanning',
  backlog: 'Reading older posts',
  rescore: 'Re-judging',
  profiles: 'Judging profiles',
  pools: 'Judging pictures together'
};
const GOES_ON = 'the next run goes on from where it stopped';

const lastLine = (j) => (j?.log?.length ? j.log[j.log.length - 1] : '');
const thisRun = (j) => (j?.log || []).filter(l => /^This run/.test(l)).pop();
const time = (iso) => (iso ? new Date(iso).getTime() : 0);

function handLabel(job, watchers) {
  if (job.mode === 'watcher') return `Running ${watchers.find(w => w.id === job.watcher)?.label || job.watcher || 'a watcher'}`;
  return HAND[job.mode] || 'Scanning';
}

/** What Paused says comes next, by what the run was doing. */
function pausedText(j, watchers) {
  const w = j.watcher ? watchers.find(x => x.id === j.watcher) : null;
  const fromPage = (profilesWatcher) => {
    const page = profilesWatcher?.resume_page;
    return `Run now on the watcher goes on from ${page != null ? `page ${page + 1}` : 'where it stopped'}`;
  };
  switch (j.mode) {
    case 'profiles':
      return fromPage(w || watchers.find(x => x.kind === 'profiles' && x.resume_page != null) || watchers.find(x => x.kind === 'profiles'));
    case 'watcher': return w?.kind === 'profiles' ? fromPage(w) : GOES_ON;
    case 'backlog': return 'Older posts goes on from the last page it finished';
    case 'rescore': return 'Re-judge again goes on with the pictures left';
    case 'pools': return 'the next run scores the rest';
    default: return GOES_ON;
  }
}

/** How the newest run ended: { at, note, bad }; at is null when no run is known. */
function lastRunOf(slots, watchers) {
  const newest = slots.filter(s => s.j?.finishedAt).sort((a, b) => time(b.j.finishedAt) - time(a.j.finishedAt))[0];
  if (newest) {
    const { j } = newest;
    if (j.exitCode) return { at: j.finishedAt, bad: true, note: `Stopped: ${j.error || lastLine(j) || 'no reason given'}` };
    if (j.paused) return { at: j.finishedAt, note: `Paused: ${pausedText(j, watchers)}` };
    const line = thisRun(j);
    return { at: j.finishedAt, note: line ? line.replace(/^This run:?\s*/, '') : '' };
  }
  // Both slots blank, e.g. after the server restarted: the newest check a watcher made
  const last = watchers.map(w => w.last_checked).filter(Boolean).sort((a, b) => time(b) - time(a))[0];
  return { at: last || null, note: '' };
}

/** The timer, short: 'in 4 min', 'off', 'after the hand run', 'running'; null when not known. */
function nextOf(watch, watchJob) {
  if (!watch) return null;
  if (watch.waitingForHand) return 'after the hand run';
  if (!watch.on) return 'off';
  if (watchJob?.running) return 'running';
  if (watch.nextAt == null) return null;
  const at = typeof watch.nextAt === 'number' ? watch.nextAt : time(watch.nextAt);
  return `in ${Math.max(1, Math.ceil((at - Date.now()) / 60000))} min`;
}

/**
 * Everything the Watch section says about the runs:
 * { running: [{ key, label, line, j }], last: { at, ago, note, bad }, next, notes: [{ label, value, tone, title }], logs }.
 */
export function runInfo(summary) {
  const { job = {}, watchJob = {}, watch, totals = {}, outbox } = summary || {};
  const watchers = summary?.watchers || [];
  const slots = [
    { key: 'hand', j: job, label: handLabel(job, watchers), head: 'Run by hand' },
    { key: 'timer', j: watchJob, label: 'Timer run', head: 'Timer' }
  ];
  const running = slots.filter(s => s.j?.running).map(s => ({ ...s, line: lastLine(s.j) }));
  const last = lastRunOf(slots, watchers);
  last.ago = last.at ? ago(last.at) : 'none yet';
  const notes = [];
  if (totals.waiting > 0) {
    notes.push({
      label: 'Waiting for P', value: totals.waiting.toLocaleString(), tone: 'warn',
      title: 'Saved but not judged: neither acm-gpu nor the NAS CPU service answered. A later run judges them'
    });
  }
  if (outbox?.queued > 0) {
    notes.push({
      label: 'Not on the profile page yet', value: outbox.queued.toLocaleString(), tone: outbox.failing ? 'bad' : undefined,
      title: 'Tried again after each run'
    });
  }
  return { running, last, next: nextOf(watch, watchJob), notes, logs: slots.filter(s => s.j?.log?.length) };
}

/** Re-renders every half minute: the minutes and the "ago" texts count on between two summaries. */
export function useTick() {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
}

/** The logs of the two run slots (the Log dialog). */
export function RunLog({ logs }) {
  if (!logs.length) return <p className="dp-log-none">No run has written a log since the server started.</p>;
  return (
    <div className="dp-log">
      {logs.map(s => (
        <div key={s.key}>
          <div className="dp-log-head">
            {s.head}
            {s.j.secondsPerPicture != null && ` · NAS CPU: ${Number(s.j.secondsPerPicture).toFixed(1)} s a picture`}
          </div>
          <pre>{s.j.log.join('\n')}</pre>
        </div>
      ))}
    </div>
  );
}

export default RunLog;
