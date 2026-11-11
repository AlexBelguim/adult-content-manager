const express = require('express');
const router = express.Router();
const db = require('../db');
const { deletePerformerRecord } = require('../services/performerRecords');
const fs = require('fs-extra');
const path = require('path');
const { normalizeName } = require('../utils/performerMatcher');
const { scrapeLeakshaven, checkLeakshavenUpdates, modelNameFromUrl } = require('../services/scraperService');
const folders = require('../services/performerFolders');
const { validName, resolveOwnFolder, twinsOf, planRemoval, removeFolder, deleteFolderWithRetry, locationFolder } = folders;

const PERFORMER_SQL = `
  SELECT p.*, f.path as folder_path
  FROM performers p
  LEFT JOIN folders f ON p.folder_id = f.id
  WHERE p.id = ?
`;
const getPerformer = (id) => db.prepare(PERFORMER_SQL).get(id);

/** Length in characters as SQLite's substr counts them (code points, not UTF-16 units). */
const sqlLength = (s) => [...s].length;

// Same library and name as twinsOf's `name = ? COLLATE NOCASE`, which folds ASCII letters only
const twinKey = (p) => `${p.folder_id ?? ''}\u0000${String(p.name).replace(/[A-Z]/g, c => c.toLowerCase())}`;

/**
 * One row of the performer list: her folder (her own one, never a twin's), hash, scrape, filter and Leakhaven facts.
 * `groups` maps normalizeName(name) to the ids of every record of that name (the duplicate hint).
 */
async function enhance(performer, twins, groups) {
  const isEmpty = (performer.pics_count || 0) + (performer.vids_count || 0) + (performer.funscript_vids_count || 0) === 0;
  const resolved = await resolveOwnFolder(performer, twins);
  const own = resolved.own;

  let location;
  if (performer.blacklisted === 1) location = 'blacklisted';
  else if (own) location = isEmpty ? 'missing-or-empty' : own.location;
  else location = 'missing-or-empty';
  const folderExists = !!own;
  const actualPath = own ? own.path : null;

  const hashInfo = db.prepare(`
    SELECT
      SUM(CASE WHEN deleted_flag = 0 THEN 1 ELSE 0 END) as file_count, -- live rows only: history (1, 2) is not a hash database
      MAX(seen_at) as last_updated,
      SUM(CASE WHEN exact_hash IS NOT NULL THEN 1 ELSE 0 END) as exact_hash_count,
      SUM(CASE WHEN perceptual_hash IS NOT NULL THEN 1 ELSE 0 END) as perceptual_hash_count,
      SUM(CASE WHEN deleted_flag = 1 THEN 1 ELSE 0 END) as deleted_count
    FROM performer_file_hashes
    WHERE performer_id = ?
  `).get(performer.id);
  const hasHashDB = !!hashInfo && hashInfo.file_count > 0;

  const hasScrapedData = !!(
    performer.scraped_at ||
    performer.age ||
    performer.born ||
    performer.height ||
    performer.ethnicity
  );

  const filterStats = db.prepare(`
    SELECT
      COUNT(*) as total_actions,
      SUM(CASE WHEN action = 'keep' THEN 1 ELSE 0 END) as kept,
      SUM(CASE WHEN action = 'delete' THEN 1 ELSE 0 END) as deleted
    FROM filter_actions
    WHERE performer_id = ?
  `).get(performer.id);

  let aliases = [];
  if (performer.aliases) {
    try {
      aliases = JSON.parse(performer.aliases);
    } catch (e) {
      aliases = [];
    }
  }

  const picsProgress = performer.pics_count > 0
    ? Math.round((performer.pics_filtered / performer.pics_count) * 100)
    : 0;
  const vidsProgress = performer.vids_count > 0
    ? Math.round((performer.vids_filtered / performer.vids_count) * 100)
    : 0;
  const funscriptProgress = performer.funscript_vids_count > 0
    ? Math.round((performer.funscript_vids_filtered / performer.funscript_vids_count) * 100)
    : 0;

  const group = groups.get(normalizeName(performer.name)) || [];
  const duplicateIds = group.filter(id => id !== performer.id);

  return {
    ...performer,
    location,
    folderExists,
    actualPath,
    expectedPath: resolved.expected ? resolved.expected.path : null,
    isEmpty,
    hasHashDB,
    hashStats: {
      fileCount: hashInfo?.file_count || 0,
      exactHashCount: hashInfo?.exact_hash_count || 0,
      perceptualHashCount: hashInfo?.perceptual_hash_count || 0,
      deletedCount: hashInfo?.deleted_count || 0,
      lastUpdated: hashInfo?.last_updated
        ? new Date(hashInfo.last_updated * 1000).toISOString()
        : null
    },
    hasScrapedData,
    scrapedAt: performer.scraped_at,
    filterStats: {
      totalActions: filterStats?.total_actions || 0,
      kept: filterStats?.kept || 0,
      deleted: filterStats?.deleted || 0
    },
    aliases,
    filteringProgress: {
      pics: picsProgress,
      vids: vidsProgress,
      funscript: funscriptProgress,
      overall: Math.round((picsProgress + vidsProgress + funscriptProgress) / 3)
    },
    leakshavenUpdate: {
      url: performer.leakshaven_url,
      lastCheckDate: performer.last_leakshaven_check_date,
      newestUpload: performer.last_leakshaven_update_time,
      acknowledged: performer.leakshaven_update_acknowledged === 1,
      error: performer.leakshaven_check_error
    },
    hasDuplicates: duplicateIds.length > 0,
    duplicateIds,
    twinIds: twins.map(t => t.id),
    folderSharedWith: resolved.sharedWith
  };
}

function nameGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.id);
  }
  return groups;
}

/**
 * GET /api/performer-management/all
 * Every performer with her location, hash status, scrape status, duplicates and twins
 */
router.get('/all', async (req, res) => {
  try {
    // exclude hidden folders like .cache
    const performers = db.prepare(`
      SELECT p.*, f.path as folder_path
      FROM performers p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.name NOT LIKE '.%'
    `).all();

    // Twins: same library, same name (case-insensitive), from this one query
    const byKey = new Map();
    for (const p of performers) {
      const key = twinKey(p);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    }
    const groups = nameGroups(performers);

    const list = await Promise.all(performers.map(p =>
      enhance(p, byKey.get(twinKey(p)).filter(t => t.id !== p.id), groups)));

    const count = (location) => list.filter(p => p.location === location).length;
    res.send({
      success: true,
      performers: list,
      summary: {
        total: list.length,
        before: count('before'),
        after: count('after'),
        missingOrEmpty: count('missing-or-empty'),
        blacklisted: count('blacklisted'),
        withHashDB: list.filter(p => p.hasHashDB).length,
        scraped: list.filter(p => p.hasScrapedData).length
      }
    });
  } catch (err) {
    console.error('Error getting performer management data:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/performer-management/:id
 * One row in the shape of /all
 */
router.get('/:id', async (req, res) => {
  try {
    const performer = getPerformer(req.params.id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    const groups = nameGroups(db.prepare("SELECT id, name FROM performers WHERE name NOT LIKE '.%'").all());
    res.send({ success: true, performer: await enhance(performer, twinsOf(performer), groups) });
  } catch (err) {
    console.error('Error getting performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/performer-management/:id/removal-plan
 * Her folders (with file counts and sizes) and, per removal option, which of them go and whether it is refused
 */
router.get('/:id/removal-plan', async (req, res) => {
  try {
    const performer = getPerformer(req.params.id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    res.send({ success: true, ...await planRemoval(performer, { stats: true }) });
  } catch (err) {
    console.error('Error planning removal:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * Delete exactly the folders the plan gives the option, in the order own (or leftover), legacy trash, training.
 * Answers the 409 (blocked) or 500 (a folder could not be deleted) itself and returns null then; else what was done.
 * Nothing in the database changes here.
 */
async function removeFolders(res, performer, option, { saveTrash = true } = {}) {
  const plan = await planRemoval(performer);
  const { goes, blocked } = plan.options[option];
  if (blocked) {
    res.status(409).send({ error: blocked, code: 'blocked' });
    return null;
  }

  const done = { plan, deletedFolders: [], deletedPaths: [], trash: { saved: 0, deleted: 0, errors: [] } };
  for (const key of ['own', 'leftover', 'trash', 'training'].filter(k => goes.includes(k))) {
    const folder = plan.folders.find(f => f.key === key);
    if (!folder) continue;
    try {
      if (key === 'training') {
        await deleteFolderWithRetry(folder.path);
      } else {
        const t = await removeFolder(folder.path, performer, { saveTrash });
        done.trash.saved += t.saved;
        done.trash.deleted += t.deleted;
        done.trash.errors.push(...t.errors);
      }
      done.deletedFolders.push(folder.rel);
      done.deletedPaths.push(folder.path);
    } catch (err) {
      console.error(`Error deleting ${folder.path}:`, err);
      res.status(500).send({
        error: `Could not delete ${folder.rel}: ${err.message}. Some files may already be gone; rescan her to see what is left.`,
        code: 'delete_failed',
        path: folder.path,
        deletedFolders: done.deletedFolders
      });
      return null;
    }
  }

  done.keptFolders = plan.folders
    .filter(f => !goes.includes(f.key) && (f.key === 'other' || ((f.key === 'trash' || f.key === 'training') && f.shared)))
    .map(f => ({ rel: f.rel, reason: f.key === 'other' ? `belongs to her other record #${f.otherId}` : 'shared with her other record' }));
  return done;
}

const removalFields = (done) => ({
  deletedFolders: done.deletedFolders,
  keptFolders: done.keptFolders,
  trash: done.trash
});

/**
 * DELETE /api/performer-management/:id/folder-only
 * Delete her own folder but keep all database records
 */
router.delete('/:id/folder-only', async (req, res) => {
  try {
    const { id } = req.params;
    const performer = getPerformer(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const done = await removeFolders(res, performer, 'delete-folder-only');
    if (!done) return;

    // Clear thumbnail (no longer valid)
    db.prepare('UPDATE performers SET thumbnail = NULL WHERE id = ?').run(id);

    res.send({
      success: true,
      message: `Deleted folders for "${performer.name}", kept all database records`,
      ...removalFields(done)
    });
  } catch (err) {
    console.error('Error deleting folder only:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/performer-management/:id/before-cleanup
 * Delete the Before folder left over from her move to After, and the filter decisions of the files in it.
 * Her After folder, her tags and her hash rows stay (the next hash build marks the missing files).
 */
router.delete('/:id/before-cleanup', async (req, res) => {
  try {
    const { id } = req.params;
    const performer = getPerformer(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const done = await removeFolders(res, performer, 'cleanup-before');
    if (!done) return;

    let filterActionsDeleted = 0;
    const leftover = done.plan.folders.find(f => f.key === 'leftover');
    if (leftover && done.deletedPaths.includes(leftover.path)) {
      const prefix = leftover.path + path.sep;
      filterActionsDeleted = db.prepare(`
        DELETE FROM filter_actions
        WHERE performer_id = ? AND (file_path = ? OR substr(file_path, 1, ?) = ?)
      `).run(id, leftover.path, sqlLength(prefix), prefix).changes;
    }

    res.send({
      success: true,
      message: `Cleaned up before folder for "${performer.name}"`,
      ...removalFields(done),
      hashPathsUpdated: 0,
      filterActionsDeleted,
      tagsDeleted: 0
    });
  } catch (err) {
    console.error('Error cleaning up before folder:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/blacklist
 * Blacklist a performer (prevents re-import, keeps hash DB)
 */
router.post('/:id/blacklist', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const performer = getPerformer(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const done = await removeFolders(res, performer, 'blacklist');
    if (!done) return;

    // Delete filter actions, tags, thumbnail
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE performer_id = ?').run(id);

    // Mark as blacklisted (keep performer record, hash DB, scraped data, name, aliases)
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE performers
      SET blacklisted = 1,
          blacklist_reason = ?,
          blacklist_date = ?,
          thumbnail = NULL,
          moved_to_after = 0,
          pics_count = 0,
          vids_count = 0,
          funscript_vids_count = 0,
          funscript_files_count = 0,
          total_size_gb = 0
      WHERE id = ?
    `).run(reason || null, now, id);

    res.send({
      success: true,
      message: `Blacklisted "${performer.name}"`,
      reason: reason || null,
      ...removalFields(done),
      keptData: ['name', 'aliases', 'hash_db', 'scraped_data']
    });
  } catch (err) {
    console.error('Error blacklisting performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/unblacklist
 * Remove blacklist status
 */
router.post('/:id/unblacklist', async (req, res) => {
  try {
    const { id } = req.params;

    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);

    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    if (performer.blacklisted !== 1) {
      return res.status(400).send({ error: 'Performer is not blacklisted' });
    }

    // Remove blacklist
    db.prepare(`
      UPDATE performers
      SET blacklisted = 0,
          blacklist_reason = NULL,
          blacklist_date = NULL
      WHERE id = ?
    `).run(id);

    res.send({
      success: true,
      message: `Removed blacklist for "${performer.name}"`
    });
  } catch (err) {
    console.error('Error unblacklisting performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/performer-management/:id/complete
 * Delete her own folder and her record
 */
router.delete('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const performer = getPerformer(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const done = await removeFolders(res, performer, 'delete-complete');
    if (!done) return;

    const deletedItems = {
      folders: done.deletedPaths,
      databaseRecords: {
        filterActions: 0,
        tags: 0,
        fileHashes: 0,
        hashRuns: 0,
        performer: 0
      }
    };
    // Delete all database records (one transaction, clears every FK dependent)
    Object.assign(deletedItems.databaseRecords, deletePerformerRecord(id));

    res.send({
      success: true,
      message: `Performer "${performer.name}" completely deleted`,
      performerName: performer.name,
      deletedItems,
      ...removalFields(done)
    });
  } catch (err) {
    console.error('Error deleting performer completely:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/performer-management/:id/forget
 * Delete a performer and her training data: her own folder and its trash (nothing saved for training), what was
 * already saved under "deleted keep for training" (only when no other record has her name), and every record, the
 * keep/delete decisions, picture pairs and picture scores she was in included. File hashes stay, so a re-download is
 * still recognised.
 */
router.delete('/:id/forget', async (req, res) => {
  try {
    const performer = getPerformer(req.params.id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const done = await removeFolders(res, performer, 'delete-forget', { saveTrash: false });
    if (!done) return;

    const plan = done.plan;
    const hasTwins = twinsOf(performer).length > 0;
    // Her pictures as pair members (any performer's pair), only in folders that went: her own one and her training
    // folder. instr is case-sensitive and needs no escaping, so a twin whose name differs in case is not hit.
    const marks = [];
    const own = plan.folders.find(f => f.key === 'own');
    const goneFolders = [];
    if (own && done.deletedPaths.includes(own.path)) goneFolders.push(own.rel.split('/')[0]);
    const training = plan.folders.find(f => f.key === 'training');
    if (training && done.deletedPaths.includes(training.path)) goneFolders.push(folders.TRAINING_FOLDER);
    for (const f of goneFolders) {
      marks.push(`/${f}/${performer.name}/`, `\\${f}\\${performer.name}\\`);
    }

    const clauses = ['performer_id = ?'];
    const params = [performer.id];
    if (!hasTwins) {
      clauses.push('(performer_id IS NULL AND performer_name = ?)');
      params.push(performer.name);
    }
    for (const mark of marks) {
      clauses.push('(instr(winner, ?) > 0 OR instr(loser, ?) > 0)');
      params.push(mark, mark);
    }

    const forget = db.transaction(() => {
      const pairs = db.prepare(`DELETE FROM pairwise_pairs WHERE ${clauses.join(' OR ')}`).run(...params).changes;
      const scores = db.prepare('DELETE FROM image_elo_scores WHERE performer_id = ?').run(performer.id).changes;
      return { pairs, scores, ...deletePerformerRecord(performer.id) };
    });

    res.send({
      success: true,
      message: `"${performer.name}" deleted with her training data`,
      ...removalFields(done),
      databaseRecords: forget()
    });
  } catch (err) {
    console.error('Error forgetting performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/rescan
 * Rescan her own folder and update stats. The original counts are written only when not set yet.
 */
router.post('/:id/rescan', async (req, res) => {
  try {
    const { id } = req.params;
    const performer = getPerformer(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const { own } = await resolveOwnFolder(performer, twinsOf(performer));
    if (!own) {
      return res.status(404).send({ error: 'Her folder was not found' });
    }
    const performerPath = own.path;

    const { scanPerformerFolderEnhanced } = require('../services/importer');
    const stats = await scanPerformerFolderEnhanced(performerPath);

    const now = new Date().toISOString();
    const picsPath = path.join(performerPath, 'pics');
    const vidsPath = path.join(performerPath, 'vids');
    const funscriptPath = path.join(vidsPath, 'funscript');

    db.prepare(`
      UPDATE performers
      SET pics_count = ?,
          vids_count = ?,
          funscript_vids_count = ?,
          funscript_files_count = ?,
          total_size_gb = ?,
          pics_original_count = CASE WHEN COALESCE(pics_original_count, 0) = 0 THEN ? ELSE pics_original_count END,
          vids_original_count = CASE WHEN COALESCE(vids_original_count, 0) = 0 THEN ? ELSE vids_original_count END,
          funscript_vids_original_count = CASE WHEN COALESCE(funscript_vids_original_count, 0) = 0 THEN ? ELSE funscript_vids_original_count END,
          last_scan_date = ?,
          cached_pics_path = ?,
          cached_vids_path = ?,
          cached_funscript_path = ?
      WHERE id = ?
    `).run(
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      stats.funscript_files_count,
      stats.total_size_gb,
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      now,
      picsPath,
      vidsPath,
      funscriptPath,
      id
    );

    res.send({
      success: true,
      message: 'Performer rescanned',
      stats
    });
  } catch (err) {
    console.error('Error rescanning performer:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/check-update
 * Check one linked performer for new Leakhaven uploads. The page calls this per performer, so it
 * can show progress and stop.
 *
 * New = the newest upload is newer than the last one seen. On a first check nothing has been seen,
 * so the performer's last folder scan is the line instead.
 */
router.post('/:id/check-update', async (req, res) => {
  try {
    const performer = db.prepare(`
      SELECT leakshaven_url, last_leakshaven_update_time, leakshaven_update_acknowledged, last_scan_date, import_date
      FROM performers WHERE id = ?
    `).get(req.params.id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    const modelName = modelNameFromUrl(performer.leakshaven_url);
    if (!modelName) {
      return res.status(400).send({ error: 'No Leakhaven link' });
    }

    const checkDate = new Date().toISOString();
    try {
      const newest = await checkLeakshavenUpdates(modelName);
      const previous = performer.last_leakshaven_update_time;
      const scanned = performer.last_scan_date || performer.import_date;
      // import_date is SQLite's UTC "YYYY-MM-DD HH:MM:SS"
      const line = previous || (scanned ? new Date(scanned.includes('T') ? scanned : `${scanned.replace(' ', 'T')}Z`).toISOString() : '');

      let acknowledged = previous ? performer.leakshaven_update_acknowledged : 1;
      if (newest && newest > line) acknowledged = 0;

      db.prepare(`
        UPDATE performers
        SET last_leakshaven_check_date = ?, last_leakshaven_update_time = ?,
            leakshaven_update_acknowledged = ?, leakshaven_check_error = NULL
        WHERE id = ?
      `).run(checkDate, newest || previous, acknowledged, req.params.id);

      res.send({ success: true, newestUpload: newest, isNew: !!newest && acknowledged === 0 });
    } catch (err) {
      console.error(`Leakhaven check failed for ${modelName}:`, err.message);
      db.prepare('UPDATE performers SET last_leakshaven_check_date = ?, leakshaven_check_error = ? WHERE id = ?')
        .run(checkDate, err.message, req.params.id);
      res.send({ success: false, error: err.message });
    }
  } catch (err) {
    console.error('Error checking Leakhaven update:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * PUT /api/performer-management/:id/leakhaven-link
 * Set the performer's Leakhaven page by hand: a leakshaven.com/model/… link or a name Leakhaven
 * knows. It is looked up first, so only a real model page is saved. An empty link removes it.
 */
router.put('/:id/leakhaven-link', async (req, res) => {
  try {
    const raw = (req.body || {}).link;
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return res.status(400).send({ error: 'Link must be text' });
    }
    const link = (raw || '').trim();
    if (!db.prepare('SELECT id FROM performers WHERE id = ?').get(req.params.id)) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    let url = null;
    if (link) {
      const found = await scrapeLeakshaven([link]);
      if (!found) {
        return res.status(404).send({ error: `No Leakhaven model page for "${link}"` });
      }
      url = found.url;
    }
    db.prepare(`
      UPDATE performers
      SET leakshaven_url = ?, last_leakshaven_check_date = NULL, last_leakshaven_update_time = NULL,
          leakshaven_update_acknowledged = 0, leakshaven_check_error = NULL
      WHERE id = ?
    `).run(url, req.params.id);
    res.send({ success: true, url });
  } catch (err) {
    console.error('Error setting Leakhaven link:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/performer-management/:id/acknowledge-update
 * Mark a performer's leakshaven update as seen/acknowledged
 */
router.post('/:id/acknowledge-update', async (req, res) => {
  try {
    const { id } = req.params;

    const performer = db.prepare('SELECT name FROM performers WHERE id = ?').get(id);

    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    db.prepare(`
      UPDATE performers
      SET leakshaven_update_acknowledged = 1
      WHERE id = ?
    `).run(id);

    res.send({
      success: true,
      message: `Acknowledged update for "${performer.name}"`
    });
  } catch (err) {
    console.error('Error acknowledging update:', err);
    res.status(500).send({ error: err.message });
  }
});

/** Same folder on disk (a case-only rename on a case-insensitive disk sees its own folder as the target). */
async function sameFolder(a, b) {
  try {
    const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

/**
 * POST /api/performer-management/:id/rename
 * Rename a performer and, with renameFolder, her own folder (never a twin's). Every stored path under her folder is
 * rewritten by prefix in one transaction; if that fails, the folders are moved back.
 */
router.post('/:id/rename', async (req, res) => {
  try {
    const { id } = req.params;
    const { newName, renameFolder } = req.body || {};
    const trimmedNewName = typeof newName === 'string' ? newName.trim() : '';
    const invalid = validName(trimmedNewName);
    if (invalid) {
      return res.status(400).send({ error: invalid, code: 'invalid_name' });
    }

    const performer = getPerformer(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }
    const oldName = performer.name;

    // Check if name already exists
    const existing = db.prepare('SELECT id FROM performers WHERE name = ? AND id != ?').get(trimmedNewName, id);
    if (existing) {
      return res.status(400).send({ error: `Performer with name "${trimmedNewName}" already exists` });
    }

    const renamedFolders = [];
    let oldOwn = null;
    let newOwn = null;

    // A record whose name is not a folder name is renamed in the database only
    if (renameFolder && performer.folder_path && !validName(oldName)) {
      const twins = twinsOf(performer);
      const resolved = await resolveOwnFolder(performer, twins);
      if (resolved.sharedWith.length) {
        return res.status(409).send({
          error: `Another record of hers (#${resolved.sharedWith[0]}) uses the same folder. Merge the two records first.`,
          code: 'blocked'
        });
      }
      if (resolved.own && trimmedNewName !== oldName) {
        oldOwn = resolved.own.path;
        const parent = path.join(performer.folder_path, locationFolder(resolved.own.location));
        newOwn = path.join(parent, trimmedNewName);
        if (path.dirname(newOwn) !== parent) {
          return res.status(400).send({ error: folders.NAME_RULE, code: 'invalid_name' });
        }
        if (await fs.pathExists(newOwn) && !await sameFolder(oldOwn, newOwn)) {
          return res.status(409).send({
            error: `A folder named ${trimmedNewName} already exists in ${folders.locationLabel(resolved.own.location)}`,
            code: 'target_exists'
          });
        }

        await fs.move(oldOwn, newOwn);
        renamedFolders.push({ from: oldOwn, to: newOwn });

        // The legacy trash is per name: only when no other record has her name, and only into a free name
        const trashOld = path.join(performer.folder_path, folders.TRASH_FOLDER, oldName);
        const trashNew = path.join(performer.folder_path, folders.TRASH_FOLDER, trimmedNewName);
        if (twins.length === 0 && await fs.pathExists(trashOld) && !await fs.pathExists(trashNew)) {
          try {
            await fs.move(trashOld, trashNew);
            renamedFolders.push({ from: trashOld, to: trashNew });
          } catch (err) {
            console.error('Could not rename the old trash folder:', err);
          }
        }
      }
    }

    const fromPrefix = oldOwn ? oldOwn + path.sep : null;
    const toPrefix = newOwn ? newOwn + path.sep : null;
    const rewrite = (value) => {
      if (!oldOwn || typeof value !== 'string') return value;
      if (value === oldOwn) return newOwn;
      return value.startsWith(fromPrefix) ? toPrefix + value.slice(fromPrefix.length) : value;
    };

    const apply = db.transaction(() => {
      if (oldOwn) {
        let thumbnailPaths = performer.thumbnail_paths;
        if (thumbnailPaths) {
          try {
            const parsed = JSON.parse(thumbnailPaths);
            if (Array.isArray(parsed)) thumbnailPaths = JSON.stringify(parsed.map(rewrite));
          } catch (e) {
            // not JSON: left as it is
          }
        }
        db.prepare(`
          UPDATE performers
          SET cached_pics_path = ?, cached_vids_path = ?, cached_funscript_path = ?, thumbnail = ?, thumbnail_paths = ?
          WHERE id = ?
        `).run(
          rewrite(performer.cached_pics_path),
          rewrite(performer.cached_vids_path),
          rewrite(performer.cached_funscript_path),
          rewrite(performer.thumbnail),
          thumbnailPaths,
          id
        );
        for (const table of ['filter_actions', 'performer_file_hashes']) {
          db.prepare(`
            UPDATE ${table}
            SET file_path = ? || substr(file_path, ?)
            WHERE performer_id = ? AND (file_path = ? OR substr(file_path, 1, ?) = ?)
          `).run(newOwn, sqlLength(oldOwn) + 1, id, oldOwn, sqlLength(fromPrefix), fromPrefix);
        }
        db.prepare('DELETE FROM performer_file_cache WHERE performer_id = ?').run(id);
      }
      db.prepare('UPDATE performers SET name = ? WHERE id = ?').run(trimmedNewName, id);
      db.prepare('UPDATE pairwise_pairs SET performer_name = ? WHERE performer_id = ?').run(trimmedNewName, id);
    });

    try {
      apply();
    } catch (err) {
      console.error('Rename failed in the database, moving the folders back:', err);
      const stuck = [];
      for (const moved of [...renamedFolders].reverse()) {
        try {
          await fs.move(moved.to, moved.from);
        } catch (moveErr) {
          stuck.push(`${moved.to} (${moveErr.message})`);
        }
      }
      return res.status(500).send({
        error: stuck.length
          ? `Could not rename her: ${err.message}. These folders could not be moved back: ${stuck.join(', ')}`
          : `Could not rename her: ${err.message}. Her folders were moved back.`
      });
    }

    res.send({
      success: true,
      message: `Renamed performer from "${oldName}" to "${trimmedNewName}"`,
      oldName,
      newName: trimmedNewName,
      renamedFolders
    });
  } catch (err) {
    console.error('Error renaming performer:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
