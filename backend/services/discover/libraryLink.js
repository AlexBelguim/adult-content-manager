/**
 * What the library does with a performer who was kept on Discover, told back to Discover. She is the library's performer
 * by name, the match the page shows as "in the library" (library.js: her names, full-name aliases, her Leakhaven link).
 *
 *   - moved to After: a Kept performer becomes Checked (kept and looked at: she leaves the Kept tab until she is found again);
 *   - deleted from the library by hand, folders and record: a Kept or Checked performer becomes Deleted, as Discover's own
 *     Delete button does it: the profile page and P's training hear a delete. Not when another library performer still
 *     has her name (a Before and an After record of the same performer).
 *
 * Only what was kept on Discover: an undecided performer is still to decide there, a deleted or removed one stays as she is.
 *
 *   const her = libraryLink.who(id);     // before the move or the delete, while her row is there
 *   …                                    // the move or the delete
 *   libraryLink.movedToAfter(her);       // or libraryLink.deleted(her): afterwards, once it went through
 *
 * Both work in the background and never throw: a failure here is logged, the library's own action stands.
 */
const { loadLibrary, libraryRow, normalize } = require('./library');
const { decide, sendQueued } = require('./events');
const { currentResults } = require('./scan');
const runner = require('./runner');

/** Who she is in the library, to hand to movedToAfter or deleted; null when there is no such performer */
const who = (performerId) => { try { return libraryRow(performerId); } catch { return null; } };

/** Discover's performers that are her, with one of these statuses; her row counts as in the library even when it just went */
function hers(her, statuses) {
  const name = normalize(her.name);
  return currentResults(loadLibrary({ plus: [her] })).everyone
    .filter((g) => statuses.includes(g.status) && (g.in_library_id === her.id || (g.in_library && normalize(g.in_library) === name)));
}

function movedToAfterNow(her) {
  const groups = hers(her, ['kept']);
  for (const g of groups) decide(g, 'checked');
  return groups;
}

function deletedNow(her) {
  const was = hers(her, ['kept', 'checked']);
  if (!was.length) return [];
  // as the library is now: one who is still in it under another record is not deleted
  const now = currentResults().everyone;
  const groups = was.map((g) => now.find((x) => x.id === g.id)).filter((g) => g && !g.in_library && ['kept', 'checked'].includes(g.status));
  for (const g of groups) decide(g, 'deleted');
  if (groups.length) sendQueued().catch(() => {});
  return groups;
}

/** Runs after the request that caused it has answered; resolves to the performers changed on Discover (the tests wait for it) */
const later = (label, fn) => (her) => new Promise((resolve) => {
  if (!her) return resolve([]);
  setImmediate(() => {
    let groups = [];
    try {
      groups = fn(her);
      if (groups.length) {
        runner.changed();
        console.log(`Discover: ${groups.map((g) => g.names[0]).join(', ')} set to ${label}: ${her.name} ${label === 'checked' ? 'moved to After' : 'deleted from the library'}`);
      }
    } catch (err) {
      console.warn(`Discover: could not set ${her.name} to ${label}: ${err.message}`);
    }
    resolve(groups);
  });
});

module.exports = { who, movedToAfter: later('checked', movedToAfterNow), deleted: later('deleted', deletedNow) };
