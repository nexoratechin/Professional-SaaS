// Generates the PWA raster icons (PNG) without any image dependency — a tiny RGBA PNG encoder
// on top of Node's built-in zlib. Run with: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
mkdirSync(publicDir, { recursive: true });

// ── PNG encoding ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Drawing ─────────────────────────────────────────────────────────────────
const GLYPH_C = [
  '00111100',
  '01111110',
  '11100110',
  '11100000',
  '11100000',
  '11100110',
  '01111110',
  '00111100',
];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function insideRoundedRect(x, y, size, radius) {
  if (radius <= 0) return true;
  if (x >= radius && x <= size - radius) return true;
  if (y >= radius && y <= size - radius) return true;
  const cx = x < radius ? radius : size - radius;
  const cy = y < radius ? radius : size - radius;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function makeIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = px + 0.5;
      const y = py + 0.5;
      const i = (py * size + px) * 4;
      if (!insideRoundedRect(x, y, size, radius)) {
        rgba[i + 3] = 0;
        continue;
      }
      // Diagonal indigo → deep blue gradient.
      const t = (x / size) * 0.6 + (y / size) * 0.4;
      rgba[i] = lerp(79, 30, t);
      rgba[i + 1] = lerp(70, 58, t);
      rgba[i + 2] = lerp(229, 138, t);
      rgba[i + 3] = 255;
    }
  }

  // White monogram, centered, occupying ~46% of the canvas (smaller for maskable safe zone).
  const glyphSpan = Math.round(size * (maskable ? 0.34 : 0.46));
  const cell = Math.max(1, Math.floor(glyphSpan / GLYPH_C.length));
  const drawn = cell * GLYPH_C.length;
  const offset = Math.floor((size - drawn) / 2);
  for (let gy = 0; gy < GLYPH_C.length; gy += 1) {
    for (let gx = 0; gx < GLYPH_C[0].length; gx += 1) {
      if (GLYPH_C[gy][gx] !== '1') continue;
      const startX = offset + gx * cell;
      const startY = offset + gy * cell;
      for (let y = startY; y < startY + cell; y += 1) {
        for (let x = startX; x < startX + cell; x += 1) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const i = (y * size + x) * 4;
          rgba[i] = 255;
          rgba[i + 1] = 255;
          rgba[i + 2] = 255;
          rgba[i + 3] = 255;
        }
      }
    }
  }
  return encodePng(size, size, rgba);
}

const targets = [
  ['pwa-192x192.png', 192, {}],
  ['pwa-512x512.png', 512, {}],
  ['maskable-512x512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon-32x32.png', 32, {}],
];

for (const [name, size, options] of targets) {
  writeFileSync(join(publicDir, name), makeIcon(size, options));
  console.log(`wrote public/${name} (${size}x${size})`);
}
