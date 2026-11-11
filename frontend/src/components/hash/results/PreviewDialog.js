import React, { useEffect, useState } from 'react';
import { Dialog, IconButton, useMediaQuery } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  thumbUrl, fullUrl, formatBytes, formatDate, formatDuration, similarityText
} from '../hashApi';
import { KeepRemove, MakeKeeper, memberBadges, isGone } from './Tile';

export const dialogPaperSx = {
  background: 'var(--surface)',
  backgroundImage: 'none',
  border: '1px solid var(--line-strong)',
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--text)'
};

/** Full media: picture, playable video, a still for other formats, or nothing when gone. */
function Media({ member, keeper }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [member.path]);
  const cls = `hr-big${keeper ? ' keeper' : ''}`;
  if (isGone(member)) {
    return <div className={cls}><span className="hr-ph">Not on disk</span></div>;
  }
  if (member.type === 'vid' && member.playable) {
    return (
      <div className={cls}>
        <video key={member.path} controls preload="metadata" poster={thumbUrl(member)} src={fullUrl(member)} />
      </div>
    );
  }
  if (member.type === 'vid') {
    return (
      <div className={cls}>
        {failed
          ? <span className="hr-ph">No preview</span>
          : <img src={thumbUrl(member)} alt="" decoding="async" onError={() => setFailed(true)} />}
        <span className="hr-cannot">This format cannot play in the browser</span>
      </div>
    );
  }
  return (
    <div className={cls}>
      {failed
        ? <span className="hr-ph">No preview</span>
        : <img key={member.path} src={fullUrl(member)} alt={member.name} decoding="async" onError={() => setFailed(true)} />}
    </div>
  );
}

function Facts({ member, other }) {
  const m = member;
  const res = m.width && m.height ? `${m.width}×${m.height}` : 'Unknown';
  const higher = other && m.width && m.height && other.width && other.height
    && m.width * m.height > other.width * other.height;
  const rows = [
    ['Full path', m.path],
    ['Resolution', higher ? `${res} (higher)` : res, higher],
    ['Size', formatBytes(m.size)]
  ];
  if (m.type === 'vid') rows.push(['Duration', m.duration ? formatDuration(m.duration) : 'Unknown']);
  rows.push(['Date', m.mtime ? formatDate(m.mtime * 1000) : 'Unknown']);
  if (!m.isKeeper) {
    rows.push(['Similarity', m.relation === 'exact'
      ? 'Exact copy (same bytes)'
      : m.similarity !== null && m.similarity !== undefined
        ? `${m.similarity}% (distance ${m.distance ?? '?'} of 64)`
        : similarityText(m)]);
  }
  if (m.disk === 'changed' && m.current) {
    rows.push(['Now on disk', `${formatBytes(m.current.size)} · ${formatDate(m.current.mtime * 1000)}`]);
  }
  return (
    <dl className="hr-rows">
      {rows.map(([k, v, better]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd className={better ? 'better' : undefined}>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Side({ member, other, group, ctx, onToggle, onMakeKeeper }) {
  const badges = memberBadges(member, group.state, ctx);
  return (
    <div style={{ minWidth: 0 }}>
      <div className="hr-side-h">
        {badges.slice(0, 2).map(b => <span key={b.text} className={`hr-badge wrap ${b.tone}`}>{b.text}</span>)}
        <span style={{ minWidth: 0 }}>{member.name}</span>
      </div>
      <Media member={member} keeper={member.isKeeper && group.state !== 'choose_keeper'} />
      <Facts member={member} other={other} />
      <div className="hr-pctl">
        <KeepRemove member={member} groupState={group.state} onToggle={(itemId, sel) => onToggle(group.key, itemId, sel)} />
        <MakeKeeper member={member} groupState={group.state} ctx={ctx} onMakeKeeper={fileId => onMakeKeeper(group.key, fileId)} />
      </div>
    </div>
  );
}

/**
 * Side-by-side preview: the clicked file against its keeper (keeper clicked:
 * the keeper against its first copy). Previous / Next walk every non-keeper
 * member of the page in order. Keys: Esc, Left, Right.
 */
export default function PreviewDialog({ open, groups, target, ctx, onClose, onNavigate, onToggle, onMakeKeeper }) {
  const fullScreen = useMediaQuery('(max-width:600px)');

  // Every non-keeper member of the list, in page order.
  const order = [];
  for (const g of groups || []) for (const m of g.members) if (!m.isKeeper) order.push({ groupKey: g.key, fileId: m.fileId });

  const group = target ? (groups || []).find(g => g.key === target.groupKey) : null;
  const clicked = group ? group.members.find(m => m.fileId === target.fileId) : null;
  const keeper = group ? group.members.find(m => m.isKeeper) : null;
  const member = clicked && clicked.isKeeper ? group.members.find(m => !m.isKeeper) : clicked;
  const index = member ? order.findIndex(o => o.groupKey === group.key && o.fileId === member.fileId) : -1;
  const prev = index > 0 ? order[index - 1] : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : null;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => {
      const t = e.target;
      if (t && (t.tagName === 'VIDEO' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); onNavigate(prev); }
      if (e.key === 'ArrowRight' && next) { e.preventDefault(); onNavigate(next); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prev, next, onNavigate]);

  const show = open && !!group && !!member;
  const title = !member ? '' : clicked && clicked.isKeeper
    ? `${clicked.name} against its first copy`
    : `${member.name} against the keeper`;

  return (
    <Dialog
      open={show}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="hr-preview-title"
      slotProps={{ paper: { sx: dialogPaperSx } }}
    >
      {show && (
        <>
          <div className="hr-dialog-title">
            <h2 id="hr-preview-title">{title}</h2>
            <IconButton onClick={onClose} aria-label="Close" title="Close" sx={{ color: 'var(--dim)' }}>
              <CloseIcon />
            </IconButton>
          </div>
          <div className="hr-dbody">
            <div className="hr-cmp">
              {keeper && (
                <Side key={`k${keeper.fileId}`} member={keeper} other={member} group={group} ctx={ctx} onToggle={onToggle} onMakeKeeper={onMakeKeeper} />
              )}
              <Side key={`m${member.fileId}`} member={member} other={keeper} group={group} ctx={ctx} onToggle={onToggle} onMakeKeeper={onMakeKeeper} />
            </div>
          </div>
          <div className="hr-dacts">
            <button type="button" className="hr-btn text" disabled={!prev} onClick={() => prev && onNavigate(prev)}>
              <ChevronLeftIcon />Previous
            </button>
            <button type="button" className="hr-btn text" disabled={!next} onClick={() => next && onNavigate(next)}>
              Next<ChevronRightIcon />
            </button>
            <span className="hr-grow" />
            <button type="button" className="hr-btn outlined" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
