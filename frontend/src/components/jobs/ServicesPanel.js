/**
 * The things jobs depend on, and where new jobs start. The Jobs page shows both in its sidebar (Services, Start).
 *
 *   <ServicesList services jobs />    five lines with tone dots (funpipe worker, GPU, scenetest, FFmpeg, AI server)
 *   <StartLinks onPipeline />         Labels & funscripts… and the pages that start jobs, as sidebar buttons
 *   servicesSummary(services, jobs)   one short line: 'GPU free · worker online · FFmpeg ready'
 *   servicesShort(services, jobs)     a few words for the rail: '2 offline', '1 warning', 'all running'
 *   servicesTone(services, jobs)      the worst tone: 'off' | 'warn' | 'ok' | 'idle'
 *   gpuState(services, jobs)          { shared, warning, training } for the GPU line and the page's warning
 */
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { SideButtons, SideButton } from '../layout';

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
    <Box role="list" aria-label="Services" sx={{ minWidth: 0 }}>
      {lines(services, jobs).map(([key, tone, label, value, title]) => (
        <Box key={key} role="listitem" title={title || undefined} sx={{
          display: 'flex', alignItems: 'center', gap: '8px', height: 26, px: '8px',
          fontSize: 13, color: 'var(--dim)', minWidth: 0
        }}>
          <Dot tone={tone} sx={{ width: 7, height: 7 }} />
          <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label} <Box component="span" sx={{ color: 'var(--muted)' }}>{value}</Box>
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

/** A few words for the rail's tooltip and the flyout's head: '2 offline', '1 warning', 'all running'. */
export function servicesShort(services, jobs) {
  if (!services) return 'checking';
  const tones = lines(services, jobs).map(l => l[1]);
  const off = tones.filter(t => t === 'off').length;
  const warn = tones.filter(t => t === 'warn').length;
  if (off) return `${off} offline${warn ? ` · ${warn} warning${warn === 1 ? '' : 's'}` : ''}`;
  if (warn) return `${warn} warning${warn === 1 ? '' : 's'}`;
  return 'all running';
}

const START = [
  ['Import a folder', '/local-import'],
  ['Build hash databases', '/performer-management?view=duplicates'],
  ['Re-encode for space', '/settings/space']
];

/** Where new jobs start: the pipeline dialog first, then the pages that start the other kinds. */
export function StartLinks({ onPipeline, onNavigate }) {
  return (
    <SideButtons>
      <SideButton onClick={onPipeline}>Labels &amp; funscripts…</SideButton>
      {START.map(([label, to]) => (
        <SideButton key={to} plain component={RouterLink} to={to} onClick={onNavigate}>{label}</SideButton>
      ))}
    </SideButtons>
  );
}
