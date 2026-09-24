import React from 'react';

const TABS = ['Pictures', 'Videos', 'Funscripts'];
const TAGGED_MODES = [
  ['All', 'Show all files (physical and tagged)'],
  ['Folder', 'Show only files physically in this folder'],
  ['Tag', 'Show only files with this tag (not physically in folder)'],
];

/**
 * Sticky control row: tabs with live counts, All/Folder/Tag (genre), sort,
 * Filters button, Rank images, thumbnail size.
 */
const GalleryToolbar = ({
  tab, onTabChange, tabCounts,
  showTaggedMode, taggedMode, onTaggedModeChange,
  sortValue, sortOptions, onSortChange,
  filterCount, filtersOpen, onOpenFilters,
  showRank, rankEnabled, onRank,
  size, minSize, maxSize, onSizeChange,
}) => (
  <div className="ug-bar">
    <div className="ug-seg tabs" role="tablist" aria-label="Media type">
      {TABS.map((label, i) => (
        <button
          key={label}
          type="button"
          role="tab"
          aria-selected={tab === i}
          className={tab === i ? 'on' : ''}
          onClick={() => onTabChange(i)}
        >
          {label}<i>{tabCounts[i]}</i>
        </button>
      ))}
    </div>

    {showTaggedMode && (
      <div className="ug-seg" role="group" aria-label="Folder or tag">
        {TAGGED_MODES.map(([label, title], i) => (
          <button
            key={label}
            type="button"
            title={title}
            aria-pressed={taggedMode === i}
            className={taggedMode === i ? 'on' : ''}
            onClick={() => onTaggedModeChange(i)}
          >
            {label}
          </button>
        ))}
      </div>
    )}

    <span className="ug-grow" />

    <label className="ug-sort">
      Sort
      <select value={sortValue} onChange={onSortChange}>
        {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>

    <button
      type="button"
      className={`ug-btn${filtersOpen ? ' on' : ''}${filterCount > 0 ? ' warn' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={filtersOpen}
      onClick={onOpenFilters}
    >
      Filters{filterCount > 0 && <b>{filterCount}</b>}
    </button>

    {showRank && (
      <button
        type="button"
        className="ug-btn"
        onClick={onRank}
        disabled={!rankEnabled}
        title={rankEnabled ? 'Rank this performer\'s pictures against each other' : 'Available on the Pictures tab'}
      >
        🏆 Rank images
      </button>
    )}

    <label className="ug-size" title="Thumbnail size — remembered on this device">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect width="5" height="5" /><rect x="7" width="5" height="5" /><rect y="7" width="5" height="5" /><rect x="7" y="7" width="5" height="5" />
      </svg>
      <input
        type="range"
        min={minSize}
        max={maxSize}
        step="2"
        value={size}
        onChange={(e) => onSizeChange(Number(e.target.value))}
        aria-label="Thumbnail size"
      />
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect width="16" height="16" rx="2" />
      </svg>
    </label>
  </div>
);

export default GalleryToolbar;
