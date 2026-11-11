const express = require('express');
const router = express.Router();
const fileTrash = require('../services/fileTrash');

function sendTrashError(res, err) {
  if (err instanceof fileTrash.TrashError) {
    return res.status(err.status).send({ error: err.message, results: err.results || undefined });
  }
  console.error('Funscript route failed:', err);
  return res.status(500).send({ error: err.message });
}

// The funscripts of a video: <base>.funscript and <base>.<axis>.funscript beside it, main script first
router.get('/', async (req, res) => {
  const { file } = req.query;
  if (!file || typeof file !== 'string') {
    return res.status(400).send({ error: 'File parameter required' });
  }
  try {
    res.send({ funscripts: await fileTrash.videoScripts(file) });
  } catch (err) {
    sendTrashError(res, err);
  }
});

// Moves one funscript to the .trash folder beside it: { scriptPath }
router.delete('/delete', async (req, res) => {
  try {
    res.send(await fileTrash.trashFunscript(req.body && req.body.scriptPath));
  } catch (err) {
    sendTrashError(res, err);
  }
});

module.exports = router;
