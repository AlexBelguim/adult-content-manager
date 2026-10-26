/**
 * Pipelines — labels (labelmaster's scenes) and funscripts for whole performers or content folders, run by
 * scenetest on the GPU PC (services/scenetestService). The Jobs page shows the queue (routes/jobs.js) and
 * starts it from here.
 *
 * - GET  /api/pipelines/targets        — performers (with their video counts) and content folders to pick from
 * - POST /api/pipelines/preview        — { performerIds, folders, paths } → { videos, labelled }
 * - POST /api/pipelines/queue          — { performerIds, folders, paths, steps: ['labels', 'funscript'], skipDone };
 *                                        paths are single videos (the player's button), checked to be inside the library
 * - POST /api/pipelines/pause          — { on }: pause / resume scenetest's queue (the current video is put back)
 * - POST /api/pipelines/job/:id/:action — cancel (the running one) | remove | front | retry one job
 */
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const scenetest = require('../services/scenetestService');

const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts']);

/** Every video under dir, skipping hidden folders (.trash, .thumbnails, .cache). */
async function videosUnder(dir) {
  if (!await fs.pathExists(dir)) return [];
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await videosUnder(p));
    else if (VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/** A single video (the player's button): a video file that exists inside one of the library folders, else null. */
async function videoInLibrary(p, bases) {
  if (typeof p !== 'string' || !VIDEO_EXTS.has(path.extname(p).toLowerCase())) return null;
  const full = path.resolve(p);
  const inside = bases.some(b => full.startsWith(path.resolve(b) + path.sep));
  return inside && await fs.pathExists(full) ? p : null;
}

async function collect(performerIds = [], folders = [], paths = []) {
  const ids = performerIds.map(Number).filter(Number.isFinite);
  const performers = ids.length ? db.prepare(`
    SELECT p.name, p.moved_to_after, f.path AS base FROM performers p JOIN folders f ON f.id = p.folder_id
    WHERE p.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) : [];
  const bases = db.prepare('SELECT path FROM folders').all().map(f => f.path);
  const dirs = [
    ...performers.map(p => path.join(p.base, p.moved_to_after === 1 ? 'after filter performer' : 'before filter performer', p.name, 'vids')),
    ...bases.flatMap(b => folders.filter(g => g && !g.includes('..') && !/[\\/]/.test(g)).map(g => path.join(b, 'content', g)))
  ];
  const lists = await Promise.all(dirs.map(videosUnder));
  const singles = await Promise.all(paths.map(p => videoInLibrary(p, bases)));
  return [...new Set([...lists.flat(), ...singles.filter(Boolean)])];
}

router.get('/targets', async (req, res) => {
  const performers = db.prepare(`
    SELECT id, name, moved_to_after, vids_count FROM performers WHERE blacklisted IS NOT 1 AND vids_count > 0 ORDER BY name COLLATE NOCASE
  `).all().map(p => ({ id: p.id, name: p.name, where: p.moved_to_after === 1 ? 'after' : 'before', videos: p.vids_count }));
  const folders = new Set();
  for (const { path: base } of db.prepare('SELECT path FROM folders').all()) {
    const content = path.join(base, 'content');
    if (!await fs.pathExists(content)) continue;
    for (const e of await fs.readdir(content, { withFileTypes: true })) if (e.isDirectory()) folders.add(e.name);
  }
  res.json({ performers, folders: [...folders].sort((a, b) => a.localeCompare(b)) });
});

router.post('/preview', async (req, res) => {
  const videos = await collect(req.body.performerIds, req.body.folders, req.body.paths);
  const labelled = db.prepare('SELECT file_path FROM video_labels').all().map(r => r.file_path);
  const have = new Set(labelled);
  res.json({ videos: videos.length, labelled: videos.filter(v => have.has(v)).length });
});

router.post('/queue', async (req, res) => {
  const { performerIds, folders, paths, steps, skipDone = true } = req.body;
  const wanted = (steps || []).filter(s => s === 'labels' || s === 'funscript');
  if (!wanted.length) return res.status(400).json({ error: 'steps required: labels and/or funscript' });
  const videos = await collect(performerIds, folders, paths);
  if (!videos.length) return res.status(400).json({ error: 'No videos in the selection' });
  const r = await scenetest.queue(videos, wanted, skipDone);
  if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ success: true, videos: videos.length, labels: r.labels, funscript: r.funscript, missing: r.missing });
});

router.post('/pause', async (req, res) => {
  const r = await scenetest.pause(!!req.body.on);
  res.status(r.ok ? 200 : 502).json(r.ok ? { success: true } : { error: r.error });
});

router.post('/job/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  if (!['cancel', 'remove', 'front', 'retry'].includes(action)) return res.status(400).json({ error: 'action must be cancel, remove, front or retry' });
  const r = await scenetest.act(id, action);
  res.status(r.ok ? 200 : 502).json(r.ok ? { success: true } : { error: r.error });
});

module.exports = router;
