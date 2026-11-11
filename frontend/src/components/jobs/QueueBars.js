/**
 * The queue-wide controls, one 40px line per queue: Funscript (funpipe), Labels + funscript (scenetest), Encoding.
 *
 *   <QueueBars jobs capped services kind compact busy onAction={({ key, url, body, message }) => …} onAdd />
 *
 * A bar shows while its kind is filtered, or (kind all) while that kind has queued or running rows; the funpipe bar
 * also while its queue is stopped with videos waiting. onAction posts the bar's request; onAdd opens Labels &
 * funscripts…. With kind funpipe or pipeline, one dim line says how the two engines differ.
 * Compact (below 700px): short labels, the facts without their 'Queue:' and 'Worker:' words, and only the main
 * button; Review editor and Add… are on the Funscripts page and in the page bar menu, Space in the services sheet.
 */
import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Panel, SPACE } from '../layout';
import { SmallButton } from '../discover/shared';
import { KIND_LABEL } from './kinds';
import { Dot, workerText } from './ServicesPanel';

/** Running and queued counts of a kind, with the rows the server left out of the list. */
function countsOf(kind, jobs, capped) {
  const extra = (status) => (capped || [])
    .filter(c => c.kind === kind && c.status === status)
    .reduce((sum, c) => sum + Math.max(0, (c.total || 0) - (c.shown || 0)), 0);
  const rows = jobs.filter(j => j.type === kind);
  return {
    running: rows.filter(j => j.status === 'running').length + extra('running'),
    queued: rows.filter(j => j.status === 'queued').length + extra('queued')
  };
}

const countText = ({ running, queued }) => `${running.toLocaleString()} running · ${queued.toLocaleString()} queued`;
/** Compact: only the counts that are not 0. */
const shortCount = ({ running, queued }) => [running ? `${running.toLocaleString()} running` : null, queued ? `${queued.toLocaleString()} queued` : null].filter(Boolean).join(' · ');
const SHORT_LABEL = { funpipe: 'Funscript', pipeline: 'Labels + funscript', encode: 'Encoding' };

function Bar({ tone, label, facts, children }) {
  const text = facts.filter(Boolean).join(' · ');
  return (
    <Panel padded={false} sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 40, px: 1.25, mb: SPACE.sm, minWidth: 0 }}>
      <Dot tone={tone} />
      <Box title={`${label} · ${text}`} sx={{
        flex: 1, minWidth: 0, fontSize: '.8125rem', color: 'var(--dim)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}>
        <Box component="b" sx={{ color: 'var(--text)', fontWeight: 600 }}>{label}</Box>
        {text ? ` · ${text}` : ''}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>{children}</Box>
    </Panel>
  );
}

export default function QueueBars({ jobs = [], capped = [], services, kind = 'all', compact = false, busy = false, onAction, onAdd }) {
  const fp = services?.funpipe || null;
  const st = services?.scenetest || null;
  const enc = services?.encode || null;

  const fpCounts = countsOf('funpipe', jobs, capped);
  const stCounts = countsOf('pipeline', jobs, capped);
  const encCounts = countsOf('encode', jobs, capped);
  const has = (c) => c.running + c.queued > 0;

  const fpPaused = fp ? !!(fp.paused ?? (fp.online && !fp.workerRunning)) : false;
  const showFunpipe = kind === 'funpipe' || (kind === 'all' && (has(fpCounts) || (fpPaused && fpCounts.queued > 0)));
  const showPipeline = kind === 'pipeline' || (kind === 'all' && has(stCounts));
  const showEncode = kind === 'encode' || (kind === 'all' && has(encCounts));

  // The review editor runs on acm-gpu: only asked about while the funpipe bar shows.
  const [editor, setEditor] = useState(null);
  useEffect(() => {
    if (!showFunpipe) return undefined;
    let alive = true;
    fetch('/api/funpipe/ui/status')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setEditor(d); })
      .catch(() => { if (alive) setEditor(null); });
    return () => { alive = false; };
  }, [showFunpipe]);

  const act = (key, url, body, message) => onAction && onAction({ key, url, body, message });

  const stOnline = !!st?.online;
  const encRunning = enc ? !!enc.running : null;

  return (
    <>
      {showFunpipe && (
        <Bar
          tone={!fp ? 'idle' : !fp.online ? 'off' : fpPaused ? 'warn' : 'ok'}
          label={compact ? SHORT_LABEL.funpipe : KIND_LABEL.funpipe}
          facts={compact ? [
            fp ? (fpPaused ? 'stopped' : 'open') : null,
            fp?.online ? 'worker online' : `worker ${workerText(fp)}`,
            shortCount(fpCounts)
          ] : [
            fp ? `Queue: ${fpPaused ? 'stopped' : 'open'}` : null,
            `Worker: ${workerText(fp)}`,
            countText(fpCounts),
            editor?.running && editor.url ? 'opens on the GPU PC' : null
          ]}
        >
          <SmallButton disabled={busy || !fp} onClick={() => (fpPaused
            ? act('funpipe', '/api/funpipe/queue/start', {}, 'The funscript queue is open')
            : act('funpipe', '/api/funpipe/queue/stop', {}, 'The funscript queue is stopped'))}>
            {fpPaused ? 'Open queue' : 'Stop queue'}
          </SmallButton>
          {compact ? null : editor?.running && editor.url ? (
            <SmallButton component="a" href={editor.url} target="_blank" rel="noreferrer"
              endIcon={<OpenInNewIcon sx={{ fontSize: '14px !important' }} />}>
              Review editor
            </SmallButton>
          ) : (
            <SmallButton component={RouterLink} to="/funpipe" tip="The review editor is not running: start it from the Funscripts page">
              Review editor
            </SmallButton>
          )}
        </Bar>
      )}

      {showPipeline && (
        <Bar
          tone={!st ? 'idle' : !stOnline ? 'off' : st.paused ? 'warn' : 'ok'}
          label={compact ? SHORT_LABEL.pipeline : KIND_LABEL.pipeline}
          facts={compact ? [
            !st ? 'checking…' : !stOnline ? 'offline' : st.paused ? 'paused' : 'running',
            shortCount(stCounts)
          ] : [
            st && stOnline ? `Queue: ${st.paused ? 'paused' : 'running'}` : null,
            !st ? 'checking scenetest…' : stOnline ? 'scenetest online' : 'scenetest offline',
            countText(stCounts)
          ]}
        >
          <SmallButton
            disabled={busy || !stOnline}
            tip={!stOnline ? 'scenetest is offline' : 'Pausing puts the current video back in the queue and frees the GPU'}
            onClick={() => act('pipeline', '/api/pipelines/pause', { on: !st.paused },
              st.paused ? 'Labels + funscript resumed' : 'Labels + funscript paused')}
          >
            {st?.paused ? 'Resume' : 'Pause'}
          </SmallButton>
          {!compact && <SmallButton onClick={onAdd}>Add…</SmallButton>}
        </Bar>
      )}

      {showEncode && (
        <Bar
          tone={!services ? 'idle' : !services.ffmpeg?.available ? 'off' : encRunning === false ? 'warn' : 'ok'}
          label={compact ? SHORT_LABEL.encode : KIND_LABEL.encode}
          facts={compact ? [
            !services ? null : !services.ffmpeg?.available ? 'FFmpeg not found' : encRunning == null ? null : encRunning ? 'running' : 'paused',
            shortCount(encCounts)
          ] : [
            encRunning == null ? null : `Queue: ${encRunning ? 'running' : 'paused'}`,
            !services ? null : services.ffmpeg?.available ? 'FFmpeg ready' : 'FFmpeg not found',
            countText(encCounts)
          ]}
        >
          {encRunning != null && (
            <SmallButton disabled={busy} onClick={() => (encRunning
              ? act('encode', '/api/encode/queue/pause', {}, 'Encoding paused')
              : act('encode', '/api/encode/queue/start', {}, 'Encoding started'))}>
              {encRunning ? 'Pause' : 'Start'}
            </SmallButton>
          )}
          {!compact && <SmallButton component={RouterLink} to="/settings/space">Space</SmallButton>}
        </Bar>
      )}

      {(kind === 'funpipe' || kind === 'pipeline') && (
        <Box sx={{ fontSize: '.75rem', color: 'var(--muted)', mb: SPACE.sm, px: 0.5 }}>
          Funscript (funpipe) writes one script per video on acm-gpu. Labels + funscript (scenetest) labels scenes first
          and is fed by the player, the performer pages and Labels &amp; funscripts…
        </Box>
      )}
    </>
  );
}
