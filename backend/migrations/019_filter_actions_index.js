/**
 * Migration 019 — an index for filter progress
 *
 * Filter progress reads each file's latest decision for a performer (filterService.decisionSummary), for every
 * performer in the filter list. filter_actions had no index, so each of those reads scanned the whole table.
 */
module.exports = {
  version: 19,
  name: 'filter_actions_index',

  up(db) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_filter_actions_performer_path ON filter_actions (performer_id, file_path, id)');
  }
};
