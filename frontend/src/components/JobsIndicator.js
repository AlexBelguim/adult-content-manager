/**
 * JobsIndicator — the app-bar chip: 'N running', else 'M queued', else a tick; '· K failed' in red when anything
 * failed; 'Offline' when the server does not answer. Its popover lists the failed and the running jobs, each a
 * link to that row on the Jobs page.
 *
 * Reads the shared jobs store (hooks/useJobs), slower than the page: it is on every screen.
 */
import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Button, Popover, CircularProgress } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import useJobs from '../hooks/useJobs';
import { iconOf, jobPercent, JobBar } from './jobs/kinds';

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

  let icon = <CheckIcon sx={{ fontSize: 14, color: 'var(--muted)' }} />;
  let label;
  let wideOnly = false;
  if (offline) {
    icon = <CloudOffIcon sx={{ fontSize: 14, color: 'var(--warn)' }} />;
    label = 'Offline';
  } else if (busy) {
    icon = <CircularProgress size={12} thickness={6} sx={{ color: 'var(--accent)' }} />;
    label = `${runningN.toLocaleString()} running`;
  } else if (queuedN > 0) {
    label = `${queuedN.toLocaleString()} queued`;
  } else {
    label = 'No jobs';
    wideOnly = true;   // the tick says it; the words only fit on a wide bar
  }

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={`Background jobs: ${label}${failedN ? `, ${failedN} failed` : ''}`}
        aria-haspopup="dialog"
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: 0, height: 28,
          border: '1px solid', borderColor: offline ? 'var(--warn)' : busy ? 'var(--accent)' : 'var(--line-strong)',
          borderRadius: 99, px: '11px', bgcolor: 'var(--surface)',
          color: 'var(--text)', fontSize: '.8125rem', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          '&:hover': { bgcolor: 'var(--raised)' },
          '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
        }}
      >
        {icon}
        <Box component="span" sx={wideOnly ? { display: { xs: 'none', lg: 'inline' } } : undefined}>{label}</Box>
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
