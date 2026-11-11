import React, { useEffect, useId, useState } from 'react';
import { Checkbox } from '@mui/material';
import { AppDialog } from '../ui';
import { fileNameOf, fmtBytes, fmtSize, fmtTime, folderOf } from './playerUtils';
import { trashFolderLabel, trashVideo } from './trashApi';
import { getHandyLoaded, stopHandy, useHandyLoaded } from './useHandy';
import './panels.css';

const FilmIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
);

function Thumb({ src }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <span className="pl-dd-thumb is-empty"><FilmIcon /></span>;
  return <img className="pl-dd-thumb" src={src} alt="" onError={() => setFailed(true)} />;
}

/**
 * "Delete this video?": the video and the funscripts that go with it (each one can be unticked) move to the
 * folder's trash. Nothing moves when the video cannot be moved; then the dialog stays open with a result per file.
 *
 *   <DeleteDialog open item scripts={[{ name, path, size, axis }]} onClose onDone={({ trashed, failed }) => …} />
 */
export default function DeleteDialog({ open, item, scripts, onClose, onDone }) {
  const list = Array.isArray(scripts) ? scripts : [];
  const [unticked, setUnticked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const [failedOnce, setFailedOnce] = useState(false);
  const idBase = useId();
  const loaded = useHandyLoaded();

  // Fresh ticks and no error each time it opens.
  useEffect(() => {
    if (!open) return;
    setUnticked(new Set());
    setError('');
    setResults(null);
    setFailedOnce(false);
    setBusy(false);
  }, [open, item?.path]);

  if (!item) return null;

  const ticked = list.filter((s) => !unticked.has(s.path));

  const toggle = (scriptPath) => {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(scriptPath)) next.delete(scriptPath);
      else next.add(scriptPath);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const now = getHandyLoaded();
      if (now?.path && ticked.some((s) => s.path === now.path)) stopHandy({ user: true });
      const { trashed, failed } = await trashVideo(item.path, ticked.map((s) => s.path));
      window.dispatchEvent(new CustomEvent('gallery-content-updated', {
        detail: { videoPath: item.path, deleted: trashed.map((t) => t.path) }
      }));
      setBusy(false);
      onDone?.({ trashed, failed });
    } catch (err) {
      setError(err?.message || 'It did not work');
      setResults(Array.isArray(err?.results) ? err.results : null);
      setFailedOnce(true);
      setBusy(false);
    }
  };

  const meta = [fmtSize(item), item.duration ? fmtTime(item.duration) : '', folderOf(item.path)].filter(Boolean).join(' · ');

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Delete this video?"
      size="md"
      busy={busy}
      error={error || null}
      primary={{ label: failedOnce ? 'Try again' : 'Move to trash', danger: true, busyLabel: 'Moving…', onClick: submit }}
    >
      <div className="pl-dd-file">
        <Thumb src={item.thumbnail} />
        <div className="pl-dd-text">
          <b className="pl-dd-name">{item.name || fileNameOf(item.path)}</b>
          {meta && <span className="pl-dd-sub">{meta}</span>}
        </div>
      </div>

      {results ? (
        <>
          <div className="pl-dd-label">What happened</div>
          <ul className="pl-dd-list">
            {results.map((r) => (
              <li key={r.path} className="pl-dd-row">
                <div className="pl-dd-text">
                  <span className="pl-dd-name">{fileNameOf(r.path)}</span>
                  {(r.reason || r.error) && <span className="pl-dd-sub">{r.reason || r.error}</span>}
                </div>
                <span className="pl-dd-badge">Not moved</span>
              </li>
            ))}
          </ul>
          <p className="pl-dd-note">Nothing was moved, and its tags and scores are unchanged.</p>
        </>
      ) : list.length > 0 && (
        <>
          <div className="pl-dd-label">Funscripts that go with it</div>
          <ul className="pl-dd-list">
            {list.map((s, i) => {
              const onHandy = loaded?.path === s.path;
              const id = `${idBase}-s${i}`;
              return (
                <li key={s.path} className="pl-dd-row">
                  <Checkbox
                    size="small"
                    checked={!unticked.has(s.path)}
                    onChange={() => toggle(s.path)}
                    disabled={busy}
                    inputProps={{ 'aria-labelledby': id }}
                    sx={{ p: '6px', ml: '-6px' }}
                  />
                  <div className="pl-dd-text">
                    <span className="pl-dd-name" id={id}>{s.name || fileNameOf(s.path)}</span>
                    <span className={`pl-dd-sub${onHandy ? ' is-warn' : ''}`}>
                      {onHandy ? 'On the Handy now: it is stopped first' : (s.axis || 'main')}
                    </span>
                  </div>
                  <span className="pl-dd-size">{fmtBytes(s.size)}</span>
                </li>
              );
            })}
          </ul>
          <p className="pl-dd-note">Untick a script to keep it.</p>
        </>
      )}

      <p className="pl-dd-where">
        <FolderIcon />
        <span>
          Moved to the folder's trash, {trashFolderLabel(item.path)}. Undo right after, or put it back from there
          later. Its tags and scores come back with it.
        </span>
      </p>
    </AppDialog>
  );
}
