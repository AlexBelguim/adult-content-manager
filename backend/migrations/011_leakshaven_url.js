/**
 * Migration 011 — Leakhaven link and scrape source
 *
 * leakshaven_url: the performer's Leakhaven model page, set when a scrape from Leakhaven is
 * confirmed or a link is entered by hand. Update checks run only for performers that have one.
 * The older leakshaven_alias was set by any scrape, even when no page was found, so it is not used.
 *
 * scraped_source: the site the last confirmed scrape came from.
 */
module.exports = {
  version: 11,
  name: 'leakshaven_url',

  up(db) {
    db.exec(`
      ALTER TABLE performers ADD COLUMN leakshaven_url TEXT;
      ALTER TABLE performers ADD COLUMN scraped_source TEXT;
    `);
  }
};
