const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const publicDir = path.resolve(__dirname, '../apps/web/public');
fs.mkdirSync(publicDir, { recursive: true });

// SVG icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#2B4C9A"/>
  <path d="M140 120 h232 v52 H202 v90 h144 v52 H202 v128 h-62 Z" fill="#FFFFFF"/>
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg, 'utf8');
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svg, 'utf8');

// Function to generate valid PNG buffer
function createPng(size, bgR, bgG, bgB, fgR, fgG, fgB) {
  const width = size;
  const height = size;

  // Raw RGBA pixel data with 1 filter byte (0) per row
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(rowBytes * height);

  const radius = Math.floor(size * 0.22);
  const minX = Math.floor(size * 0.27);
  const maxX = Math.floor(size * 0.73);
  const minY = Math.floor(size * 0.23);
  const maxY = Math.floor(size * 0.86);
  const stemW = Math.floor(size * 0.12);
  const barH = Math.floor(size * 0.10);
  const midY = Math.floor(size * 0.47);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0; // Filter byte 0 = None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Check rounded rect background
      let inBg = true;
      const dx = Math.max(0, radius - x, x - (width - 1 - radius));
      const dy = Math.max(0, radius - y, y - (height - 1 - radius));
      if (dx * dx + dy * dy > radius * radius) {
        inBg = false;
      }

      if (!inBg) {
        raw[pxOffset] = 0;
        raw[pxOffset + 1] = 0;
        raw[pxOffset + 2] = 0;
        raw[pxOffset + 3] = 0;
        continue;
      }

      // Check letter F shape
      let inFg = false;
      // Vertical stem
      if (x >= minX && x < minX + stemW && y >= minY && y < maxY) {
        inFg = true;
      }
      // Top horizontal bar
      if (x >= minX && x < maxX && y >= minY && y < minY + barH) {
        inFg = true;
      }
      // Middle horizontal bar
      if (x >= minX && x < Math.floor(size * 0.65) && y >= midY && y < midY + barH) {
        inFg = true;
      }

      if (inFg) {
        raw[pxOffset] = fgR;
        raw[pxOffset + 1] = fgG;
        raw[pxOffset + 2] = fgB;
        raw[pxOffset + 3] = 255;
      } else {
        raw[pxOffset] = bgR;
        raw[pxOffset + 1] = bgG;
        raw[pxOffset + 2] = bgB;
        raw[pxOffset + 3] = 255;
      }
    }
  }

  const compressed = zlib.deflateSync(raw);

  // PNG Signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcBody = Buffer.concat([typeBuf, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calcCrc(crcBody), 0);

  return Buffer.concat([len, crcBody, crc]);
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function calcCrc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Royal Blue #2B4C9A: 43, 76, 154
// White #FFFFFF: 255, 255, 255
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), createPng(192, 43, 76, 154, 255, 255, 255));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), createPng(512, 43, 76, 154, 255, 255, 255));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPng(180, 43, 76, 154, 255, 255, 255));

console.log('Icons generated successfully in', publicDir);
