const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// Configuration
const PRODUCT_PERMALINK = process.env.GUMROAD_PRODUCT_PERMALINK || 'wrjde';

function getProductId() {
  if (process.env.GUMROAD_PRODUCT_ID) return process.env.GUMROAD_PRODUCT_ID;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'gumroad_product_id'").get();
    return row?.value || 'qBU348KV5U7DAwCRIEHw7w==';
  } catch (err) {
    return 'qBU348KV5U7DAwCRIEHw7w==';
  }
}

// Store server start time
const SERVER_START_TIME = Date.now();

// Helper to get directory size
async function getDirectorySize(dirPath) {
  if (!dirPath || !await fs.pathExists(dirPath)) return 0;
  
  let totalSize = 0;
  const walk = async (dir) => {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
          await walk(filePath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${dir}:`, err.message);
    }
  };
  
  await walk(dirPath);
  return totalSize;
}

// Helper to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper to format uptime
function formatUptime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// Helper for Gumroad API calls
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

// GET /api/admin/stats - Get all admin statistics
router.get('/stats', async (req, res) => {
  console.log('[admin] Stats endpoint hit');
  try {
    console.log('[admin] Fetching license info...');
    // License info
    const licenseKey = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('license_key')?.value;
    const licenseEmail = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('license_email')?.value;
    const licenseExpiresAt = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('license_token_expires_at')?.value;
    const licenseLastValidated = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('license_last_validated_at')?.value;
    
    console.log('[admin] License info fetched, checking Gumroad...');
    // Get device count from Gumroad (if we have a license)
    let deviceInfo = { uses: 'N/A', maxUses: 'N/A', disabled: false };
    if (licenseKey) {
      console.log('[admin] License key exists, calling Gumroad API...');
      try {
        const params = new URLSearchParams({
          product_id: getProductId(),
          product_permalink: PRODUCT_PERMALINK,
          license_key: licenseKey,
          increment_uses_count: 'false' // Just check, don't increment
        });
        const gumroadData = await postForm('https://api.gumroad.com/v2/licenses/verify', params);
        console.log('[admin] Gumroad response received');
        console.log('[admin] Full Gumroad response:', JSON.stringify(gumroadData, null, 2));
        if (gumroadData.success && gumroadData.purchase) {
          const purchase = gumroadData.purchase;
          // Uses is at top level, not in purchase object
          const uses = gumroadData.uses || 0;
          // Max uses might be in different fields
          const maxUses = purchase.license_key_max_uses || purchase.quantity;
          // If multiseat is enabled but no max specified, default to quantity or 5
          const isMultiseat = purchase.is_multiseat_license;
          
          console.log('[admin] Uses:', uses);
          console.log('[admin] Max uses from API:', maxUses);
          console.log('[admin] Is multiseat:', isMultiseat);
          console.log('[admin] Quantity:', purchase.quantity);
          
          // Determine the display value
          let maxUsesDisplay;
          if (maxUses && maxUses > 0) {
            maxUsesDisplay = maxUses;
          } else if (isMultiseat) {
            // Multiseat is enabled but API doesn't return max - assume Gumroad default of 5
            maxUsesDisplay = 5;
          } else {
            maxUsesDisplay = 'Not Set (Configure in Gumroad)';
          }
          
          // Check if over limit
          const isOverLimit = typeof maxUsesDisplay === 'number' && uses >= maxUsesDisplay;
          
          deviceInfo = {
            uses: uses,
            maxUses: maxUsesDisplay,
            maxUsesRaw: maxUses,
            isOverLimit: isOverLimit,
            disabled: purchase.disabled || false,
            chargebackStatus: purchase.chargebacks || 0,
            refunded: purchase.refunded || false,
            subscription: purchase.subscription_id ? 'Active' : 'None',
            saleTimestamp: purchase.sale_timestamp || null,
            productName: purchase.product_name || 'Unknown'
          };
        }
      } catch (err) {
        console.error('Error fetching Gumroad device info:', err.message);
      }
    }
    
    // Uptime
    console.log('[admin] Calculating uptime...');
    const currentUptime = Date.now() - SERVER_START_TIME;
    
    // Total uptime from database (would need to track this separately)
    let totalUptime = currentUptime; // For now, same as current
    
    console.log('[admin] Fetching folders...');
    // Storage info from database (much faster than scanning directories)
    const folders = db.prepare('SELECT * FROM folders').all();
    console.log('[admin] Found', folders.length, 'folders');
    
    // Get storage from performers and genres (stored as GB in database)
    console.log('[admin] Calculating storage from database...');
    const performerStorage = db.prepare(`
      SELECT COALESCE(SUM(total_size_gb), 0) as total 
      FROM performers 
      WHERE total_size_gb IS NOT NULL
    `).get()?.total || 0;
    
    const genreStorage = db.prepare(`
      SELECT COALESCE(SUM(total_size_gb), 0) as total 
      FROM content_genres 
      WHERE total_size_gb IS NOT NULL
    `).get()?.total || 0;
    
    // Convert from GB to bytes
    const performerStorageBytes = Math.round(performerStorage * 1024 * 1024 * 1024);
    const genreStorageBytes = Math.round(genreStorage * 1024 * 1024 * 1024);
    const totalStorage = performerStorageBytes + genreStorageBytes;
    console.log('[admin] Storage calculation complete');
    
    // Note: We're not scanning actual directories as it's too slow
    // This is an approximation based on database records
    const beforeSize = 0; // Could be calculated if needed
    const afterSize = totalStorage;
    
    // Filter actions
    const filterStats = db.prepare(`
      SELECT 
        action,
        COUNT(*) as count
      FROM filter_actions
      GROUP BY action
    `).all();
    
    const totalFilterActions = db.prepare('SELECT COUNT(*) as count FROM filter_actions').get().count;
    
    // Database stats
    const performerCount = db.prepare('SELECT COUNT(*) as count FROM performers').get().count;
    const genreCount = db.prepare('SELECT COUNT(*) as count FROM content_genres').get().count;
    const sceneCount = db.prepare('SELECT COUNT(*) as count FROM video_scenes').get().count;
    const exportedFilesCount = db.prepare('SELECT COUNT(*) as count FROM exported_files').get().count;
    
    // System info
    const memoryUsage = process.memoryUsage();
    
    res.json({
      license: {
        key: licenseKey || 'None',
        keyMasked: licenseKey ? `${licenseKey.substring(0, 4)}...${licenseKey.substring(licenseKey.length - 4)}` : 'None',
        email: licenseEmail || 'N/A',
        expiresAt: licenseExpiresAt,
        lastValidated: licenseLastValidated,
        deviceUses: deviceInfo.uses,
        deviceMaxUses: deviceInfo.maxUses,
        disabled: deviceInfo.disabled,
        chargebacks: deviceInfo.chargebackStatus,
        refunded: deviceInfo.refunded,
        subscription: deviceInfo.subscription,
        saleDate: deviceInfo.saleTimestamp,
        product: deviceInfo.productName
      },
      uptime: {
        current: formatUptime(currentUptime),
        currentMs: currentUptime,
        total: formatUptime(totalUptime),
        totalMs: totalUptime,
        startTime: new Date(SERVER_START_TIME).toISOString()
      },
      storage: {
        note: 'Storage calculated from database records (performers + genres)',
        performers: {
          bytes: performerStorageBytes,
          formatted: formatBytes(performerStorageBytes)
        },
        genres: {
          bytes: genreStorageBytes,
          formatted: formatBytes(genreStorageBytes)
        },
        before: {
          bytes: beforeSize,
          formatted: formatBytes(beforeSize)
        },
        after: {
          bytes: afterSize,
          formatted: formatBytes(afterSize)
        },
        total: {
          bytes: totalStorage,
          formatted: formatBytes(totalStorage)
        }
      },
      filterActions: {
        total: totalFilterActions,
        breakdown: filterStats.reduce((acc, stat) => {
          acc[stat.action] = stat.count;
          return acc;
        }, {})
      },
      database: {
        performers: performerCount,
        genres: genreCount,
        scenes: sceneCount,
        exportedFiles: exportedFilesCount
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          rss: formatBytes(memoryUsage.rss),
          heapTotal: formatBytes(memoryUsage.heapTotal),
          heapUsed: formatBytes(memoryUsage.heapUsed),
          external: formatBytes(memoryUsage.external)
        }
      },
      folders: folders.map(f => ({
        id: f.id,
        path: f.path,
        addedAt: f.added_at
      }))
    });
    console.log('[admin] Sending response...');
  } catch (err) {
    console.error('[admin] stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/deactivate-device - Deactivate current device
router.post('/deactivate-device', async (req, res) => {
  try {
    const licenseKey = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('license_key')?.value;
    
    if (!licenseKey) {
      return res.status(400).json({ error: 'No license key found' });
    }
    
    // Decrement uses on Gumroad
    const params = new URLSearchParams({
      product_id: getProductId(),
      product_permalink: PRODUCT_PERMALINK,
      license_key: licenseKey,
      decrement_uses_count: 'true'
    });
    
    const data = await postForm('https://api.gumroad.com/v2/licenses/verify', params);
    
    if (!data.success) {
      return res.status(400).json({ error: data.message || 'Failed to deactivate device' });
    }
    
    // Clear local license data
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('license_key');
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('license_email');
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('license_token');
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('license_token_expires_at');
    db.prepare('DELETE FROM app_settings WHERE key = ?').run('license_last_validated_at');
    
    res.json({ 
      success: true, 
      message: 'Device deactivated successfully',
      newUses: data.purchase?.uses || 'N/A'
    });
  } catch (err) {
    console.error('[admin] deactivate device error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/update-license - Update/change license key
router.post('/update-license', async (req, res) => {
  try {
    const { licenseKey } = req.body || {};
    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({ error: 'licenseKey is required' });
    }
    
    console.log('[admin] Updating license key...');
    
    // Verify with Gumroad first
    const params = new URLSearchParams({
      product_id: getProductId(),
      product_permalink: PRODUCT_PERMALINK,
      license_key: licenseKey.trim(),
      increment_uses_count: 'true'
    });
    
    const data = await postForm('https://api.gumroad.com/v2/licenses/verify', params);
    
    if (!data.success) {
      return res.status(400).json({ error: data.message || 'Invalid license key' });
    }
    
    const purchase = data.purchase || {};
    
    // Update settings
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('license_key', licenseKey.trim());
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('license_email', purchase.email || '');
    
    // Create new token
    const crypto = require('crypto');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days
    
    function toISO(date) { return new Date(date).toISOString(); }
    function base64url(input) {
      return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }
    
    const SIGNING_SECRET = process.env.LICENSE_SECRET || 'CHANGE_ME_SECRET';
    const payload = {
      k: crypto.createHash('sha256').update(licenseKey.trim()).digest('hex'),
      e: toISO(expiresAt),
      i: toISO(now),
      p: PRODUCT_PERMALINK
    };
    const payloadB64 = base64url(JSON.stringify(payload));
    const hmac = crypto.createHmac('sha256', SIGNING_SECRET);
    hmac.update(payloadB64);
    const signature = hmac.digest('hex');
    const token = `${payloadB64}.${signature}`;
    
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('license_token', token);
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('license_token_expires_at', toISO(expiresAt));
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('license_last_validated_at', toISO(now));
    
    if (purchase.product_id) {
      db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('gumroad_product_id', purchase.product_id);
    }
    
    res.json({ 
      success: true, 
      message: 'License key updated successfully',
      email: purchase.email || null,
      expiresAt: toISO(expiresAt)
    });
  } catch (err) {
    console.error('[admin] update license error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/shutdown - Gracefully shut down the app
router.post('/shutdown', (req, res) => {
  try {
    console.log('[admin] Shutdown requested');
    res.json({ success: true, message: 'Server shutting down...' });
    
    // Give time for response to be sent
    setTimeout(() => {
      console.log('[admin] Exiting process');
      process.exit(0);
    }, 1000);
  } catch (err) {
    console.error('[admin] shutdown error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
