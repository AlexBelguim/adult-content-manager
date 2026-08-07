/**
 * Renders the Darkroom mark to every raster size the app needs.
 *
 *   node scripts/build-icons.mjs
 *
 * No dependencies — the mark is three rounded rectangles, so it is cheaper to
 * rasterise it here (supersampled coverage + a hand-rolled PNG/ICO writer on
 * node:zlib) than to pull in sharp or shell out to ImageMagick, which on
 * Windows collides with the built-in convert.exe.
 *
 * Source of truth for the geometry is src/components/Logo.js — the rects below
 * are the same numbers on the same 32x32 grid. Change one, change both.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/* Darkroom tokens. Kept literal: these bake into pixels, so they cannot be
   var() and must be updated by hand if styles/tokens.js changes. */
const BG = [0x0b, 0x0b, 0x0c];
const DIM = [0xa1, 0xa1, 0xa6];
const ACCENT = [0xf0, 0x70, 0x3a];

// x, y, w, h, rx, colour, alpha — on the 32x32 grid, painted in order
const MARK = [
  [3, 9, 7, 15, 2, DIM, 0.5],
  [12.5, 5, 7, 23, 2, ACCENT, 1],
  [22, 9, 7, 15, 2, DIM, 0.5]
];

const SS = 8; // supersampling factor per axis

function inRoundRect(x, y, rx0, ry0, w, h, r) {
  const x1 = rx0 + w, y1 = ry0 + h;
  if (x < rx0 || x > x1 || y < ry0 || y > y1) return false;
  const cx = x < rx0 + r ? rx0 + r : x > x1 - r ? x1 - r : null;
  const cy = y < ry0 + r ? ry0 + r : y > y1 - r ? y1 - r : null;
  if (cx === null || cy === null) return true;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/* Ink bounds of the mark itself: x 3..29, y 5..28. Scaling off the 32-grid
   instead would silently shrink everything by ~19%, which at 16px put the side
   cards at 2px with a sub-pixel gap between them — they merged into one block. */
const INK = { x0: 3, y0: 5, x1: 29, y1: 28 };
const INK_W = INK.x1 - INK.x0;
const INK_CX = (INK.x0 + INK.x1) / 2;
const INK_CY = (INK.y0 + INK.y1) / 2;

/**
 * @param size    output edge in px
 * @param fill    fraction of the canvas width the mark's ink spans
 * @param tileR   background corner radius as a fraction of size; 0 = full bleed
 * @param opaque  false leaves the area outside the tile transparent
 */
function render(size, { fill = 0.58, tileR = 0.22, opaque = true } = {}) {
  const px = new Float64Array(size * size * 4); // straight RGBA, alpha last
  const scale = (size * fill) / INK_W;
  const offX = size / 2 - INK_CX * scale;
  const offY = size / 2 - INK_CY * scale;
  const R = tileR * size;
  const n = SS * SS;

  // shape bounds in device px, for per-pixel rejection
  const bounds = MARK.map(([x, y, w, h]) => [
    x * scale + offX, y * scale + offY, (x + w) * scale + offX, (y + h) * scale + offY
  ]);

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      const i = (py * size + pxi) * 4;

      // background tile
      let covBg = 0;
      if (opaque) {
        if (tileR === 0) covBg = 1;
        else {
          for (let sy = 0; sy < SS; sy++) {
            for (let sx = 0; sx < SS; sx++) {
              if (inRoundRect(pxi + (sx + 0.5) / SS, py + (sy + 0.5) / SS, 0, 0, size, size, R)) covBg++;
            }
          }
          covBg /= n;
        }
      }
      px[i] = BG[0] * covBg; px[i + 1] = BG[1] * covBg; px[i + 2] = BG[2] * covBg; px[i + 3] = covBg;

      for (let s = 0; s < MARK.length; s++) {
        const [bx0, by0, bx1, by1] = bounds[s];
        if (pxi + 1 < bx0 || pxi > bx1 || py + 1 < by0 || py > by1) continue;
        const [rx, ry, rw, rh, rr, col, alpha] = MARK[s];
        let cov = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const gx = (pxi + (sx + 0.5) / SS - offX) / scale;
            const gy = (py + (sy + 0.5) / SS - offY) / scale;
            if (inRoundRect(gx, gy, rx, ry, rw, rh, rr)) cov++;
          }
        }
        if (!cov) continue;
        const a = (cov / n) * alpha;
        px[i] = col[0] * a + px[i] * (1 - a);
        px[i + 1] = col[1] * a + px[i + 1] * (1 - a);
        px[i + 2] = col[2] * a + px[i + 2] * (1 - a);
        px[i + 3] = a + px[i + 3] * (1 - a);
      }
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const a = px[k * 4 + 3];
    // straight -> premultiplied is wrong for PNG; un-premultiply the composite
    out[k * 4] = Math.round(a > 0 ? Math.min(255, px[k * 4] / a) : 0);
    out[k * 4 + 1] = Math.round(a > 0 ? Math.min(255, px[k * 4 + 1] / a) : 0);
    out[k * 4 + 2] = Math.round(a > 0 ? Math.min(255, px[k * 4 + 2] / a) : 0);
    out[k * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/* ── PNG ── */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ── ICO (PNG-compressed entries; every current browser reads these) ── */
function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  const blobs = [];
  entries.forEach(({ size, data }, i) => {
    const d = 6 + 16 * i;
    head[d] = size >= 256 ? 0 : size;
    head[d + 1] = size >= 256 ? 0 : size;
    head[d + 2] = 0; head[d + 3] = 0;
    head.writeUInt16LE(1, d + 4); head.writeUInt16LE(32, d + 6);
    head.writeUInt32LE(data.length, d + 8);
    head.writeUInt32LE(offset, d + 12);
    offset += data.length;
    blobs.push(data);
  });
  return Buffer.concat([head, ...blobs]);
}

/* ── SVG (transparent, literal colours — for anything that wants a file) ── */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect x="3" y="9" width="7" height="15" rx="2" fill="#A1A1A6" fill-opacity=".5"/>
  <rect x="12.5" y="5" width="7" height="23" rx="2" fill="#F0703A"/>
  <rect x="22" y="9" width="7" height="15" rx="2" fill="#A1A1A6" fill-opacity=".5"/>
</svg>
`;

const write = (name, buf) => {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(String(name).padEnd(26), (buf.length / 1024).toFixed(1) + ' KB');
};

/* Tiles for purpose:"any" keep their rounded corners. The maskable variant is
   full bleed at a smaller inset, so the platform's own mask cannot clip the
   mark — Android crops to roughly the inner 80%. */
write('logo512.png', png(render(512), 512));
write('logo192.png', png(render(192), 192));
write('logo.png', png(render(512), 512));
write('logo-maskable-512.png', png(render(512, { fill: 0.42, tileR: 0 }), 512));
write('logo.svg', Buffer.from(svg, 'utf8'));
/* Favicons run near full bleed. A tab icon is read at a glance against a busy
   strip, so the mark needs the pixels far more than the tile needs padding —
   and the corner radius drops to 0.18 because at 16px a 22% corner clips into
   the outer cards. */
write('favicon.ico', ico([16, 32, 48].map(s => ({ size: s, data: png(render(s, { fill: 0.84, tileR: 0.18 }), s) }))));
// Same geometry as the .ico entries, for eyeballing what a tab actually shows.
if (process.argv.includes('--proof')) {
  for (const s of [16, 32, 48]) write(`proof-${s}.png`, png(render(s, { fill: 0.84, tileR: 0.18 }), s));
}
