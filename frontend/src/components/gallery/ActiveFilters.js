import React from 'react';

const SCORE_LABELS = { video: 'Video score', funscript: 'Funscript score' };

/** Removable chips for every active tag filter and score range. */
const ActiveFilters = ({ includeTags, excludeTags, scoreFilters, scoreActive, onRemoveTag, onClearScore }) => {
  const scoreKeys = ['video', 'funscript'].filter(key => scoreActive[key]);
  if (includeTags.length + excludeTags.length + scoreKeys.length === 0) return null;

  return (
    <div className="ug-active" aria-label="Active filters">
      {includeTags.map(tag => (
        <button key={`i-${tag}`} type="button" className="include" title="Remove filter" onClick={() => onRemoveTag(tag)}>
          ✓ {tag} ×
        </button>
      ))}
      {excludeTags.map(tag => (
        <button key={`e-${tag}`} type="button" className="exclude" title="Remove filter" onClick={() => onRemoveTag(tag)}>
          ✕ {tag} ×
        </button>
      ))}
      {scoreKeys.map(key => (
        <button key={key} type="button" title="Remove filter" onClick={() => onClearScore(key)}>
          {SCORE_LABELS[key]} {scoreFilters[key].min ?? 0}–{scoreFilters[key].max ?? 10} ×
        </button>
      ))}
    </div>
  );
};

export default ActiveFilters;
