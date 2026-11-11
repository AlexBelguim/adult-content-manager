import React from 'react';
import { SideNote, SideSegment } from '../../layout';

/**
 * The filters of the duplicates page (/hash-results/:runId), for the sidebar's Show group: Match, Media, Size and
 * Lowest similarity as segmented choices. Filters only change what is shown, never what is selected. The option
 * lists are exported for the page.
 *
 *   <ShowFilters filters={{ kind, media, size, min }} onChange={(patch) => …} />
 */
export const KIND_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'exact', label: 'Exact' },
  { id: 'similar', label: 'Similar' }
];
export const MEDIA_OPTIONS = [
  { id: 'all', label: 'Both', title: 'Pictures and videos' },
  { id: 'pics', label: 'Pictures' },
  { id: 'vids', label: 'Videos' }
];
export const SIZE_OPTIONS = [
  { id: 'all', label: 'Both', title: 'Pairs and groups' },
  { id: 'pairs', label: 'Pairs', title: 'Two files' },
  { id: 'groups', label: 'Groups', title: 'Three files or more' }
];
export const MIN_VALUES = [86, 90, 95];

/** 86 → 9, 90 → 6, 95 → 3 (dHash bits out of 64). */
export const MIN_TO_DISTANCE = { 86: 9, 90: 6, 95: 3 };

const headSx = { mb: '-4px' };

export function ShowFilters({ filters, onChange }) {
  const { kind, media, size, min } = filters;
  const exactOnly = kind === 'exact';
  const minOptions = MIN_VALUES.map(v => ({
    id: v,
    label: `${v}%`,
    disabled: exactOnly,
    title: exactOnly ? 'Only exact copies are shown' : `Similar at least ${v}%`
  }));
  return (
    <>
      <SideNote sx={headSx}>Match</SideNote>
      <SideSegment label="Match" value={kind} options={KIND_OPTIONS} onChange={v => onChange({ kind: v })} />
      <SideNote sx={headSx}>Media</SideNote>
      <SideSegment label="Media" value={media} options={MEDIA_OPTIONS} onChange={v => onChange({ media: v })} />
      <SideNote sx={headSx}>Size</SideNote>
      <SideSegment label="Group size" value={size} options={SIZE_OPTIONS} onChange={v => onChange({ size: v })} />
      <SideNote sx={headSx}>Lowest similarity</SideNote>
      <SideSegment label="Lowest similarity shown" value={min} options={minOptions} onChange={v => onChange({ min: Number(v) })} />
      <SideNote>Filters change what is shown, never what is selected.</SideNote>
    </>
  );
}

export default ShowFilters;
