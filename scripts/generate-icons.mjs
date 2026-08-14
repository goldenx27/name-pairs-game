import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

await mkdir('public', { recursive: true });

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makeIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [109, 93, 252, 255];
  const white = [255, 255, 255, 255];
  const yellow = [255, 209, 102, 255];
  const pink = [255, 143, 171, 255];
  const dark = [45, 45, 55, 255];
  const teal = [78, 205, 196, 255];

  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * (size * 4 + 1) + 1 + x * 4;
    raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = c[3];
  };
  const fillRect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c);
  };
  const circle = (cx, cy, r, c) => {
    const rr = r * r;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= rr) set(x, y, c);
    }
  };

  fillRect(0, 0, size, size, bg);
  const m = Math.round(size * 0.14);
  const cardW = Math.round(size * 0.28);
  const cardH = Math.round(size * 0.38);
  const top = Math.round(size * 0.25);
  fillRect(m, top, m + cardW, top + cardH, white);
  fillRect(size - m - cardW, top, size - m, top + cardH, white);
  circle(m + Math.floor(cardW / 2), top + Math.round(cardH * 0.38), Math.round(size * 0.075), yellow);
  circle(size - m - Math.floor(cardW / 2), top + Math.round(cardH * 0.38), Math.round(size * 0.075), pink);
  circle(Math.round(size * 0.77), Math.round(size * 0.18), Math.round(size * 0.035), white);
  fillRect(Math.round(size * 0.49), Math.round(size * 0.70), Math.round(size * 0.51), Math.round(size * 0.82), teal);
  circle(Math.round(size * 0.42), Math.round(size * 0.72), Math.round(size * 0.018), dark);
  circle(Math.round(size * 0.58), Math.round(size * 0.72), Math.round(size * 0.018), dark);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

await writeFile('public/app-icon-192.png', makeIcon(192));
await writeFile('public/app-icon-512.png', makeIcon(512));
console.log('Generated valid PNG PWA icons: 192x192 and 512x512');
