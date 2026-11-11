/**
 * Settings → System: local numbers only (uptime, Node, memory, database size, schema and row counts) and a restart.
 * Nothing here reaches the internet; the license endpoints are removed.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const config = require('../config');

const SERVER_START_TIME = Date.now();
const inDocker = () => fs.existsSync('/.dockerenv');

const fileBytes = (p) => {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
};

const TABLES = ['performers', 'filter_actions', 'video_scenes', 'exported_files', 'tags', 'file_tags', 'content_genres', 'performer_file_hashes', 'encode_jobs'];

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  try {
    const memory = process.memoryUsage();
    let schema = null;
    try {
      schema = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    } catch (e) {
      schema = null;
    }

    const tables = [];
    for (const name of TABLES) {
      try {
        const row = { name, rows: db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n };
        if (name === 'filter_actions') {
          row.detail = {};
          for (const r of db.prepare('SELECT action, COUNT(*) AS n FROM filter_actions GROUP BY action').all()) {
            row.detail[r.action ?? 'none'] = r.n;
          }
        }
        tables.push(row);
      } catch (e) {
        // a table this database does not have is left out
      }
    }

    res.json({
      startedAt: new Date(SERVER_START_TIME).toISOString(),
      uptimeMs: Date.now() - SERVER_START_TIME,
      node: process.version,
      platform: process.platform,
      docker: inDocker(),
      memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
      database: {
        file: path.basename(config.dbPath),
        bytes: fileBytes(config.dbPath) + fileBytes(`${config.dbPath}-wal`),
        schema,
        tables
      }
    });
  } catch (err) {
    console.error('[admin] stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/restart { confirm: 'restart' }: the process exits 1 s after the answer; Docker (restart policy)
// or the worker node starts it again. Outside Docker nothing may start it again: the page says Stop server.
router.post('/restart', (req, res) => {
  if (req.body?.confirm !== 'restart') {
    return res.status(400).json({ error: 'Send { confirm: "restart" }' });
  }
  const docker = inDocker();
  console.log('[admin] Restart requested: the process exits in 1 s');
  res.json({ ok: true, docker });
  setTimeout(() => process.exit(0), 1000);
});

module.exports = router;
