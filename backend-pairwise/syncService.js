const fs = require('fs');
const path = require('path');
const sqlite = require('better-sqlite3');
const { db, queries } = require('./db');
const config = require('./config');

const mainDbPath = path.join(config.mainAppBasePath, 'backend', 'app.db');

class SyncService {
    constructor() {
        this.mainDb = null;
    }

    connect() {
        if (!fs.existsSync(mainDbPath)) {
            console.warn('⚠️ Main DB not found at:', mainDbPath);
            return false;
        }
        try {
            this.mainDb = sqlite(mainDbPath, { readonly: true });
            return true;
        } catch (err) {
            console.error('❌ Failed to connect to Main DB:', err);
            return false;
        }
    }

    sync() {
        if (!this.connect()) return;

        console.log('🔄 Syncing with Main DB...');

        try {
            // Get all performers from Main DB
            // Assuming table 'performers' has 'id' and 'name'
            const mainPerformers = this.mainDb.prepare('SELECT id, name FROM performers').all();

            let renames = 0;
            let newLinks = 0;

            db.transaction(() => {
                for (const p of mainPerformers) {
                    const link = queries.getLink.get(p.id);

                    if (link) {
                        // Link exists, check for rename
                        if (link.name !== p.name) {
                            console.log(`📝 Rename detected: "${link.name}" -> "${p.name}"`);
                            this.handleRename(link.name, p.name);
                            renames++;
                        }
                    } else {
                        // New link
                        queries.upsertLink.run(p.id, p.name);
                        newLinks++;
                    }

                    // Always update link to be sure
                    if (link && link.name !== p.name) {
                        queries.upsertLink.run(p.id, p.name);
                    }
                }
            })();

            console.log(`✅ Sync complete: ${newLinks} new links, ${renames} renames processed.`);

        } catch (err) {
            console.error('❌ Error during sync:', err);
        } finally {
            if (this.mainDb) this.mainDb.close();
        }
    }

    handleRename(oldName, newName) {
        console.log(`   Fixing DB records for ${oldName}...`);

        // Update pairs (winner/loser paths and performer column)
        const allPairs = queries.getAllPairs.all();
        let pairUpdates = 0;

        for (const pair of allPairs) {
            let changed = false;
            let w = pair.winner;
            let l = pair.loser;
            let p = pair.performer;

            // Simple string replacement in paths
            // Assumes path structure contains folder name
            if (w.includes(`/${oldName}/`) || w.includes(`\\${oldName}\\`)) {
                w = w.replace(new RegExp(`[\\/\\\\]${oldName}[\\/\\\\]`), `${path.sep}${newName}${path.sep}`);
                changed = true;
            }
            if (l.includes(`/${oldName}/`) || l.includes(`\\${oldName}\\`)) {
                l = l.replace(new RegExp(`[\\/\\\\]${oldName}[\\/\\\\]`), `${path.sep}${newName}${path.sep}`);
                changed = true;
            }

            if (p === oldName) {
                p = newName;
                changed = true;
            } else if (p.includes(oldName)) {
                // e.g. "OldName vs Other"
                p = p.replace(oldName, newName);
                changed = true;
            }

            if (changed) {
                // Direct update query needed as proper API doesn't expose ID-based update
                db.prepare('UPDATE pairs SET winner = ?, loser = ?, performer = ? WHERE id = ?')
                    .run(w, l, p, pair.id);
                pairUpdates++;
            }
        }

        // Update image_scores
        // We have to iterate and replace paths
        const scores = queries.getAllScores.all();
        let scoreUpdates = 0;

        for (const s of scores) {
            if (s.path.includes(`/${oldName}/`) || s.path.includes(`\\${oldName}\\`)) {
                const newPath = s.path.replace(new RegExp(`[\\/\\\\]${oldName}[\\/\\\\]`), `${path.sep}${newName}${path.sep}`);

                // Delete old, insert new (to handle primary key change)
                db.prepare('DELETE FROM image_scores WHERE path = ?').run(s.path);
                queries.upsertScore.run(newPath, s.score, s.comparisons);
                scoreUpdates++;
            }
        }

        // Update inference_results
        const inf = queries.getInferenceResult.get(oldName);
        if (inf) {
            db.prepare('DELETE FROM inference_results WHERE performer = ?').run(oldName);
            queries.upsertInferenceResult.run(newName, inf.data);
        }

        console.log(`   Updated ${pairUpdates} pairs and ${scoreUpdates} scores.`);
    }

    // Helper to fix paths if files moved between folders (e.g. Training -> After)
    fixMovedFiles(basePath, afterFolder, trainingFolder) {
        console.log('🔧 Checking for moved files...');
        const scores = queries.getAllScores.all();
        let updates = 0;

        const updatePath = (oldPath, newPath, table, id) => {
            if (table === 'scores') {
                const s = queries.getScore.get(oldPath);
                if (s) {
                    db.prepare('DELETE FROM image_scores WHERE path = ?').run(oldPath);
                    queries.upsertScore.run(newPath, s.score, s.comparisons);
                }
            }
            // For pairs, we'd need to iterate again. For now, we assume simple folder swaps.
        };

        // Strategy: Check if file missing. If so, check other location.
        for (const s of scores) {
            if (!fs.existsSync(s.path)) {
                // Try swap
                let newPath = s.path;
                if (s.path.includes(afterFolder)) {
                    newPath = s.path.replace(afterFolder, trainingFolder);
                } else if (s.path.includes(trainingFolder)) {
                    newPath = s.path.replace(trainingFolder, afterFolder);
                }

                if (newPath !== s.path && fs.existsSync(newPath)) {
                    // Found it! Update DB
                    updatePath(s.path, newPath, 'scores');
                    updates++;

                    // Also update any pairs using this path
                    db.prepare('UPDATE pairs SET winner = ? WHERE winner = ?').run(newPath, s.path);
                    db.prepare('UPDATE pairs SET loser = ? WHERE loser = ?').run(newPath, s.path);
                }
            }
        }

        if (updates > 0) console.log(`   Fixed ${updates} moved files.`);
    }
}

module.exports = new SyncService();
