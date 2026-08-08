#!/usr/bin/env node
// PA-APIがまだ使えない期間の取り込み経路。
// make-asin-sheet.mjs が出力した TSV に人が ASIN を記入したものを読み、商品データを作る。
//
//   node tools/ingest-sitestripe.mjs <slug>              既定の入力パスから読む
//   node tools/ingest-sitestripe.mjs <slug> <input.tsv>  パス指定
//   node tools/ingest-sitestripe.mjs <slug> -            標準入力から
//
// TSVの各行: 製品名 <TAB> ASIN <TAB> 商品画像URL(省略可)
// 「--- 関連消耗品」を含むコメント行より後の行は related として扱う。
//
// 直接商品リンクはASINとアソシエイトタグからこのスクリプトが組み立てる。
// SiteStripeの短縮URL(amzn.to)や検索URLを貼っても採用しない。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadPolicy, productsPath, writeJson, today, associateTag, ROOT } from './lib/pipeline.mjs';

const [, , slug, inputArg] = process.argv;
if (!slug) {
  console.error('用法: ingest-sitestripe.mjs <slug> [input.tsv|-]');
  process.exit(2);
}

const policy = loadPolicy();
const tag = associateTag(policy);
if (!tag) {
  console.error(
    `アソシエイトタグが未設定です。次のいずれかを行ってください:\n` +
    `  export ${policy.site.associateTagEnv}=あなたのタグ\n` +
    `  または .env に ${policy.site.associateTagEnv}=あなたのタグ を追記`
  );
  process.exit(3);
}

const defaultPath = join(ROOT, 'content', 'pipeline', 'asin-input', `${slug}.tsv`);
const input = inputArg ?? defaultPath;
if (input !== '-' && !existsSync(input)) {
  console.error(`入力ファイルがありません: ${input}\n先に node tools/make-asin-sheet.mjs ${slug} を実行してください。`);
  process.exit(2);
}

const raw = input === '-' ? readFileSync(0, 'utf8') : readFileSync(input, 'utf8');

const products = [];
const related = [];
const skipped = [];
let section = products;

for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trimEnd();
  if (!line) continue;
  if (line.startsWith('#')) {
    // セクション見出しで振り分け先を切り替える
    if (line.includes('関連消耗品')) section = related;
    continue;
  }
  const [name = '', asin = '', imageUrl = ''] = line.split('\t').map((c) => c.trim());
  if (!name) continue;
  if (!asin) { skipped.push(name); continue; }
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    console.error(`ASIN形式が不正です（10桁の英数字が必要）: ${name} → "${asin}"`);
    process.exit(2);
  }
  // 「メーカー｜製品名」形式ならブランドを切り出す
  const sep = name.indexOf('｜');
  const brand = sep > 0 ? name.slice(0, sep).trim() : '';
  const title = sep > 0 ? name.slice(sep + 1).trim() : name;

  section.push({
    asin,
    title,
    brand,
    url: `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`,
    imageUrl,
    imageLicense: 'amazon_program_content',
    verifiedAt: today(),
  });
}

if (!products.length) {
  console.error('比較対象のASINが1件も記入されていません。');
  process.exit(2);
}

const data = {
  slug,
  source: 'sitestripe',
  associateTag: tag,
  verifiedAt: today(),
  note: 'SiteStripe/商品ページで人が確認したASIN。PA-API接続後は amazon-fetch.mjs で再取得して上書きする。',
  products,
};
if (related.length) data.related = related;

writeJson(productsPath(slug), data);

console.log(`${productsPath(slug)} を作成しました。`);
console.log(`  比較対象 ${products.length} 件 / 関連消耗品 ${related.length} 件 / タグ ${tag}`);
if (skipped.length) {
  console.log(`  ASIN未記入のため除外 ${skipped.length} 件:`);
  for (const s of skipped) console.log(`    - ${s}`);
}
console.log(`\n次: node tools/validate-products.mjs ${slug}`);
