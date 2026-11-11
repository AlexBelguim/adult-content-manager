/**
 * Forget one library folder: its performers and every path-keyed row under it, in one transaction, after a copy of
 * the database is saved. No file on disk is touched.
 *
 * Removed: performers of the folder (through deletePerformerRecord: their filter actions, tags, comparison runs,
 * content items, file cache, and what cascades), filter_actions without a performer under the folder, file_tags,
 * auto_tag_dismissed, exported_files (by file or by original video), video_scenes, content_genres and the folders row.
 *
 * Kept on purpose:
 * - app_settings: settings belong to the app, not to a folder.
 * - tags rows with performer_id NULL and tag_rules: tag definitions are shared.
 * - performer_file_hashes: deletePerformerRecord keeps them by performer_name, so a re-download is still recognised.
 * - pairwise_pairs, encode_jobs (held originals for Undo), media_probe, video_labels, file_ratings, funpipe_jobs,
 *   discover_*: path-keyed history, reused if the folder is added again.
 *
 * A folder with queued or running re-encodes, funscript jobs or a running hash build of one of its performers is
 * refused. Its performers' waiting and ended hash builds (hash_jobs) go with their records.
 */
const path = require('path');
const fs = require('fs-extra');
const db = require('../db');
const config = require('../config');
const { deletePerformerRecord } = require('./performerRecords');
const { runningJobFor } = require('./hashService');

const trimEnd = (p) => String(p || '').replace(/[\\/]+$/, '');

/** The folder's name: the last part of its path, or the whole path when that is empty (a root such as "/") */
function folderName(folderPath) {
  const p = trimEnd(folderPath);
  return path.basename(p) || String(folderPath || '');
}

/** SQL: col is the folder path or lies under it, with either separator. Bind @p. */
const under = (col) => `(${col} = @p OR substr(${col}, 1, length(@p) + 1) IN (@p || '/', @p || '\\'))`;

/** A count that is 0 when its table is missing */
function count(sql, params) {
  try {
    return db.prepare(sql).get(params).n || 0;
  } catch (e) {
    return 0;
  }
}

function notFound() {
  return Object.assign(new Error('Folder not found'), { status: 404 });
}

/** What removing the folder does: counts of what goes, what stays, and why it cannot go now */
async function plan(folderId) {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  if (!folder) throw notFound();
  const id = folder.id;
  const p = trimEnd(folder.path) || String(folder.path || '');
  const name = folderName(folder.path);
  const params = { id, p };
  const ofPerformers = 'performer_id IN (SELECT id FROM performers WHERE folder_id = @id)';

  const counts = {
    performers: count('SELECT COUNT(*) AS n FROM performers WHERE folder_id = @id', params),
    filterActions: count(`SELECT COUNT(*) AS n FROM filter_actions WHERE ${ofPerformers} OR (performer_id IS NULL AND ${under('file_path')})`, params),
    scenes: count(`SELECT COUNT(*) AS n FROM video_scenes WHERE ${under('video_path')}`, params),
    exportedFiles: count(`SELECT COUNT(*) AS n FROM exported_files WHERE ${under('file_path')} OR ${under('original_video_path')}`, params),
    fileTags: count(`SELECT COUNT(*) AS n FROM file_tags WHERE ${under('file_path')}`, params),
    genres: count('SELECT COUNT(*) AS n FROM content_genres WHERE folder_id = @id', params)
  };
  const kept = {
    fileHashes: count(`SELECT COUNT(*) AS n FROM performer_file_hashes WHERE ${ofPerformers}`, params),
    heldOriginals: count(`SELECT COUNT(*) AS n FROM encode_jobs WHERE status = 'done' AND held_path IS NOT NULL AND ${under('source_path')}`, params)
  };

  const blockers = [];
  const encodes = count(`SELECT COUNT(*) AS n FROM encode_jobs WHERE status IN ('queued', 'running') AND ${under('source_path')}`, params);
  if (encodes) blockers.push(`${encodes} re-encodes of this folder are queued or running. Remove them in Settings → Space first.`);
  const funscripts = count(`SELECT COUNT(*) AS n FROM funpipe_jobs WHERE status IN ('queued', 'running') AND ${under('video_path')}`, params);
  if (funscripts) blockers.push(`${funscripts} funscript jobs of this folder are queued or running. Cancel them on the Jobs page first.`);
  // a build running here (hashService) or in another process (hash_jobs with a fresh heartbeat); waiting builds of
  // her are dropped with her record (deletePerformerRecord)
  const liveHash = new Set();
  try {
    for (const r of db.prepare("SELECT performer_id FROM hash_jobs WHERE status = 'running' AND heartbeat_at >= ?").all(Date.now() - 120000)) liveHash.add(r.performer_id);
  } catch (e) { /* no hash_jobs table */ }
  for (const performer of db.prepare('SELECT id, name FROM performers WHERE folder_id = ?').all(id)) {
    if (runningJobFor(performer.id) || liveHash.has(performer.id)) {
      blockers.push(`A hash run is going for ${performer.name}. Wait for it or cancel it on the Jobs page.`);
    }
  }

  return { folder: { id, path: folder.path, name }, counts, kept, blockers };
}

/** Local time as YYYYMMDD-HHmmss */
function stamp(d = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** Forget the folder. confirm must be its name. Returns { folder, removed, backup } */
async function remove(folderId, { confirm } = {}) {
  const p = await plan(folderId);
  const { name } = p.folder;
  if (String(confirm || '').trim() !== name) {
    throw Object.assign(new Error(`Type the folder name ${name} to confirm`), { status: 400 });
  }
  if (p.blockers.length) {
    throw Object.assign(new Error(p.blockers.join(' ')), { status: 409 });
  }

  const dir = path.join(config.dataPath, 'backups');
  await fs.ensureDir(dir);
  const backup = path.resolve(dir, `app-${stamp()}-before-removing-${name.replace(/[^A-Za-z0-9._-]+/g, '-')}.db`);
  await db.backup(backup);

  const id = p.folder.id;
  const params = { id, p: trimEnd(p.folder.path) || String(p.folder.path || '') };
  db.transaction(() => {
    // A job that started after the plan was made still blocks
    const again = db.prepare(`SELECT COUNT(*) AS n FROM encode_jobs WHERE status IN ('queued', 'running') AND ${under('source_path')}`).get(params).n;
    if (again) throw Object.assign(new Error(`${again} re-encodes of this folder are queued or running. Remove them in Settings → Space first.`), { status: 409 });

    for (const { id: performerId } of db.prepare('SELECT id FROM performers WHERE folder_id = ?').all(id)) {
      deletePerformerRecord(performerId);
    }
    db.prepare(`DELETE FROM filter_actions WHERE performer_id IS NULL AND ${under('file_path')}`).run(params);
    db.prepare(`DELETE FROM file_tags WHERE ${under('file_path')}`).run(params);
    db.prepare(`DELETE FROM auto_tag_dismissed WHERE ${under('file_path')}`).run(params);
    db.prepare(`DELETE FROM exported_files WHERE ${under('file_path')} OR ${under('original_video_path')}`).run(params);
    db.prepare(`DELETE FROM video_scenes WHERE ${under('video_path')}`).run(params);
    db.prepare('DELETE FROM content_genres WHERE folder_id = @id').run(params);
    db.prepare('DELETE FROM folders WHERE id = @id').run(params);
  })();

  console.log(`[folders] Removed folder ${p.folder.path} from the app; copy of the database at ${backup}`);
  return { folder: p.folder, removed: p.counts, backup };
}

module.exports = { plan, remove, folderName };
