import React, { useEffect, useRef, useState } from 'react';
import { fmtRating } from './playerUtils';
import { plural } from '../ui';
import DeleteDialog from './DeleteDialog';
import './player.css';
import './panels.css';

const numOrNull = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function Stars({ label, value, disabled, onRate }) {
  const [preview, setPreview] = useState(null);
  const shown = preview != null ? preview : (value ?? 0);
  return (
    <span className="pl-stars" onMouseLeave={() => setPreview(null)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, shown - (n - 1)));
        return (
          <span key={n} className={`pl-st${preview != null ? ' is-preview' : ''}`}>
            <i style={{ width: `${fill >= 1 ? 100 : fill >= 0.5 ? 50 : 0}%` }} />
            {[n - 0.5, n].map((v) => (
              <button
                key={v}
                type="button"
                disabled={disabled}
                aria-label={`${label} ${v}`}
                onMouseEnter={() => setPreview(v)}
                onClick={() => onRate(v)}
              />
            ))}
          </span>
        );
      })}
    </span>
  );
}

const NO_SCRIPTS = { funscripts: [], loaded: false, error: null, reload: () => {} };

const TrashIcon = () => (
  <svg className="pl-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5M10 11v5.5M14 11v5.5" />
  </svg>
);

/**
 * Video + funscript score (half stars 0.5-5; clicking the current value clears it) and "Delete video & scripts…".
 * Loads and saves through /api/ratings. scripts is what useFunscripts returns for this item:
 * { funscripts: [{ name, path, size, axis }], loaded, error, reload }.
 *
 *   <RatingPanel item scripts onRatingChange={(path, { videoRating, funscriptRating }) => …}
 *     onDeleted={({ item, trashed, failed }) => …} />
 */
export default function RatingPanel({ item, scripts: scriptsProp, onRatingChange, onDeleted }) {
  const scripts = scriptsProp || NO_SCRIPTS;
  const path = item?.path;
  const latestPath = useRef(path);
  latestPath.current = path;
  const funscripts = Array.isArray(scripts.funscripts) ? scripts.funscripts : [];
  const listReady = !!scripts.loaded && !scripts.error;
  const hasScripts = listReady && funscripts.length > 0;

  const [ratings, setRatings] = useState({ path: null, video: null, funscript: null });
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setError('');
    setDeleteOpen(false);
    if (!path) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ratings?path=${encodeURIComponent(path)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRatings({ path, video: numOrNull(data.videoRating), funscript: numOrNull(data.funscriptRating) });
      } catch (e) {
        // keep the values the list came with
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Until the request answers, show what the gallery already knew.
  const current = ratings.path === path;
  const videoRating = current ? ratings.video : numOrNull(item?.videoRating);
  const funscriptRating = current ? ratings.funscript : numOrNull(item?.funscriptRating);

  const save = async (type, value) => {
    if (!path) return;
    if (type === 'funscript' && !hasScripts) return;
    const savedPath = path;
    const previous = type === 'video' ? videoRating : funscriptRating;
    const next = previous === value ? null : value;
    setError('');
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: savedPath, [type === 'video' ? 'videoRating' : 'funscriptRating']: next })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to save rating');
      }
      const data = await res.json();
      const saved = { video: numOrNull(data.videoRating), funscript: numOrNull(data.funscriptRating) };
      // A late answer for an item that is no longer shown leaves this panel alone; the page patches its list by path.
      if (latestPath.current === savedPath) setRatings({ path: savedPath, ...saved });
      window.dispatchEvent(new CustomEvent('ratings-updated', {
        detail: { filePath: savedPath, videoRating: saved.video, funscriptRating: saved.funscript }
      }));
      onRatingChange?.(savedPath, { videoRating: saved.video, funscriptRating: saved.funscript });
    } catch (e) {
      if (latestPath.current === savedPath) setError(`Failed to save rating: ${e.message}`);
    }
  };

  const deleteTitle = !scripts.loaded ? 'Waiting for the funscript list'
    : scripts.error ? 'The funscript list did not load' : undefined;

  return (
    <section className="pl-pn" data-panel="rate">
      <h4>Score</h4>
      <div className="pl-rrow">
        <span>Video</span>
        <Stars label="Video score" value={videoRating} disabled={!path} onRate={(v) => save('video', v)} />
        <b>{fmtRating(videoRating)}</b>
      </div>
      <div className={`pl-rrow${hasScripts ? '' : ' is-off'}`}>
        <span>Funscript</span>
        <Stars label="Funscript score" value={hasScripts ? funscriptRating : null} disabled={!hasScripts} onRate={(v) => save('funscript', v)} />
        <b>{hasScripts ? fmtRating(funscriptRating) : '–'}</b>
      </div>
      <div className="pl-rp-del">
        <button
          type="button"
          className="pl-btn sm danger"
          onClick={() => setDeleteOpen(true)}
          disabled={!path || !listReady}
          title={deleteTitle}
        >
          <TrashIcon />
          Delete video &amp; scripts…
        </button>
        <p className="pl-warn">
          {hasScripts
            ? `Moves the video and its ${plural(funscripts.length, 'funscript')} to the folder's trash. You can undo it.`
            : "Moves the video to the folder's trash. You can undo it."}
        </p>
      </div>
      {error && <p className="pl-err" role="alert">{error}</p>}
      <DeleteDialog
        open={deleteOpen}
        item={item}
        scripts={funscripts}
        onClose={() => setDeleteOpen(false)}
        onDone={({ trashed, failed }) => {
          setDeleteOpen(false);
          onDeleted?.({ item, trashed, failed });
        }}
      />
    </section>
  );
}
