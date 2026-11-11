/**
 * The Gallery home's filter drawer: one group per filter of filterModel's GROUPS that has something to pick (or
 * is on). Changes apply at once; the grid behind updates live.
 */
import React from 'react';
import { FiltersDrawer, ChipGroup, RangeGroup } from '../filters';
import { plural } from '../ui';
import { visibleGroups, cycleValue, setRange, resetGroup, countActive } from './filterModel';

/** The facet's values, plus any selected value the data no longer has (count 0), so it can be turned off. */
function chipValues(facet, state) {
  const values = facet?.values ?? [];
  const known = new Set(values.map(v => v.value));
  const extra = [...(state?.inc || []), ...(state?.exc || [])]
    .filter(v => !known.has(v))
    .map(v => ({ value: v, label: v, count: 0 }));
  return extra.length ? [...values, ...extra] : values;
}

export default function PerformerFilters({ open, onClose, facets, filters, onChange, shown, total }) {
  return (
    <FiltersDrawer
      open={open}
      onClose={onClose}
      countLine={`Showing ${shown} of ${plural(total, 'performer')}`}
      hint="Click a value: include, again: exclude, again: off."
      onResetAll={() => onChange({})}
      resetAllDisabled={countActive(filters) === 0}
    >
      {visibleGroups(facets, filters).map((group) => {
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
    </FiltersDrawer>
  );
}
