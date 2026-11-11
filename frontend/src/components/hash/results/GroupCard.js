import React from 'react';
import { Panel } from '../../layout';
import Tile from './Tile';

/** Header badges of a group: 'Exact', '94% similar', '+1 similar', 'Choose a keeper', … */
export function groupBadges(group, skipped) {
  const out = [];
  const c = group.counts || {};
  const nonExact = (c.similar || 0) + (c.linked || 0);
  if (c.exact > 0) {
    out.push({ text: 'Exact', tone: 'bad' });
    if (nonExact > 0) out.push({ text: `+${nonExact} similar`, tone: 'warn' });
  } else if (group.minSimilarity !== null && group.minSimilarity !== undefined) {
    out.push({ text: `${group.minSimilarity}% similar`, tone: 'warn' });
  }
  if (group.state === 'choose_keeper') {
    out.push({ text: 'Choose a keeper', tone: 'warn' });
    const keeper = group.members.find(m => m.isKeeper);
    if (keeper && !keeper.history && keeper.disk === 'no') out.push({ text: 'Keeper not on disk', tone: 'warn' });
  }
  if (skipped) out.push({ text: `Skipped: ${skipped}`, tone: 'warn' });
  return out;
}

function GroupCard({ group, ctx, busy, skipped, onToggle, onMakeKeeper, onPreview, onKeepAll }) {
  const c = group.counts || {};
  const selected = c.selected || 0;
  const total = c.members || group.members.length;
  const meta = [`${selected.toLocaleString()} of ${total.toLocaleString()} to remove`];
  // A tile says how alike it is only when the header cannot say it for all of them.
  const mixed = (c.exact || 0) > 0 && ((c.similar || 0) + (c.linked || 0)) > 0;
  const showPct = mixed || group.members.length > 2;
  // The folder line only when the copies are not all in the same folder (always on a comparison: whose file it is).
  const showFolder = ctx.kind === 'compare' || new Set(group.members.map(m => `${m.location || ''}|${m.folder || ''}`)).size > 1;
  // The card is as wide as its files need: a pair takes two tile slots, a group of 5 takes five (at most 6 per row).
  const cols = Math.max(2, Math.min(6, group.members.length));
  return (
    <Panel
      padded={false}
      component="article"
      className={`hr-group${busy ? ' busy' : ''}`}
      aria-busy={busy || undefined}
      style={{ '--cols': cols }}
    >
      <div className="hr-grp-h">
        {groupBadges(group, skipped).map(b => (
          <span key={b.text} className={`hr-badge ${b.tone}`}>{b.text}</span>
        ))}
        <span className="hr-gmeta">{meta.join(' · ')}</span>
        <span className="hr-tip" title={selected ? 'Untick every copy in this group' : 'Nothing in this group is ticked'}>
          <button type="button" className="hr-btn text sm" disabled={!selected || busy} onClick={() => onKeepAll(group.key)}>
            Keep all
          </button>
        </span>
      </div>
      <div className="hr-tiles">
        {group.members.map(m => (
          <Tile
            key={m.fileId}
            member={m}
            groupKey={group.key}
            groupState={group.state}
            showPct={showPct}
            showFolder={showFolder}
            ctx={ctx}
            onToggle={onToggle}
            onMakeKeeper={onMakeKeeper}
            onPreview={onPreview}
          />
        ))}
      </div>
    </Panel>
  );
}

export default React.memo(GroupCard);
