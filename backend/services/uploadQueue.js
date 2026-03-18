const fs = require('fs-extra');
const path = require('path');
const { uploadImportPerformer, localImportPerformer, uploadProgressMap } = require('./uploadImporter');

/**
 * Upload Queue Service
 * Manages a queue of upload jobs that process one at a time
 */

// Queue storage
const uploadQueue = [];
let isProcessing = false;
let currentJob = null;

/**
 * Add a job to the queue
 * @param {Object} job - Job details
 * @returns {string} - Job ID
 */
function addToQueue(job) {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const queuedJob = {
        id: jobId,
        performerName: job.performerName,
        basePath: job.basePath,
        uploadId: job.uploadId,
        totalFiles: job.totalFiles,
        createHashes: job.createHashes || false,
        isLocalImport: false,
        status: 'queued',
        progress: 0,
        currentFile: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null
    };

    uploadQueue.push(queuedJob);
    console.log(`[UploadQueue] Job ${jobId} added for "${job.performerName}" (${job.totalFiles} files)`);

    // Start processing if not already running
    processNext();

    return jobId;
}

/**
 * Add a local import job to the queue (files already on disk in "before upload" folder)
 * @param {Object} job - Job details
 * @returns {string} - Job ID
 */
function addLocalImportToQueue(job) {
    const jobId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const queuedJob = {
        id: jobId,
        performerName: job.performerName,
        basePath: job.basePath,
        uploadId: jobId,
        totalFiles: job.totalFiles,
        createHashes: job.createHashes || false,
        isLocalImport: true,
        status: 'queued',
        progress: 0,
        currentFile: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null
    };

    uploadQueue.push(queuedJob);
    console.log(`[UploadQueue] Local import job ${jobId} added for "${job.performerName}" (${job.totalFiles} files)`);

    processNext();

    return jobId;
}

/**
 * Process the next job in the queue
 */
async function processNext() {
    if (isProcessing || uploadQueue.length === 0) {
        return;
    }

    // Find next queued job
    const nextJob = uploadQueue.find(j => j.status === 'queued');
    if (!nextJob) {
        return;
    }

    isProcessing = true;
    currentJob = nextJob;
    nextJob.status = 'processing';
    nextJob.startedAt = new Date().toISOString();

    console.log(`[UploadQueue] Starting processing job ${nextJob.id} for "${nextJob.performerName}" (local: ${nextJob.isLocalImport})`);

    try {
        if (nextJob.isLocalImport) {
            // Local import — files are already in "before upload" folder
            const result = await localImportPerformer(
                nextJob.performerName,
                nextJob.basePath,
                nextJob.uploadId,
                nextJob.createHashes
            );
            nextJob.result = result;
        } else {
            // Regular upload — files are in temp directory
            const tempDir = path.join(nextJob.basePath, '.temp-uploads');
            const allTempFiles = await fs.readdir(tempDir);

            const tempFileInfos = allTempFiles.map(filename => ({
                path: path.join(tempDir, filename),
                originalname: filename.replace(/^\d+-[a-z0-9]+-/, '')
            }));

            console.log(`[UploadQueue] Found ${tempFileInfos.length} files in temp for job ${nextJob.id}`);

            if (tempFileInfos.length === 0) {
                throw new Error(`No files found in temp folder: ${tempDir}. Check storage permissions or path.`);
            }

            const result = await uploadImportPerformer(
                nextJob.performerName,
                nextJob.basePath,
                tempFileInfos,
                nextJob.uploadId,
                nextJob.createHashes
            );

            // Clean up temp directory
            try {
                await fs.emptyDir(tempDir);
                console.log(`[UploadQueue] Cleaned up temp directory for job ${nextJob.id}`);
            } catch (cleanErr) {
                console.error(`[UploadQueue] Failed to clean temp dir for job ${nextJob.id}:`, cleanErr.message);
            }

            nextJob.result = result;
        }

        nextJob.status = 'completed';
        nextJob.completedAt = new Date().toISOString();
        nextJob.progress = 100;

        console.log(`[UploadQueue] Job ${nextJob.id} completed successfully`);

    } catch (err) {
        console.error(`[UploadQueue] Job ${nextJob.id} failed:`, err.message);
        nextJob.status = 'error';
        nextJob.error = err.message;
        nextJob.completedAt = new Date().toISOString();
    }

    isProcessing = false;
    currentJob = null;

    // Process next job if any
    processNext();
}

/**
 * Get queue status
 */
function getQueueStatus() {
    // Update progress from uploadProgressMap for current job
    if (currentJob && uploadProgressMap.has(currentJob.uploadId)) {
        const progress = uploadProgressMap.get(currentJob.uploadId);
        currentJob.progress = progress.total > 0
            ? Math.round((progress.processed / progress.total) * 100)
            : 0;
        currentJob.currentFile = progress.currentFile;
    }

    return {
        queue: uploadQueue.map(job => ({
            id: job.id,
            performerName: job.performerName,
            totalFiles: job.totalFiles,
            status: job.status,
            progress: job.progress,
            currentFile: job.currentFile,
            isLocalImport: job.isLocalImport,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            error: job.error
        })),
        isProcessing,
        queueLength: uploadQueue.filter(j => j.status === 'queued').length
    };
}

/**
 * Remove a job from the queue (only if queued or completed/error)
 */
function removeJob(jobId) {
    const index = uploadQueue.findIndex(j => j.id === jobId);
    if (index === -1) {
        return { success: false, error: 'Job not found' };
    }

    const job = uploadQueue[index];
    if (job.status === 'processing') {
        return { success: false, error: 'Cannot remove job while processing' };
    }

    uploadQueue.splice(index, 1);
    return { success: true };
}

/**
 * Clear completed/error jobs
 */
function clearCompleted() {
    const before = uploadQueue.length;
    for (let i = uploadQueue.length - 1; i >= 0; i--) {
        if (uploadQueue[i].status === 'completed' || uploadQueue[i].status === 'error') {
            uploadQueue.splice(i, 1);
        }
    }
    return { cleared: before - uploadQueue.length };
}

module.exports = {
    addToQueue,
    addLocalImportToQueue,
    getQueueStatus,
    removeJob,
    clearCompleted
};

