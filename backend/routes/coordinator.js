/**
 * Settings → Coordinator (services/coordinator.js):
 *
 *   GET    /api/coordinator    { url, connected, worker, gpu: { url, node, online } }
 *   POST   /api/coordinator    { url }: connect (this app pairs itself with the coordinator at that address)
 *   DELETE /api/coordinator    disconnect
 */
const express = require('express');
const coordinator = require('../services/coordinator');
const { clearCache } = require('../utils/aiUrl');

const router = express.Router();
const handle = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

router.get('/', handle(() => coordinator.status()));
router.post('/', handle(async (req) => { const s = await coordinator.connect(req.body?.url, req); clearCache(); return s; }));
router.delete('/', handle(async (req) => { const s = await coordinator.disconnect(req); clearCache(); return s; }));

module.exports = router;
