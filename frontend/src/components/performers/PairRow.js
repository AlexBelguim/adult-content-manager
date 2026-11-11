/**
 * A name in both Before and After, on the Library (like the old page's pairs at the top): both pictures, her name,
 * '1 before · 1 after' with what each record holds, Compare (or the hash builds Compare needs) and Merge into After.
 * Expanding the pair shows her TWO records as full PerformerRows with all their own actions (Scrape too); a click on
 * one of those opens its detail in the page's side panel.
 *
 *   <PairRow pair={{ key, before, after }} ctx={ctx} actions={actions} expanded={bool} onToggle={(key) => …}
 *     selectedId={id?} onOpen={(id) => …} />
 *   <PairSection pairs={[{ key, before, after }]} ctx={ctx} actions={actions} selectedId={id?} onOpen={(id) => …} />
 *   <SectionTitle id="…" count={n}>Title</SectionTitle>
 *
 * onToggle(pair.key) opens and closes the pair; selectedId / onOpen are the record whose panel is open (the page's
 * ?performer=<id>) and what opens one, handed to the two rows. Compare and Merge act on the Before record:
 * 'hash-compare-twin' (or 'hash-build-pair') and 'merge-pair' through actions.run, so Merge asks first as Move to After
 * does. PairSection is the Library's 'In both Before and After' section: its title and count, a line on what it is,
 * the pairs (100, then 100 more at a time), each opened and closed on its own. SectionTitle is the small uppercase
 * heading the Library and the Duplicates view put over their sections.
 */
import React, { useState } from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { iconBtnSx, Panel } from '../layout';
import { headSx as sectionHeadSx, SmallButton } from '../discover/shared';
import PerformerRow from './PerformerRow';
import { actionOf, formatNumber, formatSize, thumbUrl } from './model';

const PHONE = '@media (max-width: 699.98px)';
const PAGE_ROWS = 100;
const stop = (e) => e.stopPropagation();

const titleSx = { ...sectionHeadSx, mt: 0, mb: 0.5, display: 'flex', alignItems: 'baseline', gap: 1 };
const countSx = { color: 'var(--dim)', fontWeight: 600, letterSpacing: 0 };
const hintSx = { fontSize: '.8125rem', color: 'var(--dim)', mb: 1, lineHeight: 1.5 };
const moreSx = { display: 'flex', justifyContent: 'center', py: 1.5, borderTop: '1px solid var(--line)' };

const pairSx = {
  '&:not(:first-of-type)': { borderTop: '1px solid var(--line)' }
};
const headSx = (expanded) => ({
  boxSizing: 'border-box', display: 'grid', height: 64, px: 1.5, py: 0.75,
  gridTemplateColumns: '72px minmax(0, 1fr) auto auto',
  gridTemplateAreas: '"pics name ctl chev" "pics facts ctl chev"',
  gridTemplateRows: 'auto auto',
  alignContent: 'center', alignItems: 'center', columnGap: 1.5, rowGap: '2px',
  cursor: 'pointer', color: 'var(--text)', bgcolor: expanded ? 'var(--raised)' : 'transparent',
  transition: 'background-color .12s ease',
  '@media (hover: hover)': { '&:hover': { bgcolor: 'var(--raised)' } },
  [PHONE]: {
    height: 'auto', minHeight: 64, px: 1.25, columnGap: 1, rowGap: '4px',
    gridTemplateColumns: '62px minmax(0, 1fr) auto',
    gridTemplateAreas: '"pics name chev" "pics facts chev" "ctl ctl ctl"'
  }
});
const picsSx = { gridArea: 'pics', display: 'flex', alignItems: 'center' };
const picSx = (i) => ({
  boxSizing: 'border-box', width: 44, height: 44, flexShrink: 0, overflow: 'hidden',
  ml: i ? '-16px' : 0, zIndex: 2 - i, position: 'relative',
  border: '2px solid var(--surface)', borderRadius: 'var(--radius-sm, 4px)', bgcolor: 'var(--raised)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', fontSize: '.875rem', fontWeight: 600,
  '& img': { display: 'block', width: '100%', height: '100%', objectFit: 'cover' },
  [PHONE]: { width: 40, height: 40, ml: i ? '-18px' : 0 }
});
const nameSx = {
  gridArea: 'name', justifySelf: 'start', maxWidth: '100%', display: 'block', textAlign: 'left',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  font: 'inherit', fontSize: '.875rem', fontWeight: 620, lineHeight: '24px', color: 'var(--text)',
  borderRadius: 'var(--radius-sm, 4px)',
  '&:hover': { textDecoration: 'underline' },
  '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 }
};
const factsSx = {
  gridArea: 'facts', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  fontSize: '.75rem', lineHeight: '20px', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums',
  '& b': { color: 'var(--text)', fontWeight: 600 },
  [PHONE]: { whiteSpace: 'normal' }
};
const ctlSx = { gridArea: 'ctl', display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'default', flexWrap: 'wrap' };
const chevSx = { gridArea: 'chev', ...iconBtnSx(), '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 1 } };
const recordsSx = {
  borderTop: '1px solid var(--line)', bgcolor: 'var(--bg)', pl: 3,
  [PHONE]: { pl: 1 }
};

function Pic({ p, i }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : thumbUrl(p);
  return (
    <Box sx={picSx(i)} aria-hidden>
      {src
        ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        : (p?.name || '?').trim().charAt(0).toUpperCase() || '?'}
    </Box>
  );
}

/** '120 pics, 30 vids, 2.1 GB' of one record */
const holds = (p) => `${formatNumber(p.pics_count)} pics, ${formatNumber(p.vids_count)} vids, ${formatSize(p.total_size_gb)}`;

/** A row action as a SmallButton: its reason as tooltip when disabled, its busy word while busy. */
function ActionButton({ a, p, actions, primary, tip }) {
  if (!a) return null;
  const off = !!a.disabled || !!a.busy;
  return (
    <SmallButton primary={primary && !off} disabled={off} tip={a.disabled || tip || undefined}
      onClick={() => actions?.run?.(a.key, p)}>
      {a.busy ? (a.busyLabel || a.label) : a.label}
    </SmallButton>
  );
}

export function SectionTitle({ id, children, count }) {
  return (
    <Typography component="h2" id={id} sx={titleSx}>
      {children}
      {count != null && <Box component="span" sx={countSx}>{formatNumber(count)}</Box>}
    </Typography>
  );
}

export default function PairRow({ pair, ctx, actions, expanded = false, onToggle, selectedId = null, onOpen }) {
  const before = pair?.before;
  const after = pair?.after;
  if (!before || !after) return null;
  const name = before.name || after.name || 'Unnamed';
  const toggle = () => onToggle?.(pair.key);
  const recordsId = `${pair.key}-records`;

  // Compare needs both hash databases; without them the button builds the missing ones
  const missing = [before, after].filter(r => !r.hasHashDB);
  let compare;
  let compareTip;
  if (missing.length) {
    const hashing = missing.every(r => ctx?.job?.(r.id));
    const label = hashing ? 'Hashing…' : missing.length === 2 ? 'Build both hashes' : `Build the ${missing[0] === before ? 'Before' : 'After'} hash`;
    compare = actionOf(before, ctx, 'hash-build-pair', label);
    compareTip = `Compare needs both hash databases: ${missing.length === 2 ? 'neither has one' : `the ${missing[0] === before ? 'Before' : 'After'} record has none`}`;
  } else {
    compare = actionOf(before, ctx, 'hash-compare-twin', 'Compare');
    compareTip = 'Which of her files are in both folders; opens the results';
  }
  const merge = actionOf(before, ctx, 'merge-pair', 'Merge into After…');

  return (
    <Box sx={pairSx} data-pair={pair.key}>
      <Box sx={headSx(expanded)} onClick={toggle}>
        <Box sx={picsSx}>
          <Pic key={`b-${before.thumbnail || ''}`} p={before} i={0} />
          <Pic key={`a-${after.thumbnail || ''}`} p={after} i={1} />
        </Box>

        <ButtonBase sx={nameSx} title={name} aria-expanded={expanded} aria-controls={expanded ? recordsId : undefined}
          onClick={(e) => { e.stopPropagation(); toggle(); }}>
          {name}
        </ButtonBase>

        <Box sx={factsSx} title={`Before: ${holds(before)}\nAfter: ${holds(after)}`}>
          <b>1</b> before · <b>1</b> after · {`Before: ${holds(before)} · After: ${holds(after)}`}
        </Box>

        <Box sx={ctlSx} onClick={stop}>
          <ActionButton a={compare} p={before} actions={actions} tip={compareTip} />
          <ActionButton a={merge} p={before} actions={actions} primary
            tip="Move her Before files into her After record (it asks first)" />
        </Box>

        <Tooltip title={expanded ? 'Hide her two records' : 'Show her two records'}>
          <IconButton size="small" sx={chevSx} aria-expanded={expanded} aria-controls={expanded ? recordsId : undefined}
            aria-label={expanded ? `Hide the two records of ${name}` : `Show the two records of ${name}`}
            onClick={(e) => { e.stopPropagation(); toggle(); }}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {expanded && (
        <Box id={recordsId} sx={recordsSx} role="group" aria-label={`The two records of ${name}`}>
          {[before, after].map(r => (
            <PerformerRow key={r.id} performer={r} ctx={ctx} actions={actions}
              selected={selectedId != null && Number(selectedId) === r.id} onOpen={onOpen} hide={['twin']} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** The Library's 'In both Before and After' section; nothing when there is no pair. */
export function PairSection({ pairs = [], ctx, actions, selectedId = null, onOpen, sx }) {
  const [open, setOpen] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE_ROWS);
  if (!pairs.length) return null;
  const toggle = (key) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <Box component="section" sx={{ mb: 3, minWidth: 0, ...sx }} aria-labelledby="pm-pairs">
      <SectionTitle id="pm-pairs" count={pairs.length}>In both Before and After</SectionTitle>
      <Box sx={hintSx}>The same name in Before and in After. Compare their files, then merge her Before record into After.</Box>
      <Panel padded={false} sx={{ overflow: 'hidden' }}>
        {pairs.slice(0, limit).map(x => (
          <PairRow key={x.key} pair={x} ctx={ctx} actions={actions} expanded={open.has(x.key)} onToggle={toggle}
            selectedId={selectedId} onOpen={onOpen} />
        ))}
        {pairs.length > limit && (
          <Box sx={moreSx}>
            <SmallButton onClick={() => setLimit(n => n + PAGE_ROWS)}>{`Show ${Math.min(PAGE_ROWS, pairs.length - limit)} more`}</SmallButton>
          </Box>
        )}
      </Panel>
    </Box>
  );
}
