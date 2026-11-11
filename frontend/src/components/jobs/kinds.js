/**
 * The kinds of background job, in one place: their order, names and icons, the one progress bar, and the state
 * filters. The Jobs page, the app-bar chip and the jobs store read these, so they never drift apart.
 */
import React from 'react';
import { LinearProgress } from '@mui/material';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import StorageIcon from '@mui/icons-material/Storage';
import ListAltIcon from '@mui/icons-material/ListAlt';

export const KIND_ORDER = ['import', 'hash', 'encode', 'funpipe', 'pipeline', 'train', 'cleanup', 'discover', 'probe'];

export const KIND_LABEL = {
  import: 'Import',
  hash: 'Hashing',
  encode: 'Encoding',
  funpipe: 'Funscript (funpipe)',
  pipeline: 'Labels + funscript (scenetest)',
  train: 'Training',
  cleanup: 'Cleanup',
  discover: 'Discover',
  probe: 'Library scan'
};

/** Shorter names where the room is small (the Jobs sidebar); the full name goes in the row's title. */
export const KIND_SHORT = {
  ...KIND_LABEL,
  funpipe: 'Funscript',
  pipeline: 'Labels + funscript'
};

/** One icon per kind. */
export const KIND_ICON = {
  import: MoveToInboxIcon,
  hash: VpnKeyIcon,
  encode: MovieFilterIcon,
  funpipe: SmartToyIcon,
  pipeline: ViewTimelineIcon,
  train: PsychologyIcon,
  cleanup: CleaningServicesIcon,
  discover: TravelExploreIcon,
  probe: StorageIcon
};
export const iconOf = (kind) => KIND_ICON[kind] || ListAltIcon;

export const STATE_FILTERS = [['all', 'All'], ['running', 'Running'], ['queued', 'Queued'], ['failed', 'Failed'], ['finished', 'Finished']];

/** Whether a job is in a state filter; finished is done or cancelled. */
export function inState(job, state) {
  if (!state || state === 'all') return true;
  if (state === 'finished') return job.status === 'done' || job.status === 'cancelled';
  return job.status === state;
}

/** 0-100 (clamped), or null when the source reports no progress. */
export function jobPercent(job) {
  const p = job ? job.progress : null;
  if (p == null || typeof p !== 'number' || !Number.isFinite(p)) return null;
  return Math.min(100, Math.max(0, Math.round(p * 100)));
}

/** The one progress bar for jobs. Indeterminate when the source reports no progress (and the job has not failed). */
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
