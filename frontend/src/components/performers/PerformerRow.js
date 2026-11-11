/**
 * One performer in Performer Management's lists, like the old page's row: picture, name and location badge, then ONE
 * line with her counts (pics, vids, scripted, size) and small labels (hash, labelled, scraped, Leakhaven, folder), and
 * her action icons in their groups on the right (Leakhaven when there is something to do | open, rename, scrape,
 * rescan, merge, delete | hash: build, find duplicates, compare | labels and funscripts), then the Details button.
 * Every icon is always there, a disabled one with its reason as tooltip, so the groups line up row to row. The row
 * does not expand: a click on it, her name or Details opens her detail in the page's side panel.
 *
 *   <PerformerRow performer={row} ctx={ctx} actions={actions} selected={bool} onOpen={(id) => …}
 *     extra={node?} hide={['twin', 'dupes']?} anchor={bool?} />
 *
 * actions is useRowActions() plus the page's expand(id): actions.run(key, p) does every icon and label,
 * actions.copyPath(p) the folder label, actions.expand(id) opens a record's panel (her twin's badge when the two are no
 * pair). onOpen(id) gets her id; selected: her panel is open (the row stays highlighted). extra sits left of the icon
 * groups (the Duplicates view's buttons); hide leaves out the "also in After" badge ('twin') or the duplicates label
 * ('dupes'). The row has id="performer-<id>" and data-performer-id unless anchor={false}.
 * PC from 1360px: every row 64px high. Narrower: the icons get a line of their own under the text and the facts
 * line may wrap (it never cuts a label off).
 */
import React, { memo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, CircularProgress, IconButton, Tooltip } from '@mui/material';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import RestoreIcon from '@mui/icons-material/Restore';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import MergeIcon from '@mui/icons-material/Merge';
import DeleteIcon from '@mui/icons-material/Delete';
import StorageIcon from '@mui/icons-material/Storage';
import FindInPageIcon from '@mui/icons-material/FindInPage';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SyncIcon from '@mui/icons-material/Sync';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import FiberNewIcon from '@mui/icons-material/FiberNew';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { iconBtnSx } from '../layout';
import { Badge } from '../discover/shared';
import {
  formatDay, formatNumber, formatSize, locationTone, locationWord, pairOf, rowActions, rowFlags, thumbUrl, twinOf
} from './model';

const PHONE = '@media (max-width: 699.98px)';
// below this the icon groups (about 300px) leave the facts line too little room: they get a line of their own and the
// facts may wrap, so no label is ever cut off
const MID = '@media (max-width: 1359.98px)';
const stop = (e) => e.stopPropagation();

const ACTION_ICON = {
  gallery: PhotoLibraryIcon,
  filter: FilterAltIcon,
  unblacklist: RestoreIcon,
  rename: EditIcon,
  scrape: SearchIcon,
  rescan: RefreshIcon,
  merge: MergeIcon,
  remove: DeleteIcon,
  'hash-build': StorageIcon,
  'hash-check': FindInPageIcon,
  'hash-compare': CompareArrowsIcon,
  pipeline: ViewTimelineIcon,
  'mark-seen': CheckCircleIcon,
  'check-now': SyncIcon
};
const ACTION_TONE = {
  remove: ['var(--dim)', 'var(--bad)'],
  merge: ['var(--dim)', 'var(--warn)'],
  'mark-seen': ['var(--bad)', 'var(--ok)']
};
const FLAG_ICON = {
  scraped: CloudDoneIcon,
  unscraped: CloudQueueIcon,
  none: LinkOffIcon,
  new: FiberNewIcon,
  current: LinkIcon,
  unchecked: ScheduleIcon,
  failed: ErrorOutlineIcon
};

// ── styles ───────────────────────────────────────────────────
const rowSx = {
  '&:not(:first-of-type)': { borderTop: '1px solid var(--line)' }
};
const headSx = (selected) => ({
  boxSizing: 'border-box', display: 'grid', height: 64, px: 1.5, py: 0.75,
  gridTemplateColumns: '48px minmax(0, 1fr) auto auto',
  gridTemplateAreas: '"pic name ctl chev" "pic facts ctl chev"',
  gridTemplateRows: 'auto auto',
  alignContent: 'center', alignItems: 'center', columnGap: 1.5, rowGap: '2px',
  cursor: 'pointer', color: 'var(--text)', bgcolor: selected ? 'var(--raised)' : 'transparent',
  transition: 'background-color .12s ease',
  '@media (hover: hover)': { '&:hover': { bgcolor: 'var(--raised)' } },
  [MID]: {
    height: 'auto', minHeight: 96, rowGap: '4px',
    gridTemplateColumns: '48px minmax(0, 1fr) auto',
    gridTemplateRows: 'auto auto auto',
    gridTemplateAreas: '"pic name chev" "pic facts chev" "ctl ctl ctl"'
  },
  [PHONE]: {
    height: 'auto', minHeight: 64, px: 1.25, columnGap: 1, rowGap: '4px',
    gridTemplateColumns: '40px minmax(0, 1fr) auto',
    gridTemplateAreas: '"pic name chev" "pic facts chev" "ctl ctl ctl"'
  }
});
const picSx = {
  gridArea: 'pic', boxSizing: 'border-box', width: 48, height: 48, overflow: 'hidden',
  borderRadius: 'var(--radius-sm, 4px)', bgcolor: 'var(--raised)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--dim)', fontSize: '1rem', fontWeight: 600, userSelect: 'none',
  '& img': { display: 'block', width: '100%', height: '100%', objectFit: 'cover' },
  [PHONE]: { width: 40, height: 40 }
};
const nameLineSx = { gridArea: 'name', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, height: 24 };
const nameSx = {
  flex: '0 1 auto', minWidth: 48, maxWidth: '100%', display: 'block', textAlign: 'left',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  font: 'inherit', fontSize: '.875rem', fontWeight: 620, lineHeight: '24px', color: 'var(--text)',
  borderRadius: 'var(--radius-sm, 4px)',
  '&:hover': { textDecoration: 'underline' },
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
};
const pillSx = (tone) => ({
  flex: 'none', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', height: 20, px: 0.75,
  border: '1px solid', borderColor: tone, color: tone, borderRadius: 'var(--radius-sm, 4px)',
  fontSize: '.75rem', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap'
});
const factsSx = {
  gridArea: 'facts', display: 'flex', alignItems: 'center', columnGap: 1.25, rowGap: '2px', minWidth: 0,
  flexWrap: 'nowrap', overflow: 'hidden', whiteSpace: 'nowrap', height: 20,
  fontSize: '.75rem', lineHeight: '20px', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums',
  '& b': { color: 'var(--text)', fontWeight: 600 },
  [MID]: { flexWrap: 'wrap', height: 'auto', overflow: 'visible' }
};
const flagBase = {
  flex: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', height: 20, px: '4px', mx: '-4px',
  font: 'inherit', fontSize: '.75rem', lineHeight: '20px', whiteSpace: 'nowrap', textDecoration: 'none',
  borderRadius: 'var(--radius-sm, 4px)',
  '& svg': { width: 14, height: 14 },
  '&.Mui-focusVisible, &:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
};
const dotFlagSx = (tone, clickable) => ({
  ...flagBase, color: 'var(--dim)', cursor: clickable ? 'pointer' : 'default',
  '&::before': { content: '""', width: 6, height: 6, borderRadius: '50%', bgcolor: tone, flexShrink: 0 },
  ...(clickable && { '&:hover': { bgcolor: 'var(--overlay)', color: 'var(--text)' } })
});
const iconFlagSx = (tone, strong) => ({
  ...flagBase, color: tone, cursor: 'pointer', fontWeight: strong ? 650 : 400,
  bgcolor: strong ? 'var(--bad-quiet)' : 'transparent',
  '&:hover': { bgcolor: strong ? 'var(--bad-quiet)' : 'var(--overlay)' }
});
const ctlSx = {
  gridArea: 'ctl', display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'default', minWidth: 0,
  [MID]: { flexWrap: 'wrap' },
  [PHONE]: { gap: 0.5 }
};
const groupSx = {
  display: 'flex', alignItems: 'center', gap: '2px', px: '2px', py: '1px', flexShrink: 0,
  border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', bgcolor: 'var(--bg)'
};
const btnSx = (key) => {
  const [tone, hover] = ACTION_TONE[key] || [];
  return {
    ...iconBtnSx(tone, hover),
    '&.Mui-disabled': { color: 'var(--faint)' },
    '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
  };
};
const chevSx = { gridArea: 'chev', ...iconBtnSx(), '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 } };

// ── pieces ───────────────────────────────────────────────────
function Picture({ p }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : thumbUrl(p);
  if (src) {
    return (
      <Box sx={picSx}>
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </Box>
    );
  }
  return <Box sx={picSx} aria-hidden>{(p.name || '?').trim().charAt(0).toUpperCase() || '?'}</Box>;
}

/** Tooltip text of an icon: its name, and the reason when it cannot run now. */
function tipOf(a) {
  if (a.spin) return `${a.label}, see Jobs`;
  if (a.busy) return a.busyLabel || a.label;
  if (a.disabled) return <>{a.label}<br />{a.disabled}</>;
  return a.tip || a.label;
}

/** One icon button of a group: a link when it has `to`/`href`, its reason as tooltip when disabled. */
function ActionIcon({ a, p, onRun }) {
  if (!a) return null;
  const Icon = ACTION_ICON[a.key] || SearchIcon;
  const off = !!a.disabled || !!a.busy || !!a.spin;
  const aria = a.disabled && !a.spin ? `${a.label} (${a.disabled})` : (a.busy ? a.busyLabel || a.label : a.label);
  const glyph = a.busy || a.spin ? <CircularProgress size={14} color="inherit" /> : <Icon />;
  let btn;
  if (!off && a.to) {
    btn = <IconButton size="small" aria-label={aria} sx={btnSx(a.key)} component={RouterLink} to={a.to}>{glyph}</IconButton>;
  } else if (!off && a.href) {
    btn = (
      <IconButton size="small" aria-label={aria} sx={btnSx(a.key)} component="a" href={a.href} target="_blank" rel="noopener noreferrer">
        {glyph}
      </IconButton>
    );
  } else {
    btn = (
      <IconButton size="small" aria-label={aria} sx={btnSx(a.key)} disabled={off} onClick={() => onRun(a.key, p)}>
        {glyph}
      </IconButton>
    );
  }
  // a disabled button fires no events: the tooltip sits on a span
  return (
    <Tooltip title={tipOf(a)}>
      <span style={{ display: 'inline-flex' }}>{btn}</span>
    </Tooltip>
  );
}

/** One label of the facts line: a dot and a word, or an icon and a word; clickable when it does something. */
function Flag({ f, p, actions }) {
  const Icon = f.icon ? FLAG_ICON[f.icon] : null;
  const clickable = !!(f.action || f.href || f.to || f.copy);
  const sx = Icon ? iconFlagSx(f.tone, f.strong) : dotFlagSx(f.tone, clickable);
  const body = <>{Icon && <Icon aria-hidden />}{f.label}</>;
  let el;
  if (f.href) {
    el = <Box component="a" href={f.href} target="_blank" rel="noopener noreferrer" sx={sx} onClick={stop} aria-label={f.tip}>{body}</Box>;
  } else if (f.to) {
    el = <Box component={RouterLink} to={f.to} sx={sx} onClick={stop} aria-label={f.tip}>{body}</Box>;
  } else if (clickable) {
    const onClick = (e) => {
      e.stopPropagation();
      if (f.copy) actions?.copyPath?.(p);
      else actions?.run?.(f.action, p);
    };
    el = <ButtonBase sx={sx} onClick={onClick} aria-label={f.tip}>{body}</ButtonBase>;
  } else {
    el = <Box component="span" sx={sx}>{body}</Box>;
  }
  return <Tooltip title={f.tip}>{el}</Tooltip>;
}

function blacklistTip(p) {
  const parts = ['Blacklisted'];
  if (p.blacklist_date) parts.push(formatDay(p.blacklist_date));
  if (p.blacklist_reason) parts.push(`"${p.blacklist_reason}"`);
  return parts.join(' · ');
}

// ── the row ──────────────────────────────────────────────────
function PerformerRow({ performer: p, ctx, actions, selected = false, onOpen, extra = null, hide = [], anchor = true }) {
  if (!p) return null;
  const name = p.name || 'Unnamed';
  const open = () => onOpen?.(p.id);
  const run = (key, row) => actions?.run?.(key, row);
  const groups = rowActions(p, ctx);
  const flags = rowFlags(p, ctx).filter(f => !(f.key === 'dupes' && hide.includes('dupes')));
  const twin = hide.includes('twin') ? null : twinOf(p, ctx);
  const word = locationWord(p);
  // the twin badge shows the pair on the Library (searched by her name: the pairs are on top); a record that is not
  // such a pair (an Empty Before folder, say) opens her other record's panel instead
  const pair = twin ? pairOf(p, ctx) : null;
  const twinTo = pair ? `/performer-management?q=${encodeURIComponent(p.name || '')}` : null;
  const openTwin = (e) => { e.stopPropagation(); actions?.expand?.(twin.id); };

  return (
    <Box id={anchor ? `performer-${p.id}` : undefined} data-performer-id={anchor ? p.id : undefined} sx={rowSx}>
      <Box sx={headSx(selected)} onClick={open}>
        {/* keyed by the thumbnail: a new picture gets a new try after a failed one */}
        <Picture key={p.thumbnail || ''} p={p} />

        <Box sx={nameLineSx}>
          <ButtonBase sx={nameSx} title={name} aria-haspopup="dialog" aria-expanded={selected}
            onClick={(e) => { e.stopPropagation(); open(); }}>
            {name}
          </ButtonBase>
          <Tooltip title={word === 'Blacklisted' ? blacklistTip(p) : ''}>
            <Box component="span" sx={pillSx(locationTone(p))}>{word}</Box>
          </Tooltip>
          {twin && (
            <Tooltip title={`She has a record in ${locationWord(twin)} too. ${pair ? 'Show the pair on the Library' : 'Open her other record'}`}>
              {/* Badge holds no ref: the tooltip sits on a span */}
              <Box component="span" sx={{ display: 'inline-flex', flex: '0 1 auto', minWidth: 0 }}>
                {twinTo
                  ? (
                    <Badge tone="info" component={RouterLink} onClick={stop} sx={{ minWidth: 0, height: 20 }} to={twinTo}>
                      {`also in ${locationWord(twin)}`}
                    </Badge>
                  )
                  : (
                    <Badge tone="info" component={ButtonBase} onClick={openTwin} sx={{ minWidth: 0, height: 20, fontFamily: 'inherit', cursor: 'pointer' }}>
                      {`also in ${locationWord(twin)}`}
                    </Badge>
                  )}
              </Box>
            </Tooltip>
          )}
        </Box>

        <Box sx={factsSx}>
          <span><b>{formatNumber(p.pics_count)}</b> pics</span>
          <span><b>{formatNumber(p.vids_count)}</b> vids</span>
          {p.funscript_vids_count > 0 && <span><b>{formatNumber(p.funscript_vids_count)}</b> scripted</span>}
          <span>{formatSize(p.total_size_gb)}</span>
          {flags.map(f => <Flag key={f.key} f={f} p={p} actions={actions} />)}
        </Box>

        {/* the controls: nothing in here opens the panel */}
        <Box sx={ctlSx} onClick={stop}>
          {extra}
          {groups.map(g => (
            <Box key={g.id} sx={groupSx} role="group" aria-label={g.label}>
              {g.items.map(a => <ActionIcon key={a.key} a={a} p={p} onRun={run} />)}
            </Box>
          ))}
        </Box>

        <Tooltip title="Details">
          <IconButton size="small" sx={chevSx} aria-haspopup="dialog" aria-expanded={selected}
            aria-label={`Details of ${name}`} onClick={(e) => { e.stopPropagation(); open(); }}>
            <InfoOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default memo(PerformerRow);
