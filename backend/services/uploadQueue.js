const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { uploadImportPerformer, localImportPerformer, uploadProgressMap } = require('./uploadImporter');
const {
    UPLOAD_ID, requireLibrary, httpError, checkFolder, performerNameError, resolveImportName,
    uploadTempDir, tempRoot, readManifests
} = require('./importGuard');

/**
 * Upload Queue Service
 * One import at a time, in order: server-folder imports ('local') and browser uploads ('upload').
 * An upload job reads only its own temp folder (<lib>/.temp-uploads/<uploadId>/) and removes it after success.
 */

const uploadQueue = [];
let isProcessing = false;
let currentJob = null;

const ACTIVE = new Set(['queued', 'processing']);
const SWEEP_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Written into an upload's temp folder at hand-over, so a server restart can bring the job back (as failed, with Retry)
const JOB_FILE = 'job.json';

async function writeJobFile(job, extra = {}) {
    if (job.kind !== 'upload' || !job.tempDir) return;
    const data = {
        id: job.id, performerName: job.performerName, requestedName: job.requestedName, uploadId: job.uploadId,
        sourceLabel: job.sourceLabel, totalFiles: job.totalFiles, createHashes: job.createHashes,
        createdAt: job.createdAt, at: new Date().toISOString(), ...extra
    };
    const file = path.join(job.tempDir, JOB_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        await fs.writeFile(tmp, JSON.stringify(data));
        await fs.move(tmp, file, { overwrite: true });
    } catch (err) {
        console.error(`[UploadQueue] Could not write ${file}:`, err.message);
        fs.remove(tmp).catch(() => {});
    }
}

const samePath = (a, b) => {
    const n = (p) => {
        const r = path.resolve(String(p || '')).replace(/[\\/]+$/, '');
        return process.platform === 'win32' ? r.toLowerCase() : r;
    };
    return n(a) === n(b);
};
const sameFolderName = (a, b) => (process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);

const toInt = (v) => {
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
    return null;
};

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

function baseJob(fields) {
    return {
        id: null,
        kind: 'local',
        isLocalImport: true,
        performerName: null,
        performerId: null,
        requestedName: null,
        folderName: null,
        uploadId: null,
        sourceLabel: null,
        basePath: null,
        tempDir: null,
        totalFiles: 0,
        createHashes: false,
        status: 'queued',
        stage: null,
        progress: 0,
        currentFile: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null,
        report: null,
        result: null,
        ...fields
    };
}

/** The queued or processing job of a server folder: { id, status } | null. */
function activeJobFor({ libPath, folderName }) {
    const j = uploadQueue.find(x => x.kind === 'local' && ACTIVE.has(x.status)
        && samePath(x.basePath, libPath) && sameFolderName(x.folderName, folderName));
    return j ? { id: j.id, status: j.status } : null;
}

/** The queued or processing job of an upload: { id, status } | null. */
function jobForUpload(uploadId) {
    const j = uploadQueue.find(x => x.kind === 'upload' && x.uploadId === uploadId && ACTIVE.has(x.status));
    return j ? { id: j.id, status: j.status } : null;
}

/** The newest job of an upload, whatever its status: { id, status } | null. */
function anyJobForUpload(uploadId) {
    for (let i = uploadQueue.length - 1; i >= 0; i--) {
        const x = uploadQueue[i];
        if (x.kind === 'upload' && x.uploadId === uploadId) return { id: x.id, status: x.status };
    }
    return null;
}

/**
 * Hand an uploaded set over to the queue, after every batch is on the server.
 * Returns { jobId, files } or { jobId, existing: true }; throws an Error with .status and .code.
 */
async function addToQueue(job = {}) {
    const { uploadId, performerName, totalFiles, totalBatches, createHashes, sourceLabel, basePath } = job;
    if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) throw httpError(400, 'bad-id', 'This upload id is not valid');
    const lib = requireLibrary(basePath);
    const nBatches = toInt(totalBatches);
    const nFiles = toInt(totalFiles);
    if (nBatches === null || nBatches < 1 || nBatches > 100000) throw httpError(400, 'bad-request', 'totalBatches must be a whole number from 1 to 100000');
    if (nFiles === null) throw httpError(400, 'bad-request', 'totalFiles must be a whole number');

    // One job per upload: a second hand-over gets the first job back
    const existing = uploadQueue.find(x => x.kind === 'upload' && x.uploadId === uploadId && samePath(x.basePath, lib.path));
    if (existing) return { jobId: existing.id, existing: true };

    const tempDir = uploadTempDir(lib.path, uploadId);
    const allIndices = () => Array.from({ length: nBatches }, (_, i) => i);
    if (!await fs.pathExists(tempDir)) {
        throw httpError(409, 'missing-batches', 'The server has no files for this upload', { missing: allIndices() });
    }
    const manifests = await readManifests(tempDir);
    const missing = allIndices().filter(i => !manifests.has(i));
    if (missing.length) {
        throw httpError(409, 'missing-batches', `The server is missing batches ${missing.slice(0, 20).map(i => i + 1).join(', ')}${missing.length > 20 ? '…' : ''}`, { missing });
    }
    let have = 0;
    for (let i = 0; i < nBatches; i++) have += manifests.get(i).files.length;
    if (have !== nFiles) {
        throw httpError(409, 'count-mismatch', `The server has ${have} files of this upload, not ${nFiles}`, { have, want: nFiles });
    }

    const nameErr = performerNameError(performerName);
    if (nameErr) throw httpError(400, 'invalid', nameErr);
    const match = resolveImportName(performerName);
    if (match.kind === 'invalid') throw httpError(400, 'invalid', match.reason);
    if (match.kind === 'blacklisted') throw httpError(409, 'blacklisted', `"${match.name}" is blacklisted${match.reason ? `: ${match.reason}` : ''}`);

    const queuedJob = baseJob({
        id: newId('job'),
        kind: 'upload',
        isLocalImport: false,
        performerName: match.name,
        requestedName: match.input,
        uploadId,
        sourceLabel: typeof sourceLabel === 'string' && sourceLabel.trim() ? sourceLabel.trim().slice(0, 200) : null,
        basePath: lib.path,
        tempDir,
        totalFiles: nFiles,
        createHashes: !!createHashes
    });
    uploadQueue.push(queuedJob);
    console.log(`[UploadQueue] Job ${queuedJob.id} added for "${queuedJob.performerName}" (${nFiles} files, upload ${uploadId})`);
    await writeJobFile(queuedJob);
    processNext();
    return { jobId: queuedJob.id, files: nFiles };
}

/**
 * Queue a folder of "before upload". Returns { jobId, performerName }; throws an Error with .code:
 * 'invalid' (folder or performer name), 'blacklisted', 'queued' (it already has a job), 'missing'.
 */
async function addLocalImportToQueue(job = {}) {
    const { folderName, performerName, basePath, totalFiles, createHashes } = job;
    const lib = requireLibrary(basePath);

    const folderProblem = await checkFolder(lib.path, folderName);
    if (folderProblem && folderProblem.code === 'invalid') throw httpError(400, 'invalid', folderProblem.error);

    const nameErr = performerNameError(performerName);
    if (nameErr) throw httpError(400, 'invalid', nameErr);
    const match = resolveImportName(performerName);
    if (match.kind === 'invalid') throw httpError(400, 'invalid', match.reason);
    if (match.kind === 'blacklisted') throw httpError(409, 'blacklisted', `"${match.name}" is blacklisted${match.reason ? `: ${match.reason}` : ''}`);

    if (activeJobFor({ libPath: lib.path, folderName })) throw httpError(409, 'queued', `"${folderName}" is already queued for import`);
    if (folderProblem) throw httpError(404, 'missing', folderProblem.error);

    const queuedJob = baseJob({
        id: newId('local'),
        kind: 'local',
        isLocalImport: true,
        performerName: match.name,
        requestedName: match.input,
        folderName,
        basePath: lib.path,
        totalFiles: toInt(totalFiles) || 0,
        createHashes: !!createHashes
    });
    uploadQueue.push(queuedJob);
    console.log(`[UploadQueue] Local import job ${queuedJob.id} added for "${queuedJob.performerName}" (folder "${folderName}")`);
    processNext();
    return { jobId: queuedJob.id, performerName: match.name };
}

/**
 * The files of an upload, from its manifests in batch order: { files, gone }.
 * On a resumed run (skipGone), an entry whose temp file is no longer there was moved by the earlier run (before a
 * restart or an error): it is left out and counted in gone. On a first run it is kept, so it is reported as failed.
 */
async function uploadFiles(job, { skipGone = false } = {}) {
    const manifests = await readManifests(job.tempDir);
    const indices = [...manifests.keys()].sort((a, b) => a - b);
    const files = [];
    let gone = 0;
    for (const i of indices) {
        for (const f of manifests.get(i).files) {
            if (!f || typeof f.temp !== 'string' || f.temp.includes('/') || f.temp.includes('\\') || f.temp.startsWith('.')) continue;
            const rel = typeof f.rel === 'string' && f.rel ? f.rel : f.temp;
            const full = path.join(job.tempDir, f.temp);
            if (skipGone && !await fs.pathExists(full)) { gone++; continue; }
            files.push({ path: full, originalname: path.posix.basename(rel), rel, size: f.size });
        }
    }
    return { files, gone };
}

/**
 * After an upload's import: remove its temp folder, unless some files could not be moved. Those are only there,
 * so the folder stays, marked by its job.json (the sweep and a restart keep it). Returns the folder kept, or null.
 */
async function cleanUploadTemp(job, report) {
    const failed = report && report.failed ? report.failed : 0;
    if (!failed) {
        await fs.remove(job.tempDir);
        console.log(`[UploadQueue] Removed the temp folder of job ${job.id}`);
        return null;
    }
    await writeJobFile(job, { leftOver: failed });
    console.warn(`[UploadQueue] ${failed} files of job ${job.id} could not be moved; they stay in ${job.tempDir}`);
    return `.temp-uploads/${job.uploadId}`;
}

/**
 * Process the next job in the queue
 */
async function processNext() {
    if (isProcessing || uploadQueue.length === 0) return;

    const nextJob = uploadQueue.find(j => j.status === 'queued');
    if (!nextJob) return;

    isProcessing = true;
    currentJob = nextJob;
    nextJob.status = 'processing';
    nextJob.stage = 'moving files';
    nextJob.startedAt = new Date().toISOString();

    const queuedCount = uploadQueue.filter(j => j.status === 'queued').length;
    console.log(`[UploadQueue] Starting job ${nextJob.id} for "${nextJob.performerName}" (${nextJob.kind}). ${queuedCount} still queued after this.`);

    nextJob.runs = (nextJob.runs || 0) + 1;
    const opts = {
        requestedName: nextJob.requestedName || nextJob.performerName,
        source: nextJob.kind,
        // A retried job may find its files moved already by the run that failed
        resume: nextJob.runs > 1,
        onStage: (stage) => { if (currentJob === nextJob) nextJob.stage = stage; }
    };

    try {
        let result;
        if (nextJob.kind === 'local') {
            result = await localImportPerformer(
                nextJob.folderName,
                nextJob.requestedName || nextJob.performerName,
                nextJob.basePath,
                nextJob.id,
                nextJob.createHashes,
                opts
            );
        } else {
            if (!await fs.pathExists(nextJob.tempDir)) throw httpError(409, 'temp-gone', 'The uploaded files are no longer on the server');
            const { files, gone } = await uploadFiles(nextJob, { skipGone: opts.resume });
            console.log(`[UploadQueue] ${files.length} files in ${nextJob.tempDir} for job ${nextJob.id}${gone ? ` (${gone} moved by an earlier run)` : ''}`);
            if (!files.length && !gone) throw new Error('No files in the temp folder of this upload');
            result = await uploadImportPerformer(
                nextJob.requestedName || nextJob.performerName,
                nextJob.basePath,
                files,
                nextJob.id,
                nextJob.createHashes,
                // An earlier run moved files already: finish the record even when nothing is left to move
                { ...opts, sourceDir: nextJob.tempDir, resume: opts.resume || gone > 0 }
            );
            // Its own folder only, and only after success; files that could not be moved stay in it
            let leftIn = null;
            try {
                leftIn = await cleanUploadTemp(nextJob, result.report);
            } catch (cleanErr) {
                console.error(`[UploadQueue] Could not remove the temp folder of job ${nextJob.id}:`, cleanErr.message);
            }
            if (leftIn && result.report) {
                // Those files exist only in the temp folder: the job ends failed, so Retry (which moves only what is
                // left) and Cancel (which deletes them) are offered, and nothing is lost unseen
                result.report.leftIn = leftIn;
                if (result.name) nextJob.performerName = result.name;
                nextJob.performerId = result.id ?? null;
                const n = result.report.failed;
                const err = httpError(500, 'some-failed', `${n === 1 ? '1 file' : `${n} files`} could not be moved; ${n === 1 ? 'it is' : 'they are'} kept on the server`);
                err.report = result.report;
                throw err;
            }
        }

        nextJob.result = result;
        nextJob.report = result.report || null;
        if (result.name) nextJob.performerName = result.name;
        nextJob.performerId = result.id ?? null;
        nextJob.status = 'completed';
        nextJob.completedAt = new Date().toISOString();
        nextJob.progress = 100;
        console.log(`[UploadQueue] Job ${nextJob.id} completed`);
    } catch (err) {
        console.error(`[UploadQueue] Job ${nextJob.id} failed:`, err.message);
        nextJob.status = 'error';
        nextJob.error = err.message || String(err);
        nextJob.report = err.report || null;
        nextJob.completedAt = new Date().toISOString();
        if (nextJob.kind === 'upload' && await fs.pathExists(nextJob.tempDir).catch(() => false)) {
            await writeJobFile(nextJob, { error: nextJob.error });
        }
    } finally {
        nextJob.stage = null;
        nextJob.currentFile = null;
        uploadProgressMap.delete(nextJob.id);
        isProcessing = false;
        currentJob = null;
        // setImmediate detaches from this call stack so an error here can't poison the chain
        setImmediate(() => {
            try {
                processNext();
            } catch (e) {
                console.error('[UploadQueue] Failed to schedule next job:', e);
            }
        });
    }
}

/**
 * Get queue status
 */
function getQueueStatus() {
    if (currentJob && uploadProgressMap.has(currentJob.id)) {
        const progress = uploadProgressMap.get(currentJob.id);
        currentJob.progress = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
        currentJob.currentFile = progress.currentFile;
    }

    return {
        queue: uploadQueue.map(job => ({
            id: job.id,
            kind: job.kind,
            isLocalImport: job.isLocalImport,
            performerName: job.performerName,
            performerId: job.performerId ?? null,
            requestedName: job.requestedName,
            folderName: job.folderName,
            uploadId: job.uploadId,
            sourceLabel: job.sourceLabel,
            basePath: job.basePath,
            totalFiles: job.totalFiles,
            createHashes: job.createHashes,
            status: job.status,
            stage: job.stage,
            progress: job.progress,
            currentFile: job.currentFile,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            error: job.error,
            report: job.report
        })),
        isProcessing,
        queueLength: uploadQueue.filter(j => j.status === 'queued').length
    };
}

/**
 * Run a failed job again. Returns { success, jobId } or { success: false, status, code, error }.
 */
async function retryJob(jobId) {
    const job = uploadQueue.find(j => j.id === jobId);
    if (!job) return { success: false, status: 404, code: 'not-found', error: 'This import is no longer in the queue' };
    if (job.status !== 'error') return { success: false, status: 409, code: 'not-failed', error: 'Only a failed import can be run again' };

    if (job.kind === 'upload') {
        if (!job.tempDir || !await fs.pathExists(job.tempDir)) {
            return { success: false, status: 409, code: 'temp-gone', error: 'The uploaded files are no longer on the server' };
        }
    } else {
        const problem = await checkFolder(job.basePath, job.folderName);
        if (problem) return { success: false, status: 409, code: 'missing', error: problem.error };
        if (activeJobFor({ libPath: job.basePath, folderName: job.folderName })) {
            return { success: false, status: 409, code: 'queued', error: `"${job.folderName}" is already queued for import` };
        }
    }
    if (job.status !== 'error') return { success: false, status: 409, code: 'not-failed', error: 'Only a failed import can be run again' };

    Object.assign(job, {
        status: 'queued', progress: 0, currentFile: null, error: null, report: null, result: null,
        stage: null, startedAt: null, completedAt: null, performerId: null
    });
    // To the end of the queue, behind the jobs that were waiting
    const index = uploadQueue.indexOf(job);
    if (index >= 0) uploadQueue.splice(index, 1);
    uploadQueue.push(job);
    console.log(`[UploadQueue] Job ${job.id} queued again`);
    processNext();
    return { success: true, jobId: job.id };
}

/**
 * Remove a job from the queue (not while processing). An upload job's temp folder goes with it.
 */
function removeJob(jobId) {
    const index = uploadQueue.findIndex(j => j.id === jobId);
    if (index === -1) {
        return { success: false, status: 404, code: 'not-found', error: 'This import is no longer in the queue' };
    }

    const job = uploadQueue[index];
    if (job.status === 'processing') {
        return { success: false, status: 400, code: 'processing', error: 'Cannot remove job while processing' };
    }

    uploadQueue.splice(index, 1);
    if (job.kind === 'upload' && job.tempDir) {
        const dir = job.tempDir;
        fs.remove(dir)
            .then(() => console.log(`[UploadQueue] Removed the temp folder of job ${job.id}`))
            .catch(err => console.error(`[UploadQueue] Could not remove the temp folder of job ${job.id}:`, err.message));
    }
    return { success: true };
}

/**
 * Clear completed jobs only. Errored jobs stay so they remain visible
 * for inspection / retry; remove individually via DELETE if needed.
 */
function clearCompleted() {
    const before = uploadQueue.length;
    for (let i = uploadQueue.length - 1; i >= 0; i--) {
        if (uploadQueue[i].status === 'completed') {
            uploadQueue.splice(i, 1);
        }
    }
    const cleared = before - uploadQueue.length;
    console.log(`[UploadQueue] Cleared ${cleared} completed job(s). ${uploadQueue.length} remain.`);
    return { cleared };
}

// The newest modification time in a tree (the folder itself included)
async function newestMtime(dir) {
    let newest = 0;
    async function walk(p) {
        let st;
        try { st = await fs.lstat(p); } catch (e) { return; }
        newest = Math.max(newest, st.mtimeMs);
        if (!st.isDirectory()) return;
        let names = [];
        try { names = await fs.readdir(p); } catch (e) { return; }
        for (const name of names) await walk(path.join(p, name));
    }
    await walk(dir);
    return newest;
}

/**
 * Start-up: an upload temp folder with a job.json was handed over before the server stopped. It comes back as a
 * failed job, so Jobs shows it with Retry and Remove. Returns { restored }.
 */
async function restoreUploadJobs() {
    const rows = db.prepare('SELECT path FROM folders').all();
    let restored = 0;
    for (const row of rows) {
        const root = tempRoot(row.path);
        let entries;
        try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (e) { continue; }
        for (const entry of entries) {
            if (!entry.isDirectory() || !UPLOAD_ID.test(entry.name)) continue;
            if (uploadQueue.some(j => j.uploadId === entry.name)) continue;
            const tempDir = path.join(root, entry.name);
            let data;
            try { data = JSON.parse(await fs.readFile(path.join(tempDir, JOB_FILE), 'utf8')); } catch (e) { continue; }
            if (!data || typeof data !== 'object') continue;
            const performerName = typeof data.performerName === 'string' && !performerNameError(data.performerName) ? data.performerName : null;
            if (!performerName) continue;
            const id = typeof data.id === 'string' && /^job-[A-Za-z0-9-]{1,80}$/.test(data.id) && !uploadQueue.some(j => j.id === data.id)
                ? data.id : newId('job');
            const left = toInt(data.leftOver);
            const error = left
                ? `${left} files could not be moved; they are kept on the server in .temp-uploads/${entry.name}`
                : (typeof data.error === 'string' && data.error ? data.error : 'The server restarted during this import');
            uploadQueue.push(baseJob({
                id,
                kind: 'upload',
                isLocalImport: false,
                performerName,
                requestedName: typeof data.requestedName === 'string' && data.requestedName ? data.requestedName : performerName,
                uploadId: entry.name,
                sourceLabel: typeof data.sourceLabel === 'string' ? data.sourceLabel : null,
                basePath: row.path,
                tempDir,
                totalFiles: toInt(data.totalFiles) || 0,
                createHashes: !!data.createHashes,
                createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
                // It ran before the restart, so its next run resumes (files already moved are skipped)
                runs: 1,
                status: 'error',
                error,
                completedAt: new Date().toISOString()
            }));
            restored++;
            console.log(`[UploadQueue] Brought back the import of upload ${entry.name} ("${performerName}") as failed: ${error}`);
        }
    }
    return { restored };
}

/**
 * Start-up sweep: upload temp folders (<lib>/.temp-uploads/<uploadId>/) untouched for 7 days and without a job
 * are removed. Loose files in .temp-uploads (the old scheme) are left alone. Handed-over uploads (a job.json)
 * are brought back as jobs first and are never swept.
 */
async function sweepTempUploads() {
    await restoreUploadJobs();
    const rows = db.prepare('SELECT path FROM folders').all();
    let removed = 0;
    for (const row of rows) {
        const root = tempRoot(row.path);
        let entries;
        try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (e) { continue; }
        for (const entry of entries) {
            if (!entry.isDirectory() || !UPLOAD_ID.test(entry.name)) continue;
            if (uploadQueue.some(j => j.uploadId === entry.name)) continue;
            const dir = path.join(root, entry.name);
            if (await fs.pathExists(path.join(dir, JOB_FILE))) continue;
            const newest = await newestMtime(dir);
            if (!newest || Date.now() - newest < SWEEP_AGE_MS) continue;
            try {
                await fs.remove(dir);
                removed++;
                console.log(`[UploadQueue] Removed the abandoned upload ${dir} (untouched since ${new Date(newest).toISOString()})`);
            } catch (err) {
                console.error(`[UploadQueue] Could not remove the abandoned upload ${dir}:`, err.message);
            }
        }
    }
    return { removed };
}

module.exports = {
    addToQueue,
    addLocalImportToQueue,
    getQueueStatus,
    retryJob,
    removeJob,
    clearCompleted,
    activeJobFor,
    jobForUpload,
    anyJobForUpload,
    restoreUploadJobs,
    sweepTempUploads
};
