/**
 * Migration 016 — re-encoding for space (Settings → Space)
 *
 * media_probe: every video in the library (before / after filter performer, content), what ffprobe says about it —
 * codec, bitrate, fps, bit depth, height, length and its tracks — keyed by path, good while size and mtime match.
 * Filled by a background scan (services/mediaProbe.js); the Space page and the queue only ever read it.
 *
 * encode_jobs (004) becomes a real queue (services/encodeQueue.js): what the job is for (kind, plan, why), its place
 * (priority, position), who has it and how far (worker, phase, progress, speed, heartbeat), a pause (hold / held),
 * which file it was made from (src_fp) and where the original is held for 14 days (held_path, held_until) with the
 * new file's place and fingerprint (out_path, out_fp) for Undo. Times are ms. Status: queued | running | done |
 * failed | skipped | undone.
 *
 * encode_workers: machines that encode for this app over HTTP with a link of their own (routes/workers.js, Hikari's
 * worker protocol); only the token's hash is kept.
 */
module.exports = {
  version: 16,
  name: 'space_reencode',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_probe (
        path          TEXT PRIMARY KEY,
        size          INTEGER NOT NULL,
        mtime         INTEGER NOT NULL,
        probed_at     INTEGER,
        error         TEXT,
        container     TEXT,
        duration      REAL,
        width         INTEGER,
        height        INTEGER,
        bitrate       INTEGER,
        video_codec   TEXT,
        video_bitrate INTEGER,
        fps           REAL,
        bit_depth     INTEGER,
        pix_fmt       TEXT,
        streams       TEXT,
        seen_at       INTEGER
      );

      CREATE TABLE IF NOT EXISTS encode_workers (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        token_hash  TEXT NOT NULL UNIQUE,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        last_seen   INTEGER,
        info        TEXT
      );
    `);

    const have = new Set(db.prepare('PRAGMA table_info(encode_jobs)').all().map(c => c.name));
    const add = [
      ['kind', 'TEXT'], ['plan', 'TEXT'], ['label', 'TEXT'], ['position', 'INTEGER'],
      ['phase', 'TEXT'], ['progress', 'REAL'], ['speed', 'REAL'], ['heartbeat_at', 'INTEGER'],
      ['hold', 'TEXT'], ['held', 'INTEGER DEFAULT 0'], ['src_fp', 'TEXT'],
      ['out_path', 'TEXT'], ['out_fp', 'TEXT'], ['held_path', 'TEXT'], ['held_until', 'INTEGER']
    ];
    for (const [col, type] of add) {
      if (!have.has(col)) db.exec(`ALTER TABLE encode_jobs ADD COLUMN ${col} ${type}`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_encode_jobs_source ON encode_jobs(source_path)');

    // The estimate-only feature queued rows nothing ever ran. A video becomes a job of the real queue (planned again
    // when it's claimed, skipped when a re-encode wouldn't help); a picture to WebP isn't something the queue does.
    db.prepare("UPDATE encode_jobs SET status = 'queued', kind = 'space', position = id WHERE status = 'pending' AND target_format = 'h265'").run();
    db.prepare("UPDATE encode_jobs SET status = 'skipped', error_message = 'Pictures to WebP is not part of the re-encode queue' WHERE status = 'pending'").run();
    db.prepare("DELETE FROM encode_jobs WHERE status = 'cancelled'").run();
    db.prepare("UPDATE encode_jobs SET status = 'failed', error_message = COALESCE(error_message, 'Never ran') WHERE status = 'processing'").run();
    db.prepare("UPDATE encode_jobs SET status = 'done' WHERE status = 'completed'").run();

    // worker_mode: auto (this server encodes while no linked worker is online) | local (always) | remote (never)
    db.prepare("UPDATE encode_settings SET value = 'auto' WHERE key = 'worker_mode' AND value = 'local'").run();
    db.prepare("INSERT OR IGNORE INTO encode_settings (key, value) VALUES ('queue_running', '1')").run();
  }
};
