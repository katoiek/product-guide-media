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
// --file の値は位置引数から除く。--file が無いとき fileIdx は -1 なので、
// そのまま fileIdx + 1 で比較すると先頭の slug を取りこぼす。
const only = args.filter((a, i) => !a.startsWith('--') && !(fileIdx >= 0 && i === fileIdx + 1));

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
const issues = [];
let lineNo = 0;

for (const raw of readFileSync(csvPath, 'utf8').split(/\r?\n/)) {
  lineNo++;
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const cols = parseLine(line);
  const [slug, , kind, name] = cols;
  let asin = (cols[4] ?? '').trim();
  const imageUrl = (cols[5] ?? '').trim();
  // Excel で開くと "Column1,Column2,..." の行やカンマ列が付く。見出し行はすべて読み飛ばす。
  if (!slug || slug === 'slug' || /^Column\d+$/.test(slug)) continue;
  if (only.length && !only.includes(slug)) continue;

  if (!bySlug.has(slug)) bySlug.set(slug, { products: [], related: [] });
  const bucket = bySlug.get(slug);

  // ASIN 列に商品ページURLを貼った場合は ASIN を取り出す（よくある記入ゆれ）
  const fromUrl = asin.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  if (fromUrl) asin = fromUrl[1];

  const shortLink = /(link\.amazon|amzn\.(to|asia))/;
  const searchLink = /amazon\.co\.jp\/s\?/;
  const isRelated = kind === 'related';

  // 関連消耗品は一般名のカテゴリなので、検索結果リンク・短縮リンクをそのまま使う。
  // 比較対象は記事が製品名を名指しするため /dp/<ASIN> に限る。
  if (isRelated && policy.amazon.relatedLinks?.allowSearchLinks) {
    const link = [asin, imageUrl].find((v) => shortLink.test(v) || searchLink.test(v));
    if (link && !/^[A-Z0-9]{10}$/.test(asin)) {
      bucket.related.push({
        title: name,
        url: link,
        linkType: shortLink.test(link) ? 'short' : 'search',
        verifiedAt: today(),
      });
      continue;
    }
  }

  // 比較対象に短縮リンクが入っていた場合は、リンク先が判別できないため採用しない。
  if (shortLink.test(asin)) {
    issues.push({ line: lineNo, name, kind: 'short-link', value: asin });
    asin = '';
  }

  if (!asin) { skipped.push(`${slug}: ${name}`); continue; }
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    console.error(`${csvPath}:${lineNo} ASINが10桁の英数字ではありません: ${name} → "${asin}"`);
    process.exit(2);
  }

  // 画像は Amazon プログラム配信元か、運営者が用意してリポジトリに置いた画像のみ。
  // それ以外は掲載できないので落とす。商品リンク自体は有効なので画像なしで通す。
  let image = imageUrl;
  let license = 'amazon_program_content';
  if (shortLink.test(image)) {
    issues.push({ line: lineNo, name, kind: 'short-link-image', value: image });
    image = '';
  } else if (image.startsWith('/')) {
    // サイト内パス = 運営者が用意した画像
    license = 'owner_supplied';
  } else if (image && !/^https:\/\/(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-fe\.ssl-images-amazon\.com)\//.test(image)) {
    issues.push({ line: lineNo, name, kind: 'foreign-image', value: image });
    image = '';
  }

  const sep = name.indexOf('｜');
  if (sep < 0 && kind !== 'related') {
    issues.push({ line: lineNo, name, kind: 'no-brand-separator', value: name });
  }
  bucket[kind === 'related' ? 'related' : 'products'].push({
    asin,
    title: sep > 0 ? name.slice(sep + 1).trim() : name,
    brand: sep > 0 ? name.slice(0, sep).trim() : '',
    url: `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`,
    imageUrl: image,
    imageLicense: license,
    verifiedAt: today(),
  });
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

const LABEL = {
  'short-link': '短縮リンクはASINとして使えない',
  'short-link-image': '画像URL列に短縮リンク（画像として使えないため無視）',
  'foreign-image': '画像がAmazon配信元でない（掲載できないため無視）',
  'no-brand-separator': '製品名に「｜」が無くブランドを判別できない',
};
if (issues.length) {
  console.log(`\n── 要対応 ${issues.length} 件 ──`);
  for (const kind of Object.keys(LABEL)) {
    const list = issues.filter((i) => i.kind === kind);
    if (!list.length) continue;
    console.log(`\n[${LABEL[kind]}] ${list.length}件`);
    for (const i of list) console.log(`  行${i.line} ${i.name}\n    → ${i.value}`);
  }
  if (issues.some((i) => i.kind.startsWith('short-link'))) {
    console.log(
      `\n短縮リンク(link.amazon)について:\n` +
      `  リンク先が検索結果の場合、商品リンクとして掲載できません（アソシエイト規約）。\n` +
      `  リンクを開いて個別の商品ページへ移動し、URLの /dp/ の直後にある10桁のASINを\n` +
      `  「ASIN」列（画像URL列ではありません）に記入してください。`
    );
  }
}

if (skipped.length) {
  console.log(`\nASIN未記入でスキップした行 ${skipped.length} 件:`);
  for (const s of skipped) console.log(`  - ${s}`);
}
console.log(`\n次: npm run validate:products`);
