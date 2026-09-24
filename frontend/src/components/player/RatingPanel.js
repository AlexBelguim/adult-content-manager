import React, { useEffect, useState } from 'react';
import useFunscripts from './useFunscripts';
import { fileNameOf, fmtRating } from './playerUtils';
import './player.css';

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

/**
 * Video + funscript score (half stars 0.5–5; clicking the current value clears it)
 * and "Delete video & scripts". Self-contained: loads and saves through /api/ratings.
 */
export default function RatingPanel({ item, funscripts: funscriptsProp, onRatingChange, onDeleted }) {
  const path = item?.path;
  const own = useFunscripts(funscriptsProp ? null : path);
  const funscripts = funscriptsProp || own.funscripts;
  const hasScripts = funscripts.length > 0;

  const [ratings, setRatings] = useState({ path: null, video: null, funscript: null });
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setError('');
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
    const previous = type === 'video' ? videoRating : funscriptRating;
    const next = previous === value ? null : value;
    setError('');
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: path, [type === 'video' ? 'videoRating' : 'funscriptRating']: next })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to save rating');
      }
      const data = await res.json();
      const saved = { video: numOrNull(data.videoRating), funscript: numOrNull(data.funscriptRating) };
      setRatings({ path, ...saved });
      window.dispatchEvent(new CustomEvent('ratings-updated', {
        detail: { filePath: path, videoRating: saved.video, funscriptRating: saved.funscript }
      }));
      onRatingChange?.({ videoRating: saved.video, funscriptRating: saved.funscript });
    } catch (e) {
      setError(`Failed to save rating: ${e.message}`);
    }
  };

  const deleteAll = async () => {
    if (!path) return;
    if (!window.confirm(`Delete "${fileNameOf(path)}" and any associated funscripts?\n\nThis will permanently remove the files from disk.`)) return;
    if (!window.confirm('Are you sure? This action cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch('/api/files/delete-with-funscripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: path, funscriptPaths: funscripts.map((s) => s.path) })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to delete files');
      }
      const result = await res.json();
      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors.map((err) => err.error).join(', '));
      }
      window.dispatchEvent(new CustomEvent('gallery-content-updated', {
        detail: { videoPath: path, deleted: result.deleted }
      }));
      onDeleted?.(item, result);
    } catch (e) {
      setError(`Failed to delete video or funscripts: ${e.message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="pl-pn" data-panel="rate">
      <h4>Score</h4>
      <div className="pl-rrow">
        <span>Video</span>
        <Stars label="Video score" value={videoRating} onRate={(v) => save('video', v)} />
        <b>{fmtRating(videoRating)}</b>
      </div>
      <div className={`pl-rrow${hasScripts ? '' : ' is-off'}`}>
        <span>Funscript</span>
        <Stars label="Funscript score" value={hasScripts ? funscriptRating : null} disabled={!hasScripts} onRate={(v) => save('funscript', v)} />
        <b>{hasScripts ? fmtRating(funscriptRating) : 'N/A'}</b>
      </div>
      {!hasScripts && <p className="pl-hint">Add a funscript to enable script scoring.</p>}
      <div style={{ marginTop: 10 }}>
        <button type="button" className="pl-btn sm danger" onClick={deleteAll} disabled={!path || deleting}>
          🗑 {deleting ? 'Deleting…' : 'Delete video & scripts'}
        </button>
        <p className="pl-warn">Permanently removes the video and any linked funscripts. This action cannot be undone.</p>
      </div>
      {error && <p className="pl-err" role="alert">{error}</p>}
    </section>
  );
}
