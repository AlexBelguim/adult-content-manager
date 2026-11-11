/**
 * What is decided on Discover and goes to the profile page: Keep / Delete, Put back on a kept or deleted performer (undecide),
 * an update for a decided performer found again, an upload sent there. Queued in discover_events and applied in order, so a
 * failure stays queued and is tried again after the next run. Remove and Checked touch nothing there. An Undo on Discover takes
 * an event back while it is not sent; once sent, a correcting one follows (routes/discovery.js).
 *
 * Keep and Delete are also training verdicts for P, with source "discover" (verdicts.js).
 */
const { siteLink } = require('./links');
const { warn } = require('./runLog');
const store = require('./store');

/** What the profile page is told about a performer: the contract of POST /api/discovery/performers (verdicts.js) */
function performerPayload(g, event, extra = {}) {
  return {
    source: 'keep-scanner',
    event,
    update: g.update || null,
    key: g.id,
    members: g.members.map((m) => m.key),
    new_finds: g.new_finds || [],
    name: g.names[0],
    aliases: [...new Set([...g.names.slice(1), ...(g.data?.aliases || [])])],
    links: g.links.map(siteLink),
    sources: g.sources,
    profile: g.data ? { name: g.names[0], profile: g.data.profile, aliases: g.data.aliases, tags: g.data.tags, socials: g.data.socials } : null,
    pictures: [...new Set(g.members.map((m) => m.image_url).filter(Boolean))],
    // the same pictures as this server has them, so nothing has to be fetched again
    files: [...new Set(g.members.flatMap((m) => m.image_paths || [m.image_path]).filter(Boolean))],
    best_score: g.best_score,
    pool_score: g.pool_score ?? null,
    decided_at: new Date().toISOString(),
    verdict: null,
    ...extra,
  };
}

/**
 * What the profile page is told about an upload. Its pictures are the files in cache/uploads. verdict: 'keep' or 'delete'
 * (Send with verdict), or null: undecided there (verdicts.js).
 */
function uploadPayload(u, verdict = null) {
  const best = u.files.reduce((m, f) => (f.score != null && (m == null || f.score > m) ? f.score : m), null);
  return {
    source: 'keep-scanner',
    event: 'upload',
    key: `upload:${u.id}`,
    name: u.name || null,
    aliases: [], links: [], sources: ['upload'], profile: null,
    pictures: [], files: u.files.map((f) => f.file),
    best_score: best ?? u.score,
    pool_score: u.kind === 'performer' && u.files.length > 1 ? u.score : null,
    decided_at: new Date().toISOString(),
    verdict: verdict === 'keep' || verdict === 'delete' ? verdict : null,
  };
}

/** Undecided again on the profile page: only an entry Discover made itself (verdicts.js) */
const queueUndecide = (g) => store.enqueue('undecide', `undecide:${g.id}:${Date.now()}`, performerPayload(g, 'undecide', { verdict: null }));

/**
 * Keep / Delete / Checked / Remove / undecided (Put back) on a performer. Checked only clears her update here; the profile
 * page keeps her as kept. Remove takes her off Discover and tells nobody: no verdict, no profile page, no training.
 * Undecided takes her marks away; when she was kept, checked or deleted the profile page is told (event "undecide").
 * superWrong: a Delete that is the training verdict "superwrong", a delete P got badly wrong.
 * Returns { event }: the id of the event queued for the profile page, or null when nothing goes there.
 */
function decide(g, status, { superWrong = false } = {}) {
  const keys = g.members.map((m) => m.key);
  if (status === 'undecided') {
    store.clearStatus(keys);
    return { event: ['kept', 'checked', 'deleted'].includes(g.status) ? queueUndecide(g) : null };
  }
  store.setStatus(keys, status);
  if (status === 'kept' || status === 'deleted') {
    const event = status === 'kept' ? 'keep' : 'delete';
    const verdict = status === 'kept' ? 'keep' : superWrong ? 'superwrong' : 'delete';
    return { event: store.enqueue(event, `${event}:${g.id}:${Date.now()}`, performerPayload({ ...g, update: null, new_finds: [] }, event, { verdict })) };
  }
  return { event: null };
}

/** After a run: an update for every decided performer found again, once per set of new finds. A removed one tells nobody. */
function runEvents(everyone) {
  let updates = 0;
  for (const g of everyone) {
    if ((g.update === 'red' || g.update === 'green') && store.enqueue('update', `update:${[...g.new_finds].sort().join('|')}`, performerPayload(g, 'update')) != null) updates++;
  }
  return { updates };
}

/** Apply what is queued, oldest first; a failure stays queued with its error and is tried again next time. */
let turn = Promise.resolve();
const sendQueued = () => {
  // one at a time: a click during a run's own round would apply the same events twice
  const round = turn.then(applyQueued);
  turn = round.catch(() => {});
  return round;
};

let applying = null;   // the id of the event being applied right now: an Undo can no longer take it back

async function applyQueued() {
  // required here: verdicts.js needs routes/profile.js, which needs the database ready
  const { applyEvent } = require('./verdicts');
  let sent = 0, failed = 0;
  for (const ev of store.pendingEvents()) {
    const now = store.eventById(ev.id);
    if (!now || now.sent_at) continue;   // taken back by an Undo meanwhile
    applying = ev.id;
    try {
      store.markSent(ev.id, JSON.stringify(await applyEvent(ev.payload, { local: true })));
      sent++;
    } catch (err) {
      warn(`Profile page: ${ev.kind} of ${ev.payload.name || ev.payload.key}: ${err.message}`);
      store.markFailed(ev.id, err.message);
      failed++;
    } finally {
      applying = null;
    }
  }
  return { sent, failed };
}

/** Whether this event is being applied on the profile page right now */
const isApplying = (eventId) => applying != null && applying === eventId;

module.exports = { performerPayload, uploadPayload, decide, queueUndecide, runEvents, sendQueued, isApplying };
