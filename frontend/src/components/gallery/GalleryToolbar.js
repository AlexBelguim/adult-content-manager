import React from 'react';
import { Slider } from '@mui/material';
import PermMediaOutlinedIcon from '@mui/icons-material/PermMediaOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined';
import ViewTimelineOutlinedIcon from '@mui/icons-material/ViewTimelineOutlined';
import { SideGroup, SideList, SideSegment, SideSelect, SideField, SIDE } from '../layout';

export const TAB_LABELS = ['Pictures', 'Videos', 'Funscripts'];
const TAB_ICONS = [<ImageOutlinedIcon key="p" />, <VideocamOutlinedIcon key="v" />, <ViewTimelineOutlinedIcon key="f" />];
const TAGGED_MODES = [
  { id: 0, label: 'All', title: 'Show all files (in the folder and tagged)' },
  { id: 1, label: 'Folder', title: 'Show only files in this folder' },
  { id: 2, label: 'Tag', title: 'Show only files tagged with this genre elsewhere' }
];

const sliderSx = {
  width: 132, color: 'var(--accent)', py: '10px',
  '& .MuiSlider-rail': { bgcolor: 'var(--line-strong)', opacity: 1 },
  '& .MuiSlider-thumb': {
    width: 14, height: 14, bgcolor: 'var(--text)', border: '2px solid var(--accent)',
    '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 6px var(--accent-quiet)' }
  }
};

/**
 * The unified gallery's sidebar groups. Media: Pictures, Videos and Funscripts with their counts. Show: All /
 * Folder / Tag (genre galleries), the sort, the thumbnail size (remembered on this device), then the tag and score
 * filters (children) inline. filterCount: the active filters, the Show group's badge.
 */
const GalleryToolbar = ({
  tab, onTabChange, tabCounts,
  showTaggedMode, taggedMode, onTaggedModeChange,
  sortValue, sortOptions, onSortChange,
  filterCount,
  size, minSize, maxSize, onSizeChange,
  children
}) => (
  <>
    <SideGroup
      id="show"
      title="Show"
      icon={<FilterListIcon />}
      badge={filterCount}
      summary={filterCount ? `${filterCount} on` : 'nothing on'}
      order={SIDE.show}
    >
      {showTaggedMode && (
        <SideSegment label="Folder or tag" value={taggedMode} onChange={onTaggedModeChange} options={TAGGED_MODES} />
      )}
      <SideSelect
        label="Sort"
        value={sortValue}
        onChange={onSortChange}
        options={sortOptions.map(([value, label]) => ({ value, label }))}
      />
      <SideField label="Size">
        <Slider
          size="small"
          min={minSize}
          max={maxSize}
          step={2}
          value={size}
          onChange={(_e, v) => onSizeChange(Array.isArray(v) ? v[0] : v)}
          aria-label="Thumbnail size"
          sx={sliderSx}
        />
      </SideField>
      {children}
    </SideGroup>

    <SideGroup
      id="media"
      title="Media"
      icon={<PermMediaOutlinedIcon />}
      summary={`${TAB_LABELS[tab]} · ${(tabCounts[tab] || 0).toLocaleString()}`}
      order={SIDE.list}
    >
      <SideList
        label="Media"
        items={TAB_LABELS.map((label, i) => ({ id: i, label, count: tabCounts[i], icon: TAB_ICONS[i] }))}
        value={tab}
        onChange={onTabChange}
      />
    </SideGroup>
  </>
);

export default GalleryToolbar;
