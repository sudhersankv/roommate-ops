// Writes public/landing/og.png (1200x630), the landing page's share image, from the brand SVGs with sharp (already
// in node_modules through Next). Figtree is fetched once into a temp dir for the headline. Run: npx tsx scripts/og-image.ts
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const W = 1200;
const H = 630;
const FOREST = "#0f3b2c";
const MINT = "#d7f8df";
const SPROUT = "#86efa0";

async function font(weight: number): Promise<string> {
  const dir = join(tmpdir(), "roomie-og-fonts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `figtree-${weight}.ttf`);
  if (!existsSync(file)) {
    const res = await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/figtree@latest/latin-${weight}-normal.ttf`);
    if (!res.ok) throw new Error(`Figtree ${weight}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

async function text(markup: string, fontfile: string, family: string, width: number) {
  return sharp({ text: { text: markup, font: family, fontfile, width, rgba: true, dpi: 72, spacing: 0 } }).png().toBuffer();
}

async function main() {
  const logo = readFileSync("public/brand/roomie-logo-on-dark.svg", "utf8");
  const mark = readFileSync("public/brand/roomie-mark.svg", "utf8").replace('class="roomie rm-dino"', 'class="roomie rm-dino is-happy"');

  // Arches (the Home doorway) on the right with the dino standing in them; the logo top left.
  const arches = `
    <g transform="translate(560 214) scale(1.95)">
      <path d="M62 210V128A118 118 0 0 1 298 128V210Z" fill="#1f5b43" stroke="#0b2a1e" stroke-width="2"/>
      <path d="M80 210V128A100 100 0 0 1 280 128V210Z" fill="#4fcb78" stroke="#0b2a1e" stroke-width="2"/>
      <path d="M96 210V128A84 84 0 0 1 264 128V210Z" fill="#86efa0" stroke="#0b2a1e" stroke-width="2"/>
      <path d="M112 210V128A68 68 0 0 1 248 128V210Z" fill="${FOREST}" stroke="#0b2a1e" stroke-width="2"/>
    </g>`;
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${FOREST}"/>
    ${arches}
    <image href="${dataUri(mark)}" x="770" y="330" width="280" height="280"/>
    <image href="${dataUri(logo)}" x="72" y="64" width="262" height="80"/>
  </svg>`;

  const [bold, semi] = await Promise.all([font(800), font(600)]);
  // ADR 0015's words; HEADLINE in src/app/_landing/landing.tsx is the same string.
  const headline = await text(`<span foreground="${MINT}" letter_spacing="-1600">The roommate who actually keeps track.</span>`, bold, "Figtree ExtraBold 70", 600);
  const sub = await text(`<span foreground="${SPROUT}">Rent, splits, groceries, chores and the landlord, in the group chat.</span>`, semi, "Figtree SemiBold 28", 560);
  const headMeta = await sharp(headline).metadata();

  await sharp(Buffer.from(base))
    .composite([
      { input: headline, left: 76, top: 196 },
      { input: sub, left: 78, top: 196 + (headMeta.height ?? 240) + 28 },
    ])
    .png({ compressionLevel: 9 })
    .toFile("public/landing/og.png");
  console.log("wrote public/landing/og.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
