/**
 * Convert ISO 3166-1 alpha-2 country code to flag emoji
 * @param {string} code - 2-letter country code (e.g., "US", "RU", "GB")
 * @returns {string|null} - Flag emoji or null if invalid
 */
export function codeToFlag(code) {
  if (!code || typeof code !== 'string') return null;
  
  const trimmed = code.trim().toUpperCase();
  
  // If it's already a flag emoji (contains regional indicator symbols), return as is
  const codePoints = [...trimmed].map(c => c.codePointAt(0));
  const hasRegionalIndicator = codePoints.some(cp => cp >= 0x1F1E6 && cp <= 0x1F1FF);
  
  if (hasRegionalIndicator) {
    return code;
  }
  
  // Convert 2-letter code to flag
  if (trimmed.length === 2 && /^[A-Z]{2}$/.test(trimmed)) {
    const codePointsToConvert = [...trimmed].map(char => 
      0x1F1E6 - 65 + char.charCodeAt(0)
    );
    const flag = String.fromCodePoint(...codePointsToConvert);
    return flag;
  }
  
  return null;
}

/**
 * Ensure country_flag is a proper flag emoji, converting codes if needed
 * @param {string} countryFlag - Could be a flag emoji or 2-letter code
 * @returns {string|null} - Flag emoji or null
 */
export function ensureFlag(countryFlag) {
  if (!countryFlag) return null;
  
  // Use codePointAt instead of charCodeAt to properly handle emojis
  const codePoints = [];
  for (let i = 0; i < countryFlag.length; i++) {
    const cp = countryFlag.codePointAt(i);
    codePoints.push(cp);
    // Skip the next character if this was a surrogate pair
    if (cp > 0xFFFF) i++;
  }
  
  // Check if already a flag emoji (regional indicator symbols are 0x1F1E6-0x1F1FF)
  const hasRegionalIndicator = codePoints.some(cp => cp >= 0x1F1E6 && cp <= 0x1F1FF);
  
  if (hasRegionalIndicator) {
    return countryFlag;
  }
  
  // Try to convert from code
  return codeToFlag(countryFlag);
}
