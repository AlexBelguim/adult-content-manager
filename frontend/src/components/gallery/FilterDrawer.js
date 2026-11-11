import React from 'react';
import { FiltersDrawer, ChipGroup, NumberRangeGroup } from '../filters';

/**
 * The unified gallery's filter panel: a thin adapter over the shared
 * FiltersDrawer, with the same props as before so UnifiedGallery is unchanged.
 * The tag cycle (neutral -> include -> exclude -> neutral) stays in the parent;
 * Esc, the backdrop and the focus trap come from the MUI Drawer.
 */
const FilterDrawer = ({
  open, onClose,
  availableTags, tagStates, tagActiveCount, onToggleTag, onClearTags, onReverseTags,
  scoreFilters, scoreActive, onScoreChange, onClearScore,
}) => {
  const tags = availableTags || [];
  const states = tagStates || {};
  const scores = scoreFilters || {};
  const active = scoreActive || {};
  return (
    <FiltersDrawer
      open={open}
      onClose={onClose}
      hint="Click a tag: include, again: exclude, again: off. Included tags must all be present."
      onResetAll={() => { onClearTags(); onClearScore('video'); onClearScore('funscript'); }}
      resetAllDisabled={tagActiveCount === 0 && !active.video && !active.funscript}
    >
      <ChipGroup
        label="Tags"
        values={tags.map(t => ({ value: t }))}
        stateOf={(t) => (states[t] === 'include' ? 'include' : states[t] === 'exclude' ? 'exclude' : 'off')}
        onCycle={onToggleTag}
        onReset={onClearTags}
        extraActions={[{ label: 'Reverse', onClick: onReverseTags, disabled: tagActiveCount === 0 }]}
        collapseAfter={24}
        searchable
        emptyText="No tags available"
      />
      <NumberRangeGroup
        label="Video score"
        value={scores.video}
        active={!!active.video}
        onChange={(b, raw) => onScoreChange('video', b, raw)}
        onReset={() => onClearScore('video')}
      />
      <NumberRangeGroup
        label="Funscript score"
        value={scores.funscript}
        active={!!active.funscript}
        onChange={(b, raw) => onScoreChange('funscript', b, raw)}
        onReset={() => onClearScore('funscript')}
      />
    </FiltersDrawer>
  );
};

export default FilterDrawer;
