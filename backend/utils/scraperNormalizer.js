/**
 * Normalizes scraped data from various sources into the internal performer format
 */
function normalizeScrapedPerformerData(rawResult) {
  if (!rawResult) return null;

  const normalized = {
    personalInfo: {
      name: rawResult.Name || null,
      age: rawResult.Age ? parseInt(rawResult.Age) : null,
      born: rawResult.Birthdate || null,
      birthplace: rawResult.Birthplace || null,
      countryFlag: rawResult.Country || null,
      orientation: rawResult.Orientation || null
    },
    physicalAttributes: {
      ethnicity: rawResult.Ethnicity || null,
      eyes: rawResult.EyeColor || null,
      hair: rawResult.HairColor || null,
      height: rawResult.Height || null,
      weight: rawResult.Weight || null,
      measurements: rawResult.Measurements || null,
      bodyType: rawResult.BodyType || null,
      pubic_hair: rawResult.PubicHair || null,
      tattoos: rawResult.Tattoos || 'None',
      piercings: rawResult.Piercings || 'None',
      measurements_fake: null,
      measurements_cup: null
    },
    tags: [],
    alsoKnownAs: [],
    hasContent: true
  };

  // Handle Aliases
  if (rawResult.Aliases) {
    normalized.alsoKnownAs = rawResult.Aliases.split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // Handle Tags
  if (rawResult.Tags) {
    normalized.tags = rawResult.Tags.split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // Handle Babepedia Specifics: FakeTits & CupSize
  if (rawResult.FakeTits) {
    const fakeStr = rawResult.FakeTits.toLowerCase();
    normalized.physicalAttributes.measurements_fake = fakeStr.includes('fake') || fakeStr.includes('enhanced');
  }

  if (rawResult.CupSize) {
    const isFake = normalized.physicalAttributes.measurements_fake;
    normalized.physicalAttributes.measurements_cup = `${rawResult.CupSize} (${isFake ? 'Fake' : 'Natural'})`;
  }

  return normalized;
}

module.exports = {
  normalizeScrapedPerformerData
};
