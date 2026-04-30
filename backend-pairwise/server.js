/**
 * Pairwise Labeling Server for Adult Content Manager
 * 
 * Integrated version of the standalone pairwise labeler.
 * Uses SQLite for persistence and scans main app's performer folders.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { spawn } = require('child_process');
const config = require('./config');
const { db, queries } = require('./db');

// Global training state
let trainingProcess = null;
let trainingLogs = [];
const MAX_LOGS = 1000;

function addLog(message) {
    const time = new Date().toLocaleTimeString();
    trainingLogs.push(`[${time}] ${message}`);
    if (trainingLogs.length > MAX_LOGS) {
        trainingLogs.shift();
    }
}

// Configure multer for file uploads
const upload = multer({
    dest: path.join(__dirname, 'uploads'),
    limits: { fileSize: 50 * 1024 * 1024 }
});

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory cache for image data
let imageCache = {
    performers: {},      // performerName -> {keep: [], delete: [], name: string}
    performerList: [],   // Array of {name, keepCount, deleteCount, totalCount}
    loaded: false,
    basePath: null
};

// In-memory data that supplements the DB
let seenPairs = new Set();

// Load seen pairs from DB on startup
try {
    const allPairs = queries.getAllPairs.all();
    for (const pair of allPairs) {
        seenPairs.add(pairKey(pair.winner, pair.loser));
    }
    console.log(`📦 Loaded ${seenPairs.size} seen pairs from database`);
} catch (err) {
    console.error('Error loading pairs:', err.message);
}

// Sync with Main App DB (Performers & Renames)
try {
    const syncService = require('./syncService');
    syncService.sync();
} catch (err) {
    console.error('Error in sync service:', err);
}

/**
 * Scan the main app's folder structure to build dataset
 */
async function scanPerformerFolders() {
    try {
        // PRIORITY 1: Get base path from Main App Database
        let basePath = null;
        try {
            const mainDbPath = path.join(config.mainAppBasePath, 'backend', 'app.db');
            if (fs.existsSync(mainDbPath)) {
                const mainDb = require('better-sqlite3')(mainDbPath, { readonly: true });
                const folder = mainDb.prepare('SELECT path FROM folders LIMIT 1').get();
                if (folder) {
                    basePath = folder.path;
                    console.log(`📂 Found base path in Main DB: ${basePath}`);
                    // Update local setting to match
                    queries.setSetting.run('basePath', basePath);
                }
                mainDb.close();
            }
        } catch (err) {
            console.warn('⚠️ Could not read Main DB for base path:', err.message);
        }

        // PRIORITY 2: Fallback to saved setting
        if (!basePath) {
            basePath = queries.getSetting.get('basePath')?.value;
        }

        if (!basePath || !fs.existsSync(basePath)) {
            console.log('⚠️  No base path found. Please configure via API.');
            return false;
        }

        imageCache.basePath = basePath;
        imageCache.performers = {};

        // Scan "after filter performer" folder for performers
        const afterPath = path.join(basePath, config.afterFolderName);
        const trainingRoot = path.join(basePath, config.trainingFolderName);
        const beforeRoot = path.join(basePath, 'before filter performer');
        const blacklistRoot = path.join(basePath, 'blacklist'); // Standard naming

        const afterDirs = fs.existsSync(afterPath)
            ? fs.readdirSync(afterPath, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name)
            : [];

        const trainingDirs = fs.existsSync(trainingRoot)
            ? fs.readdirSync(trainingRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name)
            : [];

        const beforeDirs = fs.existsSync(beforeRoot)
            ? fs.readdirSync(beforeRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name)
            : [];

        const blacklistDirs = fs.existsSync(blacklistRoot)
            ? fs.readdirSync(blacklistRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name)
            : [];

        // Union all performer names
        const allPerfNames = new Set([...afterDirs, ...trainingDirs, ...beforeDirs]);
        // Note: We flag blacklisted ones but maybe don't want to load them for labeling unless they are also in others?
        blacklistDirs.forEach(n => allPerfNames.add(n));

        console.log(`\n📂 Scanning ${allPerfNames.size} total performers across folders`);

        for (const perfName of allPerfNames) {
            // Paths
            const pAfter = path.join(afterPath, perfName);
            const pTrain = path.join(trainingRoot, perfName);
            const pBefore = path.join(beforeRoot, perfName);

            // Flags
            const inAfter = afterDirs.includes(perfName);
            const inTraining = trainingDirs.includes(perfName);
            const inBefore = beforeDirs.includes(perfName);
            const inBlacklist = blacklistDirs.includes(perfName);

            // Scan images
            let keepImages = [];
            if (inAfter) {
                keepImages = scanForImages(pAfter);
            }

            let deleteImages = []; // "delete" maps to training folder logic
            if (inTraining) {
                deleteImages = scanForImages(pTrain);
            }
            
            let beforeImages = [];
            if (inBefore) {
                beforeImages = scanForImages(pBefore);
            }

            if (keepImages.length > 0 || deleteImages.length > 0 || beforeImages.length > 0) {
                imageCache.performers[perfName] = {
                    name: perfName,
                    keep: keepImages,
                    delete: deleteImages,
                    before: beforeImages,
                    inAfter,
                    inTraining,
                    inBefore,
                    inBlacklist
                };
            }
        }

        // Build performer list
        imageCache.performerList = Object.keys(imageCache.performers)
            .map(name => {
                const p = imageCache.performers[name];
                return {
                    name,
                    keepCount: p.keep.length,
                    deleteCount: p.delete.length,
                    beforeCount: p.before.length,
                    totalCount: p.keep.length + p.delete.length + p.before.length,
                    inAfter: p.inAfter,
                    inTraining: p.inTraining,
                    inBefore: p.inBefore,
                    inBlacklist: p.inBlacklist
                };
            })
            .sort((a, b) => b.totalCount - a.totalCount);

        // Seed initial scores based on folder location
        // Keep = 60, Delete = 40 (If not already in DB)
        const seedTransaction = db.transaction(() => {
            for (const name of Object.keys(imageCache.performers)) {
                const perf = imageCache.performers[name];
                for (const img of perf.keep) {
                    queries.insertScoreIgnore.run(img, 60, 0);
                }
                for (const img of perf.delete) {
                    queries.insertScoreIgnore.run(img, 40, 0);
                }
            }
        });
        seedTransaction();

        imageCache.loaded = true;

        const totalKeep = imageCache.performerList.reduce((sum, p) => sum + p.keepCount, 0);
        const totalDelete = imageCache.performerList.reduce((sum, p) => sum + p.deleteCount, 0);

        console.log(`✅ Loaded ${totalKeep} keep, ${totalDelete} delete images`);
        console.log(`   ${imageCache.performerList.length} performers`);

        return true;
    } catch (err) {
        console.error('Error scanning folders:', err);
        return false;
    }
}

/**
 * Scan a directory for images
 */
function scanForImages(dirPath) {
    let images = [];

    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                images = images.concat(scanForImages(fullPath));
            } else if (file.isFile()) {
                const ext = path.extname(file.name).toLowerCase();
                if (config.imageExtensions.includes(ext)) {
                    images.push(fullPath);
                }
            }
        }
    } catch (err) {
        // Directory might not exist or access denied
    }

    return images;
}

/**
 * Get image score from database
 */
function getImageScore(imagePath) {
    const row = queries.getScore.get(imagePath);
    return row ? { score: row.score, comparisons: row.comparisons } : { score: 50, comparisons: 0 };
}

/**
 * Update scores after comparison
 */
function updateScores(winnerPath, loserPath) {
    const winner = getImageScore(winnerPath);
    const loser = getImageScore(loserPath);

    const winnerDelta = Math.max(5, 20 / (winner.comparisons + 1));
    const loserDelta = Math.max(5, 20 / (loser.comparisons + 1));

    queries.upsertScore.run(
        winnerPath,
        Math.min(100, winner.score + winnerDelta),
        winner.comparisons + 1
    );

    queries.upsertScore.run(
        loserPath,
        Math.max(0, loser.score - loserDelta),
        loser.comparisons + 1
    );
}

/**
 * Generate pair key for deduplication
 */
function pairKey(path1, path2) {
    return [path1, path2].sort().join('|');
}

/**
 * Get pair uncertainty for active learning
 */
function getPairUncertainty(path1, path2) {
    const score1 = getImageScore(path1);
    const score2 = getImageScore(path2);

    const scoreDiff = Math.abs(score1.score - score2.score);
    let urgency = 100 - scoreDiff;

    const minComparisons = Math.min(score1.comparisons, score2.comparisons);
    if (minComparisons === 0) urgency += 30;
    else if (minComparisons < 3) urgency += 15;

    const totalFatigue = score1.comparisons + score2.comparisons;
    urgency -= totalFatigue * 3;

    return Math.max(0, urgency);
}

/**
 * Get selected performers from DB
 */
function getSelectedPerformers() {
    return queries.getSelectedPerformers.all().map(r => r.name);
}

/**
 * Select next pair for labeling
 */
function selectNextPair(pairType = 'mixed') {
    const candidates = [];
    const selectedPerformers = getSelectedPerformers();
    const performersToUse = selectedPerformers.length > 0
        ? selectedPerformers
        : Object.keys(imageCache.performers);

    if (performersToUse.length === 0) return null;

    // Generate intra-performer pairs
    if (pairType === 'intra' || pairType === 'mixed') {
        for (const perfName of performersToUse) {
            const perf = imageCache.performers[perfName];
            if (!perf) continue;

            const allImages = [...perf.keep, ...perf.delete];
            if (allImages.length >= 2) {
                for (let i = 0; i < Math.min(10, allImages.length); i++) {
                    const idx1 = Math.floor(Math.random() * allImages.length);
                    let idx2 = Math.floor(Math.random() * allImages.length);
                    while (idx2 === idx1) idx2 = Math.floor(Math.random() * allImages.length);

                    const key = pairKey(allImages[idx1], allImages[idx2]);
                    if (!seenPairs.has(key)) {
                        candidates.push({
                            path1: allImages[idx1],
                            path2: allImages[idx2],
                            type: 'intra',
                            performer: perfName,
                            uncertainty: getPairUncertainty(allImages[idx1], allImages[idx2])
                        });
                    }
                }
            }
        }
    }

    // Generate inter-performer pairs
    if (pairType === 'inter' || pairType === 'mixed') {
        const performerIds = performersToUse.filter(p => imageCache.performers[p]);

        if (performerIds.length >= 2) {
            for (let i = 0; i < 20; i++) {
                const p1Id = performerIds[Math.floor(Math.random() * performerIds.length)];
                let p2Id = performerIds[Math.floor(Math.random() * performerIds.length)];
                while (p2Id === p1Id) {
                    p2Id = performerIds[Math.floor(Math.random() * performerIds.length)];
                }

                const p1Images = [...imageCache.performers[p1Id].keep, ...imageCache.performers[p1Id].delete];
                const p2Images = [...imageCache.performers[p2Id].keep, ...imageCache.performers[p2Id].delete];

                const getChampion = (imgs) => imgs.reduce((a, b) =>
                    getImageScore(a).score > getImageScore(b).score ? a : b
                );

                if (p1Images.length > 0 && p2Images.length > 0) {
                    const champ1 = getChampion(p1Images);
                    const champ2 = getChampion(p2Images);

                    const key = pairKey(champ1, champ2);
                    if (!seenPairs.has(key)) {
                        candidates.push({
                            path1: champ1,
                            path2: champ2,
                            type: 'inter',
                            performer: `${p1Id} vs ${p2Id}`,
                            uncertainty: getPairUncertainty(champ1, champ2)
                        });
                    }
                }
            }
        }
    }

    if (candidates.length === 0) return null;

    // Active learning strategy
    const roll = Math.random();

    if (roll < 0.20) {
        return candidates[Math.floor(Math.random() * candidates.length)];
    } else if (roll < 0.40) {
        const topTier = candidates.filter(c => {
            const s1 = getImageScore(c.path1).score;
            const s2 = getImageScore(c.path2).score;
            return s1 > 60 && s2 > 60;
        });
        if (topTier.length > 0) {
            topTier.sort((a, b) => b.uncertainty - a.uncertainty);
            return topTier[0];
        }
    } else if (roll < 0.55) {
        const newcomers = candidates.filter(c => {
            const c1 = getImageScore(c.path1).comparisons;
            const c2 = getImageScore(c.path2).comparisons;
            return c1 < 3 || c2 < 3;
        });
        if (newcomers.length > 0) {
            return newcomers[Math.floor(Math.random() * newcomers.length)];
        }
    }

    candidates.sort((a, b) => b.uncertainty - a.uncertainty);
    const topN = Math.min(5, candidates.length);
    return candidates[Math.floor(Math.random() * topN)];
}

/**
 * Find which performer an image belongs to
 */
function findPerformerForImage(imagePath) {
    for (const [perfName, perf] of Object.entries(imageCache.performers)) {
        if (perf.keep.includes(imagePath) || perf.delete.includes(imagePath)) {
            return perfName;
        }
    }
    return null;
}

// ============== API Routes ==============

// Health check
app.get('/api/health', (req, res) => {
    const inferenceUrl = queries.getSetting.get('inferenceServerUrl')?.value || config.inferenceServerUrl;

    res.json({
        status: 'ok',
        loaded: imageCache.loaded,
        performers: imageCache.performerList.length,
        inferenceServerUrl: inferenceUrl,
        basePath: imageCache.basePath
    });
});

// Get status
app.get('/api/status', (req, res) => {
    const pairCount = queries.getPairCount.get()?.count || 0;
    const intraCount = queries.getPairsByType.get('intra')?.count || 0;
    const interCount = queries.getPairsByType.get('inter')?.count || 0;

    res.json({
        loaded: imageCache.loaded,
        totalImages: imageCache.performerList.reduce((sum, p) => sum + p.totalCount, 0),
        keepImages: imageCache.performerList.reduce((sum, p) => sum + p.keepCount, 0),
        deleteImages: imageCache.performerList.reduce((sum, p) => sum + p.deleteCount, 0),
        performers: imageCache.performerList.length,
        labeledPairs: pairCount,
        stats: { total: pairCount, intra: intraCount, inter: interCount },
        selectedPerformers: getSelectedPerformers(),
        basePath: imageCache.basePath
    });
});

// Get performers
app.get('/api/performers', (req, res) => {
    const selectedPerformers = getSelectedPerformers();

    const performers = imageCache.performerList.map(p => {
        const perf = imageCache.performers[p.name];
        const allImages = [...perf.keep, ...perf.delete];
        const comparedCount = allImages.filter(img => {
            const score = queries.getScore.get(img);
            return score && score.comparisons > 0;
        }).length;

        return {
            ...p,
            comparedCount,
            coverage: allImages.length > 0 ? Math.round(comparedCount / allImages.length * 100) : 0,
            selected: selectedPerformers.includes(p.name),
            inAfter: p.inAfter,
            inTraining: p.inTraining,
            inBlacklist: p.inBlacklist
        };
    });

    res.json(performers);
});

// Select performers
app.post('/api/select-performers', (req, res) => {
    const { performers } = req.body;

    queries.clearSelectedPerformers.run();
    for (const p of (performers || [])) {
        queries.insertSelectedPerformer.run(p);
    }

    res.json({ success: true, selected: performers || [] });
});

// Refresh dataset
app.post('/api/refresh', async (req, res) => {
    const success = await scanPerformerFolders();
    res.json({
        success,
        imageCount: imageCache.performerList.reduce((sum, p) => sum + p.totalCount, 0)
    });
});

// Set base path
app.post('/api/set-base-path', async (req, res) => {
    const { basePath } = req.body;

    if (!basePath || !fs.existsSync(basePath)) {
        return res.status(400).json({ error: 'Invalid base path' });
    }

    queries.setSetting.run('basePath', basePath);
    const success = await scanPerformerFolders();

    res.json({ success, basePath });
});

// Set inference server URL
app.post('/api/set-inference-url', (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL required' });
    }

    queries.setSetting.run('inferenceServerUrl', url);
    res.json({ success: true, url });
});

// Get settings
app.get('/api/settings', (req, res) => {
    res.json({
        basePath: queries.getSetting.get('basePath')?.value || null,
        inferenceServerUrl: queries.getSetting.get('inferenceServerUrl')?.value || config.inferenceServerUrl
    });
});

// Get next pair
app.get('/api/next-pair', (req, res) => {
    const pairType = req.query.type || 'mixed';
    const pair = selectNextPair(pairType);

    if (!pair) {
        return res.json({ error: 'No more pairs available', done: true });
    }

    const swapped = Math.random() < 0.5;

    res.json({
        id: uuidv4(),
        left: swapped ? pair.path2 : pair.path1,
        right: swapped ? pair.path1 : pair.path2,
        type: pair.type,
        performer: pair.performer,
        uncertainty: pair.uncertainty,
        swapped
    });
});

// Submit labeled pair
app.post('/api/submit', (req, res) => {
    const { id, winner, loser, type } = req.body;

    if (!winner || !loser) {
        return res.status(400).json({ error: 'Missing winner or loser' });
    }

    // Record pair in database
    const performer = findPerformerForImage(winner) || findPerformerForImage(loser);
    queries.insertPair.run(winner, loser, type || 'unknown', performer);

    // Mark as seen
    seenPairs.add(pairKey(winner, loser));

    // Update scores
    updateScores(winner, loser);

    const pairCount = queries.getPairCount.get()?.count || 0;

    res.json({
        success: true,
        totalPairs: pairCount,
        winnerScore: getImageScore(winner),
        loserScore: getImageScore(loser)
    });
});

// Both Bad
app.post('/api/both-bad', (req, res) => {
    const { left, right } = req.body;

    if (!left || !right) {
        return res.status(400).json({ error: 'Missing images' });
    }

    // Mark as seen
    seenPairs.add(pairKey(left, right));

    // Decay both scores
    const s1 = getImageScore(left);
    const s2 = getImageScore(right);

    const d1 = Math.max(5, 20 / (s1.comparisons + 1));
    const d2 = Math.max(5, 20 / (s2.comparisons + 1));

    queries.upsertScore.run(left, Math.max(0, s1.score - d1), s1.comparisons + 1);
    queries.upsertScore.run(right, Math.max(0, s2.score - d2), s2.comparisons + 1);

    // Record as 'both_bad'
    const performer = findPerformerForImage(left) || findPerformerForImage(right);
    queries.insertPair.run(left, right, 'both_bad', performer);

    res.json({ success: true });
});

// Undo last vote
app.post('/api/undo', (req, res) => {
    try {
        const lastPair = db.prepare('SELECT * FROM pairs ORDER BY id DESC LIMIT 1').get();

        if (!lastPair) {
            return res.status(400).json({ error: 'No vote to undo' });
        }

        // Get current scores
        const winner = getImageScore(lastPair.winner);
        const loser = getImageScore(lastPair.loser);

        // Reverse scores (approximate logic: subtract the delta that would have been added)
        // Note: We use current comparisons count which is (N+1).
        // Delta was 20 / ((N) + 1) = 20 / CurrentComparisons.
        // We subtract this delta from winner, add to loser.

        if (winner.comparisons > 0) {
            const wDelta = Math.max(5, 20 / winner.comparisons);
            winner.score -= wDelta;
            winner.comparisons -= 1;
        }

        if (loser.comparisons > 0) {
            const lDelta = Math.max(5, 20 / loser.comparisons);
            loser.score += lDelta;
            loser.comparisons -= 1;
        }

        // Update DB
        queries.upsertScore.run(lastPair.winner, winner.score, winner.comparisons);
        queries.upsertScore.run(lastPair.loser, loser.score, loser.comparisons);

        // Delete pair
        db.prepare('DELETE FROM pairs WHERE id = ?').run(lastPair.id);

        // Remove from seenPairs
        seenPairs.delete(pairKey(lastPair.winner, lastPair.loser));

        const pairCount = queries.getPairCount.get()?.count || 0;

        res.json({
            success: true,
            totalPairs: pairCount,
            undonePair: {
                left: lastPair.winner,
                right: lastPair.loser,
                performer: lastPair.performer,
                type: lastPair.type
            }
        });
    } catch (err) {
        console.error('Error undoing vote:', err);
        res.status(500).json({ error: 'Failed to undo' });
    }
});

// Skip pair
app.post('/api/skip', (req, res) => {
    const { left, right } = req.body;

    if (left && right) {
        seenPairs.add(pairKey(left, right));
    }

    res.json({ success: true });
});

// Export pairs
app.get('/api/export', (req, res) => {
    const allPairs = queries.getAllPairs.all();

    res.json({
        pairs: allPairs.map(p => ({ winner: p.winner, loser: p.loser })),
        stats: {
            total: allPairs.length,
            intra: allPairs.filter(p => p.type === 'intra').length,
            inter: allPairs.filter(p => p.type === 'inter').length,
            exportedAt: new Date().toISOString()
        }
    });
});

// ─── Binary Classifier Endpoints ─────────────────────────────────────────────

let binaryTrainingProcess = null;
let binaryTrainingLogs = [];

function addBinaryLog(msg) {
    binaryTrainingLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (binaryTrainingLogs.length > 500) binaryTrainingLogs.shift();
}

// Start binary training
app.post('/api/train-binary', (req, res) => {
    if (binaryTrainingProcess) {
        return res.status(400).json({ error: 'Binary training already in progress' });
    }

    const { performers, epochs, warmupEpochs, outputName, resumeModel, modelType } = req.body;

    if (!performers || performers.length === 0) {
        return res.status(400).json({ error: 'No performers selected' });
    }

    binaryTrainingLogs = [];

    // Gather keep/delete paths from imageCache
    const keepDirs = [];
    const deleteDirs = [];

    for (const perfName of performers) {
        const perf = imageCache.performers[perfName];
        if (!perf) {
            addBinaryLog(`WARNING: performer not found: ${perfName}`);
            continue;
        }

        const basePath = imageCache.basePath || config.basePath;
        const afterPath = path.join(basePath, config.afterFolderName, perfName);
        const trainingPath = path.join(basePath, config.trainingFolderName, perfName);

        if (fs.existsSync(afterPath) && perf.keep.length > 0) keepDirs.push(afterPath);
        if (fs.existsSync(trainingPath) && perf.delete.length > 0) deleteDirs.push(trainingPath);
    }

    if (keepDirs.length === 0 || deleteDirs.length === 0) {
        return res.status(400).json({ error: 'Not enough keep or delete images across selected performers' });
    }

    const suffix = modelType === 'context' ? '_context' : '';
    const outName = (outputName || 'binary_model').replace(/[^a-zA-Z0-9_-]/g, '_') + suffix + '.pt';
    
    addBinaryLog(`Starting ${modelType === 'context' ? 'CONTEXT-AWARE' : 'SIMPLE'} binary training on ${performers.length} performers`);
    addBinaryLog(`Keep dirs: ${keepDirs.length}, Delete dirs: ${deleteDirs.length}`);
    addBinaryLog(`Output: ${outName}, Epochs: ${epochs || 5}`);

    const scriptName = modelType === 'context' ? 'train_context_binary.py' : 'train_binary.py';
    const pythonScript = path.join(__dirname, 'python', scriptName);
    const python = process.platform === 'win32' ? 'python' : 'python3';

    const args = [
        '-u', pythonScript,
        '--keep-dirs', keepDirs.join(','),
        '--delete-dirs', deleteDirs.join(','),
        '--epochs', String(epochs || 5),
        '--warmup-epochs', String(warmupEpochs !== undefined ? warmupEpochs : 2),
        '--output', outName
    ];

    if (resumeModel && modelType !== 'context') { // Context model structure is different, don't resume from simple
        const resumePath = path.isAbsolute(resumeModel)
            ? resumeModel
            : path.join(__dirname, 'models', resumeModel);
        args.push('--resume', resumePath);
        addBinaryLog(`Resuming from: ${resumeModel}`);
    }

    addBinaryLog(`Command: ${python} ${args.join(' ')}`);

    try {
        binaryTrainingProcess = spawn(python, args, {
            cwd: path.join(__dirname, 'python'),
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        binaryTrainingProcess.stdout.on('data', (data) => {
            data.toString().split('\n').forEach(line => {
                if (line.trim()) addBinaryLog(line.trim());
            });
        });

        binaryTrainingProcess.stderr.on('data', (data) => {
            data.toString().split('\n').forEach(line => {
                if (line.trim()) addBinaryLog(`ERR: ${line.trim()}`);
            });
        });

        binaryTrainingProcess.on('close', (code) => {
            addBinaryLog(`Training finished with exit code ${code}`);
            binaryTrainingProcess = null;
        });

        res.json({ success: true, message: 'Binary training started', output: outName });
    } catch (err) {
        addBinaryLog(`Failed to start: ${err.message}`);
        binaryTrainingProcess = null;
        res.status(500).json({ error: err.message });
    }
});

// Binary training status
app.get('/api/binary-training-status', (req, res) => {
    res.json({
        active: !!binaryTrainingProcess,
        logs: binaryTrainingLogs
    });
});

// Stop binary training
app.post('/api/stop-binary-training', (req, res) => {
    if (binaryTrainingProcess) {
        binaryTrainingProcess.kill();
        addBinaryLog('Training stopped by user');
        binaryTrainingProcess = null;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'No binary training in progress' });
    }
});

// Evaluate binary model against known keep/delete images for selected performers
app.post('/api/evaluate-binary', async (req, res) => {
    const { performers, modelPath, threshold } = req.body;
    const binaryUrl = 'http://localhost:3345';
    const fetch = require('node-fetch');

    if (!performers || performers.length === 0) {
        return res.status(400).json({ error: 'No performers selected' });
    }

    try {
        // Check binary server health
        const healthRes = await fetch(`${binaryUrl}/health`).catch(() => null);
        if (!healthRes || !healthRes.ok) {
            return res.status(503).json({ error: 'Binary inference server not running on port 3345' });
        }
        const health = await healthRes.json();
        if (!health.model_loaded) {
            return res.status(400).json({ error: 'No binary model loaded in the inference server' });
        }

        // Gather keep/delete images for selected performers
        const keepImages = [];
        const deleteImages = [];

        for (const perfName of performers) {
            const perf = imageCache.performers[perfName];
            if (!perf) continue;
            keepImages.push(...perf.keep);
            deleteImages.push(...perf.delete);
        }

        // Call binary evaluate endpoint (sample for speed)
        const MAX_SAMPLE = 200;
        const sampledKeep = keepImages.sort(() => Math.random() - 0.5).slice(0, MAX_SAMPLE);
        const sampledDelete = deleteImages.sort(() => Math.random() - 0.5).slice(0, MAX_SAMPLE);

        const evalRes = await fetch(`${binaryUrl}/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                keep_images: sampledKeep,
                delete_images: sampledDelete,
                threshold: threshold || 50
            })
        });

        if (!evalRes.ok) {
            throw new Error(`Evaluate returned ${evalRes.status}`);
        }

        const evalData = await evalRes.json();
        res.json({ ...evalData, sampled: { keep: sampledKeep.length, delete: sampledDelete.length } });

    } catch (err) {
        console.error('Binary evaluate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── End Binary Classifier Endpoints ──────────────────────────────────────────

// Start training
app.post('/api/train', (req, res) => {

    if (trainingProcess) {
        return res.status(400).json({ error: 'Training already in progress' });
    }

    const { modelType, epochs, resumeModel } = req.body;

    // Export current data to file
    const allPairs = queries.getAllPairs.all();
    const exportPath = path.join(__dirname, 'pairwise_labels.json');
    const exportData = {
        pairs: allPairs.map(p => ({ winner: p.winner, loser: p.loser }))
    };
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    trainingLogs = [];
    addLog(`Starting training with ${allPairs.length} pairs...`);
    addLog(`Model: ${modelType || 'dinov2-large'}, Epochs: ${epochs || 3}`);

    // Spawn python training process
    const pythonScript = path.join(__dirname, 'python', 'train_dinov2.py');
    const python = process.platform === 'win32' ? 'python' : 'python3';

    // Use -u for unbuffered output
    const args = [
        '-u',
        pythonScript,
        '--pairs', exportPath,
        '--model', modelType || 'dinov2-large',
        '--epochs', String(epochs || 3)
    ];

    if (resumeModel) {
        // If resumeModel is just a name like "dinov2-large-epoch3.pt", find full path
        // For now assume absolute or relative to python dir
        const resumePath = path.isAbsolute(resumeModel)
            ? resumeModel
            : path.join(__dirname, 'python', 'output_dinov2', resumeModel);

        args.push('--resume', resumePath);
        addLog(`Resuming from: ${resumeModel}`);
    }

    addLog(`Command: ${python} ${args.join(' ')}`);

    try {
        trainingProcess = spawn(python, args, {
            cwd: path.join(__dirname, 'python'),
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        trainingProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line.trim()) addLog(line.trim());
            });
        });

        trainingProcess.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line.trim()) addLog(`ERROR: ${line.trim()}`);
            });
        });

        trainingProcess.on('close', (code) => {
            addLog(`Training finished with code ${code}`);
            trainingProcess = null;
        });

        res.json({ success: true, message: 'Training started' });
    } catch (err) {
        addLog(`Failed to start training: ${err.message}`);
        trainingProcess = null;
        res.status(500).json({ error: err.message });
    }
});

// Stop training
app.post('/api/stop-training', (req, res) => {
    if (trainingProcess) {
        trainingProcess.kill();
        addLog('Training stopped by user');
        trainingProcess = null;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'No training in progress' });
    }
});

// Training status
app.get('/api/training-status', (req, res) => {
    res.json({
        active: !!trainingProcess,
        logs: trainingLogs
    });
});

// Get scores
app.get('/api/scores', (req, res) => {
    const allScores = queries.getAllScores.all();

    res.json({
        total: allScores.length,
        scores: allScores.slice(0, 100).map(s => ({
            path: s.path,
            score: s.score,
            comparisons: s.comparisons
        }))
    });
});

// Performer health
app.get('/api/performer-health', (req, res) => {
    const healthData = [];
    const allPairs = queries.getAllPairs.all();

    // Count connections
    const interConnections = {};
    for (const pair of allPairs) {
        if (pair.type === 'inter') {
            const winnerPerf = findPerformerForImage(pair.winner);
            const loserPerf = findPerformerForImage(pair.loser);

            if (winnerPerf && loserPerf && winnerPerf !== loserPerf) {
                if (!interConnections[winnerPerf]) interConnections[winnerPerf] = new Set();
                if (!interConnections[loserPerf]) interConnections[loserPerf] = new Set();
                interConnections[winnerPerf].add(loserPerf);
                interConnections[loserPerf].add(winnerPerf);
            }
        }
    }

    for (const perfName of Object.keys(imageCache.performers)) {
        const perf = imageCache.performers[perfName];
        const allImages = [...perf.keep, ...perf.delete];

        const scores = allImages
            .map(img => queries.getScore.get(img)?.score)
            .filter(s => s !== undefined);

        let certainty = 0;
        let avgScore = 50;
        if (scores.length > 1) {
            avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
            const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;
            certainty = Math.sqrt(variance);
        }

        // Peak Score
        const allScoresForPeak = allImages.map(img => {
            const s = queries.getScore.get(img);
            return s ? s.score : 50;
        }).sort((a, b) => b - a);
        const top10 = allScoresForPeak.slice(0, 10);
        const peakScore = top10.length > 0 ? Math.round(top10.reduce((a, b) => a + b, 0) / top10.length) : 0;

        const intraPairs = allPairs.filter(p =>
            p.type === 'intra' &&
            (findPerformerForImage(p.winner) === perfName || findPerformerForImage(p.loser) === perfName)
        ).length;

        const connections = interConnections[perfName] ? interConnections[perfName].size : 0;

        healthData.push({
            name: perfName,
            totalImages: allImages.length,
            scoredImages: scores.length,
            avgScore: Math.round(avgScore * 10) / 10,
            peakScore,
            certainty: Math.round(certainty),
            intraPairs,
            connections,
            connectedTo: interConnections[perfName] ? Array.from(interConnections[perfName]) : [],
            certaintyStatus: certainty > 20 ? 'high' : certainty > 10 ? 'medium' : 'low',
            connectivityStatus: connections >= 3 ? 'strong' : connections >= 1 ? 'medium' : 'weak'
        });
    }

    healthData.sort((a, b) => a.certainty - b.certainty);
    res.json(healthData);
});

// Calibrate performer
app.get('/api/calibrate/:performer', (req, res) => {
    const perfName = decodeURIComponent(req.params.performer);
    const perf = imageCache.performers[perfName];

    if (!perf) {
        return res.status(404).json({ error: 'Performer not found' });
    }

    const allImages = [...perf.keep, ...perf.delete];
    const scoredImages = allImages.map(imgPath => {
        const scoreData = queries.getScore.get(imgPath);
        return {
            path: imgPath,
            score: scoreData?.score ?? 50,
            comparisons: scoreData?.comparisons ?? 0,
            originalLabel: perf.keep.includes(imgPath) ? 'keep' : 'delete'
        };
    });

    scoredImages.sort((a, b) => b.score - a.score);

    res.json({
        performer: perfName,
        totalImages: scoredImages.length,
        images: scoredImages,
        currentThreshold: 50
    });
});

// Run inference
app.post('/api/run-inference', async (req, res) => {
    const { performer, target, model, modelType } = req.body;

    if (!performer) {
        return res.status(400).json({ error: 'Missing performer' });
    }

    const perf = imageCache.performers[performer];
    if (!perf) {
        return res.status(404).json({ error: 'Performer not found' });
    }

    let allImages = [];
    let cacheKey = performer;
    if (target === 'before') {
        allImages = perf.before || [];
        cacheKey = `${performer}_before`;
    } else {
        allImages = [...perf.keep, ...perf.delete];
    }

    if (allImages.length === 0) {
        return res.status(400).json({ error: 'No images found to infer' });
    }

    // Route to binary server or pairwise server based on modelType
    const isBinary = modelType === 'binary';
    const inferenceUrl = isBinary
        ? BINARY_URL
        : (queries.getSetting.get('inferenceServerUrl')?.value || config.inferenceServerUrl);

    if (isBinary) cacheKey = `binary_${cacheKey}`;

    console.log(`\n🧠 Running inference on ${allImages.length} images for: ${performer} (${target || 'default'}) [${isBinary ? 'binary' : 'pairwise'}]`);
    console.log(`   Server: ${inferenceUrl}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify({ type: 'start', total: allImages.length })}\n\n`);

    const fetch = require('node-fetch');
    const chunkSize = 32;
    let allResults = [];
    try {
        // Auto-load model if not already loaded
        const healthRes = await fetch(`${inferenceUrl}/health`).catch(() => null);
        const healthData = healthRes ? await healthRes.json().catch(() => ({})) : {};
        if (!healthData.model_loaded) {
            console.log('   ⏳ Model not loaded — loading now...');
            res.write(`data: ${JSON.stringify({ type: 'loading', message: 'Loading model...' })}\n\n`);
            const loadRes = await fetch(`${inferenceUrl}/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: model || undefined })
            });
            if (!loadRes.ok) {
                throw new Error(`Failed to load model: ${loadRes.status}`);
            }
            console.log('   ✅ Model loaded');
        }

        for (let i = 0; i < allImages.length; i += chunkSize) {
            const chunk = allImages.slice(i, i + chunkSize);
            
            const response = await fetch(`${inferenceUrl}/score`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images: chunk })
            });

            if (!response.ok) {
                throw new Error(`Inference server returned ${response.status}`);
            }

            const inferenceData = await response.json();
            const results = inferenceData.results || [];
            allResults = allResults.concat(results);

            res.write(`data: ${JSON.stringify({ type: 'progress', current: Math.min(i + chunkSize, allImages.length), total: allImages.length })}\n\n`);
        }

        // Cache results unconditionally
        queries.upsertInferenceResult.run(cacheKey, JSON.stringify(allResults));

        // Sort by score
        allResults.sort((a, b) => (b.score || b.normalized || 0) - (a.score || a.normalized || 0));

        res.write(`data: ${JSON.stringify({ type: 'done', results: allResults, total: allImages.length })}\n\n`);
        res.end();
        console.log(`   ✅ Scored ${allResults.length} images for ${performer}`);
    } catch (err) {
        console.error('Inference error:', err);
        res.write(`data: ${JSON.stringify({ error: `Inference failed: ${err.message}. Is the inference server running at ${inferenceUrl}?` })}\n\n`);
        res.end();
    }
});

// Run inference on folder
app.post('/api/run-inference-folder', async (req, res) => {
    const { folderPath } = req.body;

    if (!folderPath || !fs.existsSync(folderPath)) {
        return res.status(400).json({ error: 'Invalid folder path' });
    }

    const imageFiles = fs.readdirSync(folderPath)
        .filter(f => config.imageExtensions.includes(path.extname(f).toLowerCase()))
        .map(f => path.join(folderPath, f));

    if (imageFiles.length === 0) {
        return res.status(400).json({ error: 'No images found in folder' });
    }

    const inferenceUrl = queries.getSetting.get('inferenceServerUrl')?.value || config.inferenceServerUrl;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify({ type: 'start', total: imageFiles.length })}\n\n`);

    const fetch = require('node-fetch');
    const chunkSize = 32;
    let allResults = [];

    try {
        for (let i = 0; i < imageFiles.length; i += chunkSize) {
            const chunk = imageFiles.slice(i, i + chunkSize);
            
            const response = await fetch(`${inferenceUrl}/score`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images: chunk })
            });

            if (!response.ok) {
                throw new Error(`Inference server returned ${response.status}`);
            }

            const inferenceData = await response.json();
            const results = inferenceData.results || [];
            allResults = allResults.concat(results);

            res.write(`data: ${JSON.stringify({ type: 'progress', current: Math.min(i + chunkSize, imageFiles.length), total: imageFiles.length })}\n\n`);
        }

        allResults.sort((a, b) => (b.score || b.normalized || 0) - (a.score || a.normalized || 0));

        res.write(`data: ${JSON.stringify({ type: 'done', results: allResults, total: imageFiles.length })}\n\n`);
        res.end();
    } catch (err) {
        console.error('Inference error:', err);
        res.write(`data: ${JSON.stringify({ error: `Inference failed: ${err.message}. Is the inference server running at ${inferenceUrl}?` })}\n\n`);
        res.end();
    }
});

// Generate auto-label proposals
app.post('/api/predict-proposals', async (req, res) => {
    const { performers, count = 50, model } = req.body;
    const inferenceUrl = queries.getSetting.get('inferenceServerUrl')?.value || config.inferenceServerUrl;

    if (!performers || performers.length === 0) {
        return res.status(400).json({ error: 'No performers selected' });
    }

    try {
        // 1. Gather candidate images
        let candidates = [];
        for (const perfName of performers) {
            // Get all images for this performer
            const perfData = imageCache.performers[perfName];
            if (!perfData) continue;
            
            const images = [...perfData.keep, ...perfData.delete];
            if (images.length === 0) continue;

            // Pick random subset (e.g. 2x requested count to ensure enough high-conf pairs)
            // If selecting multiple performers, distribute count? 
            // Simple approach: Take random 100 images per performer max
            const shuffled = [...images].sort(() => 0.5 - Math.random());
            candidates.push(...shuffled.slice(0, Math.min(100, count * 2 / performers.length)));
        }

        // Limit total to avoid huge inference payload
        if (candidates.length > 200) {
            candidates = candidates.sort(() => 0.5 - Math.random()).slice(0, 200);
        }

        if (candidates.length < 2) {
            return res.json({ success: true, proposals: [] });
        }

        // 2. Score images
        const response = await fetch(`${inferenceUrl}/score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: candidates, model })
        });

        if (!response.ok) {
            throw new Error(`Inference server error: ${response.status}`);
        }

        const data = await response.json();
        const scoredImages = data.results || [];

        // Map path back to score object for easy lookup
        const scoreMap = new Map();
        scoredImages.forEach(item => scoreMap.set(item.path, item.score));

        // 3. Generate Pairs
        const proposals = [];
        const used = new Set();

        // Strategy: Random Pairs from the scored set
        // We want to find High Confidence pairs (Large score diff)

        // Shuffle candidates again to ensure random pairing
        const pool = [...candidates].sort(() => 0.5 - Math.random());

        for (let i = 0; i < pool.length - 1; i += 2) {
            const pathA = pool[i];
            const pathB = pool[i + 1];

            const scoreA = scoreMap.get(pathA);
            const scoreB = scoreMap.get(pathB);

            if (scoreA === undefined || scoreB === undefined) continue;

            const diff = scoreA - scoreB;
            const absDiff = Math.abs(diff);

            // "Confidence" is the score difference
            // We propose the winner based on score

            proposals.push({
                left: { path: pathA, score: scoreA },
                right: { path: pathB, score: scoreB },
                winner: diff > 0 ? 'left' : 'right',
                confidence: absDiff
            });
        }

        // Sort by confidence (highest first - easier to verify obvious ones)
        proposals.sort((a, b) => b.confidence - a.confidence);

        res.json({ success: true, proposals });

    } catch (err) {
        console.error('Proposal generation failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// Execute filter by moving rejected images to 'deleted keep for training'
app.post('/api/execute-filter', async (req, res) => {
    const { performerName, deletePaths } = req.body;
    
    if (!performerName || !Array.isArray(deletePaths)) {
        return res.status(400).json({ error: 'Missing performerName or deletePaths array' });
    }

    try {
        const basePath = imageCache.basePath || config.basePath;
        const fsExtra = require('fs-extra');
        
        let movedCount = 0;
        let failedCount = 0;

        // Path where rejected images go
        const targetDir = path.join(basePath, 'deleted keep for training', performerName, 'pics');
        await fsExtra.ensureDir(targetDir);

        for (const sourcePath of deletePaths) {
            try {
                if (fs.existsSync(sourcePath)) {
                    const fileName = path.basename(sourcePath);
                    let destPath = path.join(targetDir, fileName);
                    
                    // Handle collisions
                    if (fs.existsSync(destPath)) {
                        const ext = path.extname(fileName);
                        const nameWithoutExt = path.basename(fileName, ext);
                        destPath = path.join(targetDir, `${nameWithoutExt}_${Date.now()}${ext}`);
                    }
                    
                    await fsExtra.move(sourcePath, destPath, { overwrite: false });
                    movedCount++;
                } else {
                    failedCount++;
                }
            } catch (moveErr) {
                console.error(`Failed to move ${sourcePath}:`, moveErr);
                failedCount++;
            }
        }

        // Trigger a rescan so the cache updates
        scanPerformerFolders();

        res.json({ 
            success: true, 
            moved: movedCount, 
            failed: failedCount 
        });

    } catch (err) {
        console.error('Filter execution failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// List available models
app.get('/api/models', (req, res) => {
    const modelsDir = path.join(__dirname, 'models');
    const pythonModelsDir = path.join(__dirname, 'python', 'output_dinov2');

    const models = [];

    // Scan local models folder
    if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir);
        for (const file of files) {
            if (file.endsWith('.pt') || file.endsWith('.pth')) {
                const stat = fs.statSync(path.join(modelsDir, file));
                models.push({
                    name: file,
                    path: path.join(modelsDir, file),
                    size: stat.size,
                    modified: stat.mtime,
                    location: 'models/'
                });
            }
        }
    }

    // Scan python output folder
    if (fs.existsSync(pythonModelsDir)) {
        const files = fs.readdirSync(pythonModelsDir);
        for (const file of files) {
            if (file.endsWith('.pt') || file.endsWith('.pth')) {
                const stat = fs.statSync(path.join(pythonModelsDir, file));
                models.push({
                    name: file,
                    path: path.join(pythonModelsDir, file),
                    size: stat.size,
                    modified: stat.mtime,
                    location: 'python/output_dinov2/'
                });
            }
        }
    }

    // Also check the original vision-llm-pairwise folder
    const origModelsDir = path.join(config.mainAppBasePath, 'extra', 'vision-llm-pairwise', 'output_dinov2');
    if (fs.existsSync(origModelsDir)) {
        const files = fs.readdirSync(origModelsDir);
        for (const file of files) {
            if (file.endsWith('.pt') || file.endsWith('.pth')) {
                const stat = fs.statSync(path.join(origModelsDir, file));
                models.push({
                    name: file,
                    path: path.join(origModelsDir, file),
                    size: stat.size,
                    modified: stat.mtime,
                    location: 'extra/vision-llm-pairwise/output_dinov2/'
                });
            }
        }
    }

    res.json({
        models,
        count: models.length,
        activeModel: queries.getSetting.get('activeModel')?.value || null
    });
});

// Check inference server health
app.get('/api/inference-health', async (req, res) => {
    const inferenceUrl = queries.getSetting.get('inferenceServerUrl')?.value || config.inferenceServerUrl;

    try {
        const fetch = require('node-fetch');
        const response = await fetch(`${inferenceUrl}/health`, { timeout: 5000 });

        if (response.ok) {
            const data = await response.json();
            res.json({
                online: true,
                url: inferenceUrl,
                ...data
            });
        } else {
            res.json({ online: false, url: inferenceUrl, error: 'Server returned error' });
        }
    } catch (err) {
        res.json({ online: false, url: inferenceUrl, error: err.message });
    }
});

// Serve images
app.get('/api/image', (req, res) => {
    const imagePath = req.query.path;

    // console.log(`📸 Image request: ${imagePath} from ${req.ip}`);

    if (!imagePath || !fs.existsSync(imagePath)) {
        console.error(`❌ Image not found: ${imagePath}`);
        return res.status(404).json({ error: 'Image not found' });
    }

    res.sendFile(imagePath, (err) => {
        if (err) {
            console.error(`❌ Error sending file ${imagePath}:`, err);
            if (!res.headersSent) {
                res.status(500).send('Error sending file');
            }
        }
    });
});

// ─── Binary Server Proxy Endpoints ───────────────────────────────────────────
const BINARY_URL = 'http://localhost:3345';

app.get('/api/binary-health', async (req, res) => {
    try {
        const fetch = require('node-fetch');
        const r = await fetch(`${BINARY_URL}/health`);
        const data = await r.json();
        res.json(data);
    } catch (err) {
        res.json({ online: false, model_loaded: false, error: err.message });
    }
});

app.post('/api/load-binary-model', async (req, res) => {
    const { modelName } = req.body;
    if (!modelName) return res.status(400).json({ error: 'Model name required' });
    try {
        const fetch = require('node-fetch');
        const r = await fetch(`${BINARY_URL}/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: modelName })
        });
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (err) {
        res.status(503).json({ error: `Binary server not reachable: ${err.message}` });
    }
});
// ─── End Binary Server Proxy ───────────────────────────────────────────────

// Load model on inference server
app.post('/api/load-model', async (req, res) => {

    const { modelName } = req.body;
    const inferenceUrl = queries.getSetting.get('inferenceServerUrl')?.value || config.inferenceServerUrl;

    if (!modelName) {
        return res.status(400).json({ error: 'Model name required' });
    }

    try {
        const fetch = require('node-fetch');
        const response = await fetch(`${inferenceUrl}/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: modelName })
        });

        const data = await response.json();

        if (response.ok) {
            res.json(data);
        } else {
            res.status(response.status).json(data);
        }
    } catch (err) {
        console.error('Error loading model:', err);
        res.status(500).json({ error: 'Failed to contact inference server' });
    }
});

// Start server
const PORT = config.port;

scanPerformerFolders().then(() => {
    // Helper to get batch predictions
    async function predictPairs(pairs, modelName) {
        return new Promise((resolve, reject) => {
            const inferenceUrl = config.inferenceServerUrl || 'http://localhost:5000';

            // Prepare payload: list of {left: path, right: path}
            const payload = {
                pairs: pairs.map(p => ({ left: p.left, right: p.right })),
                model: modelName
            };

            fetch(`${inferenceUrl}/predict_batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => res.json())
                .then(data => {
                    if (data.error) reject(new Error(data.error));
                    else resolve(data.results); // Expecting array of {score_left, score_right}
                })
                .catch(err => reject(err));
        });
    }

    // Active Learning: Get "Hard Pairs" for refinement
    app.post('/api/refine-performer', async (req, res) => {
        const { performerName, modelName } = req.body;

        if (!performerName || !modelName) {
            return res.status(400).json({ error: 'Missing performer or model' });
        }

        try {
            const perf = imageCache.performers[performerName];
            if (!perf) return res.status(404).json({ error: 'Performer not found' });

            const allImages = [...perf.keep, ...perf.delete];
            if (allImages.length < 2) return res.json({ pairs: [] });

            // 1. Generate Candidate Pairs (Intra + Inter)
            // We take Top 10 + Random 10 images
            const scores = allImages.map(img => ({ path: img, score: getImageScore(img).score })).sort((a, b) => b.score - a.score);
            const topImages = scores.slice(0, 10).map(s => s.path);
            const randomImages = scores.slice(10).sort(() => 0.5 - Math.random()).slice(0, 10).map(s => s.path);
            const candidates = [...new Set([...topImages, ...randomImages])];

            let pairsToCheck = [];

            // Intra-pairs
            for (let i = 0; i < candidates.length; i++) {
                for (let j = i + 1; j < candidates.length; j++) {
                    pairsToCheck.push({ left: candidates[i], right: candidates[j], type: 'intra' });
                }
            }

            // Limit to 100 candidates to keep it fast
            pairsToCheck = pairsToCheck.sort(() => 0.5 - Math.random()).slice(0, 100);

            // 2. Run Inference
            const predictions = await predictPairs(pairsToCheck, modelName);

            // 3. Filter for "Hard Pairs"
            const hardPairs = [];

            for (let i = 0; i < pairsToCheck.length; i++) {
                const p = pairsToCheck[i];
                const pred = predictions[i]; // {score_left: 0.55, score_right: 0.45}

                // Check Uncertainty (Scores consistenly close)
                const margin = Math.abs(pred.score_left - pred.score_right);
                const isUncertain = margin < 0.15; // < 15% difference

                // Check Disagreement (if we have real scores)
                const realScoreLeft = getImageScore(p.left).score;
                const realScoreRight = getImageScore(p.right).score;
                // Model says Left > Right, but Real says Right > Left (by a margin)
                const modelWinner = pred.score_left > pred.score_right ? 'left' : 'right';
                const realWinner = realScoreLeft > realScoreRight ? 'left' : 'right';
                const hasDisagreement = (Math.abs(realScoreLeft - realScoreRight) > 10) && (modelWinner !== realWinner);

                if (isUncertain || hasDisagreement) {
                    hardPairs.push({
                        ...p,
                        modelConfidence: margin,
                        reason: hasDisagreement ? 'Disagreement' : 'Uncertainty'
                    });
                }
            }

            // Return Top 20 Hardest
            res.json({
                pairs: hardPairs.slice(0, 20).map(p => ({
                    id: uuidv4(),
                    left: p.left,
                    right: p.right,
                    type: 'refine',
                    performer: performerName,
                    reason: p.reason
                }))
            });

        } catch (err) {
            console.error('Refine error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🎯 Pairwise Labeler Server running on http://localhost:${PORT}`);
        console.log(`   Health: http://localhost:${PORT}/api/health`);
        console.log(`   Status: http://localhost:${PORT}/api/status\n`);
    });
});
