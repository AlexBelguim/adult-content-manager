const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const puppeteer = require('puppeteer-core');

// Same Chrome finder as scraperService.js
function getChromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const winPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (fs.existsSync(winPath)) return winPath;
  return null;
}

/**
 * Load all YAML scrapers from the scrapers directory
 */
function getAvailableYamlScrapers() {
  const scrapersDir = path.join(__dirname, '..', 'scrapers');
  if (!fs.existsSync(scrapersDir)) {
    return [];
  }
  
  const files = fs.readdirSync(scrapersDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  const scrapers = [];
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(scrapersDir, file), 'utf8');
      const parsed = yaml.load(content);
      if (parsed && parsed.name && (parsed.performerByName || parsed.performerByURL)) {
        scrapers.push({
          id: file.replace(/\.yaml|\.yml/i, ''),
          name: parsed.name,
          config: parsed
        });
      }
    } catch (e) {
      console.error(`Failed to parse YAML scraper ${file}:`, e.message);
    }
  }
  
  return scrapers;
}

/**
 * Apply Stash postProcess rules to a string
 */
function applyPostProcess(value, rules) {
  if (!value || !rules || !Array.isArray(rules)) return value;
  
  let result = String(value);
  
  for (const rule of rules) {
    if (rule.replace && Array.isArray(rule.replace)) {
      for (const rep of rule.replace) {
        if (rep.regex !== undefined && rep.with !== undefined) {
          try {
            // Check for flags like (?i)
            let flags = 'g';
            let regexStr = rep.regex;
            if (regexStr.startsWith('(?i)')) {
              flags = 'gi';
              regexStr = regexStr.replace('(?i)', '');
            }
            // Simple replace $1 with actual capture groups
            const re = new RegExp(regexStr, flags);
            result = result.replace(re, rep.with);
          } catch(e) {
            console.error('Regex error in scraper:', e.message, rep.regex);
          }
        }
      }
    }
    
    if (rule.map) {
      // Direct object mapping
      for (const [key, val] of Object.entries(rule.map)) {
        if (result === key || result.toLowerCase() === key.toLowerCase()) {
          result = val;
          break;
        }
      }
    }
    
    if (rule.parseDate) {
      // Basic date cleaning
      // Very simplified version of Go's time.Parse
      const date = new Date(result);
      if (!isNaN(date.getTime())) {
        result = date.toISOString().split('T')[0];
      }
    }
  }
  
  return result.trim();
}

/**
 * Scrape a performer using a YAML config
 */
async function scrapeWithYaml(scraperId, performerName) {
  const scrapers = getAvailableYamlScrapers();
  const scraper = scrapers.find(s => s.id === scraperId || s.name === scraperId);
  
  if (!scraper) {
    throw new Error(`YAML scraper ${scraperId} not found`);
  }
  
  const config = scraper.config;
  if (!config.performerByName || !config.performerByURL) {
    throw new Error(`Scraper ${scraper.name} is missing performerByName or performerByURL`);
  }
  
  const queryURL = config.performerByName.queryURL.replace('{}', encodeURIComponent(performerName));
  const searchScraperName = config.performerByName.scraper;
  const searchAction = config.performerByName.action;
  
  console.log(`[YAML Scraper] Step 1: Searching ${scraper.name} for ${performerName} at ${queryURL}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: getChromePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    let targetUrl = null;
    
    if (searchAction === 'scrapeJson') {
      // 1A. JSON Search
      await page.goto(queryURL, { waitUntil: 'networkidle2', timeout: 30000 });
      const jsonContent = await page.evaluate(() => {
        try { return JSON.parse(document.body.innerText); } catch(e) { return null; }
      });
      
      if (jsonContent) {
        const spec = config.jsonScrapers?.[searchScraperName]?.performer?.URLs;
        if (spec) {
          // Simple dot notation extractor (like query.search.#.title)
          let val = null;
          let selector = typeof spec === 'string' ? spec : spec.selector;
          
          if (selector) {
            try {
              // Extremely simplified json path handler for stash format
              // E.g. "query.search.#.title"
              const parts = selector.split('.');
              let curr = jsonContent;
              for (const part of parts) {
                if (part === '#') {
                  if (Array.isArray(curr) && curr.length > 0) {
                    curr = curr[0]; // Just take first item for now
                  } else {
                    curr = null; break;
                  }
                } else {
                  curr = curr?.[part];
                }
              }
              if (curr) val = String(curr);
            } catch(e) { console.error('JSON parse error', e); }
          }
          
          if (val && typeof spec === 'object' && spec.postProcess) {
            val = applyPostProcess(val, spec.postProcess);
          }
          targetUrl = val;
        }
      }
    } else if (searchAction === 'scrapeXPath') {
      // 1B. XPath Search
      await page.goto(queryURL, { waitUntil: 'networkidle2', timeout: 30000 });
      const spec = config.xPathScrapers?.[searchScraperName]?.performer?.URLs;
      
      if (spec) {
        targetUrl = await page.evaluate((spec) => {
          const getByXPath = (xpath) => {
            try {
              const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
              const node = result.iterateNext();
              if (!node) return null;
              if (node.nodeType === 2) return node.nodeValue;
              return node.textContent;
            } catch(e) { return null; }
          };
          
          if (typeof spec === 'string') return getByXPath(spec);
          return getByXPath(spec.selector);
        }, spec);
        
        if (targetUrl && typeof spec === 'object' && spec.postProcess) {
          targetUrl = applyPostProcess(targetUrl, spec.postProcess);
        }
      }
    }
    
    if (!targetUrl) {
      throw new Error(`Could not find performer URL from search results`);
    }
    
    console.log(`[YAML Scraper] Step 2: Extracting data from ${targetUrl}`);
    
    // Step 2: Scrape the actual performer page
    const detailScraperConf = config.performerByURL[0];
    const detailScraperName = detailScraperConf.scraper;
    const detailSpec = config.xPathScrapers?.[detailScraperName]?.performer;
    
    if (!detailSpec) {
      throw new Error(`Missing xPathScrapers.${detailScraperName}.performer`);
    }
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Evaluate all XPath selectors
    const scrapedRaw = await page.evaluate((spec) => {
      const results = {};
      
      const getByXPath = (xpath, concatChar = ' ') => {
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
          let val = '';
          let node = result.iterateNext();
          while (node) {
            let nodeVal = '';
            if (node.nodeType === 2) { 
              nodeVal = node.nodeValue;
            } else {
              nodeVal = node.textContent;
            }
            if (nodeVal) {
              val += (val ? concatChar : '') + nodeVal.trim();
            }
            node = result.iterateNext();
          }
          return val.trim();
        } catch(e) {
          return null;
        }
      };
      
      for (const [field, rule] of Object.entries(spec)) {
        const selector = typeof rule === 'string' ? rule : rule.selector;
        const concatChar = (typeof rule === 'object' && rule.concat) ? rule.concat : ' ';
        if (selector) {
          results[field] = getByXPath(selector, concatChar);
        }
      }
      
      return results;
    }, detailSpec);
    
    // Debug logging for raw data
    console.log(`[YAML Scraper] Raw Data from Page:`, JSON.stringify(scrapedRaw, null, 2));
    
    // Apply post processing
    const processedResults = {};
    for (const [field, rule] of Object.entries(detailSpec)) {
      let val = scrapedRaw[field];
      if (!val) {
        processedResults[field] = null;
        continue;
      }
      
      if (typeof rule === 'object' && rule.postProcess) {
        val = applyPostProcess(val, rule.postProcess);
      }
      
      processedResults[field] = val;
    }
    
    // Debug logging
    console.log(`[YAML Scraper] Processed Results:`, JSON.stringify(processedResults, null, 2));
    
    return processedResults;
    
  } finally {
    await browser.close();
  }
}

module.exports = {
  getAvailableYamlScrapers,
  scrapeWithYaml
};
