const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { adoptOrphanedHashes } = require('./performerRecords');
const { scanPerformerFolder } = require('./fileScanner');
const {
    SUPPORTED, kindOf, isJunk, requireLibrary, httpError, performerNameError, checkFolder,
    resolveImportName, safeRel, placeFile, sameContent
} = require('./importGuard');

// Progress of the running import, keyed by its queue job id (read by the upload queue)
const uploadProgressMap = new Map();

const LIST_CAP = 200;

function newReport(performerName, requestedName) {
    return {
        performerName,
        requestedName,
        matched: null,
        isUpdate: false,
        imported: 0,
        identical: 0,
        renamed: 0,
        unsupported: 0,
        failed: 0,
        lists: { identical: [], renamed: [], unsupported: [], failed: [] },
        leftIn: null,
        coverKept: false,
        hashing: 'off',
        hashError: null
    };
}

// Counts are true totals; each list keeps the first LIST_CAP items
function note(report, key, item) {
    report[key]++;
    if (report.lists[key] && report.lists[key].length < LIST_CAP) report.lists[key].push(item);
}

const posixRel = (from, to) => path.relative(from, to).split(path.sep).join('/');

/**
 * The name checks of an import, before any file is touched: the library row, the name rule and the blacklist.
 * Returns { lib, match }; throws an Error with .code ('no-library', 'unknown-library', 'invalid', 'blacklisted').
 */
function checkImport(performerName, basePath) {
    const lib = requireLibrary(basePath);
    const nameErr = performerNameError(performerName);
    if (nameErr) throw httpError(400, 'invalid', nameErr);
    const match = resolveImportName(performerName);
    if (match.kind === 'invalid') throw httpError(400, 'invalid', match.reason);
    if (match.kind === 'blacklisted') {
        throw httpError(409, 'blacklisted', `"${match.name}" is blacklisted${match.reason ? `: ${match.reason}` : ''}`);
    }
    // The canonical name of a matched performer becomes a folder name too
    const canonicalErr = performerNameError(match.name);
    if (canonicalErr) throw httpError(400, 'invalid', `The matched performer "${match.name}" has a name that cannot be a folder: ${canonicalErr}`);
    return { lib, match };
}

/**
 * Import files into "before filter performer/<name>".
 * files: [{ path, originalname, rel, size?, buffer? }]; rel is the path inside the source ('set1/001.jpg').
 * opts: { requestedName, source: 'local'|'upload', sourceDir, onStage, resume }.
 * resume: an earlier run of this job moved files already, so the record, the cache and the hashes are finished
 * even when nothing is left to move.
 * Nothing is ever overwritten: same bytes are skipped (the source copy is removed), other same names are renamed.
 * A failed file is reported and the next one goes on.
 */
async function uploadImportPerformer(performerName, basePath, files, progressId, createHashes = false, opts = {}) {
    const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {};
    const setProgress = (processed, total, currentFile) => {
        if (progressId) uploadProgressMap.set(progressId, { status: 'processing', processed, total, currentFile });
    };

    // (a) Checks first: nothing is touched before these pass
    const { lib, match } = checkImport(performerName, basePath);
    const finalName = match.name;
    const requestedName = (opts.requestedName || performerName || '').trim();
    const report = newReport(finalName, requestedName);
    if (match.kind === 'existing') report.matched = { by: match.by, performerId: match.performerId };

    console.log(`[Import] "${requestedName}" as "${finalName}" (${opts.source || 'upload'}): ${files.length} files`);
    setProgress(0, files.length, 'Starting import...');

    // Sort the files: supported by kind, the rest reported and left where they are
    const entries = [];
    for (const file of files) {
        const rel = safeRel(file.rel || file.originalname || (file.path ? path.basename(file.path) : ''));
        const base = safeRel(file.originalname || rel).split('/').pop() || '';
        if (isJunk(base)) continue;
        const kind = kindOf(base);
        if (!kind) {
            note(report, 'unsupported', { from: rel || base, ext: path.extname(base).toLowerCase() });
            continue;
        }
        const ext = path.extname(base);
        const stem = path.basename(base, ext);
        const dir = path.posix.dirname(rel);
        entries.push({ file, rel: rel || base, base, kind, stem, key: `${dir}/${stem}`.toLowerCase() });
    }
    // (b) The performer folder
    const performerPath = path.join(lib.path, 'before filter performer', finalName);
    const picsPath = path.join(performerPath, 'pics');
    const vidsPath = path.join(performerPath, 'vids');
    const funscriptRoot = path.join(vidsPath, 'funscript');
    const existedBefore = await fs.pathExists(performerPath);
    // A resumed job finishes the record only when the earlier run left a performer folder to finish
    const resume = !!opts.resume && existedBefore;

    if (!entries.length && !resume) {
        const err = httpError(400, 'nothing', 'Nothing here can be imported');
        err.report = report;
        throw err;
    }
    await fs.ensureDir(picsPath);
    await fs.ensureDir(vidsPath);
    await fs.ensureDir(funscriptRoot);

    // A video and a .funscript with the same stem in the same folder are a pair
    const groups = new Map();
    for (const e of entries) {
        if (e.kind === 'image') continue;
        if (!groups.has(e.key)) groups.set(e.key, { videos: [], scripts: [] });
        groups.get(e.key)[e.kind === 'video' ? 'videos' : 'scripts'].push(e);
    }

    let processed = 0;
    let placed = 0;
    const tick = (e) => setProgress(processed, entries.length, `Importing: ${e.base}`);

    // One file: placeFile, then the report; a failure is noted and the import goes on
    const place = async (e, dir, base = e.base) => {
        tick(e);
        try {
            let src = e.file.path;
            if (!src && e.file.buffer) {
                // From memory: written beside the target under a name nobody uses, then placed like any file
                src = path.join(dir, `.importing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
                await fs.ensureDir(dir);
                await fs.writeFile(src, e.file.buffer);
            }
            if (!src) throw new Error('No file data');
            const { outcome, target } = await placeFile(src, dir, base);
            const inPerformer = posixRel(performerPath, target);
            if (outcome === 'imported') report.imported++;
            else if (outcome === 'identical') note(report, 'identical', { from: e.rel, same: inPerformer });
            else note(report, 'renamed', { from: e.rel, to: inPerformer });
            placed++;
            return { outcome, target };
        } catch (err) {
            console.warn(`[Import] Could not move ${e.rel}: ${err.message}`);
            note(report, 'failed', { from: e.rel, error: err.message });
            return null;
        } finally {
            processed++;
        }
    };

    // A free folder for a pair: vids/funscript/<stem>, or "<stem> (n)" when that one holds another video, or a
    // script of the pair's name with other bytes (the pair's own script would land beside it, renamed)
    const sameFileName = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    const pairDir = async (video, scripts) => {
        for (let n = 1; n < 10000; n++) {
            const dir = path.join(funscriptRoot, n === 1 ? video.stem : `${video.stem} (${n})`);
            if (!await fs.pathExists(dir)) return dir;
            const inside = await fs.readdir(dir).catch(() => []);
            let clash = false;
            for (const s of scripts) {
                const there = inside.find(f => sameFileName(f, `${video.stem}${path.extname(s.base)}`));
                if (there && !(s.file.path && await sameContent(s.file.path, path.join(dir, there)))) { clash = true; break; }
            }
            if (clash) continue;
            const sameName = inside.find(f => sameFileName(f, video.base));
            if (sameName) {
                if (video.file.path && await sameContent(video.file.path, path.join(dir, sameName))) return dir;
                continue;
            }
            if (!inside.some(f => kindOf(f) === 'video')) return dir;
        }
        return path.join(funscriptRoot, video.stem);
    };

    const done = new Set();
    for (const e of entries) {
        if (done.has(e)) continue;
        if (e.kind === 'image') {
            done.add(e);
            await place(e, picsPath);
            continue;
        }
        const g = groups.get(e.key);
        for (const m of [...g.videos, ...g.scripts]) done.add(m);
        if (g.videos.length && g.scripts.length) {
            // (X2-33) The pair goes to vids/funscript/<stem>/, the funscript keeping the video's final stem
            const dir = await pairDir(g.videos[0], g.scripts);
            let stem = g.videos[0].stem;
            for (const v of g.videos) {
                const r = await place(v, dir);
                if (v === g.videos[0] && r) stem = path.basename(r.target, path.extname(r.target));
            }
            for (const s of g.scripts) await place(s, dir, `${stem}${path.extname(s.base)}`);
        } else {
            for (const v of g.videos) await place(v, vidsPath);
            for (const s of g.scripts) await place(s, path.join(funscriptRoot, s.stem));
        }
    }

    if (!placed && !resume) {
        // Nothing moved: no performer record for an empty folder
        if (!existedBefore) await removeEmptyTree(performerPath);
        const first = report.lists.failed[0];
        const err = httpError(500, 'move-failed', `None of the files could be moved${first ? `: ${first.error}` : ''}`);
        err.report = report;
        throw err;
    }

    // (d) Stats of the whole folder (old and new files)
    const finalStats = await scanPerformerFolder(performerPath);

    // The record in "before filter" (not the "after" row of the same name, which a plain name lookup finds first)
    const existingPerformer = db.prepare('SELECT * FROM performers WHERE name = ? AND moved_to_after = 0').get(finalName);

    // (e) Cover: the existing one while its file is there, else the first picture
    let thumbnail = null;
    if (existingPerformer && existingPerformer.thumbnail && await fs.pathExists(existingPerformer.thumbnail)) {
        thumbnail = existingPerformer.thumbnail;
        report.coverKept = true;
    } else {
        thumbnail = await findThumbnailFromPath(picsPath);
    }

    // (f) The record
    let resultId;
    let isUpdate = false;
    if (existingPerformer) {
        db.prepare(`
            UPDATE performers SET
                thumbnail = ?,
                pics_count = ?, vids_count = ?, funscript_vids_count = ?, funscript_files_count = ?, total_size_gb = ?,
                pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?,
                last_scan_date = ?
            WHERE id = ?
        `).run(
            thumbnail,
            finalStats.pics_count,
            finalStats.vids_count,
            finalStats.funscript_vids_count,
            finalStats.funscript_files_count,
            finalStats.total_size_gb,
            finalStats.pics_count,
            finalStats.vids_count,
            finalStats.funscript_vids_count,
            new Date().toISOString(),
            existingPerformer.id
        );
        resultId = existingPerformer.id;
        isUpdate = true;
    } else {
        const now = new Date().toISOString();
        const result = db.prepare(`
            INSERT INTO performers (
              name, folder_id, thumbnail, pics_count, vids_count,
              funscript_vids_count, funscript_files_count, total_size_gb,
              pics_original_count, vids_original_count, funscript_vids_original_count,
              last_scan_date, cached_pics_path, cached_vids_path, cached_funscript_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            finalName,
            lib.id,
            thumbnail,
            finalStats.pics_count,
            finalStats.vids_count,
            finalStats.funscript_vids_count,
            finalStats.funscript_files_count,
            finalStats.total_size_gb,
            finalStats.pics_count,
            finalStats.vids_count,
            finalStats.funscript_vids_count,
            now,
            picsPath,
            vidsPath,
            funscriptRoot
        );
        resultId = result.lastInsertRowid;
        // Hashes left behind by an earlier performer of this name (deleted files)
        adoptOrphanedHashes(resultId, finalName);
    }
    report.isUpdate = isUpdate;

    // The cached file lists of this performer are stale now (F11-09)
    try {
        db.prepare('DELETE FROM performer_file_cache WHERE performer_id = ?').run(resultId);
    } catch (err) {
        console.warn(`[Import] Could not clear the file cache of ${finalName}: ${err.message}`);
    }

    // (g) Hashes: a failure is reported, the import still completes
    if (createHashes) {
        try {
            // One build at a time, through the server's hash queue: an import waits behind at most the running one
            onStage('waiting for hashing');
            setProgress(0, 100, 'Waiting for the hash queue...');
            await require('./hashQueue').enqueueAndWait({
                performerId: resultId, mode: 'append', origin: 'import',
                onStart: () => { onStage('hashing'); setProgress(0, 100, 'Generating hashes...'); },
                onProgress: (done, total) => setProgress(done, total, `Generating hashes (${done}/${total})`)
            });
            report.hashing = 'done';

            onStage('checking duplicates');
            setProgress(0, 100, 'Checking for duplicates...');
            try {
                const { checkInternalDuplicates } = require('./hashService');
                const dupResult = await checkInternalDuplicates(resultId);
                console.log(`[Import] Internal duplicate check: ${dupResult.duplicateCount} duplicates found`);
            } catch (dupErr) {
                console.error('[Import] Internal duplicate check failed:', dupErr.message);
            }
        } catch (hashErr) {
            console.error('[Import] Hash creation failed:', hashErr.message);
            report.hashing = 'failed';
            report.hashError = hashErr.message || String(hashErr);
        }
    }

    if (progressId) {
        uploadProgressMap.set(progressId, { status: 'completed', processed: entries.length, total: entries.length, currentFile: 'Done' });
    }

    console.log(`[Import] Done "${finalName}": ${report.imported} imported, ${report.identical} identical, ${report.renamed} renamed, ${report.unsupported} unsupported, ${report.failed} failed`);

    return {
        id: resultId,
        name: finalName,
        ...finalStats,
        thumbnail,
        isUpdate,
        report
    };
}

/**
 * Local import: a folder in "before upload" is moved into the library (not copied).
 * Hidden entries are not imported and stay. The folder is removed when only junk and empty folders are left.
 */
async function localImportPerformer(folderName, performerName, basePath, progressId, createHashes = false, opts = {}) {
    const lib = requireLibrary(basePath);
    const problem = await checkFolder(lib.path, folderName);
    if (problem) throw httpError(problem.code === 'missing' ? 404 : 400, problem.code, problem.error);
    checkImport(performerName, lib.path);

    const sourceDir = path.join(lib.path, 'before upload', folderName);
    const leftIn = `before upload/${folderName}`;

    // Every file, recursively, with its path inside the folder; hidden entries stay
    const fileInfos = [];
    async function collectFiles(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await collectFiles(fullPath);
            } else if (entry.isFile() && !isJunk(entry.name)) {
                fileInfos.push({ path: fullPath, originalname: entry.name, rel: posixRel(sourceDir, fullPath) });
            }
        }
    }
    await collectFiles(sourceDir);

    // Already empty (an earlier import moved the files): remove the shell when it is only junk, nothing else to do
    // (A retried job whose earlier run moved everything goes on below, to finish the record.)
    if (fileInfos.length === 0 && !opts.resume) {
        console.log(`[LocalImport] "${sourceDir}" is already empty`);
        const kept = await cleanupSource(sourceDir);
        const report = newReport(performerName, performerName);
        report.leftIn = kept ? leftIn : null;
        return { name: performerName, alreadyEmpty: true, report };
    }

    let result;
    try {
        result = await uploadImportPerformer(performerName, lib.path, fileInfos, progressId, createHashes, {
            ...opts,
            requestedName: opts.requestedName || performerName,
            source: 'local',
            sourceDir
        });
    } catch (err) {
        // Whatever was moved stays moved; the folder goes only when nothing but junk is left
        const kept = await cleanupSource(sourceDir);
        if (fileInfos.length === 0 && err.code === 'nothing') {
            // A retry of an empty folder with no performer folder to finish: nothing to do, as on a first run
            const report = newReport(performerName, performerName);
            report.leftIn = kept ? leftIn : null;
            return { name: performerName, alreadyEmpty: true, report };
        }
        if (err.report) err.report.leftIn = kept ? leftIn : null;
        throw err;
    }
    const kept = await cleanupSource(sourceDir);
    result.report.leftIn = kept ? leftIn : null;
    return result;
}

/**
 * Remove the source folder when nothing but junk (.DS_Store, Thumbs.db, desktop.ini, ._*) and empty folders is left.
 * Hidden files and folders count as content. Returns true when the folder is still there.
 */
async function cleanupSource(dir) {
    try {
        if (!await fs.pathExists(dir)) return false;
        let content = 0;
        async function walk(d) {
            const entries = await fs.readdir(d, { withFileTypes: true });
            for (const entry of entries) {
                if (content) return;
                if (isJunk(entry.name)) continue;
                if (entry.name.startsWith('.')) { content++; return; }
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) await walk(full);
                else content++;
            }
        }
        await walk(dir);
        if (content) {
            console.log(`[LocalImport] Files stay in ${dir}`);
            return true;
        }
        await fs.remove(dir);
        console.log(`[LocalImport] Removed the emptied source folder ${dir}`);
        return false;
    } catch (err) {
        console.warn(`[LocalImport] Cleanup check failed for ${dir}: ${err.message}`);
        return fs.pathExists(dir).catch(() => true);
    }
}

// Remove a folder tree that holds no files at all (the performer folder of an import that moved nothing)
async function removeEmptyTree(dir) {
    try {
        let files = 0;
        async function walk(d) {
            for (const entry of await fs.readdir(d, { withFileTypes: true })) {
                if (entry.isDirectory()) await walk(path.join(d, entry.name));
                else files++;
            }
        }
        await walk(dir);
        if (!files) await fs.remove(dir);
    } catch (err) {
        // Left as it is
    }
}

async function findThumbnailFromPath(picsPath) {
    try {
        if (!await fs.pathExists(picsPath)) return null;
        const pics = (await fs.readdir(picsPath)).sort();
        const imageFile = pics.find(file => !file.startsWith('.') && SUPPORTED.images.includes(path.extname(file).toLowerCase()));
        return imageFile ? path.join(picsPath, imageFile) : null;
    } catch (error) {
        return null;
    }
}

module.exports = {
    uploadImportPerformer,
    localImportPerformer,
    uploadProgressMap
};
