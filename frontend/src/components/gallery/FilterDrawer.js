import React from 'react';
import { Box } from '@mui/material';
import { ChipGroup, NumberRangeGroup } from '../filters';
import { SideButtons, SideButton, SideNote } from '../layout';

/**
 * The unified gallery's tag and score filters, drawn inline in the sidebar's Show group (they used to be a
 * drawer). The tag cycle (neutral -> include -> exclude -> neutral) stays in the parent.
 */
const FilterDrawer = ({
  availableTags, tagStates, tagActiveCount, onToggleTag, onClearTags, onReverseTags,
  scoreFilters, scoreActive, onScoreChange, onClearScore,
}) => {
  const tags = availableTags || [];
  const states = tagStates || {};
  const scores = scoreFilters || {};
  const active = scoreActive || {};
  const anyOn = tagActiveCount > 0 || !!active.video || !!active.funscript;
  return (
    <>
      {anyOn && (
        <SideButtons>
          <SideButton plain onClick={() => { onClearTags(); onClearScore('video'); onClearScore('funscript'); }}>
            Clear all
          </SideButton>
        </SideButtons>
      )}
      <SideNote>Click a tag: include, again: exclude, again: off. Included tags must all be present.</SideNote>
      <Box sx={{ px: '8px', minWidth: 0 }}>
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
      </Box>
    </>
  );
};

export default FilterDrawer;
