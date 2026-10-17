// What leaks in when a parser reads page source instead of page text: tags, CSS, scripts, escaped Next.js payloads
const MARKUP = /[<>{}\\]|data-[a-z]|class=|\.js\b|var\(|;\s*[a-z-]+:/i;

// Performer profile columns and the longest value each one can hold
const PROFILE_TEXT_FIELDS = {
  born: 40, birthplace: 100, height: 40, weight: 40, measurements: 40, measurements_cup: 20,
  hair_color: 40, eye_color: 40, ethnicity: 60, body_type: 40, orientation: 40,
  pubic_hair: 60, tattoos: 300, piercings: 300
};

/**
 * The value as one line of text, or null when it is markup, too long, or has no letters or digits.
 * Unbalanced brackets and quotes at either end are script fragments cut at a comma.
 */
function cleanScrapedText(value, maxLength = 100) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || text.length > maxLength || MARKUP.test(text) || !/[\p{L}\p{N}]/u.test(text)) return null;
  if (/^['"]|['"]$/.test(text) || text.split('(').length !== text.split(')').length) return null;
  return text;
}

/** A profile column's value, cleaned. A birth date without a digit is a place or a label, not a date. */
function cleanProfileField(field, value) {
  const text = cleanScrapedText(value, PROFILE_TEXT_FIELDS[field]);
  if (field === 'born' && text && !/\d/.test(text)) return null;
  return text;
}

/** Aliases or tags: clean, at least two characters, no duplicates. */
function cleanScrapedList(values) {
  const out = (values || []).map(v => cleanScrapedText(v, 50)).filter(v => v && v.length > 1 && v.toLowerCase() !== 'null');
  return [...new Set(out)];
}

/** 167 → 5'6" (167 cm), the format the profile columns already hold */
function formatHeight(cm) {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}'${inches % 12}" (${cm} cm)`;
}

/** 53 → 117 lbs (53 kg) */
function formatWeight(kg) {
  return `${Math.round(kg * 2.2046)} lbs (${kg} kg)`;
}

/**
 * A Stash-style scraper result (Name, Birthdate, HairColor, …) in the shape every scraper returns:
 * { name, url, profile: { <performers column>: value }, aliases: [], tags: [] }
 * Stash scrapers give height and weight as bare cm and kg.
 */
function normalizeScrapedPerformerData(raw, url) {
  const fakeText = (raw.FakeTits || '').toLowerCase();
  const fake = /fake|enhanced|yes/.test(fakeText) ? 1 : /natural|no/.test(fakeText) ? 0 : null;
  const list = (s) => (s ? s.split(',') : []);
  const number = (s) => (/^\d+$/.test(s || '') ? parseInt(s, 10) : null);
  return {
    name: raw.Name,
    url,
    profile: {
      age: raw.Age ? parseInt(raw.Age, 10) : null,
      born: raw.Birthdate,
      birthplace: raw.Birthplace,
      country_flag: raw.Country,
      height: number(raw.Height) ? formatHeight(number(raw.Height)) : raw.Height,
      weight: number(raw.Weight) ? formatWeight(number(raw.Weight)) : raw.Weight,
      measurements: raw.Measurements,
      measurements_cup: raw.CupSize ? `${raw.CupSize}${fake === null ? '' : fake ? ' (Fake)' : ' (Natural)'}` : null,
      measurements_band_size: raw.CupSize?.match(/^\d+/)?.[0],
      measurements_fake: fake,
      hair_color: raw.HairColor,
      eye_color: raw.EyeColor,
      ethnicity: raw.Ethnicity,
      body_type: raw.BodyType,
      orientation: raw.Orientation,
      pubic_hair: raw.PubicHair,
      tattoos: raw.Tattoos,
      piercings: raw.Piercings
    },
    aliases: list(raw.Aliases),
    tags: list(raw.Tags)
  };
}

/** A scrape result with every value cleaned and the empty ones dropped from profile. */
function cleanScrapeResult(result) {
  const profile = {};
  for (const [field, value] of Object.entries(result.profile || {})) {
    let clean;
    if (field in PROFILE_TEXT_FIELDS) clean = cleanProfileField(field, value);
    // The frontend draws the flag from a two-letter code; a country name would show nothing
    else if (field === 'country_flag') clean = /^[a-z]{2}$/i.test(value || '') ? value.toLowerCase() : null;
    else if (field === 'age') clean = Number.isInteger(value) && value > 0 && value < 100 ? value : null;
    else if (field === 'measurements_fake') clean = value === 0 || value === 1 ? value : null;
    else if (field === 'measurements_band_size') clean = /^\d{2}$/.test(value) ? value : null;
    if (clean !== null && clean !== undefined) profile[field] = clean;
  }
  return {
    ...result,
    name: cleanScrapedText(result.name),
    profile,
    aliases: cleanScrapedList(result.aliases),
    tags: cleanScrapedList(result.tags)
  };
}

module.exports = {
  PROFILE_TEXT_FIELDS,
  formatHeight,
  formatWeight,
  cleanProfileField,
  cleanScrapedList,
  cleanScrapeResult,
  normalizeScrapedPerformerData
};
