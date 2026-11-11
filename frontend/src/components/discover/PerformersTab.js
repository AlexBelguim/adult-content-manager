/**
 * Discover → Performers, Liked and Kept: the one performer card grid (PerformerGrid), with this tab's filters in the URL.
 * Performers has two views: To decide (default) and Decided (deleted, removed and checked: Put back undoes a decision).
 * Keep and Delete reach the profile page and P's training; Remove only takes her off Discover (POST /performer-status).
 */
import React from 'react';
import { Box } from '@mui/material';
import { Toolbar } from '../layout';
import { FilterChip, SearchField, Segment, SmallButton, SortSelect, TotalText, useQueryState } from './shared';
import PerformerGrid from './PerformerGrid';
import './tabs.css';

const DEFAULTS = { show: 'decide', q: '', sort: 'score', new: '', data: '', pics: '', hideHand: '' };
const SORTS = ['score', 'scoreAsc', 'newest', 'name'];
const EXPORT_TIP = 'The profile data of every performer in this tab, whatever the search and filters';

const EMPTY = {
  all: { title: 'No performers', description: 'Run a watcher to find performers.' },
  decided: { title: 'Nothing decided', description: 'Deleted, removed and checked performers show up here. Put back undoes a decision.' },
  liked: { title: 'No liked performers', description: 'Performers with something above the line show up here.' },
  kept: { title: 'Nothing kept yet', description: 'Keep a performer and she shows up here, until you mark her Checked.' }
};

export default function PerformersTab({ tab, version, ask, notify, refresh, watchers = [], sourceLabel, totals = {} }) {
  const [qs, setQs] = useQueryState(DEFAULTS);
  const view = tab === 'performers' ? (qs.show === 'decided' ? 'decided' : 'all') : tab;
  const sort = SORTS.includes(qs.sort) ? qs.sort : 'score';

  // Which filters this view has: data on Performers to decide; pics and hideHand there and on Liked; New only everywhere
  const hasData = view === 'all';
  const hasPics = view === 'all' || view === 'liked';
  const byHand = watchers.filter(w => !w.watch).map(w => w.label);
  const hasHand = hasPics && byHand.length > 0;

  const on = {
    new: qs.new === '1',
    data: hasData && qs.data === '1',
    pics: hasPics && qs.pics === '1',
    hideHand: hasHand && qs.hideHand === '1'
  };
  const q = qs.q || '';
  const params = new URLSearchParams({ view, q, sort });
  for (const key of ['new', 'data', 'pics', 'hideHand']) if (on[key]) params.set(key, '1');

  const toggle = (key) => setQs({ [key]: on[key] ? '' : '1' });
  const filtered = !!q || on.new || on.data || on.pics || on.hideHand;
  const clearFilters = () => setQs({ q: '', new: '', data: '', pics: '', hideHand: '' });
  const exportOnly = tab === 'liked' ? '?only=liked' : tab === 'kept' ? '?only=kept' : '';

  const toolbar = (list) => (
    <Toolbar>
      {tab === 'performers' && (
        <Segment label="Show" value={view === 'decided' ? 'decided' : 'decide'}
          onChange={(show) => setQs({ show, data: '', pics: '', hideHand: '' })}
          options={[
            { id: 'decide', label: 'To decide', count: totals.performers },
            { id: 'decided', label: 'Decided', count: totals.hidden }
          ]} />
      )}
      <Box className="dt-search">
        <SearchField value={q} onChange={(q) => setQs({ q })} placeholder="Search names and aliases" />
      </Box>
      <SortSelect value={sort} onChange={(next) => setQs({ sort: next })} />
      <FilterChip on={on.new} onClick={() => toggle('new')} title="Only the performers not in the library yet">New only</FilterChip>
      {hasData && <FilterChip on={on.data} onClick={() => toggle('data')} title="Only the performers with profile data">Has profile data</FilterChip>}
      {hasPics && (
        <FilterChip on={on.pics} onClick={() => toggle('pics')} title="Only the performers with 3 or more pictures">3+ pictures</FilterChip>
      )}
      {hasHand && (
        <FilterChip on={on.hideHand} onClick={() => toggle('hideHand')}
          title="Leaves out the performers found only by the watchers that run by hand; one also found elsewhere stays">
          {`Hide ${byHand.join(' / ')} only`}
        </FilterChip>
      )}
      <TotalText>{`${list.items.length} of ${list.total}`}</TotalText>
      {view !== 'decided' && (
        <Box sx={{ ml: 'auto' }}>
          <SmallButton component="a" href={`/api/discovery/export/profile-data${exportOnly}`} tip={EXPORT_TIP}>Export profile data</SmallButton>
        </Box>
      )}
    </Toolbar>
  );

  const empty = filtered
    ? { title: 'No performers', description: 'No performer matches the filters.', action: <SmallButton onClick={clearFilters}>Clear filters</SmallButton> }
    : EMPTY[view];

  return (
    <PerformerGrid path={`/performers?${params}`} view={view} version={version} toolbar={toolbar} empty={empty}
      sourceLabel={sourceLabel} ask={ask} notify={notify} refresh={refresh} />
  );
}
