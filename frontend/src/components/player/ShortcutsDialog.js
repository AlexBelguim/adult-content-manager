import React from 'react';
import { AppDialog, FactRows } from '../ui';

const ROWS = [
  ['Space', 'Play or pause'],
  ['← →', '5 s back or forward; previous or next picture'],
  ['Shift + ← →', 'Previous or next'],
  ['N / P', 'Next or previous'],
  ['F', 'Fullscreen'],
  ['M', 'Mute'],
  ['L', 'Loop'],
  ['?', 'This list'],
  ['Esc', 'Close the panel, else back'],
  ['Mouse wheel on the video', 'Seek']
];

/** The player's keys, opened with '?' or the keyboard button in the control row. */
export default function ShortcutsDialog({ open, onClose }) {
  return (
    <AppDialog open={open} onClose={onClose} title="Shortcuts" size="sm" cancelLabel="Close">
      <FactRows rows={ROWS} />
    </AppDialog>
  );
}
