/**
 * The things jobs depend on, and where new jobs start.
 *
 *   <ServicesList services jobs />    five lines with tone dots (funpipe worker, GPU, scenetest, FFmpeg, AI server)
 *   <StartLinks onPipeline />         Labels & funscripts… and the pages that start jobs
 *   servicesSummary(services, jobs)   one short line for the narrow strip
 *   gpuState(services, jobs)          { shared, warning, training } for the GPU line and the page's warning
 *   <RailItem />, railHeadSx          the rail's row and heading (also used for the kind list)
 */
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase } from '@mui/material';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import { KIND_ICON } from './kinds';

export const railHeadSx = {
  fontSize: '.75rem', fontWeight: 600, letterSpacing: '.05em',
  textTransform: 'uppercase', color: 'var(--muted)', mb: 0.5, px: 1
};

/** One rail row: icon, label, count. `dim` greys out a kind with no rows. */
export function RailItem({ active, icon, label, count, dim, onClick, ...rest }) {
  return (
    <ButtonBase onClick={onClick} aria-pressed={active == null ? undefined : !!active} {...rest} sx={{
      display: 'flex', alignItems: 'center', gap: 1, width: '100%', height: 32, justifyContent: 'flex-start',
      textAlign: 'left', borderRadius: 'var(--radius, 6px)', px: 1, fontSize: '.8125rem',
      color: active ? 'var(--text)' : dim ? 'var(--muted)' : 'var(--dim)',
      bgcolor: active ? 'var(--accent-quiet)' : 'transparent',
      boxShadow: active ? 'inset 2px 0 0 var(--accent)' : 'none',
      '&:hover': { bgcolor: active ? 'var(--accent-quiet)' : 'var(--raised)', color: 'var(--text)' },
      '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 },
      '& svg': { fontSize: 16, flexShrink: 0 }
    }}>
      {icon}
      <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Box>
      {count != null && (
        <Box component="span" sx={{ fontSize: '.75rem', color: dim ? 'var(--faint)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
          {count.toLocaleString()}
        </Box>
      )}
    </ButtonBase>
  );
}

const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', off: 'var(--bad)', idle: 'var(--faint)' };

export function Dot({ tone, sx }) {
  return <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: TONE[tone] || TONE.idle, display: 'inline-block', ...sx }} />;
}

export const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Whether the GPU is shared or busy, from the services answer and the running jobs. */
export function gpuState(services, jobs) {
  const list = jobs || [];
  const training = list.some(j => j.type === 'train' && j.status === 'running');
  const funpipe = list.some(j => j.type === 'funpipe' && j.status === 'running');
  return { training, shared: training && funpipe, warning: services?.gpu?.warning || null };
}

/** The funpipe worker in a few words: 'acm-gpu online', 'last seen 14:02', 'never seen'. */
export function workerText(fp) {
  if (!fp) return 'checking…';
  if (fp.online) return `${fp.worker || 'acm-gpu'} online`;
  if (fp.lastSeen) return `last seen ${clock(fp.lastSeen)}`;
  return 'never seen';
}

/** The five lines as [key, tone, label, value, title]. */
function lines(services, jobs) {
  const s = services;
  const fp = s?.funpipe;
  const st = s?.scenetest;
  const gpu = gpuState(s, jobs);
  const aiOnline = !!s?.ai?.online;
  const fpPaused = fp ? (fp.paused ?? (fp.online && !fp.workerRunning)) : false;
  return [
    ['funpipe', !fp ? 'idle' : !fp.online ? 'off' : fpPaused ? 'warn' : 'ok',
      'Funpipe worker', !fp ? 'checking…' : `${workerText(fp)}${fpPaused ? ' · queue stopped' : ''}`, fp?.url || ''],
    ['gpu', !s ? 'idle' : !aiOnline ? 'idle' : (gpu.training || gpu.shared || gpu.warning) ? 'warn' : 'ok',
      'GPU', !s ? 'checking…' : !aiOnline ? 'unknown' : gpu.training ? 'busy (training)' : (gpu.shared || gpu.warning) ? 'busy' : 'free', gpu.warning || ''],
    ['scenetest', !st ? 'idle' : !st.online ? 'off' : st.paused ? 'warn' : 'ok',
      'scenetest', !st ? 'checking…' : !st.online ? 'offline' : st.paused ? 'paused' : 'running', st?.error || st?.url || ''],
    ['ffmpeg', !s ? 'idle' : s.ffmpeg?.available ? 'ok' : 'off',
      'FFmpeg', !s ? 'checking…' : s.ffmpeg?.available ? 'ready' : 'not found', ''],
    ['ai', !s ? 'idle' : aiOnline ? 'ok' : 'off',
      'AI server', !s ? 'checking…' : aiOnline ? 'online' : 'offline', s?.ai?.url || '']
  ];
}

export function ServicesList({ services, jobs }) {
  return (
    <Box>
      {lines(services, jobs).map(([key, tone, label, value, title]) => (
        <Box key={key} title={title || undefined} sx={{
          display: 'flex', alignItems: 'center', gap: 1, height: 28, px: 1,
          fontSize: '.8125rem', color: 'var(--dim)', minWidth: 0
        }}>
          <Dot tone={tone} />
          <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ color: 'var(--text)' }}>{label}</Box> {value}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** One short line for the narrow strip: 'GPU busy (training) · worker online · FFmpeg ready'. */
export function servicesSummary(services, jobs) {
  if (!services) return 'Checking the services…';
  const s = services;
  const gpu = gpuState(s, jobs);
  const parts = [];
  if (s.ai?.online) parts.push(gpu.training ? 'GPU busy (training)' : (gpu.shared || gpu.warning) ? 'GPU busy' : 'GPU free');
  else parts.push('AI server offline');
  const fp = s.funpipe;
  if (fp) parts.push(fp.online ? 'worker online' : fp.lastSeen ? `worker last seen ${clock(fp.lastSeen)}` : 'worker never seen');
  if (s.scenetest) parts.push(s.scenetest.online ? (s.scenetest.paused ? 'scenetest paused' : 'scenetest online') : 'scenetest offline');
  parts.push(s.ffmpeg?.available ? 'FFmpeg ready' : 'FFmpeg not found');
  return parts.join(' · ');
}

/** The worst tone of the five lines, for the strip's dot. */
export function servicesTone(services, jobs) {
  if (!services) return 'idle';
  const tones = lines(services, jobs).map(l => l[1]);
  if (tones.includes('off')) return 'off';
  if (tones.includes('warn')) return 'warn';
  return 'ok';
}

const START = [
  ['import', 'Import a folder', '/local-import'],
  ['funpipe', 'Queue funscripts', '/funpipe'],
  ['hash', 'Build hash databases', '/performer-management?view=duplicates'],
  ['encode', 'Re-encode for space', '/settings/space'],
  ['discover', 'Discover performers', '/discover']
];

export function StartLinks({ onPipeline, onNavigate }) {
  return (
    <Box>
      <RailItem icon={<ViewTimelineIcon />} label="Labels & funscripts…" onClick={onPipeline} />
      {START.map(([kind, label, to]) => {
        const Icon = KIND_ICON[kind];
        return <RailItem key={to} icon={<Icon />} label={label} component={RouterLink} to={to} onClick={onNavigate} />;
      })}
    </Box>
  );
}
