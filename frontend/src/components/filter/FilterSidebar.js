import React from 'react';
import Icon from './Icon';
import { TABS, TAB_LABEL, keyLabel } from './filterUtils';

const SORTS = [
  ['name', 'Name'],
  ['size', 'Size (biggest first)'],
  ['date', 'Date modified']
];

/**
 * Left column: Back / Next performer, title, the Progress card with the three
 * tabs as rows, whatever the parent puts in between (file card, funscripts,
 * panels), the View card and the Shortcuts card. On a phone it is the bottom sheet.
 */
export default function FilterSidebar({
  performer,
  currentTab,
  progress,
  onTab,
  onBack,
  onNextPerformer,
  backBusy,
  sortBy,
  sortOrder,
  hideKept,
  mlEnabled,
  onSortBy,
  onSortOrder,
  onHideKept,
  onMlEnabled,
  shortcuts,
  sheetOpen,
  onCloseSheet,
  children
}) {
  const sorts = currentTab === 'funscript_vids' ? [...SORTS, ['funscript_count', 'Funscript count']] : SORTS;

  return (
    <aside className={`fv-left${sheetOpen ? ' is-open' : ''}`}>
      <button type="button" className="pl-btn sm fv-sheet-x" onClick={onCloseSheet}>Close</button>
      <div className="fv-navrow">
        <button type="button" className="pl-btn sm" onClick={onBack} disabled={backBusy} title="Back to performers — trash is cleaned in the background">
          <Icon name="back" size={16} /> Performers
        </button>
        <span className="fv-grow" />
        <button type="button" className="pl-btn sm fv-go" onClick={onNextPerformer} title="Cleans the trash, then opens the next performer">
          Next performer <Icon name="right" size={14} />
        </button>
      </div>
      <div className="fv-title">
        <span className="fv-sub">Filtering</span>
        <h2>{performer.name}</h2>
      </div>

      <section className="pl-pn" data-panel="progress">
        <h4>Progress</h4>
        {TABS.map((tab) => {
          const p = progress[tab];
          return (
            <button
              type="button"
              key={tab}
              className={`fv-tabrow${currentTab === tab ? ' is-on' : ''}`}
              onClick={() => onTab(tab)}
              aria-current={currentTab === tab ? 'true' : undefined}
            >
              <b>{TAB_LABEL[tab]}</b>
              <span>{p.left} left · {p.pct}%</span>
              <span className="fv-bar"><i style={{ width: `${p.pct}%` }} /></span>
            </button>
          );
        })}
      </section>

      {children}

      <section className="pl-pn" data-panel="view">
        <h4>View</h4>
        <label className="fv-opt">
          <span>Sort by</span>
          <select className="fv-select" value={sortBy} onChange={(e) => onSortBy(e.target.value)}>
            {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="fv-opt">
          <span>Order</span>
          <select className="fv-select" value={sortOrder} onChange={(e) => onSortOrder(e.target.value)}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <label className="fv-opt">
          <span>Hide kept files</span>
          <input type="checkbox" checked={hideKept} onChange={(e) => onHideKept(e.target.checked)} />
        </label>
        <label className="fv-opt">
          <span>
            🤖 ML predictions
            {mlEnabled && <span className="fv-nomodel"> (no model)</span>}
          </span>
          <input type="checkbox" checked={mlEnabled} onChange={(e) => onMlEnabled(e.target.checked)} />
        </label>
      </section>

      <section className="pl-pn" data-panel="keys">
        <h4>Shortcuts</h4>
        <div className="fv-keys">
          <kbd>{keyLabel(shortcuts.keep)}</kbd><span>Keep</span>
          <kbd>{keyLabel(shortcuts.delete)}</kbd><span>Delete</span>
          <kbd>{keyLabel(shortcuts.move_to_funscript)}</kbd><span>Move to funscript (videos)</span>
          <kbd>{keyLabel(shortcuts.undo)}</kbd><span>Undo</span>
          <kbd>{keyLabel(shortcuts.prev)} {keyLabel(shortcuts.next)}</kbd><span>Previous / next</span>
          <kbd>Space</kbd><span>Play / pause</span>
        </div>
        <p className="pl-hint" style={{ marginTop: 8 }}>Customise the keys under ⚙️ Settings in the toolbar; they are picked up when you return.</p>
      </section>
    </aside>
  );
}
