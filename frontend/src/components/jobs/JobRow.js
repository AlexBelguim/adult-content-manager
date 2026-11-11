/**
 * One job as one row of a fixed height (60px, 56px compact), whatever it holds.
 *
 *   <JobRow job compact busy offline open onToggle highlight showKind onSlot={(key) => …} />
 *
 * [chevron] [thumbnail or kind icon] [title · status · kind · chips  /  one meta line] [six slots]
 * The six slots keep their place in every row: Pause/Resume, Run next, Retry, Cancel, Remove, Open. An off slot is
 * disabled and says why in its tooltip. Compact (phones) has one ⋯ button instead: a sheet with the six slots as
 * rows and the details. A click on the title area opens the details (the log, the import report, failed files or
 * the full error) under the row; in compact it opens the sheet.
 */
import React, { useState } from 'react';
import { Box, ButtonBase, Collapse, IconButton, Tooltip } from '@mui/material';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import ReplayIcon from '@mui/icons-material/Replay';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { iconBtnSx } from '../layout';
import { AppDialog } from '../ui';
import { Badge } from '../discover/shared';
import { KIND_LABEL, iconOf, jobPercent, JobBar } from './kinds';
import { SLOT_KEYS } from './jobActions';

const OFFLINE_WHY = "Can't reach the server";

const STATUS_TONE = { running: 'accent', queued: 'info', failed: 'bad', done: 'ok', cancelled: 'dim' };

const SLOT_ICON = {
  pause: (slot) => (slot && slot.act === 'resume' ? PlayArrowIcon : PauseIcon),
  front: () => VerticalAlignTopIcon,
  retry: () => ReplayIcon,
  cancel: () => StopCircleOutlinedIcon,
  remove: () => CloseIcon,
  open: () => ChevronRightIcon
};
const SLOT_LABEL = { pause: 'Pause', front: 'Run next', retry: 'Retry', cancel: 'Cancel', remove: 'Remove', open: 'Open' };

// ── formatting ───────────────────────────────────────────────
const n = (v) => (typeof v === 'number' ? v.toLocaleString() : v);

export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Linear extrapolation: rough on purpose, and only once there is something to extrapolate from. */
function etaText(j) {
  if (j.status !== 'running' || !j.elapsedMs || !j.progress || j.progress < 0.02 || j.progress >= 1) return '';
  return `about ${fmtDuration(j.elapsedMs * (1 - j.progress) / j.progress)} left`;
}

/** '1,204 / 2,880 files · 41%' */
function progressText(j) {
  const pct = jobPercent(j);
  const count = j.total ? `${n(Math.min(j.done ?? 0, j.total))} / ${n(j.total)} ${j.unit || ''}`.trim() : '';
  if (count && pct != null) return `${count} · ${pct}%`;
  return count || (pct != null ? `${pct}%` : '');
}

/** The timing part: elapsed and what is left, 'waiting', or 'finished HH:MM'. */
function timeText(j) {
  if (j.status === 'queued') return 'waiting';
  if (j.status === 'running') {
    if (j.elapsedMs == null) return '';
    const eta = etaText(j);
    return eta ? `${fmtDuration(j.elapsedMs)} · ${eta}` : fmtDuration(j.elapsedMs);
  }
  if (j.finishedAt) return `finished ${fmtClock(j.finishedAt)}`;
  return j.elapsedMs != null ? fmtDuration(j.elapsedMs) : '';
}

/**
 * An import's report as plain lines: what was skipped, renamed, left out or could not be moved, and what stayed
 * behind. Null when there is nothing to tell.
 */
export function importDetail(job) {
  const r = job.type === 'import' ? job.raw?.report : null;
  if (!r) return null;
  const lists = r.lists || {};
  const out = [];
  const group = (heading, count, list, line) => {
    if (!count) return;
    const shown = (list || []).slice(0, count);
    if (out.length) out.push('');
    out.push(`${heading} (${count})`);
    shown.forEach(e => out.push(`  ${line(e)}`));
    if (shown.length < count) out.push(`  and ${count - shown.length} more`);
  };
  group('Skipped as identical', r.identical, lists.identical, e => `${e.from}  same as  ${e.same}`);
  group('Renamed on name clash', r.renamed, lists.renamed, e => `${e.from} → ${e.to}`);
  group('Not imported', r.unsupported, lists.unsupported, e => `${e.from} · ${e.ext} is not a supported type`);
  group('Could not be moved', r.failed, lists.failed, e => `${e.from}: ${e.error}`);
  const tail = [];
  if (r.leftIn) tail.push(`Left in ${r.leftIn}`);
  if (r.hashing === 'failed') tail.push(`Hashing failed: ${r.hashError || 'no reason given'}`);
  if (tail.length && out.length) out.push('');
  out.push(...tail);
  return out.length ? out.join('\n') : null;
}

/** The text behind the row, or null: the funpipe log, the import report, a hash build's failed files, the error. */
export function detailText(job) {
  if (job.type === 'funpipe' && Array.isArray(job.raw?.log_tail)) {
    const log = job.raw.log_tail.join('\n');
    if (log) return job.error ? `${job.error}\n\n${log}` : log;
    if (job.status === 'running' || job.status === 'queued') return 'no output yet';
  }
  const report = importDetail(job);
  if (report) return job.error && !/could not be moved/.test(job.error) ? `${job.error}\n\n${report}` : report;
  const failedFiles = job.type === 'hash' && Array.isArray(job.raw?.failedFiles) ? job.raw.failedFiles : [];
  if (failedFiles.length) {
    const list = failedFiles.map(f => (typeof f === 'string' ? f : `${f.path}: ${f.error}`)).join('\n');
    const more = (job.raw.failed || 0) > failedFiles.length ? `\nand ${job.raw.failed - failedFiles.length} more` : '';
    return `${job.error ? `${job.error}\n\n` : ''}Could not be read (${n(job.raw.failed || failedFiles.length)})\n${list}${more}`;
  }
  return job.error || null;
}

// ── pieces ───────────────────────────────────────────────────
function Thumb({ job, size }) {
  const [failed, setFailed] = useState(false);
  const Icon = iconOf(job.type);
  return (
    <Box sx={{
      width: size, height: size, flexShrink: 0, borderRadius: 'var(--radius, 6px)', overflow: 'hidden',
      bgcolor: 'var(--raised)', display: 'grid', placeItems: 'center', color: 'var(--dim)'
    }}>
      {job.thumbPath && !failed ? (
        <Box
          component="img" loading="lazy" alt=""
          src={`/api/files/video-thumbnail?path=${encodeURIComponent(job.thumbPath)}`}
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : <Icon sx={{ fontSize: 22 }} />}
    </Box>
  );
}

/** A slot's state for this row: { on, why, label, Icon }. */
function slotState(job, key, { busy, offline }) {
  const slot = job.actions?.[key] || null;
  const label = slot?.label || SLOT_LABEL[key];
  const Icon = SLOT_ICON[key](slot);
  if (!slot) return { on: false, why: 'Not for this job', label, Icon };
  if (offline && key !== 'open') return { on: false, why: OFFLINE_WHY, label, Icon };
  if (busy) return { on: false, why: slot.on ? 'Working…' : slot.why, label, Icon };
  return { on: !!slot.on, why: slot.on ? null : (slot.why || 'Not now'), label, Icon };
}

function Slots({ job, busy, offline, onSlot }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
      {SLOT_KEYS.map(key => {
        const s = slotState(job, key, { busy, offline });
        const tone = key === 'cancel' ? 'var(--bad)' : 'var(--dim)';
        return (
          <Tooltip key={key} title={s.on ? s.label : `${s.label}: ${s.why}`}>
            <span>
              <IconButton
                aria-label={s.label}
                disabled={!s.on}
                onClick={(e) => { e.stopPropagation(); onSlot && onSlot(key); }}
                sx={{
                  ...iconBtnSx(tone, key === 'cancel' ? 'var(--bad)' : 'var(--text)'),
                  width: 32, height: 32, minWidth: 32,
                  '&.Mui-disabled': { color: 'var(--faint)' }
                }}
              >
                <s.Icon />
              </IconButton>
            </span>
          </Tooltip>
        );
      })}
    </Box>
  );
}

const preSx = {
  m: 0, p: '8px 10px', bgcolor: 'var(--bg)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius, 6px)', color: 'var(--dim)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.75rem', lineHeight: 1.5,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto'
};

function SlotSheet({ job, open, onClose, busy, offline, onSlot, detail }) {
  return (
    <AppDialog
      open={open}
      onClose={onClose}
      size="md"
      sheet
      title={job.title}
      subtitle={`${KIND_LABEL[job.type] || job.type} · ${job.status}`}
      cancelLabel={false}
    >
      <Box sx={{ mx: -1 }}>
        {SLOT_KEYS.map(key => {
          const s = slotState(job, key, { busy, offline });
          return (
            <ButtonBase
              key={key}
              component="div"
              disabled={!s.on}
              onClick={() => { onClose(); onSlot && onSlot(key); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', minHeight: 48, px: 1,
                justifyContent: 'flex-start', textAlign: 'left', borderRadius: 'var(--radius, 6px)',
                color: key === 'cancel' ? 'var(--bad)' : 'var(--text)',
                '&.Mui-disabled': { color: 'var(--muted)' },
                '&:hover': { bgcolor: 'var(--raised)' },
                '& svg': { fontSize: 20, flexShrink: 0 }
              }}
            >
              <s.Icon />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ fontSize: '.875rem' }}>{s.label}</Box>
                {!s.on && s.why && (
                  <Box sx={{ fontSize: '.75rem', color: 'var(--dim)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{s.why}</Box>
                )}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
      {detail && <Box component="pre" sx={{ ...preSx, mt: 1.5, maxHeight: 'none' }}>{detail}</Box>}
    </AppDialog>
  );
}

/**
 * The meta line's parts, in order, as [key, text, color]. Compact (phones): no subtitle, which the sheet's header
 * shows, so the progress and the time left fit.
 */
function metaParts(job, compact = false) {
  const running = job.status === 'running';
  const parts = [];
  if (job.subtitle && !compact) parts.push(['subtitle', job.subtitle]);
  const pt = progressText(job);
  const showBar = running || (job.status === 'failed' && job.progress != null);
  if (showBar) parts.push(['bar', pt]);
  // 'stopping' is in the status badge already
  if (running && job.stage && job.stage !== 'stopping') parts.push(['stage', job.stage]);
  if (running && job.currentFile) parts.push(['file', job.currentFile]);
  if (job.status === 'queued' && job.stage) parts.push(['stage', job.stage]);
  const t = timeText(job);
  if (t) parts.push(['time', t]);
  if (job.note && (running || job.type === 'encode')) parts.push(['note', job.note]);
  if (job.result) parts.push(['result', job.result, job.status === 'done' ? 'var(--ok)' : 'var(--dim)']);
  if (job.error) parts.push(['error', job.error, 'var(--bad)']);
  return parts;
}

// ── the row ──────────────────────────────────────────────────
export default function JobRow({ job, compact = false, busy = false, offline = false, open = false, onToggle, highlight = false, showKind = false, onSlot }) {
  const detail = detailText(job);
  const hasDetail = !!detail;
  const height = compact ? 56 : 60;
  const thumb = compact ? 40 : 44;
  const parts = metaParts(job, compact);
  // Compact: the title area and ⋯ open the sheet, which holds the slots and the details.
  const toggles = compact || hasDetail;

  const textArea = (
    <>
      <Box sx={{ width: 16, display: 'grid', placeItems: 'center', color: 'var(--muted)', flexShrink: 0 }}>
        {hasDetail && !compact && (
          <ExpandMoreIcon sx={{ fontSize: 16, transition: 'transform .15s', transform: open ? 'none' : 'rotate(-90deg)' }} />
        )}
      </Box>
      <Thumb job={job} size={thumb} />
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, height: 22, overflow: 'hidden' }}>
          <Box component="span" title={job.title} sx={{
            // badges are clipped at the line's end before the title goes below about 12 characters
            fontWeight: 600, fontSize: '.875rem', color: 'var(--text)', minWidth: `min(${Math.max(1, String(job.title || '').length)}ch, 12ch)`, flex: '0 1 auto',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {job.title}
          </Box>
          <Badge tone={STATUS_TONE[job.status] || 'dim'} sx={{ flexShrink: 0 }}>
            {job.status === 'running' && job.stage === 'stopping' ? 'stopping' : job.status}
          </Badge>
          {showKind && !compact && <Badge sx={{ flexShrink: 0 }}>{KIND_LABEL[job.type] || job.type}</Badge>}
          {!compact && (job.chips || []).map(c => <Badge key={c} sx={{ flexShrink: 0, fontWeight: 500 }}>{c}</Badge>)}
        </Box>
        <Box sx={{
          height: 18, lineHeight: '18px', fontSize: '.75rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left'
        }}>
          {parts.map(([key, text, color], i) => (
            <React.Fragment key={key + i}>
              {i > 0 && <Box component="span" aria-hidden sx={{ color: 'var(--faint)', mx: '6px' }}>·</Box>}
              {key === 'bar' ? (
                <>
                  <JobBar job={job} sx={{ display: 'inline-block', width: compact ? 72 : 120, verticalAlign: 'middle', mr: text ? 0.75 : 0 }} />
                  {text}
                </>
              ) : (
                <Box component="span" sx={color ? { color } : undefined}>{text}</Box>
              )}
            </React.Fragment>
          ))}
        </Box>
      </Box>
    </>
  );

  const areaSx = {
    display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0, height: '100%',
    justifyContent: 'flex-start', textAlign: 'left', borderRadius: 'var(--radius, 6px)'
  };

  return (
    <Box
      id={`job-${job.id}`}
      className="job-row"
      sx={{
        outline: highlight ? '2px solid var(--accent)' : 'none', outlineOffset: -2,
        borderRadius: 'var(--radius, 6px)', transition: 'outline-color .2s'
      }}
    >
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, height, px: compact ? 0.75 : 1, py: compact ? '6px' : '8px',
        boxSizing: 'border-box'
      }}>
        {toggles ? (
          <ButtonBase
            component="div"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={compact ? `${job.title}: actions and details` : `${job.title}: details`}
            sx={{ ...areaSx, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 } }}
          >
            {textArea}
          </ButtonBase>
        ) : (
          <Box sx={areaSx}>{textArea}</Box>
        )}

        {compact ? (
          <IconButton aria-label={`Actions for ${job.title}`} onClick={onToggle} sx={{ ...iconBtnSx(), width: 40, height: 40, minWidth: 40 }}>
            <MoreHorizIcon />
          </IconButton>
        ) : (
          <Slots job={job} busy={busy} offline={offline} onSlot={onSlot} />
        )}
      </Box>

      {!compact && hasDetail && (
        <Collapse in={open} unmountOnExit>
          <Box sx={{ px: 1, pb: 1, pl: compact ? 1 : 'calc(8px + 16px + 8px)' }}>
            <Box component="pre" sx={preSx}>{detail}</Box>
          </Box>
        </Collapse>
      )}

      {compact && (
        <SlotSheet job={job} open={open} onClose={onToggle} busy={busy} offline={offline} onSlot={onSlot} detail={detail} />
      )}
    </Box>
  );
}
