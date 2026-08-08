#!/usr/bin/env node
// 1枚の CSV から、記事ごとの商品データをまとめて作る。
//
//   node tools/ingest-asins.mjs                 既定のCSVを読み、記入された記事すべてを取り込む
//   node tools/ingest-asins.mjs <slug> ...      指定した記事だけ取り込む
//   node tools/ingest-asins.mjs --file <path>   CSVのパスを指定
//
// 直接商品リンクは ASIN とアソシエイトタグから組み立てる。
// 検索URLや短縮URL(amzn.to)を貼っても採用しない。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadPolicy, productsPath, writeJson, today, associateTag, ROOT } from './lib/pipeline.mjs';

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const csvPath = fileIdx >= 0 ? args[fileIdx + 1] : join(ROOT, 'content', 'pipeline', 'asin-input', 'asins.csv');
const only = args.filter((a, i) => !a.startsWith('--') && i !== fileIdx + 1);

const policy = loadPolicy();
const tag = associateTag(policy);
if (!tag) {
  console.error(
    `アソシエイトタグが未設定です。次のいずれかを行ってください:\n` +
    `  .env に ${policy.site.associateTagEnv}=あなたのタグ を追記\n` +
    `  または export ${policy.site.associateTagEnv}=あなたのタグ`
  );
  process.exit(3);
}

if (!existsSync(csvPath)) {
  console.error(`CSVがありません: ${csvPath}\n先に node tools/make-asin-sheet.mjs を実行してください。`);
  process.exit(2);
}

/** 引用符つきセルに対応した1行パーサ。 */
function parseLine(line) {
  const cols = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  return cols.map((c) => c.trim());
}

const bySlug = new Map();
const skipped = [];
let lineNo = 0;

for (const raw of readFileSync(csvPath, 'utf8').split(/\r?\n/)) {
  lineNo++;
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [slug, , kind, name, asin = '', imageUrl = ''] = parseLine(line);
  if (!slug || slug === 'slug') continue; // ヘッダ行
  if (only.length && !only.includes(slug)) continue;

  if (!bySlug.has(slug)) bySlug.set(slug, { products: [], related: [] });
  const bucket = bySlug.get(slug);

  if (!asin) { skipped.push(`${slug}: ${name}`); continue; }
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    console.error(`${csvPath}:${lineNo} ASINが10桁の英数字ではありません: ${name} → "${asin}"`);
    process.exit(2);
  }
  if (imageUrl && !/^https:\/\/(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-fe\.ssl-images-amazon\.com)\//.test(imageUrl)) {
    console.error(`${csvPath}:${lineNo} 画像URLがAmazon配信元ではありません: ${name}\n  → ${imageUrl}`);
    process.exit(2);
  }

  const sep = name.indexOf('｜');
  bySlug.get(slug)[kind === 'related' ? 'related' : 'products'].push({
    asin,
    title: sep > 0 ? name.slice(sep + 1).trim() : name,
    brand: sep > 0 ? name.slice(0, sep).trim() : '',
    url: `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`,
    imageUrl,
    imageLicense: 'amazon_program_content',
    verifiedAt: today(),
  });
  void bucket;
}

if (!bySlug.size) {
  console.error('取り込む行がありませんでした。');
  process.exit(2);
}

let written = 0;
const empty = [];

for (const [slug, { products, related }] of bySlug) {
  if (!products.length) { empty.push(slug); continue; }
  const data = {
    slug,
    source: 'manual-asin',
    associateTag: tag,
    verifiedAt: today(),
    note: '人が商品ページで確認したASIN。PA-API接続後は amazon-fetch.mjs で再取得して上書きする。',
    products,
  };
  if (related.length) data.related = related;
  writeJson(productsPath(slug), data);
  console.log(`${slug}: 比較対象 ${products.length} 件 / 関連消耗品 ${related.length} 件`);
  written++;
}

console.log(`\n${written} 記事ぶんの商品データを書き出しました（タグ ${tag}）。`);
if (empty.length) {
  console.log(`ASIN未記入のため出力しなかった記事: ${empty.join(', ')}`);
}
if (skipped.length) {
  console.log(`\nASIN未記入でスキップした行 ${skipped.length} 件:`);
  for (const s of skipped) console.log(`  - ${s}`);
}
console.log(`\n次: node tools/validate-products.mjs`);
