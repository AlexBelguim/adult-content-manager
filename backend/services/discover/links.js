/**
 * The link the page opens for a site's page. Leakhaven: its search, leakshaven.com/?q=<name>, instead of the model
 * page leakshaven.com/model/<name>. Only what is shown changes: results.db and the profile data exported for the
 * app keep /model/<name>, which the app reads the model's name from (leakshaven_url, its update checks).
 */
const siteLink = (url) => typeof url === 'string'
  ? url.replace(/^https:\/\/(?:www\.)?leakshaven\.com\/model\/([^/?#]+)\/?$/i, 'https://leakshaven.com/?q=$1')
  : url;

/** A part of a link decoded, or as it is when it is not valid percent-encoding ("100%" in a name) */
const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

module.exports = { siteLink, safeDecode };
