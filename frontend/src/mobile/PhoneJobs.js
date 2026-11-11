import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import useJobs from '../hooks/useJobs';

/**
 * Job counts for the phone chrome: the bottom tab's failed dot, the More sheet's Jobs row and the library's
 * jobs chip. They come from the shared jobs store (hooks/useJobs) through a context; a provider inside another one
 * does not subscribe again.
 */
const ZERO = Object.freeze({ running: 0, queued: 0, failed: 0 });
const PhoneJobsContext = createContext(null);

function Poller({ onCounts }) {
  const { jobs } = useJobs({ activeMs: 5000, idleMs: 30000 });
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  useEffect(() => { onCounts({ running, queued, failed }); }, [running, queued, failed, onCounts]);
  return null;
}

/** Polls /api/jobs while `active`; children keep their tree position whatever `active` is. */
export function PhoneJobsProvider({ active = true, children }) {
  const outer = useContext(PhoneJobsContext);
  const [counts, setCounts] = useState(ZERO);
  const value = outer || counts;
  return (
    <PhoneJobsContext.Provider value={value}>
      {active && !outer ? <Poller onCounts={setCounts} /> : null}
      {children}
    </PhoneJobsContext.Provider>
  );
}

/** { running, queued, failed } — zeros outside a provider. */
export function usePhoneJobs() {
  return useContext(PhoneJobsContext) || ZERO;
}

/** A link to the Jobs page, shown only while something runs or has failed. */
export function JobsChip() {
  const { running, failed } = usePhoneJobs();
  const label = useMemo(() => {
    const parts = [];
    if (running > 0) parts.push(`${running} running`);
    if (failed > 0) parts.push(`${failed} failed`);
    return parts.join(' · ');
  }, [running, failed]);
  if (running === 0 && failed === 0) return null;

  const tone = running > 0 ? 'var(--accent)' : 'var(--bad)';
  return (
    <Box
      component={RouterLink}
      to="/jobs"
      aria-label={`Jobs: ${label}`}
      sx={{
        // A 40px hit area around a 28px pill.
        display: 'inline-flex', alignItems: 'center', minHeight: 40, flexShrink: 0,
        textDecoration: 'none', WebkitTapHighlightColor: 'transparent'
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5, height: 28, px: 1.25,
          borderRadius: 'var(--radius)', border: `1px solid ${tone}`,
          color: running > 0 ? 'var(--text)' : 'var(--bad)',
          fontSize: 12, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {running > 0 && <span>{running} running</span>}
        {running > 0 && failed > 0 && <span aria-hidden="true">·</span>}
        {failed > 0 && <Box component="span" sx={{ color: 'var(--bad)' }}>{failed} failed</Box>}
      </Box>
    </Box>
  );
}
