const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { findThumbnail, scanPerformerFolderEnhanced } = require('./importer');
const { scanPerformerFolder } = require('./fileScanner');
const { findPerformerByNameOrAlias } = require('../utils/performerMatcher');
const { createHashDB } = require('./hashService');

/**
 * Handle upload-based performer import
 * Files are uploaded via multipart form data and organized into the proper structure
 */
// Global progress tracking map
const uploadProgressMap = new Map();

/**
 * Handle upload-based performer import
 * Files are uploaded via multipart form data and organized into the proper structure
 */
async function uploadImportPerformer(performerName, basePath, files, uploadId, createHashes = false) {
    console.log(`Starting upload import for performer: ${performerName} (ID: ${uploadId})`);
    console.log(`Received ${files.length} files`);

    // Initialize progress
    if (uploadId) {
        uploadProgressMap.set(uploadId, {
            status: 'processing',
            processed: 0,
            total: files.length,
            currentFile: 'Starting import...'
        });
    }

    // Validate performer name
    if (!performerName || !performerName.trim()) {
        throw new Error('Performer name is required');
    }

    let finalName = performerName.trim();

    // Try to find existing performer to use canonical name
    const existingMatch = findPerformerByNameOrAlias(finalName);
    if (existingMatch) {
        console.log(`Matched "${finalName}" to existing performer "${existingMatch.name}"`);
        finalName = existingMatch.name;

        if (existingMatch.blacklisted) {
            throw new Error(`Performer "${finalName}" is blacklisted and cannot be imported.`);
        }
    }

    // Create performer folder structure
    const performerPath = path.join(basePath, 'before filter performer', finalName);
    const picsPath = path.join(performerPath, 'pics');
    const vidsPath = path.join(performerPath, 'vids');
    const funscriptPath = path.join(vidsPath, 'funscript');

    // Check if folder already exists
    if (await fs.pathExists(performerPath)) {
        console.log(`Performer folder "${finalName}" already exists. Merging new files...`);
    }

    // Create folder structure
    await fs.ensureDir(picsPath);
    await fs.ensureDir(vidsPath);
    await fs.ensureDir(funscriptPath);

    // File extension categories
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    const funscriptExt = '.funscript';

    // Track stats
    const stats = {
        pics_count: 0,
        vids_count: 0,
        funscript_vids_count: 0,
        funscript_files_count: 0,
        total_size_gb: 0
    };

    // Group files to detect funscript video pairs
    const filesByBasename = new Map();
    for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        const basename = path.basename(file.originalname, ext);

        if (!filesByBasename.has(basename)) {
            filesByBasename.set(basename, []);
        }
        filesByBasename.get(basename).push({ file, ext });
    }

    // Process each file
    let processedCount = 0;
    for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        const basename = path.basename(file.originalname, ext);
        const filename = file.originalname;

        // Update progress
        if (uploadId) {
            uploadProgressMap.set(uploadId, {
                status: 'processing',
                processed: processedCount,
                total: files.length,
                currentFile: `Importing: ${filename}`
            });
        }

        // Get file size - either from file object or from disk
        let fileSize = file.size;
        if (!fileSize && file.path) {
            try {
                const fileStat = await fs.stat(file.path);
                fileSize = fileStat.size;
            } catch (e) {
                console.warn(`Could not get size for ${file.originalname}:`, e.message);
                fileSize = 0;
            }
        }
        stats.total_size_gb += (fileSize || 0) / (1024 * 1024 * 1024);

        let targetPath;

        if (imageExts.includes(ext)) {
            // Image file -> pics folder
            targetPath = path.join(picsPath, filename);
            stats.pics_count++;
        } else if (videoExts.includes(ext)) {
            // Check if this video has an associated funscript
            const relatedFiles = filesByBasename.get(basename) || [];
            const hasFunscript = relatedFiles.some(f => f.ext === funscriptExt);

            if (hasFunscript) {
                // Video with funscript -> funscript folder
                targetPath = path.join(funscriptPath, filename);
                stats.funscript_vids_count++;
                stats.vids_count++;
            } else {
                // Regular video -> vids folder
                targetPath = path.join(vidsPath, filename);
                stats.vids_count++;
            }
        } else if (ext === funscriptExt) {
            // Funscript file -> funscript folder
            targetPath = path.join(funscriptPath, filename);
            stats.funscript_files_count++;
        } else {
            // Unknown file type - skip or put in root
            console.log(`Skipping unknown file type: ${filename}`);
            processedCount++;
            continue;
        }

        // Move the file from temp location to target (or copy buffer if in memory)
        try {
            if (file.path) {
                // Disk storage - move from temp
                await fs.move(file.path, targetPath, { overwrite: true });
            } else if (file.buffer) {
                // Memory storage fallback
                await fs.writeFile(targetPath, file.buffer);
            }
            console.log(`Processed file: ${filename} -> ${targetPath}`);
        } catch (err) {
            console.error(`Failed to process file ${filename}:`, err.message);
            throw new Error(`Failed to move file ${filename}: ${err.message}`);
        }

        processedCount++;
    }

    // Scan folder to get accurate stats (merges old + new counts)
    console.log(`Scanning folder to update stats: ${performerPath}`);
    const finalStats = await scanPerformerFolder(performerPath);

    // Find thumbnail (first image) - try to find one if we didn't have one before
    const thumbnail = await findThumbnailFromPath(picsPath);

    // Get folder ID
    const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
    if (!folder) {
        throw new Error(`Base folder not found in database: ${basePath}`);
    }

    // Check if performer already exists in DB
    const existingPerformer = db.prepare('SELECT * FROM performers WHERE name = ?').get(finalName);

    let resultId;
    let isUpdate = false;

    if (existingPerformer && existingPerformer.moved_to_after === 0) {
        // UPDATE existing record in "before filter"
        console.log(`Updating existing performer "${finalName}" (ID: ${existingPerformer.id}) with new stats`);

        db.prepare(`
            UPDATE performers SET 
                thumbnail = ?, 
                pics_count = ?, vids_count = ?, funscript_vids_count = ?, funscript_files_count = ?, total_size_gb = ?,
                pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?,
                last_scan_date = ?
            WHERE id = ?
        `).run(
            thumbnail || existingPerformer.thumbnail,
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
        // INSERT new record (or if existing was in "after filter", allow new "before" record)
        console.log(`Inserting new performer record for "${finalName}"`);

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
            folder.id,
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
            funscriptPath
        );

        resultId = result.lastInsertRowid;
    }

    // Optional: Create Hashes
    if (createHashes) {
        console.log(`Creating hashes for performer ${finalName} (ID: ${resultId})`);
        if (uploadId) {
            uploadProgressMap.set(uploadId, {
                status: 'processing',
                processed: 0,
                total: 100, // Arbitrary for now until hash job reports
                currentFile: 'Generating hashes...'
            });
        }

        try {
            // We'll hook into the hash service progress
            // However createHashDB creates its own "activeJobs" entry.
            // We can just rely on awaiting it. 
            // Better: update uploadProgressMap periodically if we could, but createHashDB provides a callback!

            // Re-discover files for hashing to ensure we get everything
            const hashJobId = `hash-${Date.now()}`;
            await createHashDB(resultId, basePath, hashJobId, 'append', (processed, total) => {
                if (uploadId) {
                    uploadProgressMap.set(uploadId, {
                        status: 'processing',
                        processed: processed,
                        total: total,
                        currentFile: `Generating hashes (${processed}/${total})`
                    });
                }
            });
            console.log('Hash creation completed');

            // After hash creation, run internal duplicate check
            if (uploadId) {
                uploadProgressMap.set(uploadId, {
                    status: 'processing',
                    processed: 0,
                    total: 100,
                    currentFile: 'Checking for duplicates...'
                });
            }

            try {
                const { checkInternalDuplicates } = require('./hashService');
                const dupResult = await checkInternalDuplicates(resultId);
                console.log(`Internal dup check completed: ${dupResult.duplicateCount} duplicates found`);
            } catch (dupErr) {
                console.error('Internal dup check failed:', dupErr);
                // Don't fail the import if dup check fails
            }
        } catch (hashErr) {
            console.error('Hash creation failed:', hashErr);
            // We don't fail the whole import if hashing fails, just log it
        }
    }

    // Complete progress
    if (uploadId) {
        uploadProgressMap.set(uploadId, {
            status: 'completed',
            processed: files.length,
            total: files.length,
            currentFile: 'Done'
        });
    }

    console.log(`Upload import completed for ${finalName}:`, finalStats);

    return {
        id: resultId,
        name: finalName,
        ...finalStats,
        thumbnail,
        isUpdate
    };
}

/**
 * Local import - import performer from "before upload" folder (no HTTP upload needed)
 * Files are already on the filesystem, so we just build file infos and call uploadImportPerformer
 */
async function localImportPerformer(folderName, performerName, basePath, uploadId, createHashes = false) {
    const sourceDir = path.join(basePath, 'before upload', folderName);

    if (!await fs.pathExists(sourceDir)) {
        throw new Error(`Folder not found: ${sourceDir}`);
    }

    // Recursively collect all files
    const fileInfos = [];
    async function collectFiles(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await collectFiles(fullPath);
            } else if (entry.isFile()) {
                fileInfos.push({
                    path: fullPath,
                    originalname: entry.name
                });
            }
        }
    }
    await collectFiles(sourceDir);

    if (fileInfos.length === 0) {
        throw new Error(`No files found in folder: ${sourceDir}`);
    }

    console.log(`[LocalImport] Found ${fileInfos.length} files for "${performerName}" in before upload folder`);

    // Use the existing import pipeline (files will be MOVED to before filter performer)
    const result = await uploadImportPerformer(performerName, basePath, fileInfos, uploadId, createHashes);

    // Clean up the now-empty source folder
    try {
        await fs.remove(sourceDir);
        console.log(`[LocalImport] Cleaned up source folder: ${sourceDir}`);
    } catch (cleanErr) {
        console.warn(`[LocalImport] Could not remove source folder: ${cleanErr.message}`);
    }

    return result;
}

async function findThumbnailFromPath(picsPath) {
    try {
        if (!await fs.pathExists(picsPath)) return null;

        const pics = await fs.readdir(picsPath);
        const imageFile = pics.find(file =>
            ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file).toLowerCase())
        );
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
