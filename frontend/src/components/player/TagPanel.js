import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractGenreFromPath } from './playerUtils';
import { useShell } from '../../nav';
import './player.css';
import './panels.css';

const NONE = [];
const CREATE = Symbol('create');

/**
 * Inline tag editor for a file (videos and pictures): filter box, click to toggle,
 * assigned tags first, the genre-from-path tag is locked.
 * A filter text that is no tag yet offers 'Create "<text>"' (in the shell's library folder), which also assigns it.
 * Dispatches `tag-modal-closed` (what the gallery listens to) once, when tags were
 * changed and the item changes or the panel unmounts.
 *
 *   <TagPanel item onTagsChange={(tags, path) => …} />   onTagsChange is optional
 */
export default function TagPanel({ item, onTagsChange }) {
  const path = item?.path;
  const { basePath } = useShell();
  const [state, setState] = useState({ path: null, fileTags: NONE, auto: NONE });
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
      const data = res.ok ? await res.json() : {};
      const fileTags = data.tags || [];
      if (latestPath.current === path) setState({ path, fileTags, auto: data.auto || NONE });
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

  const auto = current ? state.auto : NONE;   // set by a tag rule from labelmaster's scenes

  const q = filter.trim();
  const lowerQ = q.toLowerCase();
  const sorted = useMemo(() => [
    ...fileTags,
    ...allTags.filter((t) => !fileTags.includes(t))
  ].filter((t) => !lowerQ || String(t).toLowerCase().includes(lowerQ)), [fileTags, allTags, lowerQ]);

  const canCreate = !!q && !!basePath && !!path
    && ![...allTags, ...fileTags].some((t) => String(t).toLowerCase() === lowerQ);

  const toggle = async (tag, assignedNow = fileTags.includes(tag)) => {
    const assigned = assignedNow;
    const forPath = path;
    setBusyTag(tag);
    setError('');
    try {
      const res = await fetch(assigned ? '/api/tags/remove-file' : '/api/tags/assign-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: forPath, tag })
      });
      if (!res.ok) throw new Error();
      // Moved on meanwhile: the item change has gone by, so the gallery hears of it now.
      if (latestPath.current === forPath) dirty.current = true;
      else window.dispatchEvent(new Event('tag-modal-closed'));
      // loadFileTags of this render reads forPath and only updates the panel while forPath is shown.
      const next = await loadFileTags();
      if (next) onTagsChange?.(next, forPath);
    } catch (e) {
      if (latestPath.current === forPath) setError(assigned ? 'Failed to remove tag' : 'Failed to assign tag');
    } finally {
      setBusyTag(null);
    }
  };

  const create = async () => {
    const tag = q;
    const forPath = path;
    setBusyTag(CREATE);
    setError('');
    let made;
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath, tag })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create the tag');
      made = data.tag || tag;
    } catch (e) {
      if (latestPath.current === forPath) setError(e.message || 'Failed to create the tag');
      setBusyTag(null);
      return;
    }
    setAllTags((prev) => (prev.includes(made) ? prev : [...prev, made]));
    if (latestPath.current === forPath) setFilter('');
    await toggle(made, false);
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
        {canCreate && (
          <button
            type="button"
            className="pl-tg is-new"
            disabled={busyTag === CREATE}
            title="Make a new tag and put it on this file"
            onClick={create}
          >
            {busyTag === CREATE ? 'Creating…' : `Create "${q}"`}
          </button>
        )}
        {sorted.map((tag) => {
          const isGenre = !!genre && String(tag).toLowerCase() === genre;
          const isAuto = auto.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`pl-tg${fileTags.includes(tag) ? ' is-on' : ''}`}
              disabled={isGenre || busyTag === tag}
              title={isGenre ? 'Genre tag — comes from the folder' : isAuto ? 'Set from the video’s scenes (tag rule); take it off and it stays off' : undefined}
              aria-pressed={fileTags.includes(tag)}
              onClick={() => toggle(tag)}
            >
              {isAuto ? `✦ ${tag}` : tag}
            </button>
          );
        })}
        {sorted.length === 0 && !canCreate && current && (
          <p className="pl-hint">{allTags.length ? 'No tag matches the filter.' : 'No tags defined yet.'}</p>
        )}
      </div>
      {error && <p className="pl-err" role="alert">{error}</p>}
    </section>
  );
}
