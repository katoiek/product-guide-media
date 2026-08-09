#!/usr/bin/env node
// Amazonアソシエイトのレポート(CSV)を取り込み、記事ごとの収益に集計する。
//
//   node tools/import-earnings.mjs <report.csv> [--month YYYY-MM]
//
// リポジトリは公開設定のため、金額を含むデータは content/pipeline/revenue/ に置き、
// .gitignore で除外する。コミットされるのは順位・ランクだけ（tools/revenue.mjs --write-rank）。
//
// 対応レポート: アソシエイト・セントラルの「注文レポート」「売上レポート」など、
// ASIN・数量・紹介料の列を持つCSV。列名はレポート種別で変わるため候補から自動判定する。
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT, loadProducts, writeJson, readJson, today } from './lib/pipeline.mjs';
import { readCsvText, parseCsv, findHeader, columnIndex, toNumber } from './lib/csv.mjs';

const OUT_DIR = join(ROOT, 'content', 'pipeline', 'revenue');
const OUT_PATH = join(OUT_DIR, 'earnings.json');

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--'));
const monthArg = args.includes('--month') ? args[args.indexOf('--month') + 1] : null;

if (!csvPath) {
  console.error(
    '用法: node tools/import-earnings.mjs <report.csv> [--month YYYY-MM]\n' +
    '\n' +
    'レポートの取得元: アソシエイト・セントラル → レポート → 「ダウンロード」\n' +
    '  「注文レポート」または「売上レポート」のCSVを指定してください。'
  );
  process.exit(2);
}
if (!existsSync(csvPath)) {
  console.error(`ファイルがありません: ${csvPath}`);
  process.exit(2);
}

const { text, encoding } = readCsvText(csvPath);
const rows = parseCsv(text);
const headerIdx = findHeader(rows, ['asin', '商品名', '紹介料', '追跡id', 'tracking', 'earnings']);
if (headerIdx < 0) {
  console.error('ヘッダ行を判別できませんでした。ASIN列を含むレポートか確認してください。');
  process.exit(3);
}
const header = rows[headerIdx];

const cols = {
  asin: columnIndex(header, ['ASIN', '商品ASIN']),
  title: columnIndex(header, ['商品名', 'タイトル', 'Title', 'Product Name']),
  tracking: columnIndex(header, ['追跡ID', 'トラッキングID', 'Tracking ID']),
  qty: columnIndex(header, ['発送済み商品点数', '注文された商品点数', '商品点数', '数量', 'Items Shipped', 'Qty', 'Quantity']),
  earnings: columnIndex(header, ['紹介料', '広告費', '収益', 'Earnings', 'Commission', 'Ad Fees']),
  sales: columnIndex(header, ['売上', '商品売上', 'Revenue', 'Product Sales', '販売価格']),
  category: columnIndex(header, ['商品カテゴリー', 'カテゴリ', 'Category']),
};

if (cols.asin < 0) {
  console.error(
    `ASIN列が見つかりませんでした。\n検出したヘッダ: ${header.join(' | ')}\n` +
    'ASINを含むレポート（注文レポートなど）を指定してください。'
  );
  process.exit(3);
}

// ASIN → 記事 の対応表を、既存の商品データから作る
const productsDir = join(ROOT, 'content', 'pipeline', 'products');
const asinToArticle = new Map();
if (existsSync(productsDir)) {
  for (const f of readdirSync(productsDir).filter((f) => f.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    const d = loadProducts(slug);
    for (const p of [...(d?.products ?? []), ...(d?.related ?? [])]) {
      if (p.asin) asinToArticle.set(p.asin, { slug, title: p.title, kind: d.products.includes(p) ? 'product' : 'related' });
    }
  }
}

const byArticle = new Map();
const unmatched = new Map();
let totalEarnings = 0;
let totalQty = 0;
let lines = 0;

for (let i = headerIdx + 1; i < rows.length; i++) {
  const r = rows[i];
  const asin = (r[cols.asin] ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
  lines++;

  const qty = cols.qty >= 0 ? toNumber(r[cols.qty]) : 0;
  const earn = cols.earnings >= 0 ? toNumber(r[cols.earnings]) : 0;
  const sales = cols.sales >= 0 ? toNumber(r[cols.sales]) : 0;
  const title = cols.title >= 0 ? r[cols.title] : '';
  totalEarnings += earn;
  totalQty += qty;

  const hit = asinToArticle.get(asin);
  if (hit) {
    const cur = byArticle.get(hit.slug) ?? { slug: hit.slug, earnings: 0, qty: 0, sales: 0, asins: {} };
    cur.earnings += earn;
    cur.qty += qty;
    cur.sales += sales;
    const a = (cur.asins[asin] ??= { title: hit.title, kind: hit.kind, earnings: 0, qty: 0 });
    a.earnings += earn;
    a.qty += qty;
    byArticle.set(hit.slug, cur);
  } else {
    // 記事でリンクしていない商品。読者が「ついで買い」したものなので、次のテーマの手がかりになる。
    const cur = unmatched.get(asin) ?? { asin, title, earnings: 0, qty: 0 };
    cur.earnings += earn;
    cur.qty += qty;
    if (!cur.title && title) cur.title = title;
    unmatched.set(asin, cur);
  }
}

const articles = [...byArticle.values()].sort((a, b) => b.earnings - a.earnings || b.qty - a.qty);
const others = [...unmatched.values()].sort((a, b) => b.earnings - a.earnings || b.qty - a.qty);

// 既存データに月ごとに積み上げる
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const store = existsSync(OUT_PATH) ? readJson(OUT_PATH) : { months: {} };
const month = monthArg ?? new Date().toISOString().slice(0, 7);
store.months[month] = {
  importedAt: today(),
  source: basename(csvPath),
  totals: { earnings: totalEarnings, qty: totalQty, rows: lines },
  articles,
  unlinkedProducts: others,
};
store.updated = today();
writeJson(OUT_PATH, store);

const found = Object.entries(cols).filter(([, v]) => v >= 0).map(([k]) => k);
console.log(`読み込み: ${basename(csvPath)}（${encoding}）`);
console.log(`検出した列: ${found.join(', ')}`);
console.log(`対象月: ${month} / 明細 ${lines} 行\n`);

console.log(`記事にひもづいた成果 ${articles.length} 件`);
for (const a of articles) {
  console.log(`  ${a.slug.padEnd(40)} ${String(a.qty).padStart(4)}点  ${a.earnings.toLocaleString('ja-JP')}円`);
}
if (others.length) {
  console.log(`\n記事でリンクしていない商品 ${others.length} 件（ついで買い。次のテーマの手がかり）`);
  for (const o of others.slice(0, 15)) {
    console.log(`  ${o.asin}  ${String(o.qty).padStart(4)}点  ${o.earnings.toLocaleString('ja-JP')}円  ${o.title.slice(0, 40)}`);
  }
  if (others.length > 15) console.log(`  ...ほか ${others.length - 15} 件`);
}
console.log(`\n合計 ${totalQty}点 / ${totalEarnings.toLocaleString('ja-JP')}円`);
console.log(`\n保存先: ${OUT_PATH}（.gitignore 済み。金額はコミットされません）`);
console.log(`次: node tools/revenue.mjs`);
