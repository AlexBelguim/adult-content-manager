const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Try to load puppeteer-core for browser-based scraping
let puppeteer = null;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.log('Puppeteer not available, will use HTTP scraping only');
}

/**
 * Parse measurement string into detailed fields
 * Examples: "34C (Natural)", "32D (Fake)", "36DD"
 */
function parseMeasurementDetails(measurementStr, physicalAttributes) {
  if (!measurementStr) return;

  // Extract band size and cup size (e.g., "34C" or "32DD")
  const sizeMatch = measurementStr.match(/(\d+)([A-Z]{1,3})/i);
  if (sizeMatch) {
    physicalAttributes.measurements_band_size = sizeMatch[1]; // "34"
    physicalAttributes.measurements_cup = sizeMatch[2].toUpperCase(); // "C"
  }

  // Check if natural or fake
  const lowerStr = measurementStr.toLowerCase();
  if (lowerStr.includes('natural') || lowerStr.includes('real')) {
    physicalAttributes.measurements_fake = false;
  } else if (lowerStr.includes('fake') || lowerStr.includes('enhanced') || lowerStr.includes('implant')) {
    physicalAttributes.measurements_fake = true;
  } else {
    physicalAttributes.measurements_fake = null; // Unknown
  }

  console.log('Parsed measurements:', {
    band: physicalAttributes.measurements_band_size,
    cup: physicalAttributes.measurements_cup,
    fake: physicalAttributes.measurements_fake
  });
}

/**
 * Convert country name or ISO code to flag emoji
 */
function countryToFlag(country) {
  if (!country) return null;

  // Normalize input
  const countryUpper = country.toUpperCase().trim();

  // ISO 3166-1 alpha-2 country codes to flag emojis
  const codeToFlag = (code) => {
    if (code.length !== 2) return null;
    const codePoints = [...code.toUpperCase()].map(char =>
      0x1F1E6 - 65 + char.charCodeAt(0)
    );
    return String.fromCodePoint(...codePoints);
  };

  // Country name/code mappings
  const countryMap = {
    // Full names
    'UNITED STATES': 'US',
    'USA': 'US',
    'UNITED KINGDOM': 'GB',
    'ENGLAND': 'GB',
    'GREAT BRITAIN': 'GB',
    'SCOTLAND': 'GB',
    'WALES': 'GB',
    'RUSSIA': 'RU',
    'RUSSIAN FEDERATION': 'RU',
    'SOUTH KOREA': 'KR',
    'KOREA': 'KR',
    'CZECH REPUBLIC': 'CZ',
    'CZECHIA': 'CZ',
    'NETHERLANDS': 'NL',
    'HOLLAND': 'NL',
    'SOUTH AFRICA': 'ZA',
    'NEW ZEALAND': 'NZ',

    // Common mappings
    'CANADA': 'CA',
    'AUSTRALIA': 'AU',
    'GERMANY': 'DE',
    'FRANCE': 'FR',
    'SPAIN': 'ES',
    'ITALY': 'IT',
    'BELGIUM': 'BE',
    'SWEDEN': 'SE',
    'NORWAY': 'NO',
    'DENMARK': 'DK',
    'FINLAND': 'FI',
    'POLAND': 'PL',
    'UKRAINE': 'UA',
    'ROMANIA': 'RO',
    'HUNGARY': 'HU',
    'BRAZIL': 'BR',
    'ARGENTINA': 'AR',
    'MEXICO': 'MX',
    'COLOMBIA': 'CO',
    'VENEZUELA': 'VE',
    'CHILE': 'CL',
    'PERU': 'PE',
    'JAPAN': 'JP',
    'CHINA': 'CN',
    'THAILAND': 'TH',
    'PHILIPPINES': 'PH',
    'VIETNAM': 'VN',
    'INDIA': 'IN',
    'PAKISTAN': 'PK',
    'BANGLADESH': 'BD',
    'EGYPT': 'EG',
    'MOROCCO': 'MA',
    'ISRAEL': 'IL',
    'TURKEY': 'TR',
    'GREECE': 'GR',
    'PORTUGAL': 'PT',
    'SWITZERLAND': 'CH',
    'AUSTRIA': 'AT',
    'IRELAND': 'IE',
    'SINGAPORE': 'SG',
    'MALAYSIA': 'MY',
    'INDONESIA': 'ID',
    'LATVIA': 'LV',
    'LITHUANIA': 'LT',
    'ESTONIA': 'EE',
    'CROATIA': 'HR',
    'SERBIA': 'RS',
    'SLOVENIA': 'SI',
    'SLOVAKIA': 'SK',
    'BULGARIA': 'BG',
    'ALBANIA': 'AL'
  };

  // If it's a 2-letter code, convert directly to flag
  if (countryUpper.length === 2 && /^[A-Z]{2}$/.test(countryUpper)) {
    return codeToFlag(countryUpper);
  }

  // Check exact match in country map
  if (countryMap[countryUpper]) {
    return codeToFlag(countryMap[countryUpper]);
  }

  // Check partial match
  for (const [key, code] of Object.entries(countryMap)) {
    if (countryUpper.includes(key) || key.includes(countryUpper)) {
      return codeToFlag(code);
    }
  }

  return null;
}

/**
 * Scrape performer information from leakshaven.com
 * @param {string} performerName - Name to search for
 * @param {string[]} aliases - Array of aliases to try if main name fails
 * @returns {Promise<Object>} Scraped performer data
 */
async function scrapeLeakshaven(performerName, aliases = []) {
  console.log(`Scraping leakshaven.com for: ${performerName}, aliases: ${aliases.join(', ')}`);

  // Try the main name first, then aliases
  const namesToTry = [performerName, ...aliases];

  let bestResult = null;
  let fallbackResult = null; // First valid page even if empty

  for (const name of namesToTry) {
    try {
      console.log(`Trying to scrape: ${name}`);
      const data = await scrapePerformerPage(name);

      // Check if page is valid (performer name appears on page)
      const isValidPage = data && data.pageFound !== false;

      if (!isValidPage) {
        console.log(`No valid page found for: ${name}`);
        continue;
      }

      console.log(`Valid page found for: ${name}`);

      // Check if we actually found meaningful data (not just empty objects)
      const hasData = data && (
        (data.personalInfo && Object.keys(data.personalInfo).filter(k => data.personalInfo[k]).length > 0) ||
        (data.physicalAttributes && Object.keys(data.physicalAttributes).filter(k => data.physicalAttributes[k]).length > 0) ||
        (data.tags && data.tags.length > 0) ||
        (data.alsoKnownAs && data.alsoKnownAs.length > 0)
      );

      if (hasData) {
        // Found content! This is the best result - stop searching
        console.log(`Successfully scraped data for: ${name}`);
        bestResult = { ...data, workingAlias: name, hasContent: true };
        break;
      } else if (!fallbackResult) {
        // Save first valid page as fallback (even if no content)
        console.log(`Valid page but no data for: ${name}, saving as fallback`);
        fallbackResult = { ...data, workingAlias: name, hasContent: false };
      }
    } catch (error) {
      console.log(`Failed to scrape ${name}:`, error.message);
      // Continue to next alias
    }
  }

  // Use best result if found, otherwise use fallback
  const finalResult = bestResult || fallbackResult;

  if (!finalResult) {
    throw new Error(`No valid model page found for ${performerName} or any aliases on leakshaven.com`);
  }

  return finalResult;
}

/**
 * Fetch and parse a single performer page
 */
async function scrapePerformerPage(name) {
  // If puppeteer is available, use it to render the client-side page
  if (puppeteer) {
    try {
      return await scrapeWithPuppeteer(name);
    } catch (error) {
      console.log('Puppeteer scraping failed, falling back to HTTP:', error.message);
    }
  }

  // Fallback to HTTP scraping (won't work for client-side rendered sites)
  return await scrapeWithHTTP(name);
}

/**
 * Scrape using Puppeteer for client-side rendered pages
 */
async function scrapeWithPuppeteer(name) {
  console.log(`Using Puppeteer to scrape: ${name}`);

  const searchQuery = name.replace(/\s+/g, '+');
  const url = `https://leakshaven.com/?q=${searchQuery}`;

  console.log(`Opening browser for URL: ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows Chrome path
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Intercept API calls to capture performer data
    const apiResponses = [];
    page.on('response', async (response) => {
      const url = response.url();
      // Look for API calls that might contain performer data
      if (url.includes('/api/') || url.includes('graphql') || url.includes('performer') || url.includes('model')) {
        try {
          const text = await response.text();
          apiResponses.push({ url, body: text });
          console.log(`Captured API response from: ${url}, length: ${text.length}`);
        } catch (e) {
          // Some responses can't be read as text
        }
      }
    });

    // Set user agent and language preference (English)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Also set browser locale to English
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    console.log('Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait a bit more for async data loading
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if we can find performer data directly on the page
    const performerData = await page.evaluate(() => {
      // Get the full page text
      const bodyText = document.body.innerText;

      // Look for performer info visible (English or Dutch)
      const hasPerformerName = bodyText.includes('Born in') || bodyText.includes('Geboren in') ||
        bodyText.includes('Height') || bodyText.includes('Hoogte') ||
        bodyText.includes('Personal Information') || bodyText.includes('Persoonlijke Informatie');

      return {
        hasPerformerName,
        bodyText: bodyText
      };
    });

    console.log('Has performer data on page:', performerData.hasPerformerName);

    // Get the rendered HTML
    const html = await page.content();
    console.log('HTML length after rendering:', html.length);

    // Save rendered HTML and API responses for debugging
    const debugFile = path.join(__dirname, '..', 'debug_rendered.html');
    fs.writeFileSync(debugFile, html, 'utf8');

    const debugBodyFile = path.join(__dirname, '..', 'debug_body_text.txt');
    fs.writeFileSync(debugBodyFile, performerData.bodyText, 'utf8');
    console.log(`Saved body text to: ${debugBodyFile}`);

    if (apiResponses.length > 0) {
      const apiDebugFile = path.join(__dirname, '..', 'debug_api_responses.json');
      fs.writeFileSync(apiDebugFile, JSON.stringify(apiResponses, null, 2), 'utf8');
      console.log(`Saved ${apiResponses.length} API responses to: ${apiDebugFile}`);
    }

    await browser.close();

    // If we found performer data in the body text, parse it
    if (performerData.hasPerformerName) {
      console.log('Parsing performer data from body text...');
      return parseBodyText(performerData.bodyText);
    }

    // Try to parse API responses 
    if (apiResponses.length > 0) {
      console.log('Attempting to parse API responses...');
      for (const apiResp of apiResponses) {
        try {
          const jsonData = JSON.parse(apiResp.body);
          // Look for performer data in the JSON
          const performerInfo = findPerformerData(jsonData);
          if (performerInfo && Object.keys(performerInfo).length > 0) {
            console.log('Found performer data in API response!');
            return performerInfo;
          }
        } catch (e) {
          // Not JSON or doesn't contain performer data
        }
      }
    }

    // Check if it's a 404
    if (html.includes('404') && html.includes('could not be found')) {
      console.log('Page shows 404 after rendering');
      return {
        personalInfo: {},
        physicalAttributes: {},
        tags: [],
        alsoKnownAs: []
      };
    }

    // Parse the rendered HTML
    return parsePerformerData(html);

  } finally {
    await browser.close();
  }
}

/**
 * Fallback HTTP-based scraping (for static pages)
 */
async function scrapeWithHTTP(name) {
  // Try different URL patterns that leakshaven might use
  const urlVariations = [
    // Try performer profile URLs
    `https://leakshaven.com/performer/${name.replace(/\s+/g, '-').toLowerCase()}`,
    `https://leakshaven.com/models/${name.replace(/\s+/g, '-').toLowerCase()}`,
    `https://leakshaven.com/model/${name.replace(/\s+/g, '-').toLowerCase()}`,
    // Also try the search query as fallback
    `https://leakshaven.com/?q=${name.replace(/\s+/g, '+')}`
  ];

  for (const url of urlVariations) {
    try {
      console.log(`Trying URL: ${url}`);
      const html = await fetchPage(url);

      // Log HTML snippet for debugging
      console.log('HTML length:', html.length);

      // Check if we got a 404 or error page - be more specific
      if (html.includes('This page could not be found') || html.includes('"notFound":true') || html.includes('"children":404')) {
        console.log('Received 404 page, trying next URL pattern...');
        continue;
      }

      // Look for key sections in the HTML
      const hasPersonalInfo = /Personal\s*Information/i.test(html);
      const hasPhysicalAttrs = /Physical\s*Attributes/i.test(html);
      const hasBornIn = /Born\s*in/i.test(html);
      const hasHeight = /Height/i.test(html);

      console.log('HTML sections found:', { hasPersonalInfo, hasPhysicalAttrs, hasBornIn, hasHeight });

      // Save full HTML to a temp file for debugging (only for first successful response)
      const debugFile = path.join(__dirname, '..', 'debug_html.html');
      fs.writeFileSync(debugFile, html, 'utf8');
      console.log(`Full HTML saved to: ${debugFile}`);

      // If we found some performer data, parse and return it
      if (hasPersonalInfo || hasPhysicalAttrs || hasBornIn || hasHeight) {
        console.log('Found performer data, parsing...');
        return parsePerformerData(html);
      }
    } catch (error) {
      console.log(`Failed to fetch ${url}:`, error.message);
      continue;
    }
  }

  // No valid URL found
  console.log('No valid performer page found for any URL pattern');
  return {
    personalInfo: {},
    physicalAttributes: {},
    tags: [],
    alsoKnownAs: []
  };
}

/**
 * Fetch a page via HTTPS
 */
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Parse HTML to extract performer information
 */
function parsePerformerData(html) {
  const data = {
    personalInfo: {},
    physicalAttributes: {},
    tags: [],
    alsoKnownAs: [],
    pageFound: true // Assume page is valid unless proven otherwise
  };

  // Try to extract JSON data from Next.js props
  const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (jsonMatch) {
    try {
      const jsonData = JSON.parse(jsonMatch[1]);
      console.log('Found __NEXT_DATA__, parsing...');

      // Try to find performer data in the JSON structure
      const performerData = findPerformerData(jsonData);
      if (performerData) {
        console.log('Found performer data in JSON:', performerData);

        // Extract from JSON structure
        if (performerData.age) data.personalInfo.age = performerData.age;
        if (performerData.born) data.personalInfo.born = performerData.born;
        if (performerData.birthplace) data.personalInfo.birthplace = performerData.birthplace;
        if (performerData.country) data.personalInfo.countryFlag = performerData.country;
        if (performerData.height) data.physicalAttributes.height = performerData.height;
        if (performerData.weight) data.physicalAttributes.weight = performerData.weight;
        if (performerData.measurements) data.physicalAttributes.measurements = performerData.measurements;
        if (performerData.hair) data.physicalAttributes.hair = performerData.hair;
        if (performerData.eyes) data.physicalAttributes.eyes = performerData.eyes;
        if (performerData.ethnicity) data.physicalAttributes.ethnicity = performerData.ethnicity;
        if (performerData.body || performerData.bodyType) data.physicalAttributes.bodyType = performerData.body || performerData.bodyType;
        if (performerData.orientation) data.personalInfo.orientation = performerData.orientation;
        if (performerData.aliases) data.alsoKnownAs = Array.isArray(performerData.aliases) ? performerData.aliases : [performerData.aliases];
        if (performerData.tags) data.tags = Array.isArray(performerData.tags) ? performerData.tags : [performerData.tags];

        return data;
      }
    } catch (e) {
      console.log('Failed to parse JSON data:', e.message);
    }
  }

  // Fallback to regex parsing for plain HTML
  console.log('Using regex parsing...');

  // Extract "Also Known As" / aliases - try multiple formats
  const akaPatterns = [
    /(?:Also Known As|AKA|Aliases?)[:\s]*([^<\n]+)/gi,
    /"aliases?":\s*"([^"]+)"/gi,
    /"aliases?":\s*\[([^\]]+)\]/gi
  ];

  for (const pattern of akaPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        const aliases = match[1].split(/[,;]/)
          .map(name => name.trim().replace(/["\[\]]/g, ''))
          .filter(name => name.length > 0);
        data.alsoKnownAs.push(...aliases);
      }
    }
  }
  data.alsoKnownAs = [...new Set(data.alsoKnownAs)]; // Remove duplicates

  // Extract Age - try multiple patterns
  const agePatterns = [
    /(\d+)\s+years?\s+old/i,  // "25 years old" or "25 year old"
    /(?:Age|age)[:\s]*(\d+)/i,
    /"age":\s*(\d+)/i,
    />Age<\/[^>]+>\s*<[^>]+>(\d+)</i
  ];
  for (const pattern of agePatterns) {
    const match = html.match(pattern);
    if (match) {
      data.personalInfo.age = parseInt(match[1]);
      console.log('Found age:', data.personalInfo.age);
      break;
    }
  }

  // Extract Born/Birthdate
  const bornPatterns = [
    /(?:Born|Birthdate)[:\s]*([^<\n]+)/i,
    /"born":\s*"([^"]+)"/i,
    />Born<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of bornPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.personalInfo.born = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Birthplace/Country - updated patterns for leakshaven structure
  const birthplacePatterns = [
    /Born\s*in\s*<span[^>]*>\s*([^<]+)\s*<\/span>/i,
    /Birthplace[:\s]*([^<\n]+)/i,
    /"(?:birthplace|country)":\s*"([^"]+)"/i,
    />(?:Birthplace|Country)<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of birthplacePatterns) {
    const match = html.match(pattern);
    if (match) {
      data.personalInfo.birthplace = match[1].trim().replace(/["\[\]]/g, '');

      // Extract country flag emoji or code
      const flagMatch = match[1].match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
      const codeMatch = match[1].match(/\b([A-Z]{2})\b/);

      if (flagMatch) {
        data.personalInfo.countryFlag = flagMatch[0];
      } else if (codeMatch) {
        data.personalInfo.countryFlag = codeMatch[1];
      }

      // Try to find the flag emoji in the full HTML near the birthplace
      const surroundingText = html.substring(Math.max(0, html.indexOf(match[0]) - 100), html.indexOf(match[0]) + 200);
      const nearbyFlag = surroundingText.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
      if (nearbyFlag && !data.personalInfo.countryFlag) {
        data.personalInfo.countryFlag = nearbyFlag[0];
      }
      break;
    }
  }

  // Extract Height
  const heightPatterns = [
    /(?:Height|height)[:\s]*([^<\n]+?)(?:\s*\(|<|$)/i,
    /"height":\s*"([^"]+)"/i,
    />Height<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of heightPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.physicalAttributes.height = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Weight
  const weightPatterns = [
    /(?:Weight|weight)[:\s]*([^<\n]+?)(?:\s*\(|<|$)/i,
    /"weight":\s*"([^"]+)"/i,
    />Weight<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of weightPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.physicalAttributes.weight = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Measurements
  const measurementsPatterns = [
    /(?:Measurements|measurements)[:\s]*([^<\n]+)/i,
    /"measurements":\s*"([^"]+)"/i,
    />Measurements<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of measurementsPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.physicalAttributes.measurements = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Hair Color
  const hairPatterns = [
    /(?:Hair|hair)[:\s]*([^<\n]+?)(?:\s*\(|<|$)/i,
    /"hair":\s*"([^"]+)"/i,
    />Hair<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of hairPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.physicalAttributes.hair = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Eye Color
  const eyesPatterns = [
    /(?:Eyes?|eyes?)[:\s]*([^<\n]+?)(?:\s*\(|<|$)/i,
    /"eyes?":\s*"([^"]+)"/i,
    />Eyes?<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of eyesPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.physicalAttributes.eyes = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Ethnicity - updated for leakshaven structure
  const ethnicityPatterns = [
    /<span[^>]*class="[^"]*font-medium[^"]*"[^>]*>\s*(White|Black|Asian|Latina|Mixed|Indian|Middle Eastern|Native American)\s*<\/span>/i,
    /(?:Ethnicity|ethnicity)[:\s]*([^<\n]+)/i,
    /"ethnicity":\s*"([^"]+)"/i,
    />Ethnicity<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of ethnicityPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.physicalAttributes.ethnicity = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Body Type
  const bodyPatterns = [
    /(?:Body|body)[:\s]*([^<\n]+?)(?:\s*\(|<|$)/i,
    /"body(?:Type)?":\s*"([^"]+)"/i,
    />Body<\/[^>]+>\s*<[^>]+>([^<]+)</i
  ];
  for (const pattern of bodyPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.physicalAttributes.bodyType = match[1].trim().replace(/["\[\]]/g, '');
      break;
    }
  }

  // Extract Orientation (sexuality)
  const orientationPatterns = [
    /(?:Orientation|orientation|Sexuality|sexuality)[:\s]*([^<\n]+)/i,
    /"(?:orientation|sexuality)":\s*"([^"]+)"/i,
    />(?:Orientation|Sexuality)<\/[^>]+>\s*<[^>]+>([^<]+)</i,
    /(?:Bisexual|Heterosexual|Homosexual|Gay|Lesbian|Pansexual|Asexual)/i
  ];
  for (const pattern of orientationPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.personalInfo.orientation = match[1] ? match[1].trim().replace(/["\[\]]/g, '') : match[0];
      break;
    }
  }

  // Extract Tags (categories, niches)
  const tagsPatterns = [
    /(?:Tags|tags|Categories|categories)[:\s]*([^<\n]+)/i,
    /"tags":\s*\[([^\]]+)\]/i
  ];
  for (const pattern of tagsPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.tags = match[1]
        .split(/[,;]/)
        .map(tag => tag.trim().replace(/["\[\]]/g, ''))
        .filter(tag => tag.length > 0);
      break;
    }
  }

  return data;
}

/**
 * Parse performer data from plain body text (for puppeteer-rendered pages)
 */
function parseBodyText(bodyText) {
  const data = {
    personalInfo: {},
    physicalAttributes: {},
    tags: [],
    alsoKnownAs: [],
    pageFound: true // Page was found (we have body text)
  };

  console.log('Parsing body text, length:', bodyText.length);

  // Extract age (X years old)
  const ageMatch = bodyText.match(/(\d+)\s+years?\s+old/i);
  if (ageMatch) {
    data.personalInfo.age = parseInt(ageMatch[1]);
    console.log('Found age:', data.personalInfo.age);
  }

  // Extract aliases (Also Known As / Ook bekend als)
  // Stop at # symbols which indicate tags, or at Personal Information section
  const aliasMatch = bodyText.match(/(?:Also known as|Ook bekend als)\s+([\s\S]+?)(?:\n#|\n\n|Personal|Persoonlijke)/i);
  if (aliasMatch) {
    // Common tag/category keywords that should not be treated as aliases
    const tagKeywords = ['model', 'influencer', 'porn star', 'pornstar', 'stripper', 'actress', 'adult model',
      'onlyfans', 'cosplayer', 'gamer', 'youtuber', 'tiktoker', 'instagram', 'streamer', 'webcam', 'camgirl',
      'milf', 'teen', 'amateur', 'professional', 'escort', 'dancer', 'content creator'];

    const aliases = aliasMatch[1].split('\n')
      .map(a => a.trim())
      .filter(a => {
        if (!a || a.length === 0 || a.length > 50) return false;
        // Filter out # symbols (tag markers)
        if (a === '#' || a.startsWith('#')) return false;
        // Filter out common tag keywords (case insensitive)
        if (tagKeywords.includes(a.toLowerCase())) return false;
        return true;
      });
    data.alsoKnownAs = aliases;
    console.log('Found aliases:', aliases);
  }

  // Extract birthplace and country (Geboren in / Born in)
  const bornMatch = bodyText.match(/(?:Geboren in|Born in)\s+([^\n]+)/i);
  if (bornMatch) {
    data.personalInfo.birthplace = bornMatch[1].trim();
    console.log('Found birthplace:', data.personalInfo.birthplace);

    // First try to extract flag emoji if present in text
    const flagMatch = bornMatch[1].match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if (flagMatch) {
      data.personalInfo.countryFlag = flagMatch[0];
      console.log('Found flag emoji:', data.personalInfo.countryFlag);
    } else {
      // Convert country name to flag emoji
      const flag = countryToFlag(data.personalInfo.birthplace);
      if (flag) {
        data.personalInfo.countryFlag = flag;
        console.log('Converted country to flag:', data.personalInfo.birthplace, '→', flag);
      } else {
        console.log('No flag mapping found for:', data.personalInfo.birthplace);
      }
    }
  }

  // Extract ethnicity (Wit / White)
  const ethnicityMatch = bodyText.match(/(?:Personal Information|Persoonlijke Informatie)[\s\S]{0,200}?\n(White|Black|Asian|Latina|Wit|Zwart|Aziatisch|Latijns)\n/i);
  if (ethnicityMatch) {
    const ethnicity = ethnicityMatch[1].trim();
    // Translate Dutch to English
    const translations = {
      'Wit': 'White',
      'Zwart': 'Black',
      'Aziatisch': 'Asian',
      'Latijns': 'Latina'
    };
    data.physicalAttributes.ethnicity = translations[ethnicity] || ethnicity;
    console.log('Found ethnicity:', data.physicalAttributes.ethnicity);
  }

  // Extract Hair color (Haar / Hair)
  const hairMatch = bodyText.match(/(?:Haar|Hair):\s*\n?([^\n]+)/i);
  if (hairMatch) {
    data.physicalAttributes.hair = hairMatch[1].trim();
    console.log('Found hair color:', data.physicalAttributes.hair);
  }

  // Extract Eye color (Ogen / Eyes)
  const eyesMatch = bodyText.match(/(?:Ogen|Eyes):\s*\n?([^\n]+)/i);
  if (eyesMatch) {
    data.physicalAttributes.eyes = eyesMatch[1].trim();
    console.log('Found eye color:', data.physicalAttributes.eyes);
  }

  // Extract Body type (Lichaam / Body)
  const bodyMatch = bodyText.match(/(?:Lichaam|Body):\s*\n?([^\n]+)/i);
  if (bodyMatch) {
    const bodyType = bodyMatch[1].trim();
    // Translate Dutch to English if needed
    const translations = {
      'Atletisch': 'Athletic',
      'Slank': 'Slim',
      'Gemiddeld': 'Average',
      'Volslank': 'Curvy'
    };
    data.physicalAttributes.bodyType = translations[bodyType] || bodyType;
    console.log('Found body type:', data.physicalAttributes.bodyType);
  }

  // Extract Bust/Breast size (Borst / Bust / Breast / Boobs)
  const bustMatch = bodyText.match(/(?:Borst|Bust|Breast|Boobs):\s*\n?([^\n]+)/i);
  if (bustMatch) {
    const measurement = bustMatch[1].trim();
    data.physicalAttributes.measurements = measurement;
    // Parse detailed measurements
    parseMeasurementDetails(measurement, data.physicalAttributes);
    console.log('Found measurements:', data.physicalAttributes.measurements);
  } else {
    // Try to find it in a different format like "32D (Natural)"
    const altBustMatch = bodyText.match(/(\d+[A-Z]{1,2})\s*\([^)]+\)/i);
    if (altBustMatch) {
      data.physicalAttributes.measurements = altBustMatch[0].trim();
      parseMeasurementDetails(altBustMatch[0].trim(), data.physicalAttributes);
      console.log('Found measurements (alt format):', data.physicalAttributes.measurements);
    }
  }

  // Extract Height (Hoogte / Height)
  const heightMatch = bodyText.match(/(?:Hoogte|Height):\s*\n?([^\n]+)/i);
  if (heightMatch) {
    data.physicalAttributes.height = heightMatch[1].trim();
    console.log('Found height:', data.physicalAttributes.height);
  }

  // Extract Weight (Gewicht / Weight)
  const weightMatch = bodyText.match(/(?:Gewicht|Weight):\s*\n?([^\n]+)/i);
  if (weightMatch) {
    data.physicalAttributes.weight = weightMatch[1].trim();
    console.log('Found weight:', data.physicalAttributes.weight);
  }

  // Extract Tags (after "Tags" section)
  const tagsMatch = bodyText.match(/Tags\s+([\s\S]+?)(?:\n\n|All Models|Alle Profielen|Widowkush|WidowKush)/i);
  if (tagsMatch) {
    const tags = tagsMatch[1].split('\n')
      .map(t => t.trim())
      .filter(t => {
        // Filter out non-tag items
        if (!t || t.length < 3 || t.length > 50) return false;
        if (/^\d+\s*(MB|GB|KB|TB)$/i.test(t)) return false; // File sizes
        if (/ago$/i.test(t)) return false; // Time stamps
        if (/^\d+$/.test(t)) return false; // Pure numbers
        if (/open link|more|share/i.test(t)) return false; // UI elements
        return true;
      });
    data.tags = tags;
    console.log('Found tags:', tags);
  }

  console.log('Parsed data summary:', {
    hasAliases: data.alsoKnownAs.length > 0,
    hasBirthplace: !!data.personalInfo.birthplace,
    hasEthnicity: !!data.personalInfo.ethnicity,
    hasHeight: !!data.physicalAttributes.height,
    tagCount: data.tags.length
  });

  return data;
}

/**
 * Recursively search for performer data in JSON object
 */
function findPerformerData(obj, depth = 0) {
  if (depth > 10) return null; // Prevent infinite recursion

  if (typeof obj !== 'object' || obj === null) return null;

  // Check if this object looks like performer data
  if (obj.height || obj.age || obj.born || obj.ethnicity) {
    return obj;
  }

  // Search nested objects
  for (const key in obj) {
    const result = findPerformerData(obj[key], depth + 1);
    if (result) return result;
  }

  return null;
}

/**
 * Check for latest content update time from leakshaven.com search
 * @param {string} performerName - Name to search for
 * @param {string[]} aliases - Array of aliases to try if main name fails
 * @param {string} workingAlias - (Optional) Previously saved working alias to check first
 * @returns {Promise<Object>} Object with lastUpdateTime string and error if any
 * 
 * Note: If a workingAlias is provided (from scraped_status = 'scraped' or 'found_no_data'),
 * it will be checked first to avoid unnecessary API calls to aliases that don't work.
 */
async function checkLeakshavenUpdates(performerName, aliases = [], workingAlias = null) {
  console.log(`Checking leakshaven.com updates for: ${performerName}, aliases: ${aliases.join(', ')}${workingAlias ? `, using saved alias: ${workingAlias}` : ''}`);

  // If we have a known working alias, try it first
  const namesToTry = workingAlias
    ? [workingAlias, performerName, ...aliases.filter(a => a !== workingAlias)]
    : [performerName, ...aliases];
  const allResults = [];

  for (const nameToSearch of namesToTry) {
    try {
      console.log(`\n=== Searching leakshaven for: "${nameToSearch}" ===`);
      const result = await fetchLatestContentTime(nameToSearch);

      if (result) {
        console.log(`✓ Found content for "${nameToSearch}": ${result.time}`);
        allResults.push({
          searchName: nameToSearch,
          time: result.time,
          minutes: result.minutes
        });
      } else {
        console.log(`✗ No content found for "${nameToSearch}"`);
      }

      // Small delay between searches
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`✗ Error checking "${nameToSearch}":`, error.message);
    }
  }

  if (allResults.length === 0) {
    throw new Error(`No content found for ${performerName} or any aliases on leakshaven.com`);
  }

  // Sort by time (newest first = smallest minutes value)
  allResults.sort((a, b) => a.minutes - b.minutes);

  const newest = allResults[0];
  console.log(`\n=== Returning newest from ${allResults.length} result(s): ${newest.time} (from "${newest.searchName}") ===\n`);

  return {
    lastUpdateTime: newest.time,
    searchName: newest.searchName,
    error: null
  };
}

/**
 * Fetch latest content update time from leakshaven search page
 */
async function fetchLatestContentTime(nameToSearch) {
  // Use puppeteer if available for client-side rendered pages
  if (puppeteer) {
    try {
      return await fetchLatestContentTimeWithPuppeteer(nameToSearch);
    } catch (error) {
      console.log('Puppeteer fetch failed:', error.message);
      return null;
    }
  }

  // Fallback to HTTP (likely won't work for client-side rendered sites)
  return await fetchLatestContentTimeWithHTTP(nameToSearch);
}

/**
 * Use Puppeteer to fetch latest content time from leakshaven
 */
async function fetchLatestContentTimeWithPuppeteer(nameToSearch) {
  console.log(`Using Puppeteer to check updates for: ${nameToSearch}`);

  const searchQuery = nameToSearch.replace(/\s+/g, '+');
  const url = `https://leakshaven.com/?q=${searchQuery}`;

  console.log(`Opening browser for URL: ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    console.log('Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract upload times from matching content cards
    const result = await page.evaluate((searchName) => {
      // Helper to normalize names for comparison
      const normalizeName = (name) => {
        return name.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, '');
      };

      const normalizedSearchName = normalizeName(searchName);
      console.log('Looking for normalized name:', normalizedSearchName);

      // Helper to convert time string to comparable number (in minutes)
      const timeToMinutes = (timeStr) => {
        const match = timeStr.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
        if (!match) return Infinity;

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        switch (unit) {
          case 'minute': return value;
          case 'hour': return value * 60;
          case 'day': return value * 60 * 24;
          case 'week': return value * 60 * 24 * 7;
          case 'month': return value * 60 * 24 * 30;
          case 'year': return value * 60 * 24 * 365;
          default: return Infinity;
        }
      };

      // Look for all content cards
      const cards = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');
      console.log(`Found ${cards.length} total cards on page`);

      const matchingTimes = [];

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        // Get the performer name from the card - try multiple selectors
        let cardName = null;
        const nameElement = card.querySelector('[class*="text-2xl"]') ||
          card.querySelector('[class*="font-semibold"][class*="leading-none"]') ||
          card.querySelector('h2, h3, h1');

        if (nameElement) {
          cardName = nameElement.textContent.trim();
        }

        // If no name found in typical places, this might be the first card without explicit name
        // In that case, we assume it matches the search if it's the first result
        const isFirstCard = i === 0;
        const normalizedCardName = cardName ? normalizeName(cardName) : '';

        console.log(`Card ${i + 1}: name="${cardName || '(no name)'}"`);

        // Check if this card matches our search name
        // Match if: exact match OR first card with no name (assume it's the searched performer)
        const isMatch = normalizedCardName === normalizedSearchName ||
          (isFirstCard && !cardName);

        if (isMatch) {
          console.log(`  ✓ Card matches search name`);

          // Find the upload time in this card
          const statsRow = card.querySelector('span.flex.flex-row.flex-wrap');

          if (statsRow) {
            const childSpans = Array.from(statsRow.children).filter(el => el.tagName === 'SPAN');

            for (const span of childSpans) {
              const uploadIcon = span.querySelector('svg.lucide-upload');
              if (uploadIcon) {
                const nestedSpan = span.querySelector('span');
                if (nestedSpan && nestedSpan.textContent) {
                  const text = nestedSpan.textContent.trim();

                  if (text.match(/\d+\s+(minute|hour|day|week|month|year)s?\s+ago/i)) {
                    console.log(`  Found upload time: "${text}"`);
                    matchingTimes.push({
                      time: text,
                      minutes: timeToMinutes(text)
                    });
                  }
                }
              }
            }
          }
        }
      }

      if (matchingTimes.length === 0) {
        console.log('No matching content found');
        return null;
      }

      // Sort by time (newest first = smallest minutes value)
      matchingTimes.sort((a, b) => a.minutes - b.minutes);

      console.log(`Found ${matchingTimes.length} matching upload(s), returning newest:`, matchingTimes[0]);
      return matchingTimes[0];

    }, nameToSearch);

    await browser.close();

    return result;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Fallback HTTP-based fetch (unlikely to work for client-side rendered sites)
 */
async function fetchLatestContentTimeWithHTTP(nameToSearch) {
  const searchQuery = nameToSearch.replace(/\s+/g, '+');
  const url = `https://leakshaven.com/?q=${searchQuery}`;

  try {
    const html = await fetchPage(url);

    // Try to extract time from HTML (won't work if client-side rendered)
    const timeMatch = html.match(/<span[^>]*>(\d+\s+(minutes?|hours?|days?|weeks?|months?)\s+ago)<\/span>/i);

    if (timeMatch) {
      return { time: timeMatch[1], minutes: 0 }; // Can't calculate exact minutes from HTML
    }

    return null;
  } catch (error) {
    console.log('HTTP fetch failed:', error.message);
    return null;
  }
}

module.exports = {
  scrapeLeakshaven,
  checkLeakshavenUpdates
};
