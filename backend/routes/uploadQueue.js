const express = require('express');
const router = express.Router();
const { addToQueue, getQueueStatus, retryJob, removeJob, clearCompleted } = require('../services/uploadQueue');

/**
 * Get queue status
 * GET /api/upload-queue
 */
router.get('/', (req, res) => {
    const status = getQueueStatus();
    res.json(status);
});

/**
 * Hand an upload over to the queue (after every batch is on the server)
 * POST /api/upload-queue  { uploadId, performerName, totalFiles, totalBatches, createHashes, sourceLabel?, basePath? }
 */
router.post('/', async (req, res) => {
    try {
        const result = await addToQueue(req.body || {});
        if (result.existing) return res.json({ success: true, jobId: result.jobId, existing: true });
        res.json({ success: true, jobId: result.jobId, files: result.files });
    } catch (err) {
        if (!err.status) console.error('[UploadQueue] Hand-over failed:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code, missing: err.missing, have: err.have, want: err.want });
    }
});

/**
 * Run a failed job again
 * POST /api/upload-queue/:id/retry
 */
router.post('/:id/retry', async (req, res) => {
    try {
        const result = await retryJob(req.params.id);
        if (result.success) return res.json({ success: true, jobId: result.jobId });
        res.status(result.status || 400).json({ error: result.error, code: result.code });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Remove job from queue
 * DELETE /api/upload-queue/:id
 */
router.delete('/:id', (req, res) => {
    const result = removeJob(req.params.id);
    if (result.success) return res.json(result);
    res.status(result.status || 400).json({ error: result.error, code: result.code });
});

/**
 * Clear completed/error jobs
 * POST /api/upload-queue/clear-completed
 */
router.post('/clear-completed', (req, res) => {
    const result = clearCompleted();
    res.json(result);
});

module.exports = router;
