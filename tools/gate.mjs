#!/usr/bin/env node
// 公開ゲート。商品データ・記事・ビルドをまとめて検証する。
//   node tools/gate.mjs            全記事を検証してビルド
//   node tools/gate.mjs <slug>     指定記事のみ
//   node tools/gate.mjs --no-build ビルドを省略
import { readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadPolicy, loadQueue, PATHS, ROOT, listSlugs, productsPath, pinterestPath, articlePath } from './lib/pipeline.mjs';
import { validateProductsFor } from './validate-products.mjs';
import { validateArticle } from './validate-article.mjs';
import { validatePins } from './validate-pins.mjs';

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const targets = args.filter((a) => !a.startsWith('--'));

const policy = loadPolicy();
const slugs = targets.length
  ? targets
  : readdirSync(PATHS.articles).filter((f) => f.endsWith('.astro')).map((f) => f.replace(/\.astro$/, ''));

let failed = 0;

console.log('=== 商品アセット検証 ===');
// 記事化されていない（.astroがまだ無い）slugのproducts.jsonは、公開対象ではないため
// 全体チェックの対象に含めない。assets_pending/blockedの途中経過データでCI全体を
// 落とさないようにする（個別slug指定時は引き続き対象にする）。
const productSlugs = targets.length
  ? targets.filter((s) => existsSync(productsPath(s)))
  : listSlugs(PATHS.products).filter((s) => existsSync(articlePath(s)));
if (!productSlugs.length) console.log('（商品データなし）');
for (const slug of productSlugs) {
  if (!validateProductsFor(slug, policy).print().ok) failed++;
}

console.log('\n=== 記事検証 ===');
for (const slug of slugs) {
  if (!validateArticle(slug, policy).print().ok) failed++;
}

console.log('\n=== Pinterest投稿案検証 ===');
const pinSlugs = targets.length ? targets.filter((s) => existsSync(pinterestPath(s))) : listSlugs(PATHS.pinterest);
if (!pinSlugs.length) console.log('（投稿案なし）');
for (const slug of pinSlugs) {
  if (!validatePins(slug, policy).print().ok) failed++;
}

if (!noBuild && policy.publish.requireBuildPass) {
  console.log('\n=== ビルド ===');
  try {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    console.log('[PASS] astro build');
  } catch {
    console.log('[FAIL] astro build');
    failed++;
  }
}

// 商品データが無い記事があれば、ASIN記入が次の作業だと知らせる。
// 記事があるものだけでなく、仕様データだけ揃っているものも対象にする。
const queue = loadQueue();
const specDir = join(ROOT, 'content', 'pipeline', 'specs');
const needAsin = queue.items
  .filter((i) => i.type === 'comparison' && i.state !== 'blocked')
  .map((i) => i.slug)
  .filter((s) => existsSync(join(specDir, `${s}.json`)) && !existsSync(productsPath(s)));
if (needAsin.length) {
  console.log(`\n── 購入導線が無い記事 ${needAsin.length} 件 ──`);
  for (const s of needAsin) console.log(`  ${s}`);
  console.log('  ASINを記入すると購入リンクを掲載できます: npm run asin:sheet');
}

console.log(`\n${failed ? `公開ゲート不合格: ${failed} 件` : '公開ゲート合格。main へ push 可能。'}`);
process.exit(failed ? 1 : 0);
