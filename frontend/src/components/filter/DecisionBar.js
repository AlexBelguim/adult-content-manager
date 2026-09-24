import React from 'react';
import Icon from './Icon';
import { keyLabel } from './filterUtils';

const Key = ({ k }) => (keyLabel(k) ? <kbd>{keyLabel(k)}</kbd> : null);

/**
 * Previous · Delete · Undo · To funscript · Keep · Next — a fixed grid that
 * never moves, hides or reorders. Unavailable actions are disabled.
 */
export default function DecisionBar({
  shortcuts,
  hasItem,
  canPrev,
  canNext,
  canMove,
  canUndo,
  onPrev,
  onNext,
  onDecide,
  onUndo
}) {
  return (
    <div className="fv-acts">
      <button type="button" className="fv-act" onClick={onPrev} disabled={!canPrev} title={`Previous (${keyLabel(shortcuts.prev)})`} aria-label="Previous">
        <Icon name="left" />
        <b>Previous</b>
      </button>
      <button type="button" className="fv-act del" onClick={() => onDecide('delete')} disabled={!hasItem} title="Delete (moves to trash)" aria-label="Delete">
        <Icon name="x" />
        <b>Delete</b>
        <Key k={shortcuts.delete} />
      </button>
      <button type="button" className="fv-act" onClick={onUndo} disabled={!canUndo} title="Undo the last decision" aria-label="Undo">
        <Icon name="undo" />
        <b>Undo</b>
        <Key k={shortcuts.undo} />
      </button>
      <button type="button" className="fv-act move" onClick={() => onDecide('move_to_funscript')} disabled={!canMove} title="Videos only — moves to the funscript folder and queues funpipe" aria-label="Move to funscript">
        <Icon name="move" />
        <b>To funscript</b>
        <Key k={shortcuts.move_to_funscript} />
      </button>
      <button type="button" className="fv-act keep" onClick={() => onDecide('keep')} disabled={!hasItem} title="Keep" aria-label="Keep">
        <Icon name="check" />
        <b>Keep</b>
        <Key k={shortcuts.keep} />
      </button>
      <button type="button" className="fv-act" onClick={onNext} disabled={!canNext} title={`Next (${keyLabel(shortcuts.next)})`} aria-label="Next">
        <b>Next</b>
        <Icon name="right" />
      </button>
    </div>
  );
}
