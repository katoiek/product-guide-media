#!/usr/bin/env node
// Pinterest投稿案(content/pipeline/pinterest/<slug>.json)から比較表画像をSVG→PNGで自動生成する。
//   node tools/render-pins.mjs <slug>
//   node tools/render-pins.mjs <slug> --pin 3   単一ピンだけ再生成
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1000;
const H = 1500;

// 背景写真の枠。content/pipeline/pinterest/photos/<slug>.jpg があるときだけ使う。
// 出典はcredits.jsonに記録し、CC0/商用利用可のもの（Openverse経由）だけを置く。
const PHOTO_X = 60, PHOTO_Y = 140, PHOTO_W = 880, PHOTO_H = 280, PHOTO_RADIUS = 28;

const PALETTE = {
  ink: '#14211e',
  muted: '#60706a',
  paper: '#fbfbf8',
  line: '#dde4df',
  mintDeep: '#12694e',
  mint: '#a5e9ca',
  lime: '#d8f363',
};

// site index.astro のパレットに無い色（紫・赤・茶）は、同じ淡いトーンで拡張する。
const ACCENTS = {
  青: '#9dc9ff',
  緑: '#a5e9ca',
  紫: '#c9b8f0',
  赤: '#f2a6a6',
  オレンジ: '#ffb777',
  茶: '#d9b98a',
};
function pickAccent(paletteText) {
  for (const [key, hex] of Object.entries(ACCENTS)) {
    if (paletteText?.includes(key)) return hex;
  }
  return PALETTE.mintDeep;
}

// index.astro の icon() と同じパス（stroke-based, viewBox 0 0 48 48）
const ICONS = {
  kitchen: '<path d="M11 7v14m6-14v14M8 7h12v12a6 6 0 0 1-12 0V7Zm22 0v34m0-27h8v27"/><path d="M31 41h8"/>',
  cleaning: '<path d="m28 7 13 13-6 6L22 13zM8 39l14-14 7 7-14 14H8z"/><path d="M12 31h9M31 13l5-5"/>',
  pet: '<path d="M24 39c-8 0-13-4-13-9 0-4 3-7 7-7 2 0 4 1 6 3 2-2 4-3 6-3 4 0 7 3 7 7 0 5-5 9-13 9Z"/><ellipse cx="13" cy="16" rx="4" ry="6" transform="rotate(-25 13 16)"/><ellipse cx="35" cy="16" rx="4" ry="6" transform="rotate(25 35 16)"/>',
  storage: '<path d="M7 16h34v25H7zM5 10h38v7H5zM24 16v25"/><path d="M19 26h10"/>',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 全角文字は1em、半角は0.55emとして概算する（CJKテキストの折り返し・自動縮小用）
function estWidth(text, fontSize) {
  let w = 0;
  for (const ch of text) w += /[\x00-\xff]/.test(ch) ? 0.55 : 1.0;
  return w * fontSize;
}

function fitFontSize(text, base, maxWidth, floor = 34) {
  let size = base;
  while (estWidth(text, size) > maxWidth && size > floor) size -= 2;
  return size;
}

function wrapChips(labels, fontSize, maxWidth, padX = 18, gap = 10) {
  const rows = [[]];
  let rowWidth = 0;
  for (const label of labels) {
    const chipWidth = estWidth(label, fontSize) + padX * 2;
    if (rowWidth + chipWidth + gap > maxWidth && rows[rows.length - 1].length) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1].push({ label, width: chipWidth });
    rowWidth += chipWidth + gap;
  }
  return rows;
}

function buildSvg({ pin, brands, categoryLabel, boardLabel, icon, hasPhoto }) {
  const accent = pickAccent(pin.palette);
  const [line1 = '', line2 = ''] = pin.imageText ?? [];
  const size1 = fitFontSize(line1, 78, 900, 44);
  const size2 = fitFontSize(line2, 40, 900, 26);

  const chipFontSize = 25;
  const chipRows = wrapChips(brands, chipFontSize, 900);
  const chipRowHeight = 54;
  const chipsStartY = 1030;
  let chipsSvg = '';
  chipRows.slice(0, 3).forEach((row, ri) => {
    let x = 60;
    const y = chipsStartY + ri * chipRowHeight;
    for (const chip of row) {
      chipsSvg += `<rect x="${x}" y="${y}" width="${chip.width}" height="40" rx="20" fill="${accent}" fill-opacity="0.22" stroke="${accent}" stroke-width="1.5"/>`;
      chipsSvg += `<text x="${x + chip.width / 2}" y="${y + 27}" font-family="'Noto Sans JP','Yu Gothic',sans-serif" font-size="${chipFontSize}" font-weight="600" fill="${PALETTE.ink}" text-anchor="middle">${esc(chip.label)}</text>`;
      x += chip.width + 10;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="topline" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${PALETTE.mintDeep}"/>
        <stop offset="0.5" stop-color="${PALETTE.mint}"/>
        <stop offset="1" stop-color="${PALETTE.lime}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="${PALETTE.paper}"/>
    <rect width="${W}" height="14" fill="url(#topline)"/>
    ${hasPhoto ? `<rect x="${PHOTO_X + 5}" y="${PHOTO_Y + 8}" width="${PHOTO_W}" height="${PHOTO_H}" rx="${PHOTO_RADIUS}" fill="${PALETTE.ink}" opacity="0.12"/>` : ''}

    <g transform="translate(560,900) scale(9)" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.12">
      ${icon}
    </g>

    <circle cx="76" cy="88" r="7" fill="${PALETTE.mintDeep}"/>
    <text x="96" y="98" font-family="'DM Sans','Noto Sans JP',sans-serif" font-size="30" font-weight="700" letter-spacing="-1" fill="${PALETTE.ink}">えらびノート</text>
    <rect x="${W - 60 - estWidth(categoryLabel, 22) - 36}" y="70" width="${estWidth(categoryLabel, 22) + 36}" height="40" rx="20" fill="${PALETTE.mist ?? '#eef3ef'}" stroke="${PALETTE.line}"/>
    <text x="${W - 60 - estWidth(categoryLabel, 22) / 2 - 18}" y="96" font-family="'Noto Sans JP',sans-serif" font-size="22" font-weight="600" fill="${PALETTE.muted}" text-anchor="middle">${esc(categoryLabel)}</text>

    <rect x="60" y="430" width="64" height="8" rx="4" fill="${accent}"/>
    <text x="58" y="530" font-family="'Noto Sans JP','Yu Gothic',sans-serif" font-size="${size1}" font-weight="800" letter-spacing="-1" fill="${PALETTE.ink}">${esc(line1)}</text>
    <text x="60" y="600" font-family="'Noto Sans JP','Yu Gothic',sans-serif" font-size="${size2}" font-weight="500" fill="${PALETTE.muted}">${esc(line2)}</text>

    <text x="60" y="990" font-family="'DM Sans','Noto Sans JP',sans-serif" font-size="20" font-weight="700" letter-spacing="1" fill="${accent === PALETTE.lime ? PALETTE.mintDeep : accent}">COMPARED BRANDS</text>
    ${chipsSvg}

    <rect x="0" y="${H - 180}" width="${W}" height="180" fill="${PALETTE.ink}"/>
    <text x="60" y="${H - 110}" font-family="'Noto Sans JP',sans-serif" font-size="30" font-weight="700" fill="#fbfbf8">公式表示だけで比較｜えらびノート</text>
    <text x="60" y="${H - 62}" font-family="'Noto Sans JP',sans-serif" font-size="22" fill="${PALETTE.mint}">→ 記事で詳しく見る</text>
    <text x="${W - 60}" y="${H - 62}" font-family="'Noto Sans JP',sans-serif" font-size="20" fill="#9baca3" text-anchor="end">${esc(boardLabel)}</text>
  </svg>`;
}

async function main() {
  const [slug, ...rest] = process.argv.slice(2);
  if (!slug) { console.error('用法: node tools/render-pins.mjs <slug> [--pin N]'); process.exit(2); }
  const onlyIdx = rest.includes('--pin') ? Number(rest[rest.indexOf('--pin') + 1]) : null;

  const pinterest = JSON.parse(readFileSync(join(ROOT, 'content/pipeline/pinterest', `${slug}.json`), 'utf8'));
  const spec = JSON.parse(readFileSync(join(ROOT, 'content/pipeline/specs', `${slug}.json`), 'utf8'));
  const queue = JSON.parse(readFileSync(join(ROOT, 'content/pipeline/queue.json'), 'utf8'));
  const item = queue.items.find((i) => i.slug === slug);

  const brands = [...new Set((spec.products ?? []).map((p) => p.brand))];
  // spec.category（例:「ペット用品」）は大分類すぎるため、記事タイトルの「｜」前（例:「猫砂の比較」）を使う
  const genreLabel = (spec.title ?? item?.title ?? '').split('｜')[0] || spec.category || item?.category || '';
  const icon = ICONS[item?.categorySlug] ?? ICONS.kitchen;

  const outDir = join(ROOT, 'content/pipeline/pinterest/renders', slug);
  mkdirSync(outDir, { recursive: true });

  // content/pipeline/pinterest/photos/<slug>.jpg があれば、角丸カードとして写真枠に合成する。
  const photoPath = join(ROOT, 'content/pipeline/pinterest/photos', `${slug}.jpg`);
  const hasPhoto = existsSync(photoPath);
  let photoLayer = null;
  let labelLayer = null;
  if (hasPhoto) {
    const mask = Buffer.from(`<svg width="${PHOTO_W}" height="${PHOTO_H}"><rect width="${PHOTO_W}" height="${PHOTO_H}" rx="${PHOTO_RADIUS}" fill="#fff"/></svg>`);
    photoLayer = await sharp(photoPath)
      .resize(PHOTO_W, PHOTO_H, { fit: 'cover', position: sharp.strategy.attention })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    const labelText = 'くらしのワンシーン';
    const labelW = estWidth(labelText, 20) + 32;
    labelLayer = Buffer.from(`<svg width="${labelW}" height="38">
      <rect width="${labelW}" height="38" rx="19" fill="#fbfbf8" fill-opacity="0.92"/>
      <text x="${labelW / 2}" y="25" font-family="'Noto Sans JP',sans-serif" font-size="20" font-weight="700" letter-spacing="1" fill="${PALETTE.ink}" text-anchor="middle">${esc(labelText)}</text>
    </svg>`);
  }

  const pins = pinterest.pins;
  for (let i = 0; i < pins.length; i++) {
    if (onlyIdx && i + 1 !== onlyIdx) continue;
    const pin = pins[i];
    const svg = buildSvg({ pin, brands, categoryLabel: genreLabel, boardLabel: pin.board ?? '', icon, hasPhoto });
    const outPath = join(outDir, `pin-${String(i + 1).padStart(2, '0')}.png`);
    const base = sharp(Buffer.from(svg));
    if (hasPhoto) {
      await base
        .composite([
          { input: photoLayer, top: PHOTO_Y, left: PHOTO_X },
          { input: labelLayer, top: PHOTO_Y + 16, left: PHOTO_X + 16 },
        ])
        .png()
        .toFile(outPath);
    } else {
      await base.png().toFile(outPath);
    }
    console.log(`${outPath}`);
  }
  console.log(`完了: ${slug} — ${onlyIdx ? 1 : pins.length}枚を書き出しました（${outDir}）${hasPhoto ? '（写真あり）' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
