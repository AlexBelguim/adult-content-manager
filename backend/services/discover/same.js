/**
 * The performers: every profile and post, grouped into one performer each, with all her links, pictures and
 * profile data (Performers; Liked are the ones with something kept).
 *
 * Joined on their own (one performer):
 *   - the same name, a name the same as an alias (case and spacing aside: "Odarochka" and "odarochka"), when it is
 *     the main name of one of them (a profile's name, a post's title or creator): two profiles that merely share an
 *     alias ("Leah") are usually two people;
 *   - the same OnlyFans or Fansly account in their socials;
 *   - two that were combined by hand (Duplicates: Combine).
 * Looked at by hand (Duplicates), not joined: two performers whose names only meet without spaces and punctuation
 * ("Liza Vaiss" and "Lizavaiss", "Maddie Springs" and "MaddieSprings"), who share only an alias, who share an
 * Instagram / X / TikTok account, or where one's OnlyFans name is the other's name; and a liked performer whose
 * pictures together (the P model's pool score) fall below the keep line, to keep or drop.
 *
 * A performer's score stays her best single one; her pool score is the P model on all her pictures together, the
 * judgment P was fitted for (scored by scan.js after each run, kept in discover_pool_scores by the pictures it saw).
 */
const { createHash } = require('crypto');
const { normalize } = require('./library');
const { siteLink } = require('./links');

const MIN_KEY = 4;   // shorter names ("Mia", "Eva") join too many people
const exact = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const UPDATE_MARK = { deleted: 'red', kept: 'green', checked: 'green', removed: 'again' };
const NETWORK_NAMES = { onlyfans: 'OnlyFans', fansly: 'Fansly', instagram: 'Instagram', twitter: 'X', tiktok: 'TikTok', snapchat: 'Snapchat' };

/** The account a social link is: 'onlyfans:name', or null for a link to no account. */
function account(network, url) {
  const name = String(url || '').match(/^https?:\/\/(?:www\.)?[^/]+\/(?:@)?([^/?#]+)/i)?.[1];
  return name && !/^(home|login|signup|explore)$/i.test(name) ? `${network}:${decodeURIComponent(name).toLowerCase()}` : null;
}

/** The pictures a performer's pool score is from, and its key in pool_scores (the same pictures, the same score). */
function poolOf(members) {
  const images = [...new Set(members.flatMap(m => m.image_paths || [m.image_path]).filter(Boolean))].sort();
  return images.length > 1 ? { images, signature: createHash('sha1').update(images.join('\n')).digest('hex') } : null;
}

/**
 * singles: also the performers seen once (Performers, Liked); links: the combines and "not the same" of the
 * Duplicates tab ([{ a, b, kind: 'same' | 'apart' }], by member key); decisions: keep / drop of a performer whose
 * pool fell below the line ({ member key: { decision, at } }); pools: the pool scores ({ signature: { score, model } }).
 * Returns { performers, candidates } (candidates: the pairs to look at).
 */
function samePerformerGroups({ kept = [], notKept = [], profiles = [] }, library,
  { singles = false, links = [], decisions = {}, pools = {}, statuses = {}, threshold = 50, model = null } = {}) {
  const members = [
    ...profiles.map(p => ({
      type: 'profile', source: `${p.site}:profiles`, site: p.site, id: p.profile_id, name: p.name, link: siteLink(p.url), image_url: p.image_url, image_path: p.image_path, image_paths: p.image_paths,
      score: p.score, kept: p.kept, names: [p.name, ...(p.scrape?.aliases || [])], scrape: p.scrape, full: p.full, socials: p.scrape?.socials || {},
      found_at: p.judged_at || p.data_at
    })),
    ...[...kept, ...notKept].map(p => ({
      type: 'post', source: `${p.site}:posts`, site: p.site, id: p.post_id, name: p.performer_name || p.title, title: p.title,
      link: siteLink(p.saved_link || p.share_url || p.post_url), share_url: p.share_url, image_url: p.image_url, image_path: p.image_path, image_paths: p.image_paths,
      score: p.score, kept: p.kept, posted_at: p.posted_at, names: [p.title, p.performer_name], socials: {}, found_at: p.scanned_at
    }))
  ];
  members.forEach(m => { m.key = `${m.type}:${m.site}:${m.id}`; m.names = m.names.filter(Boolean); });
  const byKey = new Map(members.map((m, i) => [m.key, i]));

  const parent = members.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i, j) => { parent[find(i)] = find(j); };
  const index = (keyOf) => {   // value → { main: [member], alias: [member] }
    const map = new Map();
    members.forEach((m, i) => {
      const main = new Set(m.names.slice(0, m.type === 'profile' ? 1 : 2).map(keyOf));
      for (const k of new Set(m.names.map(keyOf))) {
        if (normalize(k).length < MIN_KEY) continue;
        if (!map.has(k)) map.set(k, { main: [], alias: [] });
        map.get(k)[main.has(k) ? 'main' : 'alias'].push(i);
      }
    });
    return map;
  };

  // Joined on their own: the same name (or a name the same as an alias) …
  const exactNames = index(exact);
  for (const { main, alias } of exactNames.values()) if (main.length) for (const i of [...main, ...alias]) join(i, main[0]);
  // … the same OnlyFans / Fansly account …
  const accounts = new Map();
  members.forEach((m, i) => {
    for (const [network, url] of Object.entries(m.socials)) {
      const a = account(network, url);
      if (!a) continue;
      if (!accounts.has(a)) accounts.set(a, []);
      accounts.get(a).push(i);
    }
  });
  for (const [a, list] of accounts) if (/^(onlyfans|fansly):/.test(a)) for (const i of list) join(i, list[0]);
  // … and combined by hand
  const apart = [];
  for (const l of links) {
    const i = byKey.get(l.a), j = byKey.get(l.b);
    if (i == null || j == null) continue;
    if (l.kind === 'same') join(i, j); else apart.push([i, j]);
  }

  // The pairs to look at: performers (after the joins) that meet on a looser name or a shared account
  const pairs = new Map();   // 'rootA|rootB' → { a, b, reasons }
  const consider = (i, j, reason) => {
    let [a, b] = [find(i), find(j)];
    if (a === b) return;
    if (a > b) [a, b] = [b, a];
    if (apart.some(([x, y]) => { const [p, q] = [find(x), find(y)]; return (p === a && q === b) || (p === b && q === a); })) return;
    const id = `${a}|${b}`;
    if (!pairs.has(id)) pairs.set(id, { a, b, reasons: [] });
    const r = pairs.get(id).reasons;
    if (!r.includes(reason) && r.length < 4) r.push(reason);
  };
  // A shared alias only counts as a full name ("Ariana Lu"); a first name ("Emma", "Mila") is shared by too many,
  // and some sites' data leaks into the aliases ("| birth month = November")
  const fullName = (s) => /^[\p{L}\p{N}][\p{L}\p{N} .'_-]*$/u.test(s) && s.trim().split(/\s+/).filter(w => /\p{L}/u.test(w)).length >= 2;
  const byName = index(normalize);
  for (const [k, { main, alias }] of byName) {
    const all = [...main, ...alias];
    if (all.length < 2) continue;
    const spell = (i) => members[i].names.find(n => normalize(n) === k);
    if (!main.length && !fullName(spell(all[0]))) continue;
    for (const i of all.slice(1)) consider(all[0], i, main.length ? `"${spell(all[0])}" and "${spell(i)}"` : `both list the alias "${spell(all[0])}"`);
  }
  for (const [a, list] of accounts) {
    if (/^(onlyfans|fansly):/.test(a)) continue;
    const [network, handle] = a.split(':');
    for (const i of list.slice(1)) consider(list[0], i, `the same ${NETWORK_NAMES[network] || network} account (${handle})`);
  }
  // One's OnlyFans / Fansly name is the other's name ("arianamarie" and "Ariana Marie")
  for (const [a, list] of accounts) {
    if (!/^(onlyfans|fansly):/.test(a)) continue;
    const [network, handle] = a.split(':');
    for (const j of [...(byName.get(normalize(handle))?.main || [])]) consider(list[0], j, `"${members[j].name}" is the ${NETWORK_NAMES[network]} name of "${members[list[0]].name}"`);
  }

  const groups = new Map();
  members.forEach((m, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });

  const summaries = new Map();
  for (const [root, idx] of groups) {
    const list = idx.map(i => members[i]);
    // A member's "matched on": what joined it to the others (a name another one has, a shared account, by hand)
    for (const m of list) {
      const shared = m.names.filter(n => normalize(n).length >= MIN_KEY && list.some(o => o !== m && o.names.some(x => exact(x) === exact(n))));
      const acc = Object.entries(m.socials).map(([n, u]) => account(n, u)).filter(a => a && /^(onlyfans|fansly):/.test(a) && list.some(o => o !== m && Object.entries(o.socials).some(([n2, u2]) => account(n2, u2) === a)));
      m.matched_on = [...new Map(shared.map(n => [exact(n), n])).values(), ...acc.map(a => `${NETWORK_NAMES[a.split(':')[0]]} ${a.split(':')[1]}`)];
      if (!m.matched_on.length && list.length > 1) m.matched_on = ['combined by hand'];
    }
    const scored = list.filter(m => m.score != null);
    const names = [...new Map(list.map(m => [exact(m.name), m.name])).values()];
    // Her profile data, from all her profiles: fields from the most complete one first, every alias, tag and social
    const withData = list.filter(m => m.scrape).sort((a, b) => (b.full ? 1 : 0) - (a.full ? 1 : 0));
    let data = null;
    if (withData.length) {
      const profile = {};
      for (const m of withData) for (const [k, v] of Object.entries(m.scrape.profile || {})) if (profile[k] == null && v != null && v !== '') profile[k] = v;
      const uniq = (xs) => [...new Map(xs.filter(Boolean).map(x => [exact(x), x])).values()];
      const socials = {};
      for (const m of withData) for (const [k, v] of Object.entries(m.scrape.socials || {})) socials[k] ??= v;
      data = {
        profile,
        aliases: uniq([...withData.flatMap(m => m.scrape.aliases || []), ...names]).filter(a => exact(a) !== exact(names[0])),
        tags: uniq(withData.flatMap(m => m.scrape.tags || [])),
        socials,
        complete: withData.some(m => m.full)
      };
    }
    const pool = list.length > 1 ? poolOf(list) : null;   // one post or profile: its own score is already all its pictures
    const pooled = pool && pools[pool.signature] && (!model || pools[pool.signature].model === model) ? pools[pool.signature] : null;
    // Keep / Delete / Checked / Remove: the latest on any of her members. A member without a mark was found after it:
    // an update (red when she was deleted, green when kept or checked, plain after a Remove, which told nobody anything)
    const marks = list.map(m => statuses[m.key]).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const status = marks[0]?.status || null;
    const newFinds = status ? list.filter(m => !statuses[m.key]).map(m => m.key) : [];
    const decision = list.map(m => decisions[m.key]).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]?.decision || null;
    const keptAlone = list.some(m => m.kept);
    const poolScore = pooled ? Math.round(pooled.score * 10) / 10 : null;
    for (const m of list) { delete m.scrape; delete m.full; delete m.names; delete m.socials; }
    summaries.set(root, {
      names,
      data,
      in_library: library.find(...list.flatMap(m => [m.name, m.title, ...m.matched_on]), ...(data?.aliases || [])),
      profiles: list.filter(m => m.type === 'profile').length,
      posts: list.filter(m => m.type === 'post').length,
      sites: [...new Set(list.map(m => m.site))],
      sources: [...new Set(list.map(m => m.source))],
      // Liked: something kept on its own, unless dropped after its pictures together fell below the line
      kept: keptAlone && decision !== 'drop',
      kept_count: list.filter(m => m.kept).length,
      best_score: scored.length ? Math.max(...scored.map(m => m.score)) : null,
      pool_score: poolScore,
      pool_images: pool?.images.length || 0,
      // The pictures we hold of her: every one she was judged on, across all her finds
      pictures: new Set(list.flatMap(m => m.image_paths || [m.image_path]).filter(Boolean)).size,
      pool_pending: !!pool && !pooled,
      // Kept on her own, below the line together, and not decided yet: Duplicates asks
      fell_out: keptAlone && poolScore != null && poolScore < threshold && !decision && !status,
      decision,
      status,
      update: newFinds.length ? UPDATE_MARK[status] : null,
      new_finds: newFinds,
      links: [...new Set(list.map(m => m.link).filter(Boolean))],
      // When the scanner last found her (every site has it; only Leakhaven gives a post date): "Newest first"
      last_seen: list.map(m => m.found_at).filter(Boolean).sort().pop() || null,
      members: list.sort((a, b) => (b.kept ? 1 : 0) - (a.kept ? 1 : 0) || (a.type === 'profile' ? -1 : 1) - (b.type === 'profile' ? -1 : 1) || (b.score ?? -1) - (a.score ?? -1))
    });
  }
  for (const g of summaries.values()) g.id = g.members[0].key;

  const order = (a, b) => b.kept - a.kept || (!!a.in_library - !!b.in_library) || (b.best_score ?? -1) - (a.best_score ?? -1);
  const performers = [...summaries.values()].filter(g => singles || g.members.length > 1).sort(order);
  const candidates = [...pairs.values()].map(({ a, b, reasons }) => {
    const [ga, gb] = [summaries.get(a), summaries.get(b)].sort(order);
    return { kind: 'pair', id: `pair:${ga.id}|${gb.id}`, groups: [ga, gb], reasons };
  });
  return { performers, candidates };
}

module.exports = { poolOf, samePerformerGroups };
