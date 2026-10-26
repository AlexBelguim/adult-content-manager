/**
 * Tag rules — the app's own tags (content folders) set from labelmaster's scenes.
 *
 * A rule names the scene terms a tag stands for (an activity group, a detail, a sex position, who she is with,
 * a dress state) and the share of the video they must cover. A labelled video gets every tag whose rule it
 * meets, marked file_tags.source = 'labelmaster'; a tag taken off by hand goes to auto_tag_dismissed and is
 * never set again. Tags without a rule are never touched.
 */
const db = require('../db');

/** The terms a rule can use, grouped as the folder maker shows them: [value, label]. */
const TERMS = {
  act: [['show', 'show'], ['foreplay', 'foreplay'], ['masturbation', 'masturbation'], ['toy', 'toy'], ['oral', 'oral'],
    ['cunnilingus', 'cunnilingus'], ['stroking', 'hands / feet / tits'], ['sex', 'sex']],
  detail: [['blowjob', 'blowjob'], ['face_sitting', 'face sitting'], ['handjob', 'handjob'], ['titjob', 'titjob'],
    ['footjob', 'footjob'], ['fingering', 'fingering'], ['rubbing', 'rubbing'], ['riding_toy', 'riding a toy'],
    ['toy_insertion', 'toy insertion'], ['vibrator', 'vibrator'], ['machine', 'machine']],
  position: [['cowgirl', 'cowgirl'], ['reverse_cowgirl', 'reverse cowgirl'], ['doggy', 'doggy'], ['missionary', 'missionary'],
    ['spooning', 'spooning'], ['standing', 'standing']],
  with: [['solo', 'solo'], ['MF', 'with a man'], ['FF', 'with a woman'], ['group', 'group']],
  dress: [['dressed', 'dressed'], ['underwear', 'underwear'], ['topless', 'topless'], ['bottomless', 'bottomless'], ['nude', 'nude']]
};
const DRESS = new Set(TERMS.dress.map(([v]) => v));

// a sex position only counts during sex or a toy ride, not in a show where she straddles the camera
const sceneTerms = (s) => [s.group, s.detail, ['sex', 'toy'].includes(s.group) ? s.position : null, s.cast];

/** Share (0–1) of the video covered by any of the terms: scenes for acts, details, positions and cast; the dress lane for dress. */
function share(labels, terms) {
  const spans = [
    ...labels.scenes.filter(s => terms.some(t => sceneTerms(s).includes(t))).map(s => [s.start, s.end]),
    ...labels.exposure.filter(([, , e]) => DRESS.has(e) && terms.includes(e)).map(([a, b]) => [a, b])
  ].sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    covered += b - Math.max(a, end);
    end = b;
  }
  return labels.seconds > 0 ? covered / labels.seconds : 0;
}

const parseLabels = (row) => row && { seconds: row.seconds, scenes: JSON.parse(row.scenes), exposure: JSON.parse(row.exposure) };
const rules = () => db.prepare('SELECT tag, terms, min_share FROM tag_rules').all().map(r => ({ ...r, terms: JSON.parse(r.terms) }));

const insertAuto = db.prepare(`
  INSERT INTO file_tags (file_path, tag, source)
  SELECT ?, ?, 'labelmaster'
  WHERE NOT EXISTS (SELECT 1 FROM auto_tag_dismissed WHERE file_path = ? AND tag = ?)
  ON CONFLICT(file_path, tag) DO NOTHING
`);

/** Give one labelled video the tags its scenes meet. Returns the tags added. */
function applyToFile(filePath) {
  const labels = parseLabels(db.prepare('SELECT seconds, scenes, exposure FROM video_labels WHERE file_path = ?').get(filePath));
  if (!labels) return [];
  return rules()
    .filter(r => share(labels, r.terms) >= r.min_share)
    .filter(r => insertAuto.run(filePath, r.tag, filePath, r.tag).changes > 0)
    .map(r => r.tag);
}

/** Run one rule over every labelled video (a new or changed rule). Returns how many videos got the tag. */
function applyRule(tag) {
  const rule = rules().find(r => r.tag === tag);
  if (!rule) return 0;
  const hits = db.prepare('SELECT file_path, seconds, scenes, exposure FROM video_labels').all()
    .filter(row => share(parseLabels(row), rule.terms) >= rule.min_share);
  let added = 0;
  db.transaction(() => {
    for (const row of hits) added += insertAuto.run(row.file_path, tag, row.file_path, tag).changes;
  })();
  return added;
}

/** How many labelled videos a rule would tag (the folder maker's live count). */
function countMatches(terms, minShare) {
  let n = 0;
  for (const row of db.prepare('SELECT seconds, scenes, exposure FROM video_labels').iterate()) {
    if (share(parseLabels(row), terms) >= minShare) n += 1;
  }
  return n;
}

module.exports = { TERMS, share, rules, applyToFile, applyRule, countMatches };
