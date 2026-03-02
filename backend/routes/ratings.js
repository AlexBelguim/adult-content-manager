const express = require('express');
const router = express.Router();
const db = require('../db');

const selectRatingStmt = db.prepare(`
  SELECT video_rating AS videoRating, funscript_rating AS funscriptRating
  FROM file_ratings
  WHERE file_path = ?
`);

const upsertRatingStmt = db.prepare(`
  INSERT INTO file_ratings (file_path, video_rating, funscript_rating, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(file_path) DO UPDATE SET
    video_rating = excluded.video_rating,
    funscript_rating = excluded.funscript_rating,
    updated_at = CURRENT_TIMESTAMP
`);

function normalizeRating(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Rating must be a number');
  }
  if (parsed < 0 || parsed > 5) {
    throw new Error('Rating must be between 0 and 5');
  }
  return Math.round(parsed * 2) / 2;
}

router.get('/', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).send({ error: 'path query parameter is required' });
    }

    const rating = selectRatingStmt.get(filePath);
    res.send({
      filePath,
      videoRating: rating ? rating.videoRating : null,
      funscriptRating: rating ? rating.funscriptRating : null,
    });
  } catch (error) {
    console.error('Failed to fetch rating:', error);
    res.status(500).send({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { filePath, videoRating, funscriptRating } = req.body;
    if (!filePath) {
      return res.status(400).send({ error: 'filePath is required' });
    }

    if (videoRating === undefined && funscriptRating === undefined) {
      return res.status(400).send({ error: 'Provide at least one rating value to update' });
    }

    const existing = selectRatingStmt.get(filePath) || {};

    let nextVideoRating = existing.videoRating ?? null;
    let nextFunscriptRating = existing.funscriptRating ?? null;

    if (videoRating !== undefined) {
      nextVideoRating = normalizeRating(videoRating);
    }
    if (funscriptRating !== undefined) {
      nextFunscriptRating = normalizeRating(funscriptRating);
    }

    upsertRatingStmt.run(filePath, nextVideoRating, nextFunscriptRating);

    res.send({
      success: true,
      filePath,
      videoRating: nextVideoRating,
      funscriptRating: nextFunscriptRating,
    });
  } catch (error) {
    console.error('Failed to save rating:', error);
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
