/**
 * The player's recoverable delete: files go to the trash folder beside them (<dir>/.trash, or
 * vids/funscript/.trash/<sub>/ for a video's own funscript folder) and come back with restoreFromTrash.
 * Tags and scores stay in the database, so a restored file has them again.
 *
 *   trashVideo(videoPath, funscriptPaths) -> { trashed: [{ path, trashPath }], failed: [{ path, reason }] }
 *     throws Error(message) with err.results = [{ path, ok, reason }] | null when nothing was moved
 *   trashFunscript(scriptPath)            -> { trashed: [{ path, trashPath }] }
 *   restoreFromTrash(items)               -> { restored, skipped }   items: [{ path, trashPath }]
 *   trashFolderLabel(filePath)            -> 'vids/.trash' | 'funscript/.trash' (what the dialogs name)
 */

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function trashVideo(videoPath, funscriptPaths = []) {
  const res = await fetch('/api/files/delete-with-funscripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoPath, funscriptPaths })
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.results = data.results || null;
    throw err;
  }
  return { trashed: data.trashed || [], failed: data.failed || [] };
}

export async function trashFunscript(scriptPath) {
  const res = await fetch('/api/funscripts/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptPath })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { trashed: data.trashed || [] };
}

export async function restoreFromTrash(items) {
  const res = await fetch('/api/files/restore-from-trash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { restored: data.restored || [], skipped: data.skipped || [] };
}

/** The trash folder a file goes to, as the server picks it, named short. */
export function trashFolderLabel(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  const at = (i) => parts[parts.length + i] || '';
  if (at(-3).toLowerCase() === 'funscript' && at(-4).toLowerCase() === 'vids') return 'funscript/.trash';
  return `${at(-2)}/.trash`;
}
