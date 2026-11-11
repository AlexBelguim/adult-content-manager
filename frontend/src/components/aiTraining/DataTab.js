/**
 * The AI & Training page's Data tab: what the models can train on (the page's picture counts and the AI server's, as
 * facts in the sidebar's 'Training data' group), and the same per performer (GET /api/training/performer-stats?scan_disk=true)
 * with its search and sort in the sidebar's Show group.
 * URL: &q=<search> &sort=name|kept|deleted|pairs|sorted (default kept).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import DatasetOutlined from '@mui/icons-material/DatasetOutlined';
import {
  Panel, EmptyState, LoadingState, SideGroup, SideSearch, SideSelect, SideFacts, SideButtons, SideButton, SideNote,
  ContentLine, SIDE
} from '../layout';
import { errorText, plural } from '../ui';
import { SmallButton, Badge, ListError, useQueryState } from '../discover/shared';
import { pairSourcesOf, fmtDay } from './modelInfo';

const FIRST = 200;
const SORTS = [
  ['name', 'Name'],
  ['kept', 'Kept, most first'],
  ['deleted', 'Deleted, most first'],
  ['pairs', 'Hand pairs, most first'],
  ['sorted', 'Sorted, least first'],
];
const SORT_OPTIONS = SORTS.map(([value, label]) => ({ value, label }));
const num = (n) => (n == null ? '–' : n.toLocaleString());
const kept = (p) => p.disk?.keep || 0;
const deleted = (p) => p.disk?.delete || 0;
const pairsOf = (p) => p.pairwise?.total || 0;
const sortedOf = (p) => p.filter?.progress || 0;
const byName = (a, b) => a.name.localeCompare(b.name);
const COMPARE = {
  name: byName,
  kept: (a, b) => kept(b) - kept(a) || byName(a, b),
  deleted: (a, b) => deleted(b) - deleted(a) || byName(a, b),
  pairs: (a, b) => pairsOf(b) - pairsOf(a) || byName(a, b),
  sorted: (a, b) => sortedOf(a) - sortedOf(b) || byName(a, b),
};

const COLUMNS = { xs: 'minmax(0,1fr)', sm: 'minmax(0,1fr) repeat(5, 72px)' };
const numCell = { display: { xs: 'none', sm: 'block' }, textAlign: 'right', fontSize: '.85rem', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' };
const headCell = { textAlign: 'right', fontSize: '.75rem', color: 'var(--muted)' };

function PerformerRow({ p, basePath }) {
  const usable = kept(p) > 0 && deleted(p) > 0;
  const mark = usable ? <Badge tone="ok">Usable</Badge> : <Box component="span" sx={{ color: 'var(--muted)' }}>–</Box>;
  const to = p.movedToAfter && basePath
    ? `/unified-gallery?performer=${encodeURIComponent(p.name)}&basePath=${encodeURIComponent(basePath)}`
    : `/filter/${p.id}`;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 1, rowGap: 0.25, alignItems: 'center', py: 0.75, borderTop: '1px solid var(--line)' }}>
      <Box component={RouterLink} to={to} sx={{
        minWidth: 0, fontSize: '.85rem', fontWeight: 560, color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        '&:hover': { color: 'var(--accent)', textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
      }}>
        {p.name}
      </Box>
      <Box sx={numCell}>{num(kept(p))}</Box>
      <Box sx={numCell}>{num(deleted(p))}</Box>
      <Box sx={numCell}>{num(pairsOf(p))}</Box>
      <Box sx={numCell}>{sortedOf(p)}%</Box>
      <Box sx={{ ...numCell, fontSize: '.75rem' }}>{mark}</Box>
      {/* the phone: the figures on a second line */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography component="span" sx={{ fontSize: '.75rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums', flex: '1 1 auto', minWidth: 0 }}>
          {num(kept(p))} kept · {num(deleted(p))} deleted · {plural(pairsOf(p), 'pair')} · {sortedOf(p)}% sorted
        </Typography>
        {usable && mark}
      </Box>
    </Box>
  );
}

function PerformerList({ reloadKey, notice }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [qs, setQs] = useQueryState({ q: '', sort: 'kept' });
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    setState(cur => ({ ...cur, status: 'loading', error: null }));
    try {
      const r = await fetch('/api/training/performer-stats?scan_disk=true');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `The server answered ${r.status}`);
      setState({ status: 'ok', data: d, error: null });
    } catch (err) {
      setState(cur => ({ ...cur, status: 'error', error: errorText(err, 'Could not load the performers') }));
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const rows = useMemo(() => state.data?.performers || [], [state.data]);
  const sort = COMPARE[qs.sort] ? qs.sort : 'kept';
  const shown = useMemo(() => {
    const needle = qs.q.trim().toLowerCase();
    const list = needle ? rows.filter(p => (p.name || '').toLowerCase().includes(needle)) : rows.slice();
    return list.sort(COMPARE[sort]);
  }, [rows, qs.q, sort]);
  const withData = rows.filter(p => kept(p) + deleted(p) > 0).length;
  const visible = all ? shown : shown.slice(0, FIRST);
  const searching = !!qs.q.trim();
  const sortLabel = (SORTS.find(([id]) => id === sort) || SORTS[1])[1];
  const meta = state.data
    ? `${shown.length.toLocaleString()} of ${plural(rows.length, 'performer')} · ${withData.toLocaleString()} with training pictures`
    : state.status === 'error' ? null : 'Loading…';

  let body;
  if (state.status === 'error') body = <ListError error={state.error} onRetry={load} />;
  else if (!state.data) body = <LoadingState />;
  else if (!rows.length) body = <EmptyState title="No performers yet" />;
  else {
    body = (
      <>
        <Panel sx={{ py: 0.5, px: 1.5 }}>
          <Box sx={{ display: { xs: 'none', sm: 'grid' }, gridTemplateColumns: COLUMNS, columnGap: 1, py: 0.75 }}>
            <Box sx={{ ...headCell, textAlign: 'left' }}>Performer</Box>
            <Box sx={headCell}>Kept</Box>
            <Box sx={headCell}>Deleted</Box>
            <Box sx={headCell}>Hand pairs</Box>
            <Box sx={headCell}>Sorted</Box>
            <Box sx={headCell}>K</Box>
          </Box>
          {visible.map(p => <PerformerRow key={p.id} p={p} basePath={state.data.basePath} />)}
          {!shown.length && (
            <Typography sx={{ fontSize: '.85rem', color: 'var(--dim)', py: 1.5, borderTop: '1px solid var(--line)' }}>No performer matches the search</Typography>
          )}
        </Panel>
        {!all && shown.length > FIRST && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
            <SmallButton onClick={() => setAll(true)}>{`Show all ${shown.length.toLocaleString()}`}</SmallButton>
          </Box>
        )}
      </>
    );
  }

  return (
    <>
      <SideGroup id="show" title="Show" icon={<TuneOutlined />} order={SIDE.show} badge={searching ? 1 : 0}
        summary={searching ? `"${qs.q.trim()}" · ${sortLabel}` : sortLabel}>
        <SideSearch value={qs.q} onChange={(v) => setQs({ q: v })} placeholder="Search performers" />
        <SideSelect label="Sort" value={sort} onChange={(v) => setQs({ sort: v })} options={SORT_OPTIONS} />
      </SideGroup>

      <ContentLine title="Data" meta={meta} />
      {notice}
      {body}
    </>
  );
}

export default function DataTab({ ai, summary, aiData, reloadKey, onRetry }) {
  const d = summary.data;
  const server = aiData.status === 'ok' ? aiData.data : null;
  const offline = aiData.status === 'offline' || ai.state === 'offline';

  let facts = null;
  if (d) {
    const pictures = d.pictures || {};
    const levels = d.taste?.performers || [];
    const level = l => levels.filter(t => t.level === l);
    const [keptPerfs, disliked, blacklisted] = ['kept', 'disliked', 'blacklisted'].map(level);
    const keptWithDeletes = keptPerfs.filter(t => t.delete > 0);
    const rated = keptPerfs.filter(t => t.stars != null);
    const sources = pairSourcesOf(d, aiData.data);
    const src = (id) => sources.find(s => s.id === id) || {};
    const rank = src('rank');
    const pairwiseDb = src('pairwise_db');
    const labeller = src('labeller');

    const serverRow = aiData.status === 'offline'
      ? { value: '–', title: 'acm-gpu not answering' }
      : !server ? { value: '–', title: 'Checking the AI server' }
        : server.has_data
          ? { value: `${num(server.keep)} / ${num(server.delete)}`, title: server.manifest?.created ? `keep / delete, pushed ${fmtDay(server.manifest.created)}` : 'keep / delete' }
          : server.has_data === false ? { value: '–', title: 'Nothing pushed yet' } : { value: '–', title: 'acm-gpu did not say' };
    const legacyValue = labeller.all == null && offline ? '–' : num((pairwiseDb.all || 0) + (labeller.all ?? 0));

    facts = (
      <SideFacts rows={[
        { label: 'Keep pictures', value: num(pictures.keep), title: plural(keptPerfs.length, 'performer') },
        { label: 'Delete pictures', value: num(pictures.delete), title: plural(pictures.performers || 0, 'performer') },
        { label: 'On the AI server', ...serverRow },
        { label: 'Usable for K', value: num(keptWithDeletes.length), title: 'performers with kept and deleted pictures' },
        { label: 'Hand pairs', value: num(rank.all), title: `${num(rank.same)} same performer · Rank images` },
        { label: 'Legacy pairs', value: legacyValue, title: 'pairwise.db import and old labeller file' },
        { label: 'Disliked / blacklisted', value: `${num(disliked.length)} / ${num(blacklisted.length)}`, title: 'only deleted pictures: CLIP Taste' },
        { label: 'Rated performers', value: num(rated.length), title: 'stars 2+ apart make CLIP Taste pairs' },
      ]} />
    );
  }

  const groupSummary = d
    ? `${num(d.pictures?.keep)} keep · ${num(d.pictures?.delete)} delete`
    : summary.status === 'error' ? 'Could not count' : 'Counting…';

  return (
    <Box>
      <SideGroup id="data" title="Training data" icon={<DatasetOutlined />} summary={groupSummary}
        dot={summary.status === 'error' ? 'bad' : null}>
        {facts || (
          <SideNote>{summary.status === 'error' ? 'Could not count the training pictures.' : 'Counting the training pictures…'}</SideNote>
        )}
        <SideButtons columns={2}>
          <SideButton component={RouterLink} to="/ranking-insight">Rank images</SideButton>
          <SideButton component={RouterLink} to="/smart-compare">Rate performers</SideButton>
        </SideButtons>
      </SideGroup>

      <PerformerList
        reloadKey={reloadKey}
        notice={summary.status === 'error' ? <ListError error={summary.error} onRetry={onRetry} /> : null}
      />
    </Box>
  );
}
