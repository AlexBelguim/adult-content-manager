import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractGenreFromPath } from '../../utils/tagModal';
import './player.css';

const NONE = [];

/**
 * Inline tag editor for a file (videos and pictures): filter box, click to toggle,
 * assigned tags first, the genre-from-path tag is locked.
 * Dispatches `tag-modal-closed` (what the gallery listens to) once, when tags were
 * changed and the item changes or the panel unmounts.
 */
export default function TagPanel({ item, onTagsChange }) {
  const path = item?.path;
  const [state, setState] = useState({ path: null, fileTags: NONE });
  const [allTags, setAllTags] = useState(NONE);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busyTag, setBusyTag] = useState(null);
  const dirty = useRef(false);
  const latestPath = useRef(path);
  latestPath.current = path;

  // The tag vocabulary is the same for every file: fetch it once per mount.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tags/all')
      .then((res) => (res.ok ? res.json() : { tags: [] }))
      .then((data) => {
        if (!cancelled) setAllTags(data.tags || NONE);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load tags');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadFileTags = useCallback(async () => {
    if (!path) return null;
    try {
      const res = await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);
      const fileTags = res.ok ? ((await res.json()).tags || []) : [];
      if (latestPath.current === path) setState({ path, fileTags });
      return fileTags;
    } catch (e) {
      if (latestPath.current === path) setError('Failed to load tags');
      return null;
    }
  }, [path]);

  useEffect(() => {
    setError('');
    setFilter('');
    loadFileTags();
    return () => {
      if (dirty.current) {
        dirty.current = false;
        window.dispatchEvent(new Event('tag-modal-closed'));
      }
    };
  }, [loadFileTags]);

  const current = state.path === path;
  const itemTags = Array.isArray(item?.tags) ? item.tags : NONE;
  const fileTags = current ? state.fileTags : itemTags;
  const genre = extractGenreFromPath(path);

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [
      ...fileTags,
      ...allTags.filter((t) => !fileTags.includes(t))
    ].filter((t) => !q || String(t).toLowerCase().includes(q));
  }, [fileTags, allTags, filter]);

  const toggle = async (tag) => {
    const assigned = fileTags.includes(tag);
    setBusyTag(tag);
    setError('');
    try {
      const res = await fetch(assigned ? '/api/tags/remove-file' : '/api/tags/assign-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, tag })
      });
      if (!res.ok) throw new Error();
      dirty.current = true;
      const next = await loadFileTags();
      if (next) onTagsChange?.(next);
    } catch (e) {
      setError(assigned ? 'Failed to remove tag' : 'Failed to assign tag');
    } finally {
      setBusyTag(null);
    }
  };

  return (
    <section className="pl-pn" data-panel="tags">
      <h4>Tags</h4>
      <input
        className="pl-tfilter"
        type="text"
        placeholder="Filter tags…"
        autoComplete="off"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter tags"
      />
      <div className="pl-chips">
        {sorted.map((tag) => {
          const isGenre = !!genre && String(tag).toLowerCase() === genre;
          return (
            <button
              key={tag}
              type="button"
              className={`pl-tg${fileTags.includes(tag) ? ' is-on' : ''}`}
              disabled={isGenre || busyTag === tag || !current}
              title={isGenre ? 'Genre tag — comes from the folder' : undefined}
              aria-pressed={fileTags.includes(tag)}
              onClick={() => toggle(tag)}
            >
              {tag}
            </button>
          );
        })}
        {current && sorted.length === 0 && (
          <p className="pl-hint">{allTags.length ? 'No tag matches the filter.' : 'No tags defined yet.'}</p>
        )}
      </div>
      {error && <p className="pl-err" role="alert">{error}</p>}
    </section>
  );
}
