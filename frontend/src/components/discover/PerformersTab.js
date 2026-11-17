/**
 * Discover → Performers, Liked and Kept: the one performer card grid (PerformerGrid), with this tab's filters in the URL.
 * Performers has two views: To decide (default) and Decided (deleted, removed and checked: Put back undoes a decision).
 * Keep and Delete reach the profile page and P's training; Remove only takes her off Discover (POST /performer-status).
 * Its search, sort and filters are the sidebar's Show group; the content line says what is shown.
 */
import React, { useEffect, useState } from 'react';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import { ContentLine, SIDE, SideChecks, SideGroup, SideMultiSelect, SideNote, SideSearch, SideSegment, SideSelect } from '../layout';
import { get, SmallButton, SORT_OPTIONS, useQueryState } from './shared';
import PerformerGrid from './PerformerGrid';
import './tabs.css';

// The profile filters (GET /facets, backend/services/discover/facets.js): the query's key and the select's label
const FACETS = [
  { key: 'eth', label: 'Ethnicity' },
  { key: 'country', label: 'Country' },
  { key: 'tag', label: 'Tags' },
  { key: 'body', label: 'Body type' },
  { key: 'cup', label: 'Cup size' }
];
const FACETS_OFF = Object.fromEntries(FACETS.map(f => [f.key, '']));
const listOf = (s) => String(s || '').split(',').map(v => v.trim()).filter(Boolean);

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { regionNames = null; }
/** 'US' → 'United States'; the code itself when the browser has no name for it */
const countryName = (code) => { try { return regionNames?.of(code) || code; } catch { return code; } };

const DEFAULTS = { show: 'decide', q: '', sort: 'score', new: '', data: '', pics: '', hideHand: '', ...FACETS_OFF };
const SORTS = ['score', 'scoreAsc', 'newest', 'name'];
const TITLE = { all: 'Performers', decided: 'Decided', liked: 'Liked', kept: 'Kept' };
/** 'score, high to low': a sort's label inside a line */
export const sortText = (sort) => {
  const label = SORT_OPTIONS.find(o => o.value === sort)?.label || '';
  return label.charAt(0).toLowerCase() + label.slice(1);
};
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
  const chosen = Object.fromEntries(FACETS.map(f => [f.key, listOf(qs[f.key])]));
  // What is shown, without its order: the list's query, and the one the profile filters' options are counted for
  const shown = new URLSearchParams({ view, q });
  for (const key of ['new', 'data', 'pics', 'hideHand']) if (on[key]) shown.set(key, '1');
  for (const f of FACETS) if (chosen[f.key].length) shown.set(f.key, chosen[f.key].join(','));
  const shownQuery = shown.toString();
  const params = new URLSearchParams(shown);
  params.set('sort', sort);

  const [facets, setFacets] = useState(null);
  useEffect(() => {
    let live = true;
    get(`/facets?${shownQuery}`).then((r) => { if (live) setFacets(r); }).catch(() => {});
    return () => { live = false; };
  }, [shownQuery, version]);

  const toggle = (key) => setQs({ [key]: on[key] ? '' : '1' });
  const profileOn = FACETS.filter(f => chosen[f.key].length).length;
  const filtered = !!q || on.new || on.data || on.pics || on.hideHand || profileOn > 0;
  const clearFilters = () => setQs({ q: '', new: '', data: '', pics: '', hideHand: '', ...FACETS_OFF });
  const exportOnly = tab === 'liked' ? '?only=liked' : tab === 'kept' ? '?only=kept' : '';

  const onCount = [q, on.new, on.data, on.pics, on.hideHand].filter(Boolean).length;

  const toolbar = (list) => (
    <>
      <SideGroup id="show" title="Show" icon={<FilterListIcon />} badge={onCount} summary={onCount ? `${onCount} on` : 'no filters'} order={SIDE.show}>
        <SideSearch value={q} onChange={(next) => setQs({ q: next })} placeholder="Search names and aliases" />
        <SideSelect label="Sort" value={sort} onChange={(next) => setQs({ sort: next })} options={SORT_OPTIONS} />
        {tab === 'performers' && (
          <SideSegment label="Show" value={view === 'decided' ? 'decided' : 'decide'}
            onChange={(show) => setQs({ show, data: '', pics: '', hideHand: '' })}
            options={[
              { id: 'decide', label: 'To decide', count: totals.performers },
              { id: 'decided', label: 'Decided', count: totals.hidden }
            ]} />
        )}
        <SideChecks items={[
          { id: 'new', label: 'New only', checked: on.new, onChange: () => toggle('new'), title: 'Only the performers not in the library yet' },
          hasData && { id: 'data', label: 'Has profile data', checked: on.data, onChange: () => toggle('data'), title: 'Only the performers with profile data' },
          hasPics && { id: 'pics', label: '3+ pictures', checked: on.pics, onChange: () => toggle('pics'), title: 'Only the performers with 3 or more pictures' },
          hasHand && {
            id: 'hideHand', label: `Hide ${byHand.join(' / ')} only`, checked: on.hideHand, onChange: () => toggle('hideHand'),
            title: 'Leaves out the performers found only by the watchers that run by hand; one also found elsewhere stays'
          }
        ]} />
      </SideGroup>
      <SideGroup id="profile" title="Profile" icon={<BadgeOutlinedIcon />} badge={profileOn} summary={profileOn ? `${profileOn} on` : 'any'} order={SIDE.show + 1}>
        {FACETS.map(f => (
          <SideMultiSelect key={f.key} label={f.label} values={chosen[f.key]}
            onChange={(values) => setQs({ [f.key]: values.join(',') })}
            options={(facets?.facets?.[f.key] || []).map(o => ({ value: o.value, label: f.key === 'country' ? countryName(o.value) : o.value, count: o.count }))} />
        ))}
        {facets ? (
          <SideNote>
            {`${facets.with_data.toLocaleString()} of ${facets.total.toLocaleString()} have profile data. A filter leaves out the ones without that field.`}
          </SideNote>
        ) : null}
      </SideGroup>
      <ContentLine
        title={TITLE[view]}
        meta={list.loaded ? [
          `${list.total.toLocaleString()}${view === 'all' ? ' to decide' : ''}`,
          `${list.items.length.toLocaleString()} shown`,
          sortText(sort)
        ].join(' · ') : 'Loading…'}
        actions={view !== 'decided' ? (
          <SmallButton component="a" href={`/api/discovery/export/profile-data${exportOnly}`} tip={EXPORT_TIP}>Export profile data</SmallButton>
        ) : null} />
    </>
  );

  const empty = filtered
    ? { title: 'No performers', description: 'No performer matches the filters.', action: <SmallButton onClick={clearFilters}>Clear filters</SmallButton> }
    : EMPTY[view];

  return (
    <PerformerGrid path={`/performers?${params}`} view={view} version={version} toolbar={toolbar} empty={empty}
      sourceLabel={sourceLabel} ask={ask} notify={notify} refresh={refresh} />
  );
}
