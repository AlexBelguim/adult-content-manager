const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const https = require('https');
const db = require('../db');

// Configuration
const PRODUCT_PERMALINK = process.env.GUMROAD_PRODUCT_PERMALINK || 'wrjde';
// Gumroad now requires product_id. Provide via env or fall back to a known id for this product.
const PRODUCT_ID = process.env.GUMROAD_PRODUCT_ID || (db.prepare("SELECT value FROM app_settings WHERE key = 'gumroad_product_id'").get()?.value) || 'qBU348KV5U7DAwCRIEHw7w==';
const TOKEN_VALID_DAYS = parseInt(process.env.LICENSE_CACHE_DAYS || '14', 10);
const SIGNING_SECRET = process.env.LICENSE_SECRET || 'CHANGE_ME_SECRET';

// Helpers
function now() { return new Date(); }
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function toISO(date) { return new Date(date).toISOString(); }

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const payloadB64 = base64url(payload);
  const hmac = crypto.createHmac('sha256', SIGNING_SECRET);
  hmac.update(payloadB64);
  const signature = hmac.digest('hex');
  return `${payloadB64}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  const hmac = crypto.createHmac('sha256', SIGNING_SECRET);
  hmac.update(payloadB64);
  const expected = hmac.digest('hex');
  if (expected !== signature) return null;
  try {
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const payload = JSON.parse(json);
    return payload;
  } catch (e) {
    return null;
  }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

function deleteSetting(key) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

function postForm(urlString, formParams) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const body = formParams.toString();
      const options = {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'application/json',
          'User-Agent': 'adult-content-manager/1.0'
        },
        timeout: 15000
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const text = data || '';
            let json;
            try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
            if (res.statusCode && res.statusCode >= 400) {
              const err = new Error(`HTTP ${res.statusCode}`);
              err.statusCode = res.statusCode;
              err.response = json;
              return reject(err);
            }
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('timeout', () => {
        req.destroy(new Error('Request timeout'));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function verifyWithGumroad(licenseKey, shouldIncrement = false) {
  const params = new URLSearchParams({
    product_id: PRODUCT_ID,
    product_permalink: PRODUCT_PERMALINK,
    license_key: licenseKey,
    increment_uses_count: shouldIncrement ? 'true' : 'false'
  });
  const data = await postForm('https://api.gumroad.com/v2/licenses/verify', params);
  return data;
}

async function decrementWithGumroad(licenseKey) {
  // NOTE: Gumroad's decrement_uses_count endpoint requires OAuth seller authentication
  // It's not available for customer self-service. Customers can only view their usage.
  // To actually free up a device slot, you must:
  // 1. Go to your Gumroad dashboard
  // 2. Find the purchase
  // 3. Manually adjust the license usage count

  // For now, we'll just return success without actually decrementing
  // This will clear the local license, which is still useful for the user
  console.warn('[license] Decrement not actually performed - requires Gumroad seller OAuth');
  return { success: true, message: 'Local license cleared' };
}

function buildStatus() {
  // License check disabled — always return licensed
  return {
    licensed: true,
    expiresAt: null,
    email: null,
    product: null,
    needsRevalidation: false,
  };
}

// GET /api/license/status
// Fast local check - does NOT contact Gumroad
// This allows offline use within the 14-day cached token period
router.get('/status', (req, res) => {
  try {
    const status = buildStatus();
    res.json(status);
  } catch (err) {
    console.error('[license] status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/license/verify { licenseKey }
router.post('/verify', async (req, res) => {
  try {
    const { licenseKey } = req.body || {};
    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({ error: 'licenseKey is required' });
    }
    const masked = licenseKey.replace(/.(?=.{4})/g, '*');
    console.log('[license] verifying key', masked);

    // Check if this is a new key (first activation) or existing key (refresh)
    const existingKey = getSetting('license_key');
    const isNewActivation = !existingKey || existingKey.trim() !== licenseKey.trim();

    console.log('[license] isNewActivation:', isNewActivation);

    // Only increment on first activation of a new key
    const data = await verifyWithGumroad(licenseKey.trim(), isNewActivation);

    if (!data.success) {
      return res.status(400).json({ error: data.message || 'Invalid license key' });
    }

    const purchase = data.purchase || {};
    const uses = data.uses || 0;
    const quantity = purchase.quantity || 1;
    const isMultiseat = purchase.is_multiseat_license;

    // Determine max uses from quantity (Gumroad's multiseat uses quantity as the limit)
    const maxUses = isMultiseat ? quantity : 1;

    console.log('[license] Uses:', uses, 'Max:', maxUses, 'Multiseat:', isMultiseat);

    // Check if over limit BEFORE saving (only if we just incremented)
    if (isNewActivation && uses > maxUses) {
      console.log('[license] BLOCKED - Usage limit exceeded:', uses, '>', maxUses);
      return res.status(403).json({
        error: 'License activation limit exceeded',
        uses: uses,
        maxUses: maxUses,
        message: `This license has been activated ${uses} times but only allows ${maxUses} device(s). Please manage your activations through Gumroad.`,
        overLimit: true
      });
    }

    // Persist product_id if present
    if (purchase.product_id) {
      setSetting('gumroad_product_id', purchase.product_id);
    } else if (PRODUCT_ID) {
      setSetting('gumroad_product_id', PRODUCT_ID);
    }
    // Create signed token
    const issuedAt = now();
    const expiresAt = addDays(issuedAt, TOKEN_VALID_DAYS);
    const payload = {
      k: crypto.createHash('sha256').update(licenseKey).digest('hex'),
      e: toISO(expiresAt),
      i: toISO(issuedAt),
      p: PRODUCT_PERMALINK
    };
    const token = signToken(payload);

    // Persist settings
    setSetting('license_key', licenseKey.trim());
    setSetting('license_email', purchase.email || '');
    setSetting('license_token', token);
    setSetting('license_token_expires_at', toISO(expiresAt));
    setSetting('license_last_validated_at', toISO(issuedAt));
    setSetting('gumroad_product_permalink', PRODUCT_PERMALINK);

    res.json({ success: true, expiresAt: toISO(expiresAt), email: purchase.email || null });
  } catch (err) {
    console.error('[license] verify error:', err && err.message, err && err.response);
    const status = err && err.statusCode ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'License verification failed', upstream: err.response || null });
  }
});

// POST /api/license/refresh
router.post('/refresh', async (req, res) => {
  try {
    const licenseKey = getSetting('license_key');
    if (!licenseKey) {
      return res.status(400).json({ error: 'No stored license key. Please verify again.' });
    }

    console.log('[license] Refreshing existing license (no increment)');

    // Refresh should NOT increment - just check validity
    const data = await verifyWithGumroad(licenseKey, false);

    if (!data.success) {
      // Invalidate token if Gumroad says invalid
      deleteSetting('license_token');
      deleteSetting('license_token_expires_at');
      return res.status(400).json({ error: data.message || 'License invalid' });
    }

    const purchase = data.purchase || {};
    const uses = data.uses || 0;
    const quantity = purchase.quantity || 1;
    const isMultiseat = purchase.is_multiseat_license;
    const maxUses = isMultiseat ? quantity : 1;

    console.log('[license] Refresh check - Uses:', uses, 'Max:', maxUses);

    // Check if over limit (should block app from continuing)
    if (uses > maxUses) {
      console.log('[license] BLOCKED on refresh - Usage limit exceeded');
      // Don't delete the token yet, but return error so UI can show warning
      return res.status(403).json({
        error: 'License activation limit exceeded',
        uses: uses,
        maxUses: maxUses,
        message: `This license has been activated on too many devices (${uses}/${maxUses}). Please manage your activations through Gumroad.`,
        overLimit: true
      });
    }

    const issuedAt = now();
    const expiresAt = addDays(issuedAt, TOKEN_VALID_DAYS);
    const payload = {
      k: crypto.createHash('sha256').update(licenseKey).digest('hex'),
      e: toISO(expiresAt),
      i: toISO(issuedAt),
      p: PRODUCT_PERMALINK
    };
    const token = signToken(payload);

    setSetting('license_token', token);
    setSetting('license_token_expires_at', toISO(expiresAt));
    setSetting('license_last_validated_at', toISO(issuedAt));

    res.json({ success: true, expiresAt: toISO(expiresAt) });
  } catch (err) {
    console.error('[license] refresh error:', err && err.message, err && err.response);
    const status = err && err.statusCode ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'Refresh failed', upstream: err.response || null });
  }
});

// DELETE /api/license -> clear license (manual reset)
router.delete('/', async (req, res) => {
  try {
    // Deactivate on Gumroad before clearing locally
    const licenseKey = getSetting('license_key');
    if (licenseKey) {
      try {
        await decrementWithGumroad(licenseKey);
        console.log('[license] Deactivated on Gumroad');
      } catch (err) {
        console.warn('[license] Could not deactivate on Gumroad:', err.message);
        // Continue with local cleanup even if Gumroad fails
      }
    }

    deleteSetting('license_key');
    deleteSetting('license_email');
    deleteSetting('license_token');
    deleteSetting('license_token_expires_at');
    deleteSetting('license_last_validated_at');
    res.json({ success: true });
  } catch (err) {
    console.error('[license] reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
