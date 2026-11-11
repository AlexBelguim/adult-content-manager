/**
 * The results as the Discover page shows them: every judged post (kept and not kept) with its score, the skipped ones with
 * their reason, what is waiting to be judged, the creator profiles with their score and data, the performers (everyone the
 * watchers found, grouped by name, with their profile data), the liked ones (something kept), the duplicates (found more
 * than once), and how many each watcher checked and kept.
 */
const { samePerformerGroups } = require('./same');

const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** What buildResults takes from the store besides the posts and profiles: watcher runs, the Duplicates decisions, pool scores. */
const storedState = (store) => ({ checks: store.checks(), links: store.links(), decisions: store.decisions(), pools: store.pools(), statuses: store.statuses() });

/**
 * Above the line (kept) is the stored score against the line as it is now, not as it was when judged: a new line counts at
 * once, in Liked, the counts, the watchers and the export.
 */
function buildResults(rows, library, run = {}, profileRows = []) {
  const t = run.threshold ?? 50;
  const above = (score) => (score != null && score >= t ? 1 : 0);
  const posts = rows.map((p) => ({ ...p, kept: above(p.score), score: round(p.score), in_library: p.score == null ? null : library.find(p.performer_name, p.title) }));
  const judged = posts.filter((p) => p.score != null);
  const kept = judged.filter((p) => p.kept).sort((a, b) => b.score - a.score);
  const notKept = judged.filter((p) => !p.kept).sort((a, b) => b.score - a.score);
  const skipped = posts.filter((p) => p.score == null && !p.waiting);
  const waiting = posts.filter((p) => p.waiting);

  const profiles = profileRows
    .map((p) => ({ ...p, kept: above(p.score), score: round(p.score), in_library: library.find(p.name, ...(p.scrape?.aliases || [])) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const judgedProfiles = profiles.filter((p) => p.score != null);

  // Performers: everyone the watchers found, one entry each (a creator found as a profile and in two posts is one
  // entry with all three, same.js); Liked: the ones with something kept; Duplicates: what is left to decide by
  // hand, the pairs that may be one performer (Combine / Not the same) and the liked performers whose pictures
  // together fell below the keep line (Keep / Drop)
  const { performers: groups, candidates } = samePerformerGroups({ kept, notKept, profiles }, library, {
    singles: true, links: run.links || [], decisions: run.decisions || {}, pools: run.pools || {}, statuses: run.statuses || {}, threshold: t,
  });
  const everyone = groups.sort((a, b) => (!!a.in_library - !!b.in_library) || b.kept_count - a.kept_count || (b.best_score ?? -1) - (a.best_score ?? -1));
  // Keep / Delete / Checked / Remove (same.js status): Performers and Liked show the undecided ones and the deleted or
  // removed ones found again; Kept shows the kept ones and the checked ones found again; a deleted, removed or checked
  // performer with nothing new is gone from the page
  const performers = everyone.filter((g) => !g.status || ((g.status === 'deleted' || g.status === 'removed') && g.update));
  const keptList = everyone.filter((g) => g.status === 'kept' || (g.status === 'checked' && g.update));
  const hidden = new Set(everyone.filter((g) => g.status && !performers.includes(g) && !keptList.includes(g)));
  const liked = performers.filter((g) => g.kept);
  const flat = (gs) => ({
    names: gs.flatMap((g) => g.names), best_score: Math.max(...gs.map((g) => g.best_score ?? -1)), in_library: gs.find((g) => g.in_library)?.in_library || null,
    in_library_id: gs.find((g) => g.in_library)?.in_library_id ?? null,
    last_seen: gs.map((g) => g.last_seen).filter(Boolean).sort().pop() || null, members: gs.flatMap((g) => g.members), data: { aliases: gs.flatMap((g) => g.data?.aliases || []) },
  });
  const pairs = candidates.filter((c) => !c.groups.some((g) => hidden.has(g)));
  const same = [
    ...performers.filter((g) => g.fell_out).map((g) => ({ kind: 'fallen', id: `fallen:${g.id}`, groups: [g], reasons: [], ...flat([g]) })),
    ...pairs.map((c) => ({ ...c, ...flat(c.groups) })),
  ];

  const models = [...new Set([...judged, ...judgedProfiles].map((p) => p.model).filter(Boolean))];
  const results = {
    run: { threshold: run.threshold, models, last_scan: posts.map((p) => p.scanned_at).sort().pop() || null },
    watchers: watcherStats(run.watchers || [], posts, profiles, run.checks || {}),
    totals: {
      // every post and profile judged, and those above the line (the page's header)
      judged_all: judged.length + judgedProfiles.length,
      above_line: kept.length + judgedProfiles.filter((p) => p.kept).length,
      judged: judged.length,
      kept: kept.length,
      rejected: notKept.length,
      skipped: skipped.length,
      waiting: waiting.length + profiles.filter((p) => p.waiting).length,
      performers: performers.length,
      performers_new: performers.filter((p) => !p.in_library).length,
      performers_with_data: performers.filter((p) => p.data).length,
      duplicates: same.length,
      kept_tab: keptList.length,
      updates_red: performers.filter((g) => g.update === 'red').length,
      updates_green: keptList.filter((g) => g.update === 'green').length,
      hidden: hidden.size,
      duplicates_pairs: pairs.length,
      duplicates_fallen: same.length - pairs.length,
      pools_scored: performers.filter((g) => g.pool_score != null).length,
      pools_pending: performers.filter((g) => g.pool_pending).length,
      performers_with_keeps: liked.length,
      new_performers: liked.filter((p) => !p.in_library).length,
      profiles_judged: judgedProfiles.length,
      profiles_kept: judgedProfiles.filter((p) => p.kept).length,
      profiles_new: judgedProfiles.filter((p) => p.kept && !p.in_library).length,
      profiles_with_data: profiles.filter((p) => p.scrape).length,
    },
    performers,
    liked,
    keptList,
    kept,
    notKept,
    skipped,
    waiting,
    profiles,
    same,
  };
  // Everyone, decided or not, for the run's own steps (pool scores, events); decided: the ones in neither Performers nor
  // Kept (deleted, removed or checked, with nothing new), the Decided view
  Object.defineProperty(results, 'everyone', { value: everyone, enumerable: false });
  Object.defineProperty(results, 'decided', { value: [...hidden], enumerable: false });
  return results;
}

/**
 * Per watcher: how many it checked (judged or skipped), kept, skipped; when it last ran (last_checked: a caught-up run adds
 * nothing but still counts), what that run found and why it stopped if it did; and when it last added something
 * (last_update: its newest post or profile).
 */
function watcherStats(watchers, posts, profiles, checks) {
  const latest = (list, field) => list.map((x) => x[field]).filter(Boolean).sort().pop() || null;
  return watchers.map((w) => {
    const base = { id: w.id, label: w.label, site: w.name, kind: w.kind, url: w.url, watch: w.watch !== false, enabled: w.enabled !== false, source: `${w.name}:${w.kind}` };
    const check = checks[w.id];
    const run = (lastUpdate) => ({ last_update: lastUpdate, last_checked: check?.checked_at ?? lastUpdate, last_found: check?.found ?? null, last_error: check?.error ?? null });
    if (w.kind === 'profiles') {
      const mine = profiles.filter((p) => p.site === w.name);
      const judged = mine.filter((p) => p.score != null);
      return { ...base, checked: judged.length, judged: judged.length, kept: judged.filter((p) => p.kept).length, skipped: 0, waiting: mine.filter((p) => p.waiting).length, with_data: mine.filter((p) => p.scrape).length, ...run(latest(judged, 'judged_at')) };
    }
    const mine = posts.filter((p) => p.site === w.name);
    return { ...base, checked: mine.length, judged: mine.filter((p) => p.score != null).length, kept: mine.filter((p) => p.kept).length, skipped: mine.filter((p) => p.score == null && !p.waiting).length, waiting: mine.filter((p) => p.waiting).length, ...run(latest(mine, 'scanned_at')) };
  });
}

/**
 * The creator profiles' data for the profile page, without any judgment (no score, no kept): one entry per profile, its
 * result in the shape POST /api/performers/:id/scrape/accept takes with source 'leakhaven'.
 * only: the profiles to export, as '<site>:<profile id>' (an id alone is not unique across sites); all profiles with data otherwise.
 */
function profileDataExport(profiles, only = null) {
  const wanted = only && new Set(only);
  return {
    format: 'darkroom-profile-data',
    version: 1,
    source: 'leakhaven',
    exported_at: new Date().toISOString(),
    profiles: profiles
      .filter((p) => p.scrape && (!wanted || wanted.has(`${p.site}:${p.profile_id}`)))
      .map((p) => ({ site: p.site, profile_id: p.profile_id, url: p.url, picture_url: p.image_url, complete: !!p.full, data_at: p.data_at, result: p.scrape })),
  };
}

module.exports = { storedState, buildResults, profileDataExport };
