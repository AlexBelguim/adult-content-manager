/**
 * The Discover page's run line, always on screen: what the runs are doing or how the last one ended, when the timer runs
 * next, what is waiting, and Pause and Log.
 *
 *   [spinner] <activity> · <timer> · <notes>      [Pause] [Log]
 *
 * The two run slots are summary.job (started by hand) and summary.watchJob (the timer). On a phone the activity takes the
 * first line and the timer and notes the second.
 */
import React, { useEffect, useState } from 'react';
import { CircularProgress } from '@mui/material';
import { Panel, SPACE } from '../layout';
import { ago, SmallButton } from './shared';
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

/** The activity part: the running slots, else how the newest run ended. */
function activityOf(slots, watchers) {
  const running = slots.filter(s => s.j?.running);
  if (running.length) {
    return { spin: true, text: running.map(s => `${s.label}… ${lastLine(s.j)}`.trim()).join(' · ') };
  }
  const newest = slots.filter(s => s.j?.finishedAt).sort((a, b) => time(b.j.finishedAt) - time(a.j.finishedAt))[0];
  if (newest) {
    const { j } = newest;
    const when = ago(j.finishedAt);
    if (j.exitCode) return { bad: true, text: `Stopped ${when}: ${j.error || lastLine(j) || 'no reason given'}` };
    if (j.paused) return { text: `Paused ${when}: ${pausedText(j, watchers)}` };
    const line = thisRun(j);
    return { text: `Last run ${when}${line ? `: ${line.replace(/^This run:?\s*/, '')}` : ''}` };
  }
  // Both slots blank, e.g. after the server restarted: the newest check a watcher made
  const last = watchers.map(w => w.last_checked).filter(Boolean).sort((a, b) => time(b) - time(a))[0];
  return { text: last ? `Last run ${ago(last)}` : 'No run yet' };
}

function timerOf(watch, watchJob) {
  if (!watch) return null;
  if (watch.waitingForHand) return 'Timer waits for the run started by hand';
  if (!watch.on) return 'Timer off';
  if (watchJob?.running || watch.nextAt == null) return null;
  const at = typeof watch.nextAt === 'number' ? watch.nextAt : time(watch.nextAt);
  return `Next run in ${Math.max(1, Math.ceil((at - Date.now()) / 60000))} min`;
}

export default function RunLine({ summary, onPause }) {
  const [logOpen, setLogOpen] = useState(false);
  const [pausing, setPausing] = useState(null);
  const [, setNow] = useState(0);
  // The minutes and the "ago" texts count on between two summaries
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const { job = {}, watchJob = {}, watch, totals = {}, outbox } = summary;
  const watchers = summary.watchers || [];
  const slots = [
    { key: 'hand', j: job, label: handLabel(job, watchers), head: 'Run by hand' },
    { key: 'timer', j: watchJob, label: 'Timer run', head: 'Timer' }
  ];
  const running = slots.filter(s => s.j?.running);
  const activity = activityOf(slots, watchers);

  const rest = [];
  const timer = timerOf(watch, watchJob);
  if (timer) rest.push({ text: timer });
  if (totals.waiting > 0) {
    rest.push({
      text: `${totals.waiting.toLocaleString()} waiting for P`, tone: 'warn',
      title: 'Saved but not judged: neither acm-gpu nor the NAS CPU service answered. A later run judges them'
    });
  }
  if (outbox?.queued > 0) {
    rest.push({
      text: `${outbox.queued.toLocaleString()} not on the profile page yet`, tone: outbox.failing ? 'bad' : undefined,
      title: 'Tried again after each run'
    });
  }
  const full = [activity.text, ...rest.map(r => r.text)].join(' · ');
  const logs = slots.filter(s => s.j?.log?.length);

  const pause = async (slot) => {
    setPausing(slot);
    try { await onPause(slot); } finally { setPausing(null); }
  };

  return (
    <Panel padded={false} className={`dp-run${activity.bad ? ' bad' : ''}`}
      sx={{ p: '10px 12px', mb: SPACE.md, ...(activity.bad && { borderColor: 'var(--bad)' }) }}>
      <div className="dp-run-row">
        {activity.spin && <CircularProgress size={14} sx={{ color: 'var(--accent)', flex: 'none' }} aria-label="A run is going" />}
        <div className="dp-run-text" title={full}>
          <span className={`dp-run-activity${activity.bad ? ' bad' : ''}`}>{activity.text}</span>
          {rest.length > 0 && (
            <span className="dp-run-rest">
              {rest.map(r => (
                <React.Fragment key={r.text}>
                  <span className="dp-sep" aria-hidden="true">·</span>
                  <span className={r.tone ? `dp-tone-${r.tone}` : undefined} title={r.title}>{r.text}</span>
                </React.Fragment>
              ))}
            </span>
          )}
        </div>
        {(running.length > 0 || logs.length > 0) && (
          <div className="dp-run-btns">
            {running.map(s => (
              <SmallButton key={s.key} disabled={pausing === s.key} onClick={() => pause(s.key)}
                tip={`Stops this run. ${s.j.mode === 'rescore' ? 'Re-judge goes on with the pictures left.' : 'The next run goes on from where it stopped.'}`}>
                {running.length === 1 ? 'Pause' : s.key === 'hand' ? 'Pause hand run' : 'Pause timer run'}
              </SmallButton>
            ))}
            {logs.length > 0 && (
              <SmallButton aria-expanded={logOpen} onClick={() => setLogOpen(o => !o)}
                sx={{ borderColor: 'transparent', color: 'var(--dim)', '&:hover': { borderColor: 'transparent', bgcolor: 'var(--raised)' } }}>
                {logOpen ? 'Hide log' : 'Log'}
              </SmallButton>
            )}
          </div>
        )}
      </div>
      {logOpen && logs.length > 0 && (
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
      )}
    </Panel>
  );
}
