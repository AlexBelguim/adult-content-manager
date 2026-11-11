import React from 'react';
import { plural } from '../hashApi';

const KIND = [['all', 'All'], ['exact', 'Exact'], ['similar', 'Similar']];
const MEDIA = [['all', 'Pictures and videos'], ['pics', 'Pictures'], ['vids', 'Videos']];
const SIZE = [['all', 'Pairs and groups'], ['pairs', 'Pairs'], ['groups', 'Groups']];
const MIN = [86, 90, 95];

/** 86 → 9, 90 → 6, 95 → 3 (dHash bits out of 64). */
export const MIN_TO_DISTANCE = { 86: 9, 90: 6, 95: 3 };

function ChipGroup({ label, options, value, onChange }) {
  return (
    <span className="hr-chipgroup" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          className={`hr-fchip${value === v ? ' on' : ''}`}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >{text}</button>
      ))}
    </span>
  );
}

/**
 * One chip row (phone: one horizontal scrolling row). Filters only change
 * what is shown, never what is selected.
 */
export default function FilterRow({ filters, matchCount, onChange }) {
  const { kind, media, size, min } = filters;
  return (
    <>
      <div className="hr-chips">
        <ChipGroup label="Match" options={KIND} value={kind} onChange={v => onChange({ kind: v })} />
        <span className="hr-vsep" />
        <ChipGroup label="Media" options={MEDIA} value={media} onChange={v => onChange({ media: v })} />
        <span className="hr-vsep" />
        <ChipGroup label="Group size" options={SIZE} value={size} onChange={v => onChange({ size: v })} />
        <span className="hr-vsep" />
        <select
          className="hr-select"
          aria-label="Lowest similarity shown"
          value={min}
          disabled={kind === 'exact'}
          title={kind === 'exact' ? 'Only exact copies are shown' : 'This check holds matches of 86% and up'}
          onChange={e => onChange({ min: Number(e.target.value) })}
        >
          {MIN.map(v => <option key={v} value={v}>{`Similar at least ${v}%`}</option>)}
        </select>
        <span className="hr-grow" />
        <span className="hr-match">{`${plural(matchCount, 'group')} ${matchCount === 1 ? 'matches' : 'match'}`}</span>
      </div>
      <p className="hr-hint">Filters change what is shown, never what is selected.</p>
    </>
  );
}
