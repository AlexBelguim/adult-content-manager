import React, { useState } from 'react';
import StarIcon from '@mui/icons-material/StarRounded';
import StarBorderIcon from '@mui/icons-material/StarBorderRounded';
import {
  thumbUrl, formatBytes, formatDay, formatDuration, folderText,
  reasonText, keeperReasonText
} from '../hashApi';

/* ─── shared bits (also used by the orphan rows and the preview) ─── */

/** Folder line: 'pics / import 2026-10'; comparisons: '<owner> / <location> / <folder>'. */
export function memberFolder(m, ctx) {
  if (ctx.kind === 'compare') {
    return [m.ownerName, m.location, folderText(m.folder)].filter(Boolean).join(' / ');
  }
  // Own files: the location only when it is not her usual one (a copy in the other folder).
  const loc = m.location && ctx.sourceLocation && m.location !== ctx.sourceLocation ? m.location : null;
  return [loc, folderText(m.folder)].filter(Boolean).join(' / ');
}

/** '4032×3024 · 3.1 MB · 6:12 · 12 Mar 2025' */
export function memberFacts(m) {
  const parts = [];
  if (m.width && m.height) parts.push(`${m.width}×${m.height}`);
  parts.push(formatBytes(m.size));
  if (m.type === 'vid' && m.duration) parts.push(formatDuration(m.duration));
  if (m.mtime) parts.push(formatDay(m.mtime * 1000));
  return parts.join(' · ');
}

/** True when the file itself is gone (no image request is made). */
export function isGone(m) {
  return m.disk === 'no' || m.history === 'deleted_before' || m.history === 'removed';
}

/** Relation badges for a member: [{ text, tone }]. */
export function memberBadges(m, groupState, ctx) {
  const out = [];
  if (m.history === 'deleted_before') out.push({ text: 'Not on disk: deleted before', tone: 'warn' });
  else if (m.history === 'removed') out.push({ text: 'Removed as a duplicate', tone: 'warn' });
  else if (m.disk === 'no') out.push({ text: 'Not on disk', tone: 'warn' });

  if (m.isKeeper) {
    if (!m.history && m.disk === 'yes') out.unshift({ text: 'Keeper', tone: 'ok' });
    else if (!m.history && m.disk !== 'no') out.unshift({ text: 'Keeper', tone: 'ok' });
  } else if (m.relation === 'exact') {
    out.push({ text: 'Exact copy', tone: 'bad' });
  } else if (m.relation === 'linked') {
    out.push({ text: `Linked through ${m.linkedVia?.name || 'another copy'}`, tone: 'info' });
    if (m.similarity !== null && m.similarity !== undefined) out.push({ text: `${m.similarity}% like the keeper`, tone: 'warn' });
  } else if (m.similarity !== null && m.similarity !== undefined) {
    out.push({ text: `${m.similarity}% like the keeper`, tone: 'warn' });
  }

  if (m.disk === 'changed') out.push({ text: 'Changed after the check', tone: 'warn' });
  if (ctx.kind === 'compare' && m.ownerName) out.push({ text: m.ownerName, tone: '' });
  return out;
}

/** The one 'why' line under a tile, or null. */
export function memberWhy(m, groupState) {
  if (m.isKeeper) {
    if (groupState === 'choose_keeper') return { text: 'It was the keeper. Pick one of the copies that still exist.' };
    return null;
  }
  if (m.disk === 'changed' || m.reason === 'changed') {
    return { text: 'Changed after the check. Run Check again to compare the new version.', tone: 'warn' };
  }
  if (m.reason === 'other_performer') return { text: reasonText('other_performer', { ownerName: m.ownerName }) };
  if (m.waiting) return { text: 'Ticked, but its keeper is not on disk. Choose a keeper first.', tone: 'warn' };
  // Why Remove is disabled comes first: a phone cannot show the button's title.
  if (!m.canSelect && m.reason && m.reason !== 'keeper') return { text: reasonText(m.reason, { ownerName: m.ownerName }) };
  const videoNote = m.type === 'vid' && m.relation !== 'exact' && !isGone(m)
    ? 'Similar videos are matched on one frame. Check the length before removing.'
    : null;
  if (m.selected && m.selectedBy === 'user') {
    return videoNote ? { text: `You ticked this one. ${videoNote}`, tone: 'warn' } : { text: 'You ticked this one.' };
  }
  if (videoNote) return { text: videoNote, tone: m.selected ? 'warn' : '' };
  if (!m.selected && m.canSelect && m.relation === 'linked') return { text: 'Not ticked: matched another copy, not the keeper directly.' };
  if (!m.selected && m.canSelect && m.relation === 'similar') return { text: 'Not ticked: similar, not identical.' };
  return null;
}

/** The thumbnail button: lazy image, 'No preview' on error, 'Not on disk' without a request. */
export const Thumb = React.memo(function Thumb({ member, onOpen, className = 'hr-pic', hideDuration = false }) {
  const [failed, setFailed] = useState(false);
  const gone = isGone(member);
  const src = gone ? null : thumbUrl(member);
  return (
    <button
      type="button"
      className={className}
      onClick={onOpen}
      title={gone ? 'Not on disk: details only' : 'Open preview'}
      aria-label={`Open preview of ${member.name}`}
    >
      {gone ? (
        <span className="hr-ph">Not on disk</span>
      ) : failed ? (
        <span className="hr-ph">No preview</span>
      ) : (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      )}
      {!hideDuration && member.type === 'vid' && member.duration ? (
        <span className="hr-ochip">{formatDuration(member.duration)}</span>
      ) : null}
    </button>
  );
});

/**
 * Keep | Remove segment. Keep stays enabled for a selected item so it can be
 * unticked; Remove only when the member can be selected.
 */
export function KeepRemove({ member, groupState, onToggle }) {
  const m = member;
  if (m.isKeeper) {
    const t = groupState === 'choose_keeper' ? 'This file is not on disk' : 'The keeper is always kept';
    return (
      <div className="hr-kr" role="radiogroup" aria-label={`Keep or remove ${m.name}`}>
        <button type="button" role="radio" aria-checked={groupState !== 'choose_keeper'} className={`k${groupState !== 'choose_keeper' ? ' on' : ''}`} disabled title={t}>Keep</button>
        <button type="button" role="radio" aria-checked="false" className="r" disabled title={reasonText('keeper')}>Remove</button>
      </div>
    );
  }
  const live = !isGone(m) && m.reason !== 'choose_keeper';
  const keepOn = !m.selected && live;
  const keepEnabled = m.selected || m.canSelect;
  const removeEnabled = m.canSelect;
  const why = m.canSelect ? '' : reasonText(m.reason, { ownerName: m.ownerName });
  return (
    <div className="hr-kr" role="radiogroup" aria-label={`Keep or remove ${m.name}`}>
      <button
        type="button" role="radio" aria-checked={keepOn}
        className={`k${keepOn ? ' on' : ''}`}
        disabled={!keepEnabled}
        title={keepEnabled ? 'Keep this file' : why}
        onClick={() => { if (m.selected) onToggle(m.itemId, false); }}
      >Keep</button>
      <button
        type="button" role="radio" aria-checked={!!m.selected}
        className={`r${m.selected ? ' on' : ''}`}
        disabled={!removeEnabled}
        title={removeEnabled ? 'Move this file to her trash when you confirm' : why}
        onClick={() => { if (!m.selected) onToggle(m.itemId, true); }}
      >Remove</button>
    </div>
  );
}

export function MakeKeeper({ member, groupState, onMakeKeeper, ctx, className = '' }) {
  const m = member;
  const enabled = m.canBeKeeper && !m.isKeeper;
  const primary = enabled && groupState === 'choose_keeper';
  const title = enabled
    ? 'Keep this file and offer the others for removal'
    : keeperReasonText(m.isKeeper ? 'is_keeper' : m.keeperReason, { otherName: ctx.targetName });
  return (
    <span className="hr-tip block" title={title}>
      <button
        type="button"
        className={`hr-cact${primary ? ' primary' : ''} ${className}`}
        disabled={!enabled}
        onClick={() => onMakeKeeper(m.fileId)}
      >Make keeper</button>
    </span>
  );
}

/** Short text for the control row of a file that cannot be ticked (the full reason is the row's title). */
function shortReason(m) {
  switch (m.reason) {
    case 'other_performer': return `${m.ownerName || 'Her'} copy · kept`;
    case 'deleted_before': return 'Deleted before';
    case 'removed': return 'Removed as a duplicate';
    case 'not_on_disk': return 'Not on disk';
    case 'changed': return 'Changed · check again';
    case 'keeper_changed': return 'Keeper changed · check again';
    case 'library_offline': return 'Library offline';
    case 'choose_keeper': return 'Choose a keeper first';
    default: return 'Cannot be removed';
  }
}

/** The one chip in the top-left corner of the picture, or null: only what the group header does not say. */
function tileFlag(m, showPct) {
  if (m.isKeeper) return null;
  if (m.waiting) return { text: 'Keeper not on disk', tone: 'warn' };
  if (m.relation === 'linked') return { text: 'Linked', tone: 'info', title: `Matched ${m.linkedVia?.name || 'another copy'}, not the keeper directly` };
  if (showPct && m.relation !== 'exact' && m.similarity !== null && m.similarity !== undefined) {
    return { text: `${m.similarity}%`, tone: 'warn', title: `${m.similarity}% like the keeper` };
  }
  if (showPct && m.relation === 'exact') return { text: 'Exact', tone: 'bad', title: 'Exact copy of the keeper' };
  return null;
}

/**
 * One file of a group. Every fact appears once: what kind of match is in the group header, resolution and size
 * on the picture, the length in its corner, the name under it, and one control row. The date, the full path and
 * the reasons in full are in the preview. Memoised: one toggle re-renders one tile.
 */
function Tile({ member, groupKey, groupState, ctx, showPct, showFolder, onToggle, onMakeKeeper, onPreview }) {
  const m = member;
  const gone = isGone(m);
  const toggle = (itemId, selected) => onToggle(groupKey, itemId, selected);
  const flag = tileFlag(m, showPct);
  const res = m.width && m.height ? `${m.width}×${m.height}` : null;
  const size = gone ? null : formatBytes(m.size);
  const keeperOk = m.isKeeper && groupState !== 'choose_keeper';
  const canKeeper = !m.isKeeper && m.canBeKeeper;
  const keeperTitle = canKeeper
    ? 'Make this the keeper: the others are then offered for removal'
    : keeperReasonText(m.keeperReason, { otherName: ctx.targetName });
  const state = keeperOk ? ' keeper' : m.selected && !m.waiting ? ' remove' : '';

  let row;
  if (m.isKeeper) {
    row = keeperOk
      ? <div className="hr-krow keeper" title="The keeper is never removed"><StarIcon fontSize="inherit" />Keeper</div>
      : <div className="hr-krow warn" title={reasonText('not_on_disk')}>Keeper · not on disk</div>;
  } else if (groupState === 'choose_keeper' && canKeeper) {
    row = (
      <button type="button" className="hr-cact primary" onClick={() => onMakeKeeper(groupKey, m.fileId)} title={keeperTitle}>
        <StarBorderIcon fontSize="inherit" />Make keeper
      </button>
    );
  } else if (m.canSelect || m.selected) {
    row = (
      <div className="hr-krow">
        <KeepRemove member={m} groupState={groupState} onToggle={toggle} />
        <button
          type="button"
          className="hr-star"
          disabled={!canKeeper}
          onClick={() => onMakeKeeper(groupKey, m.fileId)}
          title={keeperTitle}
          aria-label={`Make ${m.name} the keeper`}
        >
          <StarBorderIcon fontSize="inherit" />
        </button>
      </div>
    );
  } else {
    row = <div className="hr-krow muted" title={reasonText(m.reason, { ownerName: m.ownerName })}>{shortReason(m)}</div>;
  }

  return (
    <div className={`hr-tile${state}`}>
      <div className="hr-media">
        <Thumb member={m} hideDuration onOpen={() => onPreview(groupKey, m.fileId)} />
        {flag && <span className={`hr-ov tl ${flag.tone}`} title={flag.title}>{flag.text}</span>}
        {m.type === 'vid' && m.duration && !gone ? <span className="hr-ov tr">{formatDuration(m.duration)}</span> : null}
        {(res || size) && (
          <span className="hr-ovs">
            {res && <span className="hr-ov">{res}</span>}
            {size && <span className="hr-ov">{size}</span>}
          </span>
        )}
      </div>
      <div className="hr-fname" title={m.path}>{m.name}</div>
      {showFolder && <div className="hr-folder" title={m.path}>{memberFolder(m, ctx) || 'top folder'}</div>}
      {row}
    </div>
  );
}

export default React.memo(Tile);
