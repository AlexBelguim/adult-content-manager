/** Small shared helpers for the player components. */

export const isVideoItem = (item) => !!item && item.type !== 'image';

export const fileNameOf = (path) => String(path || '').split(/[\\/]/).pop();

/** 0:07, 12:34, 1:02:03 */
export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** Bytes → "12 MB". Prefers the server-formatted string when the item has one. */
export function fmtSize(item) {
  if (!item) return '';
  if (item.sizeFormatted) return item.sizeFormatted;
  const bytes = Number(item.size);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 4 → "4", 3.5 → "3.5", null → "–" */
export function fmtRating(value) {
  if (value == null || value === '') return '–';
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// Scene rows come back snake_case from the DB and camelCase from older callers.
export const sceneStart = (scene) => Number(scene.startTime !== undefined ? scene.startTime : scene.start_time);
export const sceneEnd = (scene) => Number(scene.endTime !== undefined ? scene.endTime : scene.end_time);
export const sceneFunscript = (scene) => scene.funscriptPath || scene.funscript_path || null;

/** Categorical colour for scene n — the chart series published by styles/tokens.js. */
export const sceneColor = (index) => `var(--chart-${index % 6})`;

/** Scenes that have usable start/end times, in the order given. */
export const validScenes = (scenes) =>
  (Array.isArray(scenes) ? scenes : []).filter((s) => Number.isFinite(sceneStart(s)) && Number.isFinite(sceneEnd(s)));
