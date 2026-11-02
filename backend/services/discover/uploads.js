/**
 * Uploads (the Upload tab): pictures, or folders of them, added by hand and judged by the P model right away. Kept in
 * cache/uploads/<id>/ and discover_uploads until removed. An entry is either
 *   - a performer: her pictures judged together (as P judges a performer's gallery), each picture's own score kept too;
 *   - a picture: one image judged alone.
 * A performer can be split into pictures, and entries merged into one performer. Send puts her on the profile page as
 * undecided (events.js, event "upload"); Remove only takes the entry and its files away.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE, rel, abs } = require('./paths');
const { createJudge } = require('./judge');

const PICTURE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const newUploadId = () => `u${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const uploadDir = (id) => path.join(CACHE, 'uploads', id);

// One for all uploads: it remembers who is away, so a hanging acm-gpu costs one timeout and not one per picture
const judger = createJudge();

/** P's keep % for these pictures judged together, one decimal, as on the rest of the page */
async function scorePictures(files) {
  const answer = await judger.score(files.map(abs));
  return { score: Math.round(answer.score * 10) / 10, model: judger.file };
}

/**
 * Judge an entry: every picture alone, and a performer of several also on all of them together. A picture P cannot open keeps
 * its error and no score. When nobody can judge at all the error says waiting, and the entry stays as it was.
 */
async function judge(entry) {
  const files = [];
  let model = null;
  for (const f of entry.files) {
    try {
      const r = await scorePictures([f.file]);
      files.push({ ...f, score: r.score, error: null });
      model = r.model;
    } catch (err) {
      if (err.waiting) throw err;
      files.push({ ...f, score: null, error: err.message });
    }
  }
  const good = files.filter((f) => f.score != null);
  let score = good[0]?.score ?? null;
  if (entry.kind === 'performer' && good.length > 1) score = (await scorePictures(good.map((f) => f.file))).score;
  return { ...entry, files, score, model, scored_at: new Date().toISOString() };
}

/** Move an entry's pictures into another entry's folder (merge, split); returns the moved file records. */
function moveFiles(files, toId) {
  const dir = uploadDir(toId);
  fs.mkdirSync(dir, { recursive: true });
  return files.map((f, i) => {
    const target = path.join(dir, `${Date.now().toString(36)}-${i}-${crypto.randomBytes(3).toString('hex')}${path.extname(f.file)}`);   // never two alike: merged entries move in the same millisecond
    fs.renameSync(abs(f.file), target);
    return { ...f, file: rel(target) };
  });
}

module.exports = { PICTURE_TYPES, MAX_UPLOAD_BYTES, newUploadId, uploadDir, judge, moveFiles };
