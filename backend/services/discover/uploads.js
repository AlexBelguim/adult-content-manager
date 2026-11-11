/**
 * Uploads (the Upload tab): pictures, or folders of them, added by hand and judged by the P model right away. Kept in
 * cache/uploads/<id>/ and discover_uploads until removed. An entry is either
 *   - a performer: her pictures judged together (as P judges a performer's gallery), each picture's own score kept too;
 *   - a picture: one image judged alone.
 * A performer can be split into pictures, and entries merged into one performer. Send puts her on the profile page as
 * undecided (events.js, event "upload"), or with a verdict: keep / delete, or by the line (keep at or above it, delete
 * below); Remove only takes the entry and its files away.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE, rel, abs } = require('./paths');
const { createJudge } = require('./judge');
const { uploadPayload } = require('./events');
const store = require('./store');

const PICTURE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const newUploadId = () => `u${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const uploadDir = (id) => path.join(CACHE, 'uploads', id);

// One for all uploads: it remembers who is away, so a hanging acm-gpu costs one timeout and not one per picture
const judger = createJudge({ why: 'Discover upload' });

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

/** Move an entry's pictures into another entry's folder (merge, split); returns the moved file records. A file no longer on disk is left out. */
function moveFiles(files, toId) {
  const dir = uploadDir(toId);
  fs.mkdirSync(dir, { recursive: true });
  return files.filter((f) => f?.file && fs.existsSync(abs(f.file))).map((f, i) => {
    const target = path.join(dir, `${Date.now().toString(36)}-${i}-${crypto.randomBytes(3).toString('hex')}${path.extname(f.file)}`);   // never two alike: merged entries move in the same millisecond
    fs.renameSync(abs(f.file), target);
    return { ...f, file: rel(target) };
  });
}

/** A send refused: status for the route, reason for a bulk answer ('no pictures', 'no name', 'unscored', 'already sent') */
const refused = (status, reason, message) => Object.assign(new Error(message), { status, reason });

/** The verdict a send gives: none (undecided), keep or delete as asked, or by the line ('auto'), which needs a score */
function verdictOf(u, verdict, line) {
  if (verdict == null || verdict === '' || verdict === 'undecided') return null;
  if (verdict === 'keep' || verdict === 'delete') return verdict;
  if (verdict !== 'auto') throw refused(400, 'bad verdict', 'verdict: keep, delete or auto');
  if (u.score == null) throw refused(400, 'unscored', 'no score yet: judge it first');
  return u.score >= line ? 'keep' : 'delete';
}

/**
 * Send an entry to the profile page under the name given or its own, with a verdict or undecided; once per set of pictures,
 * whatever the verdict. Returns { upload, verdict }; a refusal throws with its status and reason.
 */
function send(u, { name, verdict } = {}) {
  if (!u.files.length) throw refused(400, 'no pictures', 'no pictures yet');
  const named = { ...u, name: String(name || '').trim().slice(0, 200) || u.name };
  if (!named.name) throw refused(400, 'no name', 'name: her name is needed to send');
  const given = verdictOf(u, verdict, store.setting('threshold', 50));
  store.saveUpload(named);
  const pictures = crypto.createHash('sha1').update(u.files.map((f) => f.file).join('\n')).digest('hex');
  if (store.enqueue('upload', `upload:${u.id}:${pictures}`, uploadPayload(named, given)) == null) throw refused(409, 'already sent', 'already sent with these pictures');
  store.saveUpload({ ...named, sent_at: new Date().toISOString() });
  return { upload: store.upload(u.id), verdict: given };
}

/** Refused while its "upload" event waits: the profile page reads her pictures from this entry's folder when it applies it */
function notSending(id) {
  if (store.uploadSending(id)) throw refused(409, 'sending', 'still on its way to the profile page: try again once it is there');
}

/** Remove: the entry and its files; nothing goes anywhere. Refused (409, 'sending') while a send of it waits. */
function remove(id) {
  notSending(id);
  fs.rmSync(uploadDir(id), { recursive: true, force: true });
  store.deleteUpload(id);
}

module.exports = { PICTURE_TYPES, MAX_UPLOAD_BYTES, newUploadId, uploadDir, judge, moveFiles, send, remove, notSending };
