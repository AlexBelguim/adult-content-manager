const express = require('express');
const router = express.Router();
const { addToQueue, getQueueStatus, removeJob, clearCompleted } = require('../services/uploadQueue');

/**
 * Get queue status
 * GET /api/upload-queue
 */
router.get('/', (req, res) => {
    const status = getQueueStatus();
    res.json(status);
});

/**
 * Add job to queue (called when all batches have been uploaded)
 * POST /api/upload-queue
 */
router.post('/', (req, res) => {
    const { performerName, basePath, uploadId, totalFiles, createHashes } = req.body;

    if (!performerName || !basePath || !uploadId) {
        return res.status(400).json({ error: 'performerName, basePath, and uploadId are required' });
    }

    const jobId = addToQueue({
        performerName,
        basePath,
        uploadId,
        totalFiles: totalFiles || 0,
        createHashes: !!createHashes
    });

    res.json({ success: true, jobId });
});

/**
 * Remove job from queue
 * DELETE /api/upload-queue/:id
 */
router.delete('/:id', (req, res) => {
    const result = removeJob(req.params.id);
    if (result.success) {
        res.json(result);
    } else {
        res.status(400).json(result);
    }
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
