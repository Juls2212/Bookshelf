// Generates the PLACEHOLDER app icon, Android adaptive icon layers, splash image and favicon:
// three book spines on a wooden shelf, drawn with the design palette. No dependencies: shapes
// are rasterized here (4x4 supersampling) and written as PNG with node:zlib.
//
// Usage (from the project root, any OS): node scripts/generateAssets.mjs
// Replace the files in assets/images with final artwork whenever it exists.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = resolve(fileURLToPath(new URL('../assets/images', import.meta.url)));

// Values from src/design/tokens.ts (light palette).
const COLORS = {
  background: '#F4EBDC', // background, crema papel
  espresso: '#3B2418', // actionPrimary
  caramel: '#B7773A', // accent
  terracotta: '#A0452D', // danger, terracota
  wood: '#8C5A36', // shelf
  gold: '#E6C887', // highlight
};

const SUPERSAMPLE = 4;

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

/**
 * The glyph, in a unit box (0..1). Later shapes paint over earlier ones. `cut` shapes are
 * details (bands) that become holes in the monochrome layer.
 */
const LEAN = { angle: (12 * Math.PI) / 180, pivot: { x: 0.58, y: 0.81 } };
const GLYPH = [
  // Book 1: tall espresso spine with two gold bands.
  { x: 0.17, y: 0.16, w: 0.19, h: 0.65, r: 0.03, color: 'espresso' },
  { x: 0.17, y: 0.27, w: 0.19, h: 0.035, color: 'gold', cut: true },
  { x: 0.17, y: 0.66, w: 0.19, h: 0.035, color: 'gold', cut: true },
  // Book 2: shorter caramel spine.
  { x: 0.39, y: 0.29, w: 0.16, h: 0.52, r: 0.03, color: 'caramel' },
  { x: 0.39, y: 0.39, w: 0.16, h: 0.03, color: 'espresso', cut: true },
  // Book 3: terracotta spine leaning right, rotated (with its band) around its bottom-left corner.
  { x: 0.58, y: 0.22, w: 0.16, h: 0.59, r: 0.03, color: 'terracotta', lean: LEAN },
  { x: 0.58, y: 0.33, w: 0.16, h: 0.03, color: 'gold', cut: true, lean: LEAN },
  // The shelf.
  { x: 0.08, y: 0.81, w: 0.84, h: 0.07, r: 0.015, color: 'wood' },
];

/** Is (px, py) inside the (optionally rotated) rounded rectangle? Unit coordinates. */
function inside(shape, px, py) {
  let x = px;
  let y = py;
  if (shape.lean) {
    // Rotate the point back around the lean pivot.
    const { x: ox, y: oy } = shape.lean.pivot;
    const cos = Math.cos(-shape.lean.angle);
    const sin = Math.sin(-shape.lean.angle);
    const dx = px - ox;
    const dy = py - oy;
    x = ox + dx * cos - dy * sin;
    y = oy + dx * sin + dy * cos;
  }
  if (x < shape.x || x > shape.x + shape.w || y < shape.y || y > shape.y + shape.h) return false;
  const r = shape.r ?? 0;
  if (r === 0) return true;
  const cx = Math.min(Math.max(x, shape.x + r), shape.x + shape.w - r);
  const cy = Math.min(Math.max(y, shape.y + r), shape.y + shape.h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * Renders a square image. `glyphBox` = { size, x, y } as fractions of the canvas (null: background only).
 * mode: 'color' (palette) or 'mono' (white glyph, bands cut out).
 */
function render(size, { background = null, glyphBox, mode = 'color' }) {
  const pixels = Buffer.alloc(size * size * 4);
  const bg = background ? [...hex(background), 255] : [0, 0, 0, 0];
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const shapes = glyphBox ? GLYPH : [];
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const box = glyphBox ?? { size: 1, x: 0, y: 0 };
          const u = ((px + (sx + 0.5) / SUPERSAMPLE) / size - box.x) / box.size;
          const v = ((py + (sy + 0.5) / SUPERSAMPLE) / size - box.y) / box.size;
          let color = bg;
          for (const shape of shapes) {
            if (!inside(shape, u, v)) continue;
            if (mode === 'mono') color = shape.cut ? bg : [255, 255, 255, 255];
            else color = [...hex(COLORS[shape.color]), 255];
          }
          // Premultiplied accumulation keeps transparent edges clean.
          acc[0] += color[0] * color[3];
          acc[1] += color[1] * color[3];
          acc[2] += color[2] * color[3];
          acc[3] += color[3];
        }
      }
      const i = (py * size + px) * 4;
      const alpha = acc[3] / samples;
      pixels[i] = alpha ? Math.round(acc[0] / acc[3]) : 0;
      pixels[i + 1] = alpha ? Math.round(acc[1] / acc[3]) : 0;
      pixels[i + 2] = alpha ? Math.round(acc[2] / acc[3]) : 0;
      pixels[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, pixels);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Full-bleed icon: the glyph a bit larger than the adaptive one (no system mask safe zone).
const ICON_BOX = { size: 0.74, x: 0.13, y: 0.12 };
// Adaptive icon foreground: keep the glyph inside the 66 % safe zone of the 108 dp canvas.
const ADAPTIVE_BOX = { size: 0.56, x: 0.22, y: 0.21 };
const SPLASH_BOX = { size: 1, x: 0, y: 0 };

const files = {
  'icon.png': () => render(1024, { background: COLORS.background, glyphBox: ICON_BOX }),
  'android-icon-foreground.png': () => render(1024, { glyphBox: ADAPTIVE_BOX }),
  'android-icon-background.png': () =>
    render(1024, { background: COLORS.background, glyphBox: null }),
  'android-icon-monochrome.png': () => render(1024, { glyphBox: ADAPTIVE_BOX, mode: 'mono' }),
  'splash-icon.png': () => render(1024, { glyphBox: SPLASH_BOX }),
  'favicon.png': () => render(48, { background: COLORS.background, glyphBox: ICON_BOX }),
};

mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(files)) {
  writeFileSync(join(OUT, name), make());
  console.log(`assets/images/${name}`);
}
