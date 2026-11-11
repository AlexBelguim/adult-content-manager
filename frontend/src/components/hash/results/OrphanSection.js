import React from 'react';
import { CircularProgress } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Panel, Section } from '../../layout';
import { plural } from '../hashApi';
import { Thumb, KeepRemove, memberFolder, isGone } from './Tile';

function matchText(member) {
  if (member.relation === 'exact') return 'exact';
  if (member.similarity !== null && member.similarity !== undefined) return `${member.similarity}%`;
  return 'similar';
}

/** 'Matched X (exact), which was deleted before. This is the last copy.' */
export function orphanWhy(member, group) {
  const keeper = group.members.find(m => m.isKeeper);
  const live = group.members.filter(m => !m.isKeeper && !isGone(m));
  const name = keeper ? keeper.name : 'another copy';
  const base = `Matched ${name} (${matchText(member)})`;
  if (keeper?.history === 'removed') return `${base}, which was removed as a duplicate.`;
  if (keeper?.history === 'deleted_before') {
    return `${base}, which was deleted before.${live.length <= 1 ? ' This is the last copy.' : ''}`;
  }
  return `${base}, which is no longer on disk.${live.length <= 1 ? ' This is the last copy.' : ''}`;
}

/**
 * 'Other copy already removed': collapsed; fetched and rendered only when
 * open. Nothing here is ticked unless the user ticks it.
 */
export default function OrphanSection({
  count, open, onOpenChange, orphans, ctx, busyKeys,
  onToggle, onDismiss, onPreview
}) {
  const rows = [];
  for (const g of orphans.groups) {
    for (const m of g.members) {
      if (!m.isKeeper && !isGone(m)) rows.push({ g, m });
    }
  }
  return (
    <Section>
      <Panel padded={false} sx={{ overflow: 'hidden' }}>
        <button
          type="button"
          className={`hr-collapse-h${open ? ' open' : ''}`}
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRightIcon className="hr-chev" />
          <span style={{ fontWeight: 620 }}>Other copy already removed</span>
          <span className="hr-badge hr-num">{count.toLocaleString()}</span>
          <span className="hr-grow" />
          <span className="hr-note">Loaded when opened · nothing here is ticked unless you tick it</span>
        </button>
        {open && (
          <div>
            {orphans.loading && rows.length === 0 && (
              <div className="hr-more"><CircularProgress size={16} sx={{ color: 'var(--accent)' }} />Loading…</div>
            )}
            {orphans.error && rows.length === 0 && (
              <div className="hr-more">
                {`Could not load these matches: ${orphans.error.message}`}
                <button type="button" className="hr-btn text sm" onClick={orphans.reload}>Retry</button>
              </div>
            )}
            {!orphans.loading && !orphans.error && rows.length === 0 && (
              <div className="hr-more">Nothing left here.</div>
            )}
            {rows.map(({ g, m }) => {
              const busy = busyKeys.has(g.key);
              return (
                <div className="hr-orow" key={`${g.key}:${m.fileId}`} style={busy ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
                  <Thumb member={m} onOpen={() => onPreview(g.key, m.fileId, 'orphans')} />
                  <div style={{ minWidth: 0 }}>
                    <div className="hr-fname" title={m.name}>{m.name}</div>
                    <div className="hr-folder" title={m.path}>{memberFolder(m, ctx)}</div>
                    <div className="hr-why">{orphanWhy(m, g)}</div>
                    <div className="hr-orow-ctl">
                      <KeepRemove member={m} groupState={g.state} onToggle={(itemId, sel) => onToggle(g.key, itemId, sel)} />
                      <button
                        type="button"
                        className="hr-btn text sm"
                        title="Drop this match from the check; the file is not touched"
                        onClick={() => onDismiss(g.key)}
                      >Dismiss match</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {orphans.page < orphans.pageCount && rows.length > 0 && (
              <div className="hr-more">
                <span className="hr-num">{`${plural(Math.max(0, orphans.total - orphans.groups.length), 'more match', 'more matches')}`}</span>
                <button type="button" className="hr-btn outlined sm" disabled={orphans.loading} onClick={orphans.loadMore}>
                  {orphans.loading ? <CircularProgress size={14} color="inherit" /> : null}
                  Show more
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </Section>
  );
}
