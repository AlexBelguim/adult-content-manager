/**
 * Leakhaven (leakshaven.com) profile scraper and update checker.
 *
 * Leakhaven is a client-rendered app, but it has a public JSON API and every model page carries its
 * profile as JSON (initialProfileData in the page's RSC payload). Both are read over plain HTTP, so
 * no browser and no HTML parsing:
 *   - api.leakshaven.com/content?search=<name> resolves a name or alias to the model it belongs to
 *     (richProfileId, richProfileName) and lists uploads with their createdAt dates;
 *   - api.leakshaven.com/profile/<richProfileId> holds the profile;
 *   - leakshaven.com/model/<model name> embeds the same profile, and is the fallback when the API
 *     has none. Some model pages answer HTTP 451 (taken down on request) while the API profile
 *     still works, which is why the API is read first.
 */
const axios = require('axios');
const { formatHeight, formatWeight } = require('../utils/scraperNormalizer');

const SITE = 'https://leakshaven.com';
const API = 'https://api.leakshaven.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: SITE,
  Referer: `${SITE}/`
};

const get = (url) => axios.get(url, { headers: HEADERS, timeout: 20000 }).then(res => res.data);
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function modelUrl(modelName) {
  return `${SITE}/model/${encodeURIComponent(modelName)}`;
}

/** The model in a Leakhaven link: "https://leakshaven.com/model/Senya%20Marin" → "Senya Marin". Null if it is not one. */
function modelNameFromUrl(url) {
  const match = String(url || '').match(/leakshaven\.com\/model\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).trim() : null;
}

function searchContent(name, count) {
  return get(`${API}/content?search=${encodeURIComponent(name)}&count=${count}&sorting=NEWEST`);
}

/** The JSON object that starts at text[start], or null. */
function jsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      return JSON.parse(text.slice(start, i + 1));
    }
  }
  return null;
}

/** The profile the API holds for a model, or null when it has none. */
async function fetchApiProfile(richProfileId) {
  try {
    const data = await get(`${API}/profile/${encodeURIComponent(richProfileId)}`);
    return data && data.name ? data : null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

/** The profile a model page embeds, or null when the page has none. */
async function fetchModelProfile(modelName) {
  const html = await get(modelUrl(modelName)).catch(err => {
    if (err.response?.status === 451) {
      throw new Error(`Leakhaven has taken down the page for "${modelName}" (HTTP 451)`);
    }
    throw err;
  });
  const rsc = [...html.matchAll(/\.rsc\.push\(("(?:[^"\\]|\\.)*")\)/g)].map(m => JSON.parse(m[1])).join('');
  const key = '"initialProfileData":';
  const at = rsc.indexOf(key);
  return at < 0 ? null : jsonObjectAt(rsc, at + key.length);
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/** "PROFESSION_DILDO_BLOWJOB" → "Dildo Blowjob" */
function tagLabel(tag) {
  return titleCase(String(tag).replace(/^(PROFESSION|CATEGORY)_/, '').replace(/_/g, ' '));
}

function ageFrom(birthDate) {
  const born = new Date(birthDate);
  if (isNaN(born)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age--;
  return age;
}

/** A model page profile in the shape every scraper returns (see utils/scraperNormalizer). */
function toScrapeResult(data) {
  const e = data.enhanced || {};
  const fake = e.boobsType ? e.boobsType !== 'Natural' : null;
  return {
    name: data.name,
    url: modelUrl(data.name),
    profile: {
      age: e.birthDate ? ageFrom(e.birthDate) : null,
      born: e.birthDate ? e.birthDate.slice(0, 10) : null,
      birthplace: e.placeOfBirth,
      country_flag: e.nationality?.[0]?.toLowerCase(),
      height: e.heightCm ? formatHeight(e.heightCm) : null,
      weight: e.weightKg ? formatWeight(e.weightKg) : null,
      measurements_cup: e.cupSize ? `${e.cupSize}${fake === null ? '' : fake ? ' (Fake)' : ' (Natural)'}` : null,
      measurements_band_size: e.cupSize?.match(/^\d+/)?.[0],
      measurements_fake: fake === null ? null : fake ? 1 : 0,
      hair_color: e.hairColor,
      eye_color: e.eyeColor,
      ethnicity: e.ethnicity === 'Caucasian' ? 'White' : e.ethnicity,
      body_type: e.bodyType,
      orientation: e.sexuality
    },
    aliases: e.alias || [],
    tags: (e.tags || []).map(tagLabel)
  };
}

/**
 * Find a performer on Leakhaven. Each name is searched in turn; the first one Leakhaven matches to a
 * model gives that model's profile. A Leakhaven link (from an earlier scrape or typed in) can be passed
 * as a name too. Returns null when no name matches a model.
 */
async function scrapeLeakshaven(names) {
  for (const [i, name] of names.entries()) {
    if (i > 0) await pause(1000);
    const { richProfileId, richProfileName } = await searchContent(modelNameFromUrl(name) || name, 1);
    if (!richProfileName) continue;
    // The API profile first: it still answers for models whose page Leakhaven has taken down (451)
    const data = (richProfileId && await fetchApiProfile(richProfileId)) || await fetchModelProfile(richProfileName);
    if (data) return { ...toScrapeResult(data), searchedFor: name };
  }
  return null;
}

/**
 * When the newest upload Leakhaven lists for a model was posted (ISO date), or null when it lists none.
 * Uploads are found by searching the model name, the same search the model page runs.
 */
async function checkLeakshavenUpdates(modelName) {
  const { content = [] } = await searchContent(modelName, 30);
  const dates = content.filter(c => !c.deleted && c.createdAt).map(c => new Date(c.createdAt).toISOString()).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

module.exports = {
  modelUrl,
  modelNameFromUrl,
  scrapeLeakshaven,
  checkLeakshavenUpdates
};
