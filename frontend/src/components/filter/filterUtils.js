/** Small helpers shared by the filter view pieces. */

export const TABS = ['pics', 'vids', 'funscript_vids'];
export const TAB_LABEL = { pics: 'Pictures', vids: 'Videos', funscript_vids: 'Funscript videos' };

// /api/filter/stats/:id names its per-tab fields picsTotal / vidsTotal / funscriptTotal …
const STAT_PREFIX = { pics: 'pics', vids: 'vids', funscript_vids: 'funscript' };

export const ACTION_LABEL = { keep: 'Keep', delete: 'Delete', move_to_funscript: 'Move to funscript' };
export const ACTION_BADGE = { keep: 'KEPT', delete: 'DELETED', move_to_funscript: 'MOVED' };

/**
 * Per-tab progress from the stats payload plus this session's not-yet-reflected
 * decisions (`delta` — the backend caches stats for up to a minute).
 */
export function tabProgress(stats, delta, tab) {
  const p = STAT_PREFIX[tab];
  const d = delta?.[tab] || { done: 0, total: 0 };
  const total = Math.max(0, (Number(stats?.[`${p}Total`]) || 0) + d.total);
  const done = Math.min(total, Math.max(0, (Number(stats?.[`${p}Processed`]) || 0) + d.done));
  const pct = stats ? (total === 0 ? 100 : Math.round((done / total) * 100)) : 0;
  return { total, done, left: Math.max(0, total - done), pct };
}

const KEY_NAMES = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  ' ': 'Space', Enter: '↵', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Tab: 'Tab'
};

/** "ArrowLeft" → "←", "k" → "K" */
export function keyLabel(key) {
  if (!key) return '';
  return KEY_NAMES[key] || (key.length === 1 ? key.toUpperCase() : key);
}

/** Does this keydown match a configured shortcut? Single letters ignore case (Caps Lock). */
export function matchesKey(e, key) {
  if (!key) return false;
  return key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
}

/** A filter-list file → the MediaItem shape MediaStage and the panels expect. */
export function mediaItemFor(file, tab) {
  const enc = encodeURIComponent(file.path);
  const image = tab === 'pics';
  return {
    path: file.path,
    name: file.name,
    type: image ? 'image' : tab === 'vids' ? 'video' : 'funscript_video',
    url: `/api/files/raw?path=${enc}`,
    thumbnail: `/api/files/${image ? 'preview' : 'video-thumbnail'}?path=${enc}`,
    size: file.size,
    modified: file.modified,
    duration: file.duration,
    width: file.width,
    height: file.height
  };
}

/** Body of a failed fetch as a readable message. */
export async function errorMessage(res) {
  const text = await res.text().catch(() => '');
  try {
    const data = JSON.parse(text);
    if (data && data.error) return String(data.error);
  } catch (e) {
    // not JSON
  }
  return text || `HTTP ${res.status}`;
}
