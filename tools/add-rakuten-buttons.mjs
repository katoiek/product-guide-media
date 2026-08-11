#!/usr/bin/env node
// 記事(.astro)内のAmazon購入ボタンを、products.jsonにrakutenリンクがある製品だけ
// Amazon+楽天の併記(.buy-group)に変換する。既にbuy-group化済みの箇所は変更しない（冪等）。
//
//   node tools/add-rakuten-buttons.mjs <slug> ...
import { readFileSync, writeFileSync } from 'node:fs';
import { articlePath, loadProducts } from './lib/pipeline.mjs';

const slugs = process.argv.slice(2);
if (!slugs.length) {
  console.error('用法: add-rakuten-buttons.mjs <slug> ...');
  process.exit(2);
}

for (const slug of slugs) {
  const products = loadProducts(slug);
  if (!products) { console.error(`products が見つかりません: ${slug}`); continue; }

  const byAsin = new Map();
  for (const p of products.products ?? []) {
    if (p.rakuten?.url) byAsin.set(p.asin, p.rakuten.url);
  }
  const byUrl = new Map();
  for (const r of products.related ?? []) {
    if (r.rakutenUrl) byUrl.set(r.url, r.rakutenUrl);
  }

  let src = readFileSync(articlePath(slug), 'utf8');
  let count = 0;

  // 比較対象: /dp/<ASIN>?tag=... のAmazonボタンをASINで照合する。
  src = src.replace(
    /<a class="buy" href="(https:\/\/www\.amazon\.co\.jp\/dp\/([A-Z0-9]{10})\?tag=[^"]+)" rel="sponsored nofollow noopener" target="_blank">([^<]+)<\/a>/g,
    (whole, amazonUrl, asin, label) => {
      const rakutenUrl = byAsin.get(asin);
      if (!rakutenUrl) return whole;
      count++;
      return `<div class="buy-group"><a class="buy" href="${amazonUrl}" rel="sponsored nofollow noopener" target="_blank">${label}</a><a class="buy rakuten" href="${rakutenUrl}" rel="sponsored nofollow noopener" target="_blank">楽天</a></div>`;
    }
  );

  // 関連消耗品: link.amazon/... 等のURLで照合する。
  src = src.replace(
    /<a class="buy" href="((?:https:\/\/link\.amazon|https:\/\/www\.amazon\.co\.jp\/s\?)[^"]*)" rel="sponsored nofollow noopener" target="_blank">([^<]+)<\/a>/g,
    (whole, amazonUrl, label) => {
      const rakutenUrl = byUrl.get(amazonUrl);
      if (!rakutenUrl) return whole;
      count++;
      const rakutenLabel = label.includes('探す') ? '楽天で探す' : '楽天';
      return `<div class="buy-group"><a class="buy" href="${amazonUrl}" rel="sponsored nofollow noopener" target="_blank">${label}</a><a class="buy rakuten" href="${rakutenUrl}" rel="sponsored nofollow noopener" target="_blank">${rakutenLabel}</a></div>`;
    }
  );

  writeFileSync(articlePath(slug), src, 'utf8');
  console.log(`${slug}: ${count} 箇所に楽天ボタンを追加しました。`);
}
