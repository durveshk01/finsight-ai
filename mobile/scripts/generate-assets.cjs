const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
if (!fs.existsSync(root)) throw new Error("Mobile project directory is missing.");
const directory = path.join(root, "assets");
fs.mkdirSync(directory, { recursive: true });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, content) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(content.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, content])));
  return Buffer.concat([length, type, content, crc]);
}

function image(size, transparent) {
  const pixels = Buffer.alloc(size * size * 4);
  const set = (x, y, color) => { const offset = (y * size + x) * 4; for (let channel = 0; channel < 4; channel++) pixels[offset + channel] = color[channel]; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, transparent ? [0, 0, 0, 0] : [13, 17, 23, 255]);
  const rect = (x, y, width, height, color) => {
    for (let row = Math.floor(y * size); row < (y + height) * size; row++) for (let column = Math.floor(x * size); column < (x + width) * size; column++) set(column, row, color);
  };
  const green = [63, 185, 80, 255];
  const white = [240, 246, 252, 255];
  rect(.27, .25, .085, .5, white); rect(.27, .25, .33, .075, white); rect(.27, .445, .255, .075, white);
  rect(.45, .635, .065, .115, green); rect(.55, .555, .065, .195, green); rect(.65, .40, .065, .35, green);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const [name, size, transparent] of [["icon.png", 1024, false], ["adaptive-icon.png", 1024, true], ["splash.png", 512, false]]) fs.writeFileSync(path.join(directory, name), image(size, transparent));
console.log("Generated FinSight icon, adaptive icon, and splash assets.");
