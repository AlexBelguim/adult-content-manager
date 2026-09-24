import React, { useEffect, useRef } from 'react';

const ScoreRange = ({ label, type, range, active, onChange, onClear }) => (
  <div className="ug-score">
    <span>{label}</span>
    <input
      type="number" min="0" max="10" step="0.1" placeholder="Min" aria-label={`${label} minimum`}
      value={range.min ?? ''}
      onChange={(e) => onChange(type, 'min', e.target.value)}
    />
    to
    <input
      type="number" min="0" max="10" step="0.1" placeholder="Max" aria-label={`${label} maximum`}
      value={range.max ?? ''}
      onChange={(e) => onChange(type, 'max', e.target.value)}
    />
    <button type="button" className="ug-btn sm" onClick={() => onClear(type)} disabled={!active}>Clear</button>
  </div>
);

/**
 * Right slide-over with the tag filter and the two score ranges.
 * Backdrop click and Esc close it.
 */
const FilterDrawer = ({
  open, onClose,
  availableTags, tagStates, tagActiveCount, onToggleTag, onClearTags, onReverseTags,
  scoreFilters, scoreActive, onScoreChange, onClearScore,
}) => {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="ug-shade" onClick={onClose} />
      <aside className="ug-drawer" role="dialog" aria-modal="true" aria-label="Filters">
        <div className="ug-drawer-head">
          <h2>Filters</h2>
          <button ref={closeRef} type="button" className="ug-btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="ug-fl">
          <div className="ug-fl-h">
            <span>Filter tags</span>
            <span className="hint">click: include → exclude → off</span>
            <span className="ug-grow" />
            <button type="button" className="ug-btn sm" onClick={onClearTags} disabled={tagActiveCount === 0}>Clear</button>
            <button type="button" className="ug-btn sm" onClick={onReverseTags} disabled={tagActiveCount === 0}>Reverse</button>
          </div>
          <div className="ug-tagbox">
            {availableTags.length === 0 && <span className="none">No tags available</span>}
            {availableTags.map(tag => {
              const state = tagStates[tag] || 'neutral';
              return (
                <button
                  key={tag}
                  type="button"
                  className={`ug-tg ${state}`}
                  onClick={() => onToggleTag(tag)}
                >
                  {state === 'include' ? '✓ ' : state === 'exclude' ? '✕ ' : ''}{tag}
                </button>
              );
            })}
          </div>
          <div className="ug-scores">
            <ScoreRange
              label="Video score" type="video" range={scoreFilters.video} active={scoreActive.video}
              onChange={onScoreChange} onClear={onClearScore}
            />
            <ScoreRange
              label="Funscript score" type="funscript" range={scoreFilters.funscript} active={scoreActive.funscript}
              onChange={onScoreChange} onClear={onClearScore}
            />
          </div>
        </div>
      </aside>
    </>
  );
};

export default FilterDrawer;
