/**
 * Facts about one performer row from /api/performers/gallery, read the same way everywhere on the Gallery home:
 * the sorts, the filter drawer and the New upload badge. Pure: no React, no requests.
 *
 * The row formats (checked against the scrapers): height is `5'6" (168 cm)` or bare cm, weight is `117 lbs (53 kg)`
 * or bare kg, measurements_cup is like `34C (Natural)`, `C (Fake)` or `C`, measurements_fake defaults to 0 for
 * performers never scraped, scraped_tags and aliases are JSON arrays.
 */

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Her age today, from the scraped age and the date it was scraped (the card's own rule). An integer or null. */
export function currentAge(p) {
  const age = num(p?.age);
  if (!p?.age || age == null) return null;
  if (!p.scraped_at) return Math.round(age);
  const scraped = new Date(p.scraped_at);
  if (Number.isNaN(scraped.getTime())) return Math.round(age);
  const now = new Date();
  const years = now.getFullYear() - scraped.getFullYear();
  return Math.round(age + years - (now.getMonth() < scraped.getMonth() ? 1 : 0));
}

/** The cup letter of measurements_cup ('34C (Natural)' -> 'C'), or null. */
export function cupLetter(p) {
  const raw = p?.measurements_cup;
  if (raw == null) return null;
  const letter = String(raw).replace(/\([^)]*\)/g, '').replace(/\d/g, '').trim().toUpperCase();
  return letter || null;
}

export const CUP_ORDER = ['AA', 'A', 'B', 'C', 'D', 'DD', 'DDD', 'E', 'F', 'FF', 'G', 'GG', 'H', 'HH', 'I', 'J', 'K'];

/** 0 for no cup, its place in CUP_ORDER (from 1) when known, 99 for anything else. */
export function cupRank(letter) {
  if (!letter) return 0;
  const i = CUP_ORDER.indexOf(String(letter).toUpperCase());
  return i < 0 ? 99 : i + 1;
}

const isBand = (n) => n != null && Number.isInteger(n) && n >= 26 && n <= 50;

/** The band size: measurements_band_size, else the leading 2 digits of measurements_cup; 26..50 only, else null. */
export function bandOf(p) {
  const own = num(p?.measurements_band_size);
  if (isBand(own)) return own;
  const m = /^\s*(\d{2})(?!\d)/.exec(String(p?.measurements_cup ?? ''));
  const lead = m ? Number(m[1]) : null;
  return isBand(lead) ? lead : null;
}

/** 'enhanced', 'natural' or 'unknown'. measurements_fake is 0 for performers never scraped, so 0 alone is not natural. */
export function breastsOf(p) {
  const cup = String(p?.measurements_cup ?? '');
  if (Number(p?.measurements_fake) === 1 || /\(fake\)/i.test(cup)) return 'enhanced';
  if (/\(natural\)/i.test(cup)) return 'natural';
  return 'unknown';
}

const bare = (v) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
};

/** Height in cm, or null. */
export function heightCm(p) {
  const raw = p?.height;
  if (raw == null || raw === '') return null;
  const s = String(raw);
  const cm = /(\d{2,3})\s*cm/i.exec(s);
  if (cm) return Number(cm[1]);
  const n = bare(s);
  if (n != null && n >= 120 && n <= 220) return Math.round(n);
  const ft = /(\d)\s*'\s*(\d{1,2})/.exec(s);
  if (ft) return Math.round((Number(ft[1]) * 12 + Number(ft[2])) * 2.54);
  return null;
}

/** Weight in kg, or null. */
export function weightKg(p) {
  const raw = p?.weight;
  if (raw == null || raw === '') return null;
  const s = String(raw);
  const kg = /(\d{2,3}(?:\.\d+)?)\s*kg/i.exec(s);
  if (kg) return Math.round(Number(kg[1]));
  const lbs = /(\d{2,3})\s*lbs?/i.exec(s);
  if (lbs) return Math.round(Number(lbs[1]) / 2.2046);
  const n = bare(s);
  if (n != null && n >= 30 && n <= 200) return Math.round(n);
  return null;
}

/** A JSON array of strings (or an array) -> its non-empty trimmed unique strings; anything else -> []. */
function stringList(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const x of list) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export const tagsOf = (p) => stringList(p?.scraped_tags);
export const aliasesOf = (p) => stringList(p?.aliases);

/** Leakhaven has an upload she has not been checked off for (leakhavenState() 'new' in PerformerManagementPageNew.js). */
export function hasNewUpload(p) {
  return !!p?.leakshaven_url
    && !p.leakshaven_check_error
    && !!p.last_leakshaven_check_date
    && !!p.last_leakshaven_update_time
    && Number(p.leakshaven_update_acknowledged) !== 1;
}

/** The newest Leakhaven upload time as a Date, or null. SQLite's "YYYY-MM-DD HH:MM:SS" is read as UTC. */
export function newUploadDate(p) {
  const raw = p?.last_leakshaven_update_time;
  if (!raw) return null;
  const s = String(raw);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// fixed month names: newer browsers write 'Sept' for en-GB
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '3 Nov' this year, '3 Nov 2025' another year. */
export function shortDate(d) {
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() !== new Date().getFullYear() ? `${day} ${d.getFullYear()}` : day;
}

/** '3 November 2026'. */
export const longDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** Her gallery in the app. */
export const galleryUrl = (p, root) => (
  `/unified-gallery?performer=${encodeURIComponent(p.name)}&basePath=${encodeURIComponent(p.folder_path || root || '')}`
);
