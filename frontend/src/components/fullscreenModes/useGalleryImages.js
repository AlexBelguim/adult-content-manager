import { useEffect, useRef, useState } from 'react';

/**
 * Shared image-fetching hook for fullscreen gallery animation modes.
 *
 * Loads a pool of (performer, imagePath) pairs by hitting
 * `/api/performers/:id/images?filter=pics` for each performer in batches.
 * Modes can iterate this pool however they want.
 *
 * @param {Array} performers
 * @param {Object} options
 *   - perPerformerMax: hard cap on images pulled per performer
 *   - active: only fetch while truthy
 */
export default function useGalleryImages(performers, { perPerformerMax = 12, active = true } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef(new Map()); // performerId -> string[] of paths
  const abortRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    if (!performers || performers.length === 0) {
      setItems([]);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const valid = performers.filter(p => p && p.name);
    const collected = [];

    const fetchOne = async (performer) => {
      const cached = cacheRef.current.get(performer.id);
      if (cached) {
        cached.slice(0, perPerformerMax).forEach(path => {
          collected.push({ performer, path });
        });
        return;
      }
      try {
        const resp = await fetch(`/api/performers/${performer.id}/images?filter=pics`, {
          signal: controller.signal
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const paths = (data?.pics || []).map(p => p.path).filter(Boolean);
        cacheRef.current.set(performer.id, paths);
        paths.slice(0, perPerformerMax).forEach(path => {
          collected.push({ performer, path });
        });
      } catch (e) {
        if (e.name !== 'AbortError') {
          // ignore - one performer's failure shouldn't kill the whole pool
        }
      }
    };

    // Run in small concurrent batches to avoid overloading server
    const run = async () => {
      const concurrency = 4;
      let i = 0;
      const next = async () => {
        const me = i++;
        if (me >= valid.length) return;
        await fetchOne(valid[me]);
        // Stream partial results periodically so the view can start rendering
        if (me % 6 === 0 && !controller.signal.aborted) {
          setItems([...collected]);
        }
        return next();
      };
      await Promise.all(Array.from({ length: concurrency }, next));
      if (!controller.signal.aborted) {
        setItems([...collected]);
        setLoading(false);
      }
    };

    run();

    return () => {
      controller.abort();
      setLoading(false);
    };
  }, [performers, active, perPerformerMax]);

  return { items, loading };
}

export const imageUrlForPath = (path) =>
  `/api/files/raw?path=${encodeURIComponent(path)}`;
