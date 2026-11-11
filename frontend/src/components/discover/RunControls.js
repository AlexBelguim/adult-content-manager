/**
 * The Discover page's run controls: the keep line, the watch timer, Older posts, Re-judge and Scan now.
 *
 *   layout="bar"   an inline row for the PC header, with tooltips
 *   layout="sheet" the phone's Runs sheet (a bottom drawer, open while the URL has sheet=runs), each control with a
 *                  visible one-line description under it
 *
 * act(path, body) POSTs, reloads the summary and says a refusal in a toast; it answers true when the POST went through.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Switch, Tooltip } from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { useOverlay } from './shared';
import './page.css';

/** A number that takes effect when you leave the field or press Enter; anything out of range goes back. */
function NumberField({ value, min, max, whole, label, large, onCommit }) {
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
    <input type="number" inputMode={whole ? 'numeric' : 'decimal'} min={min} max={max} aria-label={label} value={text}
      className={`dp-num${large ? ' lg' : ''}`}
      onChange={(e) => setText(e.target.value)} onFocus={() => { focused.current = true; }} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

/**
 * A header button with a tooltip that still shows while it is disabled. Outlined and contained are the same box (32px, a
 * 1px border), so Scan now is no bigger than Older posts and Re-judge.
 */
function RunButton({ tip, contained, children, ...rest }) {
  return (
    <Tooltip title={tip}>
      <span className="dp-tip">
        <Button size="small" variant={contained ? 'contained' : 'outlined'} disableElevation
          className={`dp-run-btn ${contained ? 'contained' : 'outlined'}`} {...rest}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}

export default function RunControls({ summary, layout = 'bar', ask, notify, act }) {
  const sheet = useOverlay('sheet');
  const run = summary.run || {};
  const watch = summary.watch || {};
  const totals = summary.totals || {};
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
  const isSheet = layout === 'sheet';

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
    if (isSheet) sheet.close();
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
    if (isSheet) sheet.close();
    await act('/scan', { mode: 'rescore' });
  };

  const lineText = 'P likes a picture at this score or above. Liked follows at once.';
  const watchText = `Runs the watched sites every ${minutes} min. Switching it on starts a run now.`;
  const olderText = next ? `Reads up to 300 older posts, starting with ${next}.` : 'Every site was read to the end.';
  const rejudgeText = n ? `Judges again the ${n.toLocaleString()} posts and profiles judged by another model.` : 'Everything is judged by the current model.';

  const lineField = (
    <NumberField label="Keep line" value={threshold} min={0} max={100} large={isSheet} onCommit={setLine} />
  );
  const watchSwitch = (
    <Switch size={isSheet ? 'medium' : 'small'} checked={!!watch.on} inputProps={{ 'aria-label': 'Watch: run the watched sites on a timer' }}
      onChange={(e) => setWatch(e.target.checked, minutes)} />
  );
  const minutesField = (
    <NumberField label="Minutes between runs" value={minutes} min={5} max={1440} whole large={isSheet}
      onCommit={(mins) => setWatch(!!watch.on, mins)} />
  );

  if (!isSheet) {
    return (
      <>
        <Tooltip title={lineText}>
          <label className="dp-ctl">Keep at {lineField}+</label>
        </Tooltip>
        <Tooltip title={watchText}>
          <span className="dp-ctl sw">{watchSwitch}Watch every {minutesField} min</span>
        </Tooltip>
        <RunButton startIcon={<ArrowDownwardIcon />} disabled={busy || !next} onClick={olderPosts}
          tip={next ? `${olderText.replace(/\.$/, '')}${notNow}` : olderText}>
          Older posts
        </RunButton>
        <RunButton startIcon={<RefreshIcon />} disabled={busy || !n} onClick={reJudge}
          tip={n ? `${rejudgeText.replace(/\.$/, '')}${notNow}` : rejudgeText}>
          Re-judge
        </RunButton>
        <RunButton contained startIcon={<SearchIcon />} disabled={busy} onClick={() => act('/scan', {})}
          tip={`Runs every watcher on watch now${notNow}`}>
          Scan now
        </RunButton>
      </>
    );
  }

  const busyNote = busy ? ' Not while a run is going.' : '';
  return (
    <Drawer anchor="bottom" open={sheet.value === 'runs'} onClose={() => sheet.close()}
      PaperProps={{ className: 'dp-sheet', role: 'dialog', 'aria-label': 'Runs' }}>
      <div className="dp-sheet-head">
        <h2>Runs</h2>
        <Button variant="outlined" className="dp-run-btn outlined lg" onClick={() => sheet.close()}>Close</Button>
      </div>

      <div className="dp-sheet-row">
        <label className="dp-sheet-ctl">Keep at {lineField}+</label>
        <p className="dp-sheet-desc">{lineText}</p>
      </div>

      <div className="dp-sheet-row">
        <span className="dp-sheet-ctl">{watchSwitch}Watch every {minutesField} min</span>
        <p className="dp-sheet-desc">{watchText}</p>
      </div>

      <div className="dp-sheet-row">
        <Button variant="outlined" className="dp-run-btn outlined lg" startIcon={<ArrowDownwardIcon />} disabled={busy || !next} onClick={olderPosts}>
          Older posts
        </Button>
        <p className="dp-sheet-desc">{olderText}{next ? busyNote : ''}</p>
      </div>

      <div className="dp-sheet-row">
        <Button variant="outlined" className="dp-run-btn outlined lg" startIcon={<RefreshIcon />} disabled={busy || !n} onClick={reJudge}>
          Re-judge
        </Button>
        <p className="dp-sheet-desc">{rejudgeText}{n ? busyNote : ''}</p>
      </div>
    </Drawer>
  );
}
