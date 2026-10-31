// Reproducible geometric app icon, embedded as PNG data URLs for QX text responses.
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
function icon(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const line = (x, y, a, b, c, d) => {
    const t = Math.max(0, Math.min(1, ((x - a) * (c - a) + (y - b) * (d - b)) / ((c - a) ** 2 + (d - b) ** 2)));
    return Math.hypot(x - a - t * (c - a), y - b - t * (d - b)) < .027;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const white = [[.32,.64,.32,.32],[.32,.32,.64,.32],[.44,.70,.70,.44],[.49,.44,.70,.44],[.70,.44,.70,.65]].some(args => line(u, v, ...args));
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    raw.set(white ? [255,255,255] : [32,35,41], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
await writeFile(new URL('../src/web/pwa-icons.json', import.meta.url), JSON.stringify({ apple: icon(180), small: icon(192), large: icon(512) }));
