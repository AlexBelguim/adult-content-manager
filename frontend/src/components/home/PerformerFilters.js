/**
 * The Gallery home's performer filters, drawn inline in the sidebar's Show group: one group per filter of
 * filterModel's GROUPS that has something to pick (or is on). Changes apply at once. The Leakhaven group is left
 * out (the "New uploads only" check above is its include) unless an exclude is on, so that it can be turned off.
 */
import React from 'react';
import { Box } from '@mui/material';
import { ChipGroup, RangeGroup } from '../filters';
import { SideNote } from '../layout';
import { visibleGroups, cycleValue, setRange, resetGroup } from './filterModel';

/** The facet's values, plus any selected value the data no longer has (count 0), so it can be turned off. */
function chipValues(facet, state) {
  const values = facet?.values ?? [];
  const known = new Set(values.map(v => v.value));
  const extra = [...(state?.inc || []), ...(state?.exc || [])]
    .filter(v => !known.has(v))
    .map(v => ({ value: v, label: v, count: 0 }));
  return extra.length ? [...values, ...extra] : values;
}

export default function PerformerFilters({ facets, filters, onChange }) {
  const groups = visibleGroups(facets, filters).filter(g => g.key !== 'lh' || filters.lh?.exc?.length > 0);
  if (!groups.length) return null;
  return (
    <>
      <SideNote>Click a value: include, again: exclude, again: off.</SideNote>
      <Box sx={{ px: '8px', minWidth: 0 }}>
        {groups.map((group) => {
          const { key } = group;
          if (group.kind === 'range') {
            const facet = facets[key];
            if (!facet || facet.min == null || facet.max == null) return null;
            return (
              <RangeGroup
                key={key}
                label={group.label}
                min={facet.min}
                max={facet.max}
                value={filters[key] ?? null}
                unit={group.unit}
                note={group.note}
                onCommit={(r) => onChange(setRange(filters, key, r))}
              />
            );
          }
          const state = filters[key];
          return (
            <ChipGroup
              key={key}
              label={group.label}
              values={chipValues(facets[key], state)}
              stateOf={(v) => (state?.inc.includes(v) ? 'include' : state?.exc.includes(v) ? 'exclude' : 'off')}
              onCycle={(v) => onChange(cycleValue(filters, key, v))}
              onReset={() => onChange(resetGroup(filters, key))}
              note={group.note}
              collapseAfter={group.collapseAfter}
              searchable={group.searchable}
            />
          );
        })}
      </Box>
    </>
  );
}
