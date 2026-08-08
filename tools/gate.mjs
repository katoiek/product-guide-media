#!/usr/bin/env node
// 公開ゲート。商品データ・記事・ビルドをまとめて検証する。
//   node tools/gate.mjs            全記事を検証してビルド
//   node tools/gate.mjs <slug>     指定記事のみ
//   node tools/gate.mjs --no-build ビルドを省略
import { readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadPolicy, PATHS, ROOT, listSlugs, productsPath } from './lib/pipeline.mjs';
import { validateProductsFor } from './validate-products.mjs';
import { validateArticle } from './validate-article.mjs';

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const targets = args.filter((a) => !a.startsWith('--'));

const policy = loadPolicy();
const slugs = targets.length
  ? targets
  : readdirSync(PATHS.articles).filter((f) => f.endsWith('.astro')).map((f) => f.replace(/\.astro$/, ''));

let failed = 0;

console.log('=== 商品アセット検証 ===');
const productSlugs = targets.length ? targets.filter((s) => existsSync(productsPath(s))) : listSlugs(PATHS.products);
if (!productSlugs.length) console.log('（商品データなし）');
for (const slug of productSlugs) {
  if (!validateProductsFor(slug, policy).print().ok) failed++;
}

console.log('\n=== 記事検証 ===');
for (const slug of slugs) {
  if (!validateArticle(slug, policy).print().ok) failed++;
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

console.log(`\n${failed ? `公開ゲート不合格: ${failed} 件` : '公開ゲート合格。main へ push 可能。'}`);
process.exit(failed ? 1 : 0);
