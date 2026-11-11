/**
 * The filter tiles of Performer Management: the counts ARE the filter (single choice). On PC a grid of 64px tiles
 * (count over label); below 700px one horizontally scrolling strip of compact chips "Before 412" (performers.css).
 *
 *   <StatFilters label="Filter" items={[{ id, label, count }]} value={id} onChange={(id) => …} />
 *
 * A radiogroup: the chosen tile is the one Tab stop, the arrow keys (and Home/End) move the choice.
 */
import React, { useRef } from 'react';
import { ButtonBase } from '@mui/material';

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : (n ?? '–'));

export default function StatFilters({ label, items = [], value, onChange }) {
  const group = useRef(null);
  const at = Math.max(0, items.findIndex(it => it.id === value));

  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    if (it.id !== value) onChange(it.id);
    const btn = group.current?.querySelectorAll('[role="radio"]')[i];
    btn?.focus();
    btn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const onKeyDown = (e) => {
    const n = items.length;
    if (!n) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next == null) return;
    e.preventDefault();
    choose(next);
  };

  return (
    <div ref={group} className="pm-tiles" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        const on = i === at;
        return (
          <ButtonBase key={it.id} role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            className={`pm-tile${on ? ' on' : ''}`} onClick={() => { if (!on) onChange(it.id); }}>
            <span className="pm-tile-label" title={it.label}>{it.label}</span>
            <span className="pm-tile-count">{fmt(it.count)}</span>
          </ButtonBase>
        );
      })}
    </div>
  );
}
