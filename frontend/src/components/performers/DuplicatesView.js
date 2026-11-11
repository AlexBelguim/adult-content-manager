/**
 * Performer Management's Duplicates view: hash duplicates only, in two sections (the tiles above are model.js
 * FILTERS.duplicates). A name in both Before and After is not here: the Library shows those pairs (PairRow.js).
 *
 *   Duplicates in her own files performers whose latest check of her own files left duplicates open: Open them
 *   No hash database yet (N)    one compact line: Build missing (N) and List them / Hide them
 *
 *   <DuplicatesView performers={rows} ctx={ctx} actions={actions} selectedId={id | null} onOpen={(id) => …} />
 *
 * performers: the view's rows after its filter and search (viewList); the sections come from them
 * (duplicateSections). ctx.filter picks the sections: 'all' every one with something in it, 'own' / 'nohash' that
 * one; each header counts what its tile counts. selectedId / onOpen(id): the record whose side panel is open
 * (?performer=<id>) and what opens one. actions: useRowActions() (run, buildMissing).
 */
import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { Panel } from '../layout';
import { SmallButton } from '../discover/shared';
import PerformerRow from './PerformerRow';
import { SectionTitle } from './PairRow';
import { actionOf, duplicateSections, formatNumber, missingHashList } from './model';

const PAGE_ROWS = 100;
const quiet = (promise) => { Promise.resolve(promise).catch(() => {}); };

const sectionSx = { mb: 3, minWidth: 0 };
const hintSx = { fontSize: '.8125rem', color: 'var(--dim)', mb: 1, lineHeight: 1.5 };
const lineSx = {
  display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 1.5, py: 1, minHeight: 48, boxSizing: 'border-box'
};
const lineTextSx = { flex: '1 1 auto', minWidth: 0, fontSize: '.875rem', color: 'var(--text)', fontWeight: 600 };
const moreSx = { display: 'flex', justifyContent: 'center', py: 1.5, borderTop: '1px solid var(--line)' };

/** The first 100 of a list, then 100 more at a time. */
function useLimit() {
  const [n, setN] = useState(PAGE_ROWS);
  return [n, () => setN(x => x + PAGE_ROWS)];
}

function More({ total, limit, onMore }) {
  if (total <= limit) return null;
  return (
    <Box sx={moreSx}>
      <SmallButton onClick={onMore}>{`Show ${Math.min(PAGE_ROWS, total - limit)} more`}</SmallButton>
    </Box>
  );
}

export default function DuplicatesView({ performers = [], ctx, actions, selectedId = null, onOpen }) {
  const [listNoHash, setListNoHash] = useState(null);   // null: as the filter says
  const [ownLimit, moreOwn] = useLimit();
  const [noHashLimit, moreNoHash] = useLimit();

  const filter = ctx?.filter || 'all';
  const openId = selectedId == null || selectedId === '' ? null : Number(selectedId);
  const derived = duplicateSections(performers);
  const own = (filter === 'all' || filter === 'own') ? derived.own : [];
  const nohash = (filter === 'all' || filter === 'nohash') ? derived.nohash : [];
  const buildable = missingHashList(nohash, ctx);
  const noHashListed = listNoHash ?? filter === 'nohash';

  const row = (p, extra) => (
    <PerformerRow key={p.id} performer={p} ctx={ctx} actions={actions} selected={openId === p.id} onOpen={onOpen} {...extra} />
  );

  return (
    <Box sx={{ minWidth: 0 }}>
      {own.length > 0 && (
        <Box component="section" sx={sectionSx} aria-labelledby="pm-dup-own">
          <SectionTitle id="pm-dup-own" count={own.length}>Duplicates in her own files</SectionTitle>
          <Box sx={hintSx}>Her last check found the same file more than once in her own folder.</Box>
          <Panel padded={false} sx={{ overflow: 'hidden' }}>
            {own.slice(0, ownLimit).map(p => {
              const n = Number(p.internal_duplicate_count) || 0;
              const a = actionOf(p, ctx, 'hash-results', `Open ${formatNumber(n)} duplicate${n === 1 ? '' : 's'}`);
              const open = a && !a.disabled && a.to
                ? <SmallButton component={RouterLink} to={a.to}>{a.label}</SmallButton>
                : <SmallButton disabled tip={a?.disabled || undefined}>{a?.label || 'Open duplicates'}</SmallButton>;
              return row(p, { extra: open, hide: ['dupes'] });
            })}
            <More total={own.length} limit={ownLimit} onMore={moreOwn} />
          </Panel>
        </Box>
      )}

      {nohash.length > 0 && (
        <Box component="section" sx={sectionSx} aria-labelledby="pm-dup-nohash">
          <Panel padded={false} sx={{ overflow: 'hidden' }}>
            <Box sx={lineSx}>
              <Box sx={lineTextSx} id="pm-dup-nohash">
                {`No hash database yet (${formatNumber(nohash.length)})`}
              </Box>
              <SmallButton onClick={() => quiet(actions?.buildMissing?.(buildable))} disabled={buildable.length === 0}
                tip={buildable.length === 0 ? 'They are all queued or hashing, see Jobs' : undefined}>
                {`Build missing (${formatNumber(buildable.length)})`}
              </SmallButton>
              <SmallButton onClick={() => setListNoHash(!noHashListed)} aria-expanded={noHashListed} aria-controls="pm-dup-nohash-list">
                {noHashListed ? 'Hide them' : 'List them'}
              </SmallButton>
            </Box>
            {noHashListed && (
              <Box id="pm-dup-nohash-list" sx={{ borderTop: '1px solid var(--line)' }}>
                {nohash.slice(0, noHashLimit).map(p => row(p))}
                <More total={nohash.length} limit={noHashLimit} onMore={moreNoHash} />
              </Box>
            )}
          </Panel>
        </Box>
      )}
    </Box>
  );
}
