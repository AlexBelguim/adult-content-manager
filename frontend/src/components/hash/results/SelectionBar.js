import React from 'react';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { formatBytes, plural } from '../hashApi';

/**
 * Sticky bottom bar (never moves): what is selected over the whole run,
 * Clear, Select all shown, Remove. Rendered after PageShell as a sibling.
 */
export default function SelectionBar({
  selection, offScreen, waiting = 0, showCount, libraryReachable, busy,
  onClear, onSelectShown, onRemove
}) {
  const count = selection?.count || 0;
  const second = [
    `${(selection?.exact || 0).toLocaleString()} exact`,
    `${(selection?.similar || 0).toLocaleString()} similar`
  ];
  if (offScreen > 0) second.push(`${offScreen.toLocaleString()} on other pages or hidden by filters`);
  if (waiting > 0) second.push(`${waiting.toLocaleString()} ticked ${waiting === 1 ? 'waits' : 'wait'} for a keeper choice`);
  second.push('choices are saved');

  let removeTitle = 'Check the list, then move these files to her trash folder';
  if (!libraryReachable) removeTitle = 'The library folder cannot be reached';
  else if (count === 0) removeTitle = 'Select files first';

  return (
    <div className="hr-selbar" role="region" aria-label="Selection">
      <div className="hr-count" aria-live="polite">
        {`${plural(count, 'file')} · ${formatBytes(selection?.bytes || 0)} selected`}
        <small>{second.join(' · ')}</small>
      </div>
      <span className="hr-grow" />
      <div className="hr-selbtns">
        <span className="hr-tip" title={count ? 'Untick every file of this check' : 'Nothing is selected'}>
          <button type="button" className="hr-btn text" disabled={!count || busy} onClick={onClear}>Clear</button>
        </span>
        <span className="hr-tip" title="Ticks every copy that can be removed in the groups on this page">
          <button type="button" className="hr-btn outlined" disabled={!showCount || busy} onClick={onSelectShown}>
            {`Select all shown (${showCount.toLocaleString()})`}
          </button>
        </span>
      </div>
      <span className="hr-tip hr-remove" title={removeTitle}>
        <button type="button" className="hr-btn" disabled={!count || !libraryReachable} onClick={onRemove}>
          <DeleteOutlineIcon />
          {`Remove ${plural(count, 'file')}…`}
        </button>
      </span>
    </div>
  );
}
