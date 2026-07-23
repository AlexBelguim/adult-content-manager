// Self-contained HTTPS static server. Generates a self-signed cert on first run.
// Usage: node serve.js [--regen-cert]
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');
const os     = require('os');

const PORT   = 8443;
const DIR    = __dirname;
const CERT   = path.join(DIR, 'cert.pem');
const KEY    = path.join(DIR, 'key.pem');

// ── LAN IPv4 addresses ──────────────────────────────────────────────────────
function lanIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal)
    .map(n => n.address);
}

// ── Find openssl ────────────────────────────────────────────────────────────
function findOpenSSL() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  ];
  for (const c of candidates) {
    try { execSync(`"${c}" version`, { stdio: 'ignore' }); return c; } catch {}
  }
  return null;
}

// ── Generate self-signed cert if needed ────────────────────────────────────
function ensureCert() {
  const regen = process.argv.includes('--regen-cert');
  if (!regen && fs.existsSync(CERT) && fs.existsSync(KEY)) return;

  const openssl = findOpenSSL();
  if (!openssl) {
    console.error('openssl not found. Install Git for Windows or add openssl to PATH.');
    process.exit(1);
  }

  // SAN needs DNS:localhost plus every LAN IP — browsers ignore the CN field,
  // so without these entries the hostname check fails even after accepting the cert.
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIPs().map(ip => `IP:${ip}`)].join(',');

  console.log(regen ? 'Regenerating self-signed certificate...' : 'Generating self-signed certificate...');
  execSync(
    `"${openssl}" req -x509 -newkey rsa:2048 -keyout "${KEY}" -out "${CERT}" ` +
    `-days 3650 -nodes -subj "/CN=localhost" -addext "subjectAltName=${san}"`,
    { stdio: 'inherit' }
  );
  console.log('Certificate created.\n');
}

// ── MIME types ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',   '.json': 'application/json',
  '.mp4': 'video/mp4',  '.webm': 'video/webm',
  '.png': 'image/png',  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ── Simple directory listing (handy for picking media from a headset) ───────
function sendDirListing(res, dirPath, urlPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.') && e.name !== 'key.pem')
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));

  const base = urlPath.endsWith('/') ? urlPath : urlPath + '/';
  const rows = entries.map(e => {
    const name = e.name + (e.isDirectory() ? '/' : '');
    return `<li><a href="${base}${encodeURIComponent(e.name)}${e.isDirectory() ? '/' : ''}">${name}</a></li>`;
  }).join('\n');

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${urlPath}</title><body style="background:#07090d;color:#e8e6df;font-family:sans-serif">
<h3>/${urlPath.replace(/^\/|\/$/g, '')}</h3>
<ul style="line-height:2;list-style:none;padding:0">
${urlPath !== '/' ? '<li><a href="..">../</a></li>' : ''}
${rows}
</ul>`);
}

// ── Request handler ─────────────────────────────────────────────────────────
function handler(req, res) {
  // Parse + decode the URL so query strings and %20-style names work.
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'https://x').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  const filePath = path.resolve(DIR, '.' + pathname);

  // Prevent path traversal — separator-aware check, not a bare prefix match.
  if (filePath !== DIR && !filePath.startsWith(DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    if (stat.isDirectory()) {
      // Serve index.html if present, otherwise show a listing.
      const index = path.join(filePath, 'index.html');
      if (filePath !== DIR && fs.existsSync(index)) {
        serveFile(req, res, index, fs.statSync(index));
      } else if (filePath === DIR) {
        serveFile(req, res, path.join(DIR, 'index.html'), fs.statSync(path.join(DIR, 'index.html')));
      } else {
        try { sendDirListing(res, filePath, pathname); }
        catch { res.writeHead(500); res.end('Cannot read directory'); }
      }
      return;
    }

    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    serveFile(req, res, filePath, stat);
  });
}

function serveFile(req, res, filePath, stat) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'no-cache',   // revalidate every load; 304 keeps it cheap
  };

  // Conditional GET: skip the body when the client already has this version.
  if (req.headers['if-modified-since'] === headers['Last-Modified']) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  let start = 0;
  let end   = stat.size - 1;

  // Range requests — required for video seeking on headset browsers.
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {                       // suffix range: bytes=-500
        start = Math.max(0, stat.size - parseInt(m[2], 10));
      } else {
        start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), end);
      }
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    headers['Content-Range']  = `bytes ${start}-${end}/${stat.size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
  } else {
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
  }

  if (req.method === 'HEAD') { res.end(); return; }

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
  stream.pipe(res);
}

// ── Start ───────────────────────────────────────────────────────────────────
ensureCert();

const server = https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }, handler);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other server or change PORT.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('HTTPS server running.\n');
  console.log(`  This machine :  https://localhost:${PORT}`);
  lanIPs().forEach(ip => console.log(`  Local network:  https://${ip}:${PORT}`));
  console.log('\nHeadset: accept the self-signed cert warning once, then it works.');
  console.log('Run "node serve.js --regen-cert" if your LAN IP changes.');
  console.log('Press Ctrl+C to stop.\n');
});
