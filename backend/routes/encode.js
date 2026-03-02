/**
 * Encode Routes - API endpoints for media optimization
 */

const express = require('express');
const router = express.Router();
const encodeService = require('../services/encodeService');

/**
 * GET /api/encode/status
 * Get system status (FFmpeg availability, etc.)
 */
router.get('/status', (req, res) => {
    res.json({
        ffmpegAvailable: encodeService.ffmpegAvailable,
        ffprobeAvailable: encodeService.ffprobeAvailable,
        settings: encodeService.getSettings()
    });
});

/**
 * GET /api/encode/settings
 * Get encode settings
 */
router.get('/settings', (req, res) => {
    try {
        const settings = encodeService.getSettings();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/encode/settings
 * Update encode settings
 */
router.put('/settings', (req, res) => {
    try {
        const settings = encodeService.updateSettings(req.body);
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/encode/estimate/:performerId
 * Estimate space savings for a performer
 */
router.get('/estimate/:performerId', async (req, res) => {
    try {
        const { performerId } = req.params;
        const estimate = await encodeService.estimatePerformerSavings(parseInt(performerId, 10));

        // Format for display
        estimate.formatted = {
            total: {
                originalSize: encodeService.formatBytes(estimate.total.originalSize),
                estimatedSize: encodeService.formatBytes(estimate.total.estimatedSize),
                savings: encodeService.formatBytes(estimate.total.savings)
            },
            videos: {
                originalSize: encodeService.formatBytes(estimate.videos.originalSize),
                estimatedSize: encodeService.formatBytes(estimate.videos.estimatedSize),
                savings: encodeService.formatBytes(estimate.videos.savings)
            },
            images: {
                originalSize: encodeService.formatBytes(estimate.images.originalSize),
                estimatedSize: encodeService.formatBytes(estimate.images.estimatedSize),
                savings: encodeService.formatBytes(estimate.images.savings)
            }
        };

        res.json(estimate);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/encode/queue
 * Queue files for encoding
 */
router.post('/queue', (req, res) => {
    try {
        const { performerId, files } = req.body;

        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: 'No files provided' });
        }

        const jobs = encodeService.queueFiles(files, performerId);

        res.json({
            success: true,
            message: `Queued ${jobs.length} files for encoding`,
            jobs
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/encode/jobs
 * Get all jobs with optional status filter
 */
router.get('/jobs', (req, res) => {
    try {
        const { status, limit = 100 } = req.query;
        const jobs = encodeService.getJobs(status || null, parseInt(limit, 10));

        // Format file sizes for display
        for (const job of jobs) {
            job.originalSizeFormatted = encodeService.formatBytes(job.original_size_bytes || 0);
            job.estimatedSizeFormatted = encodeService.formatBytes(job.estimated_size_bytes || 0);
            job.actualSizeFormatted = job.actual_size_bytes ? encodeService.formatBytes(job.actual_size_bytes) : null;
        }

        res.json(jobs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/encode/stats
 * Get queue statistics
 */
router.get('/stats', (req, res) => {
    try {
        const stats = encodeService.getQueueStats();

        // Format for display
        stats.formatted = {
            pending: {
                originalSize: encodeService.formatBytes(stats.pending.originalBytes),
                estimatedSize: encodeService.formatBytes(stats.pending.estimatedBytes)
            },
            completed: {
                originalSize: encodeService.formatBytes(stats.completed.originalBytes),
                savedSize: encodeService.formatBytes(stats.completed.savedBytes)
            }
        };

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/encode/jobs/:id
 * Cancel a pending job
 */
router.delete('/jobs/:id', (req, res) => {
    try {
        const { id } = req.params;
        const cancelled = encodeService.cancelJob(parseInt(id, 10));

        if (cancelled) {
            res.json({ success: true, message: 'Job cancelled' });
        } else {
            res.status(404).json({ error: 'Job not found or not in pending status' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/encode/clear
 * Clear completed/cancelled/failed jobs
 */
router.post('/clear', (req, res) => {
    try {
        const count = encodeService.clearFinishedJobs();
        res.json({ success: true, cleared: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== Future: Remote Worker Endpoints =====
// These are documented but will return 501 until worker_mode is implemented

/**
 * GET /api/encode/worker/claim
 * (Future) Claim next pending job for processing
 */
router.get('/worker/claim', (req, res) => {
    const settings = encodeService.getSettings();
    if (settings.worker_mode !== 'remote') {
        return res.status(501).json({
            error: 'Remote worker mode not enabled',
            hint: 'Set worker_mode to "remote" in encode settings to enable worker API'
        });
    }

    // TODO: Implement worker job claiming
    res.status(501).json({ error: 'Not implemented yet' });
});

/**
 * POST /api/encode/worker/complete/:id
 * (Future) Mark job as complete and upload result
 */
router.post('/worker/complete/:id', (req, res) => {
    const settings = encodeService.getSettings();
    if (settings.worker_mode !== 'remote') {
        return res.status(501).json({
            error: 'Remote worker mode not enabled'
        });
    }

    // TODO: Implement worker job completion
    res.status(501).json({ error: 'Not implemented yet' });
});

module.exports = router;
