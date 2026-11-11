/**
 * JobsIndicator — the app bar's Jobs item: 'N running' (a spinner), else 'M queued' (an accent dot), else 'No jobs'
 * (a green dot); '· K failed' in red when anything failed; 'Offline' when the server does not answer. Its popover
 * lists the failed and the running jobs, each a link to that row on the Jobs page.
 *
 * barGhostSx is the one style of the bar's right-hand items (Jobs, Handy, More): no border, no box, a hover background.
 *
 * Reads the shared jobs store (hooks/useJobs), slower than the page: it is on every screen.
 */
import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Button, Popover, CircularProgress } from '@mui/material';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import useJobs from '../hooks/useJobs';
import { iconOf, jobPercent, JobBar } from './jobs/kinds';

/** The bar's right-hand items: Jobs, the Handy gear and More. */
export const barGhostSx = (active = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0, height: 32, minWidth: 0, px: '10px',
  border: 0, bgcolor: 'transparent', borderRadius: 'var(--radius)', boxShadow: 'none',
  fontSize: 13, fontWeight: 500, fontFamily: 'inherit', lineHeight: 1, textTransform: 'none', whiteSpace: 'nowrap',
  color: active ? 'var(--text)' : 'var(--dim)', fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
  '& .MuiSvgIcon-root': { fontSize: 18 },
  '& .MuiButton-startIcon': { m: 0 },
  '& .MuiButton-startIcon > .MuiSvgIcon-root': { fontSize: 18 },
  '&:hover': { bgcolor: 'var(--raised)', color: 'var(--text)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '2px' }
});

const barDot = (color) => (
  <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
);

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const jobLink = (id) => `/jobs?job=${encodeURIComponent(id)}`;

const headSx = {
  fontSize: '.75rem', fontWeight: 600, letterSpacing: '.05em',
  textTransform: 'uppercase', color: 'var(--muted)', mt: 1, mb: 0.25
};

const rowSx = {
  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', height: 44, px: 1, mx: -1,
  borderRadius: 'var(--radius, 6px)', color: 'var(--text)', textDecoration: 'none',
  '&:hover': { bgcolor: 'var(--raised)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
};

const ellipsis = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** The rows of a status the server left out of the list (its capped tails). */
const cappedExtra = (capped, status) => (capped || [])
  .filter(c => c.status === status)
  .reduce((s, c) => s + Math.max(0, (c.total || 0) - (c.shown || 0)), 0);

export default function JobsIndicator() {
  const [anchor, setAnchor] = useState(null);
  const { jobs, capped, error, updatedAt } = useJobs({ activeMs: 5000, idleMs: 30000 });

  const running = jobs.filter(j => j.status === 'running');
  const failed = jobs.filter(j => j.status === 'failed');
  const runningN = running.length + cappedExtra(capped, 'running');
  const queuedN = jobs.filter(j => j.status === 'queued').length + cappedExtra(capped, 'queued');
  const failedN = failed.length + cappedExtra(capped, 'failed');
  const offline = !!error;
  const busy = runningN > 0;

  const close = () => setAnchor(null);

  let icon = barDot('var(--ok)');
  let label;
  if (offline) {
    icon = <CloudOffIcon sx={{ color: 'var(--warn)' }} />;
    label = 'Offline';
  } else if (busy) {
    icon = <CircularProgress size={12} thickness={6} sx={{ color: 'var(--accent)', flexShrink: 0 }} />;
    label = `${runningN.toLocaleString()} running`;
  } else if (queuedN > 0) {
    icon = barDot('var(--accent)');
    label = `${queuedN.toLocaleString()} queued`;
  } else {
    label = 'No jobs';
  }

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={`Background jobs: ${label}${failedN ? `, ${failedN} failed` : ''}`}
        aria-haspopup="dialog"
        sx={barGhostSx(!!anchor)}
      >
        {icon}
        <Box component="span">{label}</Box>
        {failedN > 0 && (
          <Box component="span" sx={{ color: 'var(--bad)' }}>· {failedN.toLocaleString()} failed</Box>
        )}
      </ButtonBase>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1, p: 1.5, pt: 0.5, width: 'min(360px, calc(100vw - 28px))',
              bgcolor: 'var(--overlay)', backgroundImage: 'none', color: 'var(--text)',
              border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg, 10px)',
              boxShadow: 'var(--shadow-lg)'
            }
          }
        }}
      >
        {offline && (
          <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 44, fontSize: '.8125rem', color: 'var(--warn)' }}>
            <CloudOffIcon sx={{ fontSize: 16, flexShrink: 0 }} />
            <Box component="span" sx={ellipsis}>
              Can't reach the server{updatedAt ? `, last update ${clock(updatedAt)}` : ''}
            </Box>
          </Box>
        )}

        {failed.length > 0 && (
          <>
            <Box sx={headSx}>Failed</Box>
            {failed.slice(0, 3).map(j => {
              const Icon = iconOf(j.type);
              return (
                <Box key={j.id} component={RouterLink} to={jobLink(j.id)} onClick={close} sx={rowSx}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '.8125rem', minWidth: 0 }}>
                    <Icon sx={{ fontSize: 15, color: 'var(--dim)', flexShrink: 0 }} />
                    <Box component="span" title={j.title} sx={{ ...ellipsis, fontWeight: 600 }}>{j.title}</Box>
                  </Box>
                  <Box sx={{ ...ellipsis, fontSize: '.75rem', color: 'var(--bad)', pl: '23px' }}>{j.error || 'failed'}</Box>
                </Box>
              );
            })}
            {failedN > 3 && (
              <Box component={RouterLink} to="/jobs?state=failed" onClick={close} sx={{
                ...rowSx, height: 32, fontSize: '.8125rem', color: 'var(--accent)'
              }}>
                Show all {failedN.toLocaleString()} failed
              </Box>
            )}
          </>
        )}

        <Box sx={headSx}>Running</Box>
        {running.length === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', height: 32, fontSize: '.8125rem', color: 'var(--muted)' }}>Nothing running</Box>
        )}
        {running.slice(0, 4).map(j => {
          const Icon = iconOf(j.type);
          const pct = jobPercent(j);
          return (
            <Box key={j.id} component={RouterLink} to={jobLink(j.id)} onClick={close} sx={rowSx}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '.8125rem', minWidth: 0 }}>
                <Icon sx={{ fontSize: 15, color: 'var(--dim)', flexShrink: 0 }} />
                <Box component="span" title={j.title} sx={{ ...ellipsis, flex: 1, fontWeight: 600 }}>{j.title}</Box>
                {pct != null && (
                  <Box component="span" sx={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{pct}%</Box>
                )}
              </Box>
              <JobBar job={j} sx={{ ml: '23px' }} />
            </Box>
          );
        })}

        <Box sx={{ display: 'flex', alignItems: 'center', mt: 1.25, pt: 1, borderTop: '1px solid var(--line)' }}>
          <Box sx={{ flex: 1, fontSize: '.8125rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {queuedN.toLocaleString()} queued
          </Box>
          <Button size="small" variant="contained" component={RouterLink} to="/jobs" onClick={close}
            sx={{ textTransform: 'none', boxShadow: 'none' }}>
            Open Jobs
          </Button>
        </Box>
      </Popover>
    </>
  );
}
