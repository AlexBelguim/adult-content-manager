/**
 * Encode Service - Media optimization for videos and images
 * Converts videos to H.265 and images to WebP for space savings
 */

const db = require('../db');
const path = require('path');
const fs = require('fs-extra');
const { execSync, spawn } = require('child_process');

// Check if FFmpeg is available
let ffmpegAvailable = false;
let ffprobeAvailable = false;

try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    ffmpegAvailable = true;
} catch (e) {
    console.warn('FFmpeg not found - video encoding will not be available');
}

try {
    execSync('ffprobe -version', { stdio: 'ignore' });
    ffprobeAvailable = true;
} catch (e) {
    console.warn('FFprobe not found - video analysis will be limited');
}

/**
 * Get all encode settings
 */
function getSettings() {
    const rows = db.prepare('SELECT key, value FROM encode_settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
}

/**
 * Update encode settings
 */
function updateSettings(updates) {
    const stmt = db.prepare(`
    INSERT OR REPLACE INTO encode_settings (key, value, updated_at) 
    VALUES (?, ?, datetime('now'))
  `);

    for (const [key, value] of Object.entries(updates)) {
        stmt.run(key, String(value));
    }

    return getSettings();
}

/**
 * Get video codec using FFprobe
 */
function getVideoCodec(filePath) {
    if (!ffprobeAvailable) return 'unknown';

    try {
        const result = execSync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { encoding: 'utf-8', timeout: 10000 }
        );
        return result.trim().toLowerCase();
    } catch (e) {
        return 'unknown';
    }
}

/**
 * Check if video is already H.265/HEVC
 */
function isVideoOptimized(filePath) {
    const codec = getVideoCodec(filePath);
    return codec === 'hevc' || codec === 'h265';
}

/**
 * Check if image is already WebP
 */
function isImageOptimized(filePath) {
    return path.extname(filePath).toLowerCase() === '.webp';
}

/**
 * Estimate savings for a single file
 */
function estimateFileSavings(filePath, fileSize, isVideo) {
    if (isVideo) {
        if (isVideoOptimized(filePath)) {
            return { originalSize: fileSize, estimatedSize: fileSize, savings: 0, alreadyOptimized: true };
        }
        // H.264 → H.265 typically saves 25-35%
        const estimatedSize = Math.round(fileSize * 0.70);
        return {
            originalSize: fileSize,
            estimatedSize,
            savings: fileSize - estimatedSize,
            alreadyOptimized: false
        };
    } else {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.webp') {
            return { originalSize: fileSize, estimatedSize: fileSize, savings: 0, alreadyOptimized: true };
        }
        // PNG → WebP ~50%, JPEG → WebP ~25%
        const ratio = ext === '.png' ? 0.50 : 0.75;
        const estimatedSize = Math.round(fileSize * ratio);
        return {
            originalSize: fileSize,
            estimatedSize,
            savings: fileSize - estimatedSize,
            alreadyOptimized: false
        };
    }
}

/**
 * Estimate savings for a performer
 */
async function estimatePerformerSavings(performerId) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) {
        throw new Error('Performer not found');
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    if (!folder) {
        throw new Error('Folder not found');
    }

    // Determine performer path
    const performerPath = performer.moved_to_after === 1
        ? path.join(folder.path, 'after filter performer', performer.name)
        : path.join(folder.path, 'before filter performer', performer.name);

    const picsPath = path.join(performerPath, 'pics');
    const vidsPath = path.join(performerPath, 'vids');

    const results = {
        performerId,
        performerName: performer.name,
        videos: { count: 0, originalSize: 0, estimatedSize: 0, savings: 0, alreadyOptimized: 0 },
        images: { count: 0, originalSize: 0, estimatedSize: 0, savings: 0, alreadyOptimized: 0 },
        total: { originalSize: 0, estimatedSize: 0, savings: 0 },
        files: []
    };

    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    // Process videos
    if (await fs.pathExists(vidsPath)) {
        const files = await fs.readdir(vidsPath);
        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (videoExts.includes(ext)) {
                const filePath = path.join(vidsPath, file);
                try {
                    const stats = await fs.stat(filePath);
                    const estimate = estimateFileSavings(filePath, stats.size, true);

                    results.videos.count++;
                    results.videos.originalSize += estimate.originalSize;
                    results.videos.estimatedSize += estimate.estimatedSize;
                    results.videos.savings += estimate.savings;
                    if (estimate.alreadyOptimized) results.videos.alreadyOptimized++;

                    if (!estimate.alreadyOptimized) {
                        results.files.push({
                            path: filePath,
                            type: 'video',
                            name: file,
                            ...estimate
                        });
                    }
                } catch (e) {
                    // Skip inaccessible files
                }
            }
        }
    }

    // Process images
    if (await fs.pathExists(picsPath)) {
        const files = await fs.readdir(picsPath);
        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (imageExts.includes(ext)) {
                const filePath = path.join(picsPath, file);
                try {
                    const stats = await fs.stat(filePath);
                    const estimate = estimateFileSavings(filePath, stats.size, false);

                    results.images.count++;
                    results.images.originalSize += estimate.originalSize;
                    results.images.estimatedSize += estimate.estimatedSize;
                    results.images.savings += estimate.savings;
                    if (estimate.alreadyOptimized) results.images.alreadyOptimized++;

                    if (!estimate.alreadyOptimized) {
                        results.files.push({
                            path: filePath,
                            type: 'image',
                            name: file,
                            ...estimate
                        });
                    }
                } catch (e) {
                    // Skip inaccessible files
                }
            }
        }
    }

    // Calculate totals
    results.total.originalSize = results.videos.originalSize + results.images.originalSize;
    results.total.estimatedSize = results.videos.estimatedSize + results.images.estimatedSize;
    results.total.savings = results.videos.savings + results.images.savings;
    results.total.savingsPercent = results.total.originalSize > 0
        ? Math.round((results.total.savings / results.total.originalSize) * 100)
        : 0;

    return results;
}

/**
 * Queue files for encoding
 */
function queueFiles(files, performerId) {
    const stmt = db.prepare(`
    INSERT INTO encode_jobs (performer_id, source_path, target_format, original_size_bytes, estimated_size_bytes, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);

    const jobs = [];
    for (const file of files) {
        const format = file.type === 'video' ? 'h265' : 'webp';
        const result = stmt.run(performerId, file.path, format, file.originalSize, file.estimatedSize);
        jobs.push({ id: result.lastInsertRowid, ...file, format });
    }

    return jobs;
}

/**
 * Get all jobs with optional status filter
 */
function getJobs(status = null, limit = 100) {
    if (status) {
        return db.prepare(`
      SELECT j.*, p.name as performer_name 
      FROM encode_jobs j
      LEFT JOIN performers p ON j.performer_id = p.id
      WHERE j.status = ?
      ORDER BY j.created_at DESC
      LIMIT ?
    `).all(status, limit);
    }

    return db.prepare(`
    SELECT j.*, p.name as performer_name 
    FROM encode_jobs j
    LEFT JOIN performers p ON j.performer_id = p.id
    ORDER BY j.created_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get queue statistics
 */
function getQueueStats() {
    const stats = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count,
      SUM(original_size_bytes) as original_bytes,
      SUM(COALESCE(actual_size_bytes, estimated_size_bytes)) as result_bytes
    FROM encode_jobs
    GROUP BY status
  `).all();

    const result = {
        pending: { count: 0, originalBytes: 0, estimatedBytes: 0 },
        processing: { count: 0, originalBytes: 0, estimatedBytes: 0 },
        completed: { count: 0, originalBytes: 0, savedBytes: 0 },
        failed: { count: 0 }
    };

    for (const stat of stats) {
        if (result[stat.status]) {
            result[stat.status].count = stat.count;
            if (stat.status === 'completed') {
                result[stat.status].originalBytes = stat.original_bytes || 0;
                result[stat.status].savedBytes = (stat.original_bytes || 0) - (stat.result_bytes || 0);
            } else {
                result[stat.status].originalBytes = stat.original_bytes || 0;
                result[stat.status].estimatedBytes = stat.result_bytes || 0;
            }
        }
    }

    return result;
}

/**
 * Cancel a pending job
 */
function cancelJob(jobId) {
    const result = db.prepare(`
    UPDATE encode_jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'
  `).run(jobId);

    return result.changes > 0;
}

/**
 * Clear completed/cancelled jobs
 */
function clearFinishedJobs() {
    const result = db.prepare(`
    DELETE FROM encode_jobs WHERE status IN ('completed', 'cancelled', 'failed')
  `).run();

    return result.changes;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
    ffmpegAvailable,
    ffprobeAvailable,
    getSettings,
    updateSettings,
    getVideoCodec,
    isVideoOptimized,
    isImageOptimized,
    estimateFileSavings,
    estimatePerformerSavings,
    queueFiles,
    getJobs,
    getQueueStats,
    cancelJob,
    clearFinishedJobs,
    formatBytes
};
