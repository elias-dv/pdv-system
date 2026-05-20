'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const iconsetDir = path.join(assetsDir, 'icon.iconset');

const iconsetSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

const icoSizes = [16, 32, 48, 64, 128, 256];

fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(iconsetDir, { recursive: true });

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    chunk('IEND'),
  ]);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function roundedRectCoverage(x, y, rx, ry, w, h, r) {
  const qx = Math.abs(x - (rx + w / 2)) - (w / 2 - r);
  const qy = Math.abs(y - (ry + h / 2)) - (h / 2 - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const distance = outside + inside - r;
  return 1 - smoothstep(-1.5, 1.5, distance);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function blendPixel(data, offset, color, alpha) {
  if (alpha <= 0) return;
  const srcA = Math.max(0, Math.min(1, alpha)) * (color[3] / 255);
  const dstA = data[offset + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);

  if (outA <= 0) return;

  data[offset] = Math.round((color[0] * srcA + data[offset] * dstA * (1 - srcA)) / outA);
  data[offset + 1] = Math.round((color[1] * srcA + data[offset + 1] * dstA * (1 - srcA)) / outA);
  data[offset + 2] = Math.round((color[2] * srcA + data[offset + 2] * dstA * (1 - srcA)) / outA);
  data[offset + 3] = Math.round(outA * 255);
}

function renderIcon(size) {
  const data = Buffer.alloc(size * size * 4);
  const scale = 1024 / size;
  const bgTop = [10, 132, 255, 255];
  const bgBottom = [0, 99, 217, 255];
  const white = [255, 255, 255, 255];
  const softWhite = [234, 244, 255, 255];
  const primary = [0, 122, 255, 255];
  const samples = size >= 512 ? 1 : 3;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const offset = (py * size + px) * 4;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) * scale;
          const y = (py + (sy + 0.5) / samples) * scale;
          const sampleAlpha = 1 / (samples * samples);

          const bgAlpha = roundedRectCoverage(x, y, 64, 64, 896, 896, 224);
          if (bgAlpha > 0) {
            const t = Math.max(0, Math.min(1, (x * 0.18 + y * 0.82 - 88) / 848));
            blendPixel(data, offset, [
              mix(bgTop[0], bgBottom[0], t),
              mix(bgTop[1], bgBottom[1], t),
              mix(bgTop[2], bgBottom[2], t),
              255,
            ], bgAlpha * sampleAlpha);
          }

          const bodyShadow = roundedRectCoverage(x, y - 18, 216, 408, 592, 429, 106);
          if (bodyShadow > 0) blendPixel(data, offset, [0, 74, 173, 48], bodyShadow * sampleAlpha);

          const bodyAlpha = roundedRectCoverage(x, y, 216, 416, 592, 421, 106);
          if (bodyAlpha > 0) blendPixel(data, offset, white, bodyAlpha * sampleAlpha);

          if (pointInPolygon(x, y, [[284, 352], [740, 352], [808, 448], [216, 448]])) {
            blendPixel(data, offset, softWhite, sampleAlpha);
          }

          const handleRadius = Math.hypot(x - 512, y - 488);
          const handleStroke = Math.abs(handleRadius - 136);
          const onHandle = y >= 486 && y <= 654 && handleStroke <= 31;
          const leftCap = Math.hypot(x - 376, y - 488) <= 29;
          const rightCap = Math.hypot(x - 648, y - 488) <= 29;
          if (onHandle || leftCap || rightCap) {
            const edge = onHandle ? 1 - smoothstep(28, 31, handleStroke) : 1;
            blendPixel(data, offset, primary, edge * sampleAlpha);
          }
        }
      }
    }
  }

  return encodePng(size, size, data);
}

function writeIco(outputPath, entries) {
  const headerSize = 6 + entries.length * 16;
  const header = Buffer.alloc(headerSize);
  let offset = headerSize;

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  entries.forEach((entry, index) => {
    const pos = 6 + index * 16;
    header[pos] = entry.size === 256 ? 0 : entry.size;
    header[pos + 1] = entry.size === 256 ? 0 : entry.size;
    header[pos + 2] = 0;
    header[pos + 3] = 0;
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(entry.png.length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += entry.png.length;
  });

  fs.writeFileSync(outputPath, Buffer.concat([header, ...entries.map(entry => entry.png)]));
}

function writeIcns(outputPath, entries) {
  const parts = entries.map(entry => {
    const header = Buffer.alloc(8);
    header.write(entry.type, 0, 4, 'ascii');
    header.writeUInt32BE(entry.png.length + 8, 4);
    return Buffer.concat([header, entry.png]);
  });
  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 4, 'ascii');
  fileHeader.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0), 4);
  fs.writeFileSync(outputPath, Buffer.concat([fileHeader, ...parts]));
}

const rendered = new Map();
function pngForSize(size) {
  if (!rendered.has(size)) rendered.set(size, renderIcon(size));
  return rendered.get(size);
}

fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngForSize(1024));

for (const [fileName, size] of iconsetSizes) {
  fs.writeFileSync(path.join(iconsetDir, fileName), pngForSize(size));
}

writeIco(path.join(assetsDir, 'icon.ico'), icoSizes.map(size => ({ size, png: pngForSize(size) })));
writeIcns(path.join(assetsDir, 'icon.icns'), [
  { type: 'icp4', png: pngForSize(16) },
  { type: 'icp5', png: pngForSize(32) },
  { type: 'icp6', png: pngForSize(64) },
  { type: 'ic07', png: pngForSize(128) },
  { type: 'ic08', png: pngForSize(256) },
  { type: 'ic09', png: pngForSize(512) },
  { type: 'ic10', png: pngForSize(1024) },
  { type: 'ic11', png: pngForSize(32) },
  { type: 'ic12', png: pngForSize(64) },
  { type: 'ic13', png: pngForSize(256) },
  { type: 'ic14', png: pngForSize(512) },
]);

console.log('Generated app icons in assets/');
