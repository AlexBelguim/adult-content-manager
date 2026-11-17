/**
 * The profile filters of Discover's performer lists: ethnicity, country, tags, body type and cup size, read from her
 * profile data (same.js: data.profile and data.tags, what the sites' profiles gave). In the query each is a list of
 * values with commas between them (?eth=Asian,Latin&tag=Cosplayer): any of a filter's values will do, and every filter
 * that is set has to match. A performer without the field never matches a filter on it.
 */

/** "34D (Natural)" → "D", "c (Fake)" → "C": the cup without the band size and what follows it */
const cupLetter = (cup) => /^\s*\d*\s*([a-z]{1,4})\b/i.exec(String(cup || ''))?.[1].toUpperCase() || null;

const one = (v) => (v == null || v === '' ? [] : [String(v)]);

/** The values a performer has for each filter */
const FACETS = {
  eth: (g) => one(g.data?.profile?.ethnicity),
  country: (g) => one(g.data?.profile?.country_flag).map((c) => c.toUpperCase()),
  tag: (g) => g.data?.tags || [],
  body: (g) => one(g.data?.profile?.body_type),
  cup: (g) => one(cupLetter(g.data?.profile?.measurements_cup)),
};
const FACET_KEYS = Object.keys(FACETS);

const fold = (v) => String(v).trim().toLowerCase();

/** The filters that are set: key → the values asked for, folded */
function asked(q) {
  const out = new Map();
  for (const key of FACET_KEYS) {
    const values = String(q?.[key] ?? '').split(',').map(fold).filter(Boolean);
    if (values.length) out.set(key, new Set(values));
  }
  return out;
}

/** The performers that match every profile filter of the query; except: one filter to leave out */
function matchProfile(list, q, except = null) {
  const want = [...asked(q)].filter(([key]) => key !== except);
  if (!want.length) return list;
  return list.filter((g) => want.every(([key, values]) => FACETS[key](g).some((v) => values.has(fold(v)))));
}

/**
 * Every filter's options with how many of the list's performers each would show: counted with the other filters on
 * and its own off, so the options of a filter in use still say what choosing one more would add. Most first.
 */
function facetCounts(list, q) {
  const out = {};
  for (const key of FACET_KEYS) {
    const counts = new Map();
    for (const g of matchProfile(list, q, key)) {
      for (const v of new Set(FACETS[key](g))) counts.set(v, (counts.get(v) || 0) + 1);
    }
    out[key] = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return out;
}

module.exports = { FACET_KEYS, cupLetter, matchProfile, facetCounts };
