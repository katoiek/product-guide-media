#!/usr/bin/env node
// 仕様データから、ASIN 記入用の CSV を作る。
// 人が Amazon で各製品を探し、ASIN と商品画像URLを埋めて ingest-asins.mjs に渡す。
//
//   node tools/make-asin-sheet.mjs              全記事を1ファイルにまとめる（既定）
//   node tools/make-asin-sheet.mjs <slug> ...   指定した記事だけ
//
// 出力: content/pipeline/asin-input/asins.csv
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSpec, loadQueue, loadProducts, ROOT } from './lib/pipeline.mjs';

const OUT_DIR = join(ROOT, 'content', 'pipeline', 'asin-input');
const OUT_PATH = join(OUT_DIR, 'asins.csv');

// CSV セル。カンマ・引用符・改行を含む値を安全に囲む。
const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (cols) => cols.map(cell).join(',');

/** 引用符つきセルに対応した1行パーサ。"1,500ml" のような値を壊さない。 */
function parseCsvLine(line) {
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

/** 「メーカー｜製品名」からメーカー名を取り出す。 */
const brandOf = (name) => {
  const i = (name ?? '').indexOf('｜');
  return i > 0 ? name.slice(0, i).trim() : '';
};

/**
 * 記入済みCSVから ASIN・画像URL・記入された製品名を引き継ぐ。
 * 人はAmazonの表記に合わせて製品名を書き換えることがあるため、製品名だけで
 * 突き合わせると引き継ぎに失敗し、記入済みのASINが消える。slug+メーカー名でも引く。
 */
function existingEntries() {
  const byName = new Map();
  const byBrand = new Map();
  const brandCount = new Map();
  if (!existsSync(OUT_PATH)) return { byName, byBrand };
  for (const line of readFileSync(OUT_PATH, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = parseCsvLine(line);
    const [slug, , kind, name, asin = '', imageUrl = ''] = cols;
    if (!slug || slug === 'slug' || /^Column\d+$/.test(slug)) continue;
    if (!asin && !imageUrl) continue;
    const entry = { asin, imageUrl, name };
    byName.set(`${slug}\t${name}`, entry);
    const brand = brandOf(name);
    if (kind === 'product' && brand) {
      const key = `${slug}\t${brand}`;
      brandCount.set(key, (brandCount.get(key) ?? 0) + 1);
      byBrand.set(key, entry);
    }
  }
  // 同じメーカーが複数製品ある場合、メーカー名だけでは製品を特定できない。
  // 取り違えると別製品のASINを引き当てるので、その場合は使わない。
  for (const [key, n] of brandCount) if (n > 1) byBrand.delete(key);
  return { byName, byBrand };
}

const queue = loadQueue();
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : queue.items
      .filter((i) => i.type === 'comparison' && existsSync(join(ROOT, 'content', 'pipeline', 'specs', `${i.slug}.json`)))
      .map((i) => i.slug);

if (!targets.length) {
  console.error('対象の記事がありません。');
  process.exit(2);
}

const prev = existingEntries();
const out = [];
out.push('# えらびノート ASIN記入シート');
out.push('#');
out.push('# 「種別」が product の行が比較対象、related が関連消耗品です。');
out.push('# Amazon.co.jp で各製品を探し、商品ページURLの /dp/ の直後にある10桁の英数字を');
out.push('# 「ASIN」列に記入してください。例: https://www.amazon.co.jp/dp/B08XYZ1234/ → B08XYZ1234');
out.push('#');
out.push('# 画像URL列は省略できます。入れる場合は m.media-amazon.com で始まるURLだけを使ってください。');
out.push('# メーカーサイトの写真は使えません。');
out.push('#');
out.push('# 関連消耗品（related）は一般名のカテゴリなので、検索結果リンクや');
out.push('# SiteStripe の短縮リンクをそのまま「ASIN」列に貼っても構いません。');
out.push('#');
out.push('# メーカー名と容量まで一致する商品を選んでください。');
out.push('# 容量違い・詰め替え・セット品・並行輸入は別商品です。');
out.push('# 判断がつかない製品は ASIN 欄を空のままにしてください（その製品だけリンク無しで公開されます）。');
out.push('#');
out.push('# slug列と種別列は編集しないでください。行の並べ替え・削除も不要です。');
out.push('# 製品名は実際のAmazonの表記に書き換えて構いません（次回の再生成でも引き継がれます）。');
out.push('#');
out.push(row(['slug', '記事', '種別', '製品名', 'ASIN', '画像URL']));

let productCount = 0;
let relatedCount = 0;
let carried = 0;

for (const slug of targets) {
  const spec = loadSpec(slug);
  if (!spec) {
    console.error(`仕様データが見つかりません（スキップ）: ${slug}`);
    continue;
  }
  // 既に書き出した商品データからも引き継げるようにする
  const products = loadProducts(slug);
  const jsonByTitle = new Map();
  const jsonByBrand = new Map();
  for (const p of products?.products ?? []) {
    jsonByTitle.set(p.title, p);
    if (p.brand) jsonByBrand.set(p.brand, p);
  }
  for (const p of products?.related ?? []) jsonByTitle.set(p.title, p);

  // 仕様データ側でも同じメーカーが複数あるなら、メーカー名での引き当ては使えない。
  const specBrandCount = new Map();
  for (const p of spec.products ?? []) {
    specBrandCount.set(p.brand, (specBrandCount.get(p.brand) ?? 0) + 1);
  }

  /** specName に対応する記入済みの値を探す。名前 → メーカー → 商品データ の順。 */
  const pick = (specName, kind) => {
    const brand = brandOf(specName);
    const brandUsable = kind === 'product' && brand && specBrandCount.get(brand) === 1;
    const fromCsv =
      prev.byName.get(`${slug}\t${specName}`) ??
      (brandUsable ? prev.byBrand.get(`${slug}\t${brand}`) : undefined);
    if (fromCsv) {
      carried++;
      return { asin: fromCsv.asin, imageUrl: fromCsv.imageUrl, name: fromCsv.name || specName };
    }
    const bare = specName.includes('｜') ? specName.slice(specName.indexOf('｜') + 1) : specName;
    const fromJson = jsonByTitle.get(bare) ?? (brandUsable ? jsonByBrand.get(brand) : undefined);
    if (fromJson) {
      carried++;
      return { asin: fromJson.asin ?? fromJson.url ?? '', imageUrl: fromJson.imageUrl ?? '', name: specName };
    }
    return { asin: '', imageUrl: '', name: specName };
  };

  out.push('#');
  out.push(`# ── ${spec.title}`);
  for (const p of spec.products ?? []) {
    const specName = `${p.brand}｜${p.name}`;
    const v = pick(specName, 'product');
    out.push(row([slug, spec.category ?? '', 'product', v.name, v.asin, v.imageUrl]));
    productCount++;
  }
  for (const r of spec.relatedProducts ?? []) {
    const v = pick(r.name, 'related');
    out.push(row([slug, spec.category ?? '', 'related', v.name, v.asin, v.imageUrl]));
    relatedCount++;
  }
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, out.join('\n') + '\n', 'utf8');

// 記事ごとの未記入行を数える。どこを埋めればよいかが一目で分かるようにする。
const pending = new Map();
for (const line of out) {
  if (!line || line.startsWith('#') || line.startsWith('slug,')) continue;
  const [slug, , , , asin = ''] = parseCsvLine(line);
  if (!slug) continue;
  const cur = pending.get(slug) ?? { total: 0, filled: 0 };
  cur.total++;
  if (asin) cur.filled++;
  pending.set(slug, cur);
}

console.log(`${OUT_PATH} を作成しました。`);
console.log(`  記事 ${targets.length} 件 / 比較対象 ${productCount} 行 / 関連消耗品 ${relatedCount} 行`);
if (carried) console.log(`  記入済みの ${carried} 行を引き継ぎました。`);

const todo = [...pending.entries()].filter(([, v]) => v.filled < v.total);
if (!todo.length) {
  console.log('\n全行が記入済みです。次: npm run asin:ingest');
} else {
  const rest = todo.reduce((s, [, v]) => s + (v.total - v.filled), 0);
  console.log(`\n── ASINの記入が必要な記事 ${todo.length} 件（残り ${rest} 行）──`);
  for (const [slug, v] of todo) {
    console.log(`  ${slug.padEnd(42)} 残り ${String(v.total - v.filled).padStart(2)} 行（${v.filled}/${v.total}）`);
  }
  console.log('\n  ファイル: content/pipeline/asin-input/asins.csv');
  console.log('  ASIN列に、商品ページURLの /dp/ の直後にある10桁を記入してください。');
  console.log('  手順: docs/ASIN-INPUT.md');
  console.log('\n記入後: npm run asin:ingest');
}
