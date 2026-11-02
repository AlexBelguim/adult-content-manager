/**
 * Migration 018 — Discover: the keep scanner comes into the app
 *
 * The scanner's results.db as tables of the app (services/discover/store.js). A post or profile is recorded once, by site
 * and id; image_path / image_paths are relative to <data>/discover/cache. waiting = 1: its pictures are saved but nobody
 * could judge them yet (the GPU PC off and the NAS's CPU service down), a later run does.
 *
 * discover_entries: a performer as the profile page knows her from Discover (services/discover/verdicts.js): a record of her own, or, when
 * merged_into is set, what Discover added to a record the page already had. library_id: she is a performer of the library, so she stays undecided here.
 */
module.exports = {
  version: 18,
  name: 'discover',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discover_posts (
        site            TEXT NOT NULL,
        post_id         TEXT NOT NULL,
        short_code      TEXT,
        title           TEXT,
        post_url        TEXT,
        share_url       TEXT,
        page_kind       TEXT,
        performer_name  TEXT,
        saved_link      TEXT,
        image_url       TEXT,
        image_path      TEXT,
        image_paths     TEXT,
        score           REAL,
        kept            INTEGER,
        skip_reason     TEXT,
        waiting         INTEGER NOT NULL DEFAULT 0,
        model           TEXT,
        info            TEXT,
        posted_at       TEXT,
        scanned_at      TEXT NOT NULL,
        PRIMARY KEY (site, post_id)
      );
      CREATE INDEX IF NOT EXISTS idx_discover_posts_waiting ON discover_posts (waiting) WHERE waiting = 1;

      CREATE TABLE IF NOT EXISTS discover_profiles (
        site            TEXT NOT NULL,
        profile_id      TEXT NOT NULL,
        name            TEXT,
        url             TEXT,
        image_url       TEXT,
        image_path      TEXT,
        image_paths     TEXT,
        score           REAL,
        kept            INTEGER,
        waiting         INTEGER NOT NULL DEFAULT 0,
        model           TEXT,
        judged_at       TEXT,
        scrape          TEXT,
        full            INTEGER,
        data_at         TEXT,
        PRIMARY KEY (site, profile_id)
      );

      CREATE TABLE IF NOT EXISTS discover_watcher_checks (
        watcher         TEXT PRIMARY KEY,
        checked_at      TEXT NOT NULL,
        found           INTEGER,
        error           TEXT
      );

      CREATE TABLE IF NOT EXISTS discover_performer_links (
        a               TEXT NOT NULL,
        b               TEXT NOT NULL,
        kind            TEXT NOT NULL,
        at              TEXT NOT NULL,
        PRIMARY KEY (a, b)
      );

      CREATE TABLE IF NOT EXISTS discover_performer_decisions (
        member          TEXT PRIMARY KEY,
        decision        TEXT NOT NULL,
        at              TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discover_performer_status (
        member          TEXT PRIMARY KEY,
        status          TEXT NOT NULL,
        at              TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discover_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe          TEXT UNIQUE,
        kind            TEXT NOT NULL,
        payload         TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        sent_at         TEXT,
        error           TEXT,
        answer          TEXT
      );

      CREATE TABLE IF NOT EXISTS discover_uploads (
        id              TEXT PRIMARY KEY,
        name            TEXT,
        kind            TEXT NOT NULL,
        files           TEXT NOT NULL,
        score           REAL,
        model           TEXT,
        created_at      TEXT NOT NULL,
        scored_at       TEXT,
        sent_at         TEXT
      );

      CREATE TABLE IF NOT EXISTS discover_settings (
        key             TEXT PRIMARY KEY,
        value           TEXT
      );

      CREATE TABLE IF NOT EXISTS discover_pool_scores (
        signature       TEXT PRIMARY KEY,
        score           REAL NOT NULL,
        images          INTEGER NOT NULL,
        model           TEXT,
        scored_at       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discover_backlog (
        site            TEXT PRIMARY KEY,
        cursor          TEXT,
        pages           INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT
      );

      CREATE TABLE IF NOT EXISTS discover_entries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        slug            TEXT NOT NULL UNIQUE,
        key             TEXT UNIQUE,
        origin          TEXT NOT NULL DEFAULT 'scanner',
        merged_into     TEXT,
        library_id      INTEGER,
        was_verdict     TEXT,
        name            TEXT,
        aliases         TEXT,
        links           TEXT,
        sources         TEXT,
        profile         TEXT,
        members         TEXT,
        pictures        TEXT,
        status          TEXT NOT NULL DEFAULT 'undecided',
        update_mark     TEXT,
        best_score      REAL,
        pool_score      REAL,
        decided_at      TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
    `);
  }
};
