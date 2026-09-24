/**
 * JobsIndicator — the toolbar pill: "N running · M failed", visible from every
 * page. Click opens a popover with the running jobs and a way to the Jobs page.
 *
 * Replaces the two floating "Background Tasks" boxes, which covered the
 * bottom-right corner and cancelled every hash job when closed.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ButtonBase, Button, Popover, Typography, CircularProgress, LinearProgress } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import PsychologyIcon from '@mui/icons-material/Psychology';
import useJobs, { jobPercent } from '../hooks/useJobs';

/** One icon per job type — shared with the Jobs page so the two never drift. */
export const JOB_TYPE_ICONS = {
  import: MoveToInboxIcon,
  funpipe: SmartToyIcon,
  hash: VpnKeyIcon,
  encode: MovieFilterIcon,
  cleanup: CleaningServicesIcon,
  train: PsychologyIcon
};

/** The one progress bar for jobs. Indeterminate when the source reports no progress. */
export function JobBar({ job, sx = {} }) {
  const pct = jobPercent(job);
  const failed = job.status === 'failed';
  return (
    <LinearProgress
      variant={pct == null && !failed ? 'indeterminate' : 'determinate'}
      value={pct ?? 0}
      sx={{
        height: 6, borderRadius: 3, bgcolor: 'var(--line-strong)',
        '& .MuiLinearProgress-bar': { bgcolor: failed ? 'var(--bad)' : 'var(--accent)', borderRadius: 3 },
        ...sx
      }}
    />
  );
}

export default function JobsIndicator({ hashQueue }) {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);
  // Slower than the page: this one is mounted on every screen.
  const { jobs } = useJobs({ hashQueue, activeMs: 5000, idleMs: 30000 });

  const running = jobs.filter(j => j.status === 'running');
  const queued = jobs.filter(j => j.status === 'queued').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const busy = running.length > 0;

  const openJobs = () => { setAnchor(null); navigate('/jobs'); };

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="Background jobs"
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: 0,
          border: '1px solid', borderColor: busy ? 'var(--accent)' : 'var(--line-strong)',
          borderRadius: 99, p: '3px 12px 3px 9px', bgcolor: 'var(--surface)',
          color: 'var(--text)', fontSize: '.82rem', whiteSpace: 'nowrap',
          '&:hover': { bgcolor: 'var(--raised)' }
        }}
      >
        {busy
          ? <CircularProgress size={12} thickness={6} sx={{ color: 'var(--accent)' }} />
          : <CheckIcon sx={{ fontSize: 14, color: 'var(--muted)' }} />}
        <span>{busy ? `${running.length} running` : 'No jobs running'}</span>
        {failed > 0 && (
          <Box component="span" sx={{ color: 'var(--bad)' }}>· {failed} failed</Box>
        )}
      </ButtonBase>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1, p: 1.5, width: 'min(360px, calc(100vw - 28px))',
              bgcolor: 'var(--overlay)', backgroundImage: 'none', color: 'var(--text)',
              border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg, 10px)',
              boxShadow: 'var(--shadow-lg)'
            }
          }
        }}
      >
        <Typography sx={{
          fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--muted)', mb: 1
        }}>
          Running now
        </Typography>

        {running.length === 0 && (
          <Typography sx={{ fontSize: '.8rem', color: 'var(--muted)' }}>Nothing running.</Typography>
        )}

        <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {running.map((j, i) => {
            const Icon = JOB_TYPE_ICONS[j.type] || CleaningServicesIcon;
            const pct = jobPercent(j);
            return (
              <Box key={j.id} sx={{ py: 0.75, borderTop: i ? '1px solid var(--line)' : 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '.8rem' }}>
                  <Icon sx={{ fontSize: 15, color: 'var(--dim)', flexShrink: 0 }} />
                  <Box component="b" title={j.title} sx={{
                    flex: 1, minWidth: 0, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {j.title}
                  </Box>
                  {pct != null && (
                    <Box component="span" sx={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</Box>
                  )}
                </Box>
                <JobBar job={j} sx={{ mt: 0.5 }} />
              </Box>
            );
          })}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', mt: 1.25 }}>
          <Typography sx={{ flex: 1, fontSize: '.8rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {queued} queued
          </Typography>
          <Button size="small" variant="contained" onClick={openJobs}>Open Jobs</Button>
        </Box>
      </Popover>
    </>
  );
}
