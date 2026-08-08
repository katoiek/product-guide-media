#!/usr/bin/env node
// Amazon商品アセット（ASIN・直接リンク・画像許諾）を公開ポリシーに照らして検証する。
// 使い方: node tools/validate-products.mjs [slug ...]   引数なしで全件
import { existsSync } from 'node:fs';
import {
  loadPolicy, loadProducts, productsPath, listSlugs, PATHS,
  Report, associateTag, validateAmazonUrl, daysSince,
} from './lib/pipeline.mjs';

const IMAGE_HOSTS = ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com'];

export function validateProductsFor(slug, policy = loadPolicy()) {
  const report = new Report(`products: ${slug}`);
  if (!existsSync(productsPath(slug))) {
    return report.error('products/missing', `${productsPath(slug)} が存在しない`);
  }
  const data = loadProducts(slug);
  const tag = data.associateTag || associateTag(policy);
  if (!tag) {
    report.error(
      'products/no-tag',
      `アソシエイトタグが未設定。環境変数 ${policy.site.associateTagEnv} を設定するか products JSON に associateTag を書く`
    );
  }

  const items = Array.isArray(data.products) ? data.products : [];
  const related = Array.isArray(data.related) ? data.related : [];
  const { minProducts, maxProducts, minDistinctBrands, minRelatedProducts, maxRelatedProducts } = policy.comparison;
  if (items.length < minProducts || items.length > maxProducts) {
    report.error('products/count', `製品数が ${items.length} 件。${minProducts}〜${maxProducts} 件である必要がある`);
  }
  // 関連消耗品（同時に買われやすい商品）。0件は許容するが、入れるなら件数制限を守る。
  if (related.length && (related.length < minRelatedProducts || related.length > maxRelatedProducts)) {
    report.error('products/related-count', `関連消耗品が ${related.length} 件。${minRelatedProducts}〜${maxRelatedProducts} 件である必要がある`);
  }

  const asins = new Set();
  const brands = new Set();

  const checkItem = (p, at, { countBrand }) => {
    // 関連消耗品は「猫用トイレ消臭シート」のような一般名で扱うため、ブランド名は必須にしない。
    // 比較対象はブランド間比較が記事の骨格なので必須。
    for (const field of policy.amazon.requiredProductFields) {
      if (field === 'brand' && !countBrand) continue;
      if (!p[field]) report.error('products/field', `${at}: 必須項目 ${field} が空`);
    }
    if (!p.asin) return;

    if (!/^[A-Z0-9]{10}$/.test(p.asin)) {
      report.error('products/asin-format', `${at}: ASIN "${p.asin}" が10桁英数字ではない`);
    }
    if (asins.has(p.asin)) report.error('products/asin-dup', `${at}: ASIN ${p.asin} が重複`);
    asins.add(p.asin);
    // 関連消耗品はブランド多様性の要件に数えない（比較対象ではないため）。
    if (countBrand && p.brand) brands.add(p.brand.trim());

    if (p.url) {
      const v = validateAmazonUrl(policy, p.url, p.asin);
      if (!v.ok) report.error('products/url', `${at}: ${v.reason}`);
      else if (tag && !p.url.includes(`tag=${tag}`)) {
        report.error('products/url-tag', `${at}: URLのtagが設定値(${tag})と一致しない`);
      }
    }

    if (p.imageLicense && !policy.amazon.allowedImageLicenses.includes(p.imageLicense)) {
      report.error('products/image-license', `${at}: 画像許諾種別 "${p.imageLicense}" は許可されていない`);
    }
    if (p.imageUrl) {
      let host = null;
      try { host = new URL(p.imageUrl).host; } catch { /* 後段でエラーにする */ }
      if (!host) report.error('products/image-url', `${at}: imageUrl がURLとして不正`);
      else if (!IMAGE_HOSTS.includes(host)) {
        report.error('products/image-host', `${at}: 画像ホスト ${host} はAmazonプログラム配信元ではない（メーカーサイト画像の転載は不可）`);
      }
    }
    if (p.verifiedAt && daysSince(p.verifiedAt) > policy.sources.maxSpecAgeDays) {
      report.warn('products/stale', `${at}: 確認日 ${p.verifiedAt} が ${policy.sources.maxSpecAgeDays} 日より古い`);
    }
  };

  // 関連消耗品は一般名のカテゴリなので、検索結果リンク・短縮リンクを許可する
  // （記事が特定の1商品を名指ししていないため）。ASINも必須にしない。
  const relCfg = policy.amazon.relatedLinks ?? {};
  const checkRelatedLink = (p, at) => {
    if (!p.title) report.error('products/related-field', `${at}: title が空`);
    if (!p.url) return report.error('products/related-field', `${at}: url が空`);
    let host = null;
    try { host = new URL(p.url).host; } catch { /* 下でエラーにする */ }
    if (!host) return report.error('products/related-url', `${at}: url がURLとして不正`);
    const allowed = relCfg.allowedHosts ?? policy.amazon.allowedHosts;
    if (!allowed.includes(host)) {
      report.error('products/related-host', `${at}: ${host} はAmazonのドメインではない`);
    }
    if (p.imageUrl) {
      report.warn('products/related-image', `${at}: 検索結果リンクに商品画像は付けられない（無視される）`);
    }
  };

  items.forEach((p, i) => checkItem(p, `#${i + 1} ${p.title || p.asin || '(名称不明)'}`, { countBrand: true }));
  related.forEach((p, i) => {
    const at = `関連#${i + 1} ${p.title || p.asin || '(名称不明)'}`;
    // ASIN を持つものは通常の商品として、持たないものはカテゴリリンクとして検証する
    if (p.asin) checkItem(p, at, { countBrand: false });
    else if (relCfg.allowSearchLinks) checkRelatedLink(p, at);
    else report.error('products/related-asin', `${at}: ASIN が無い`);
  });

  if (brands.size < minDistinctBrands) {
    report.error(
      'products/brands',
      `異なるメーカー／ブランドが ${brands.size} 社。${minDistinctBrands} 社以上必要（同一シリーズの色・容量違いの並列は不可）`
    );
  }

  report.note(`製品 ${items.length} 件 / 関連消耗品 ${related.length} 件 / ブランド ${brands.size} 社 / タグ ${tag ?? '未設定'}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('validate-products.mjs')) {
  const policy = loadPolicy();
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : listSlugs(PATHS.products);
  if (!slugs.length) {
    console.log('検証対象の商品データがありません（content/pipeline/products/*.json）。');
    process.exit(0);
  }
  let failed = 0;
  for (const slug of slugs) {
    const r = validateProductsFor(slug, policy).print();
    if (!r.ok) failed++;
  }
  console.log(`\n合計 ${slugs.length} 件中 ${failed} 件がゲート不合格。`);
  process.exit(failed ? 1 : 0);
}
