/**
 * The one performer card of every Discover grid (Performers, Liked, Kept, Decided, a watcher's Performers, the sides of a
 * Duplicates card). On the picture: the best score, ONE state chip, "together <n>" (all her pictures judged as one) and
 * "<n> finds", a button that opens her finds with their links (FindsPopover), not the drawer; under it her first name
 * and one dim line (her age, country, height, cup and ethnicity, else her profiles and posts, as the old card); one
 * control row: [Keep | Delete] Checked Remove, always in the same places, off with a title when they do not apply.
 */
import React, { memo, useCallback, useState } from 'react';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import { RowBtn, RowIcon, RowSeg, RowSegBtn, Tile, TileChip } from './Tile';
import FindsPopover from './FindsPopover';
import { dataLine, plural } from './shared';

/**
 * What she is now and what can be done:
 * chip: the one state chip (or null), tone: the border ('ok' | 'bad' | null), can: { action: [enabled, title] }.
 */
export function decisionState(g) {
  const s = g.status || null;
  const u = g.update || null;
  const n = g.new_finds?.length || 0;
  let chip = null;
  if (u === 'red') chip = { text: 'Update', tone: 'bad', title: `Deleted, then found again: ${n} new` };
  else if (u === 'green') chip = { text: 'Update', tone: 'ok', title: `Kept, then found again: ${n} new` };
  else if (u === 'again') chip = { text: 'Found again', tone: 'dim', title: `Removed, then found again: ${n} new` };
  else if (s === 'kept') chip = { text: 'Kept', tone: 'ok' };
  else if (s === 'checked') chip = { text: 'Checked', tone: 'ok' };
  else if (s === 'deleted') chip = { text: 'Deleted', tone: 'bad' };
  else if (s === 'removed') chip = { text: 'Removed', tone: 'dim' };
  else if (g.in_library) {
    const id = g.in_library_id;
    chip = id != null
      ? { text: 'In library', tone: 'dim', title: `In the library as ${g.in_library}: open in Performer management`, href: `/performer-management?performer=${id}` }
      : { text: 'In library', tone: 'dim', title: `In the library as ${g.in_library}` };
  }

  const tone = s === 'kept' || s === 'checked' || u === 'green' ? 'ok' : s === 'deleted' || u === 'red' ? 'bad' : null;
  const pair = (on, yes, no) => [on, on ? yes : no];
  const can = {
    kept: pair(s !== 'kept' && s !== 'checked', 'To Kept, and to the profile page as kept: a training verdict', 'Kept already'),
    deleted: pair(s !== 'deleted' || u === 'red', 'Off this page, and to the profile page as deleted: a training verdict', 'Deleted already'),
    checked: pair(s === 'kept' || (s === 'checked' && u === 'green'), 'Seen: off Kept until something new of her is found', 'Only for a kept performer'),
    removed: pair(s !== 'removed' || u === 'again', 'Off Discover, nothing sent to the profile page', 'Removed already'),
    undecided: pair(!!s, 'Put back: undecided again', 'Not decided yet'),
    superWrong: pair(s !== 'deleted', 'A delete P got badly wrong: it can count heavier when P learns', 'Deleted already')
  };
  return { chip, tone, can };
}

/** Whether she still belongs to a list ('all', 'liked', 'kept', 'decided', 'everyone') after a decision. */
export function belongs(g, view) {
  switch (view) {
    case 'all':
    case 'liked':
      return !g.status || ((g.status === 'deleted' || g.status === 'removed') && !!g.update);
    case 'kept':
      return g.status === 'kept' || (g.status === 'checked' && !!g.update);
    case 'decided':
      return !!g.status && !belongs(g, 'all') && !belongs(g, 'kept');
    default:
      return true;
  }
}

/** Her picture: the cached cover, else the first find with a picture. */
export const coverOf = (g) => g.image || g.members?.find(m => m.image)?.image || null;

/**
 * The four decision controls, in the same places on the card and in the drawer. text: the drawer's version, with words
 * on Checked and Remove.
 */
export function DecisionRow({ g, busy, onDecide, text = false }) {
  const { can } = decisionState(g);
  const decide = (status) => () => onDecide?.(g, status);
  const keepOn = g.status === 'kept' || g.status === 'checked';
  const name = g.names?.[0] || 'her';
  return (
    <>
      <RowSeg label={`Keep or delete ${name}`}>
        <RowSegBtn on={keepOn} tone="ok" disabled={busy || !can.kept[0]} title={can.kept[1]} onClick={decide('kept')}>Keep</RowSegBtn>
        <RowSegBtn on={g.status === 'deleted'} tone="bad" disabled={busy || !can.deleted[0]} title={can.deleted[1]} onClick={decide('deleted')}>Delete</RowSegBtn>
      </RowSeg>
      {text ? (
        <>
          <RowBtn tone={can.checked[0] ? 'ok' : undefined} icon={<DoneAllIcon />} disabled={busy || !can.checked[0]} title={can.checked[1]} onClick={decide('checked')}>Checked</RowBtn>
          <RowBtn icon={<VisibilityOffIcon />} disabled={busy || !can.removed[0]} title={can.removed[1]} onClick={decide('removed')}>Remove</RowBtn>
        </>
      ) : (
        <>
          <RowIcon tone="ok" ariaLabel="Checked" disabled={busy || !can.checked[0]} title={can.checked[1]} onClick={decide('checked')}><DoneAllIcon /></RowIcon>
          <RowIcon ariaLabel="Remove" disabled={busy || !can.removed[0]} title={can.removed[1]} onClick={decide('removed')}><VisibilityOffIcon /></RowIcon>
        </>
      )}
    </>
  );
}

/** "together 88", titled "All 6 pictures together" (and a by-hand decision); null while not scored yet. */
function togetherChip(g) {
  if (g.pool_score == null) return null;
  const hand = g.decision ? ` · ${g.decision === 'drop' ? 'dropped' : 'kept'} by hand` : '';
  const all = g.pool_images != null ? `All ${g.pool_images} pictures together` : 'All her pictures together';
  return <TileChip tone="dim" title={`${all}${hand}`}>together {g.pool_score}</TileChip>;
}

function PerformerTile({ g, busy, sourceLabel, onOpen, onDecide, controls = true }) {
  const st = decisionState(g);
  const name = g.names?.[0] || 'Unknown';
  const finds = g.members?.length || 0;
  // the finds box: mounted from the first open on, so it can fade out when closed
  const [anchor, setAnchor] = useState(null);
  const [findsOpen, setFindsOpen] = useState(false);
  const openFinds = useCallback((e) => { setAnchor(e.currentTarget); setFindsOpen(true); }, []);
  const closeFinds = useCallback(() => setFindsOpen(false), []);
  const sites = (g.sources || []).map(s => (sourceLabel ? sourceLabel(s) : s)).join(', ');
  const data = dataLine(g.data);
  const counts = [g.profiles ? plural(g.profiles, 'profile') : null, g.posts ? plural(g.posts, 'post') : null].filter(Boolean).join(' · ');
  const metaTip = [data, counts, sites && `on ${sites}`].filter(Boolean).join(' · ');
  const chips = {
    tl: g.best_score != null ? <TileChip tone={g.kept ? 'ok' : undefined} title="Best picture">{g.best_score}</TileChip> : null,
    tr: st.chip ? <TileChip tone={st.chip.tone} title={st.chip.title} href={st.chip.href}>{st.chip.text}</TileChip> : null,
    bl: togetherChip(g),
    br: finds > 0 ? (
      <TileChip tone="info" title={`Her finds and their links${sites ? `: ${sites}` : ''}`} onClick={openFinds}
        aria-haspopup="dialog" aria-expanded={findsOpen} aria-label={`${plural(finds, 'find')} of ${name}: show their links`}>
        {plural(finds, 'find')}
      </TileChip>
    ) : null
  };
  return (
    <>
      <Tile
        title={name}
        titleTip={(g.names || [name]).join(' · ')}
        meta={data || counts}
        metaTip={metaTip}
        image={coverOf(g)}
        ariaLabel={name}
        onOpen={onOpen ? () => onOpen(g) : undefined}
        tone={st.tone}
        busy={busy}
        dimmed={!g.kept}
        chips={chips}
        controls={controls ? <DecisionRow g={g} busy={busy} onDecide={onDecide} /> : null}
      />
      {anchor && (
        <FindsPopover open={findsOpen} anchorEl={anchor} g={g} sourceLabel={sourceLabel} onClose={closeFinds}
          onDetails={onOpen ? () => onOpen(g) : undefined} />
      )}
    </>
  );
}

export default memo(PerformerTile);
