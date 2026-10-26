/**
 * Migration 014 — labelmaster's scenes and tag rules
 *
 * video_labels: one row per video scenetest has labelled, as it sends them: the scenes (activity group, detail,
 * sex position, who she is with, dress) and the dress-state lane, both JSON.
 * tag_rules: what an existing tag (content folder) means in labelmaster's terms, so labelled videos get it
 * by themselves. file_tags.source = 'labelmaster' marks the tags a rule set; auto_tag_dismissed remembers the
 * ones taken off by hand, so the rule never sets them again. Ridding gets its rule here (riding ≥ 10 %).
 */
module.exports = {
  version: 14,
  name: 'video_labels_and_tag_rules',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_labels (
        file_path  TEXT PRIMARY KEY,
        seconds    REAL NOT NULL,
        model      TEXT,
        scenes     TEXT NOT NULL,
        exposure   TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tag_rules (
        tag       TEXT PRIMARY KEY,
        terms     TEXT NOT NULL,
        min_share REAL NOT NULL DEFAULT 0.1
      );

      CREATE TABLE IF NOT EXISTS auto_tag_dismissed (
        file_path TEXT NOT NULL,
        tag       TEXT NOT NULL,
        PRIMARY KEY (file_path, tag)
      );

      ALTER TABLE file_tags ADD COLUMN source TEXT;

      INSERT OR IGNORE INTO tag_rules (tag, terms, min_share)
        VALUES ('Ridding', '["cowgirl","reverse_cowgirl","riding_toy"]', 0.1);
    `);
  }
};
