#!/usr/bin/env node
// PA-APIがまだ使えない期間の代替経路。
// SiteStripe（Amazonアソシエイト管理画面）で人が取得したASIN・画像URLをTSVから取り込む。
//
//   node tools/ingest-sitestripe.mjs <slug> <input.tsv>
//   node tools/ingest-sitestripe.mjs <slug> -        # 標準入力から
//
// TSVの列（ヘッダ行は任意、# で始まる行はコメント）:
//   ASIN <TAB> 商品名 <TAB> メーカー／ブランド <TAB> 商品画像URL
//
// 直接商品リンクはASINとアソシエイトタグからこのスクリプトが組み立てる。
// SiteStripeの短縮URL(amzn.to)や検索URLを貼り付けても採用しない。
import { readFileSync } from 'node:fs';
import { loadPolicy, productsPath, writeJson, today, associateTag } from './lib/pipeline.mjs';

const [, , slug, input] = process.argv;
if (!slug || !input) {
  console.error('用法: ingest-sitestripe.mjs <slug> <input.tsv|->');
  process.exit(2);
}

const policy = loadPolicy();
const tag = associateTag(policy);
if (!tag) {
  console.error(`アソシエイトタグが未設定です。環境変数 ${policy.site.associateTagEnv} を設定してください。`);
  process.exit(3);
}

const raw = input === '-' ? readFileSync(0, 'utf8') : readFileSync(input, 'utf8');
const rows = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split('\t').map((c) => c.trim()))
  .filter((c) => /^[A-Z0-9]{10}$/.test(c[0])); // ヘッダ行はASIN列で自然に落ちる

if (!rows.length) {
  console.error('取り込める行がありません。1列目がASIN（10桁英数字）のTSVか確認してください。');
  process.exit(2);
}

const products = rows.map(([asin, title, brand, imageUrl]) => ({
  asin,
  title: title ?? '',
  brand: brand ?? '',
  url: `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`,
  imageUrl: imageUrl ?? '',
  imageLicense: 'amazon_program_content',
  verifiedAt: today(),
}));

writeJson(productsPath(slug), {
  slug,
  source: 'sitestripe',
  associateTag: tag,
  verifiedAt: today(),
  note: 'SiteStripeで人が確認したASIN・画像。PA-API接続後は amazon-fetch.mjs で再取得して上書きする。',
  products,
});

console.log(`${productsPath(slug)} に ${products.length} 件を書き出しました。`);
console.log(`次: node tools/validate-products.mjs ${slug}`);
