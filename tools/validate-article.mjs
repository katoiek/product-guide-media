#!/usr/bin/env node
// 記事(.astro)を公開ポリシーに照らして検証する。
// 使い方: node tools/validate-article.mjs [slug ...]   引数なしで articles 配下の全記事
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import {
  loadPolicy, loadQueue, loadSpec, loadProducts, articlePath, PATHS,
  Report, checkText, checkCategory, extractAmazonUrls, validateAmazonUrl, daysSince,
} from './lib/pipeline.mjs';
import { validateProductsFor } from './validate-products.mjs';

const prop = (src, name) => src.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

export function validateArticle(slug, policy = loadPolicy(), queue = loadQueue()) {
  const report = new Report(`article: ${slug}`);
  const path = articlePath(slug);
  if (!existsSync(path)) return report.error('article/missing', `${path} が存在しない`);
  const src = readFileSync(path, 'utf8');

  // 記事はすべてキュー登録が必要。type で検証範囲が変わる。
  const item = queue.items.find((i) => i.slug === slug);
  if (!item) {
    return report.error(
      'article/unmanaged',
      `キュー(content/pipeline/queue.json)に未登録。node tools/queue.mjs add ${slug} "<タイトル>" "<カテゴリ>" <categorySlug> で登録する`
    );
  }
  const type = item.type ?? 'comparison';
  report.note(`type=${type} / state=${item.state}`);

  // --- レイアウトとメタデータ ---
  if (!src.includes('ArticleLayout')) {
    report.error('article/layout', 'ArticleLayout を使っていない');
  }
  const slugProp = prop(src, 'slug');
  if (slugProp !== slug) {
    report.error('article/slug', `slug プロパティ "${slugProp}" がファイル名 "${slug}" と一致しない`);
  }
  for (const name of ['title', 'description', 'category']) {
    if (!prop(src, name)) report.error('article/meta', `${name} プロパティが無い`);
  }
  const desc = prop(src, 'description') ?? '';
  if (desc && (desc.length < 40 || desc.length > 200)) {
    report.warn('article/description-length', `description が ${desc.length} 文字（40〜200文字が目安）`);
  }
  const h1 = (src.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) report.error('article/h1', `<h1> が ${h1} 個。1個である必要がある`);

  // --- 本文表現 ---
  const body = src.replace(/<style>[\s\S]*?<\/style>/g, '');
  checkText(policy, body, report, '本文');
  checkCategory(policy, body, report, '本文');

  // --- 根拠の明示（比較記事のみ） ---
  // 確認日は verifiedAt プロパティ（レイアウトが描画）か本文のどちらかにあればよい。
  if (type === 'comparison' && policy.sources.requireVerifiedDate && !prop(src, 'verifiedAt') && !/確認日/.test(body)) {
    report.error('article/verified-date', 'verifiedAt プロパティも本文の「確認日」も無い（比較表の根拠日が必要）');
  }

  // レイアウトが広告開示を出すのは type="comparison" のときだけ。
  // 導線があるのに guide 扱いだと、開示が出ないままリンクが載る。
  const typeProp = prop(src, 'type');
  if (type === 'comparison' && typeProp !== 'comparison') {
    report.error(
      'article/type-prop',
      'ArticleLayout に type="comparison" が無い。広告開示がページに出力されないため、購入リンクを載せられない'
    );
  }

  // --- Amazonリンク ---
  const urls = extractAmazonUrls(src);
  if (type === 'guide' && urls.length) {
    report.error('article/guide-affiliate', `一般ガイドに商品アフィリエイト導線がある（${urls.length}件）。比較記事として登録し直すか導線を外す`);
  }

  // 冒頭にリンクを置かない。比較表より前に導線があると購入まで進みにくい。
  if (type === 'comparison' && urls.length && policy.amazon.linkPlacement?.forbidBeforeComparisonTable) {
    const firstTable = src.indexOf('<table');
    const firstLink = Math.min(...urls.map((u) => src.indexOf(u)).filter((i) => i >= 0));
    if (firstTable < 0) {
      report.error('article/no-table', '比較表(<table>)が無い');
    } else if (firstLink < firstTable) {
      report.error('article/link-placement', `比較表より前にAmazonリンクがある。${policy.amazon.linkPlacement.reason}`);
    }
  }
  const products = loadProducts(slug);
  const productByUrl = new Map((products?.products ?? []).map((p) => [p.url, p]));
  for (const url of urls) {
    const expected = productByUrl.get(url)?.asin ?? null;
    const v = validateAmazonUrl(policy, url, expected);
    if (!v.ok) report.error('article/amazon-url', `${url} — ${v.reason}`);
    else if (products && !productByUrl.has(url)) {
      report.error('article/amazon-unregistered', `${url} は商品データ(products JSON)に登録されていない`);
    }
  }
  for (const rej of policy.amazon.rejectPatterns) {
    if (new RegExp(rej.pattern).test(src)) {
      report.error(`article/${rej.id}`, rej.reason);
    }
  }

  // --- 仕様データとの整合（比較記事のみ） ---
  const spec = type === 'comparison' ? loadSpec(slug) : null;
  if (type !== 'comparison') {
    // 一般ガイドは仕様データ・商品アセットを持たない
  } else if (!spec) {
    report.warn('article/spec-missing', `仕様データ content/pipeline/specs/${slug}.json が無い（既存記事の遡及登録が必要）`);
  } else {
    const items = spec.products ?? [];
    const { minProducts, maxProducts, minDistinctBrands } = policy.comparison;
    if (items.length < minProducts || items.length > maxProducts) {
      report.error('article/spec-count', `仕様データの製品数が ${items.length} 件（${minProducts}〜${maxProducts} 件）`);
    }
    const brands = new Set(items.map((p) => (p.brand || '').trim()).filter(Boolean));
    if (brands.size < minDistinctBrands) {
      report.error('article/spec-brands', `異なるメーカー／ブランドが ${brands.size} 社（${minDistinctBrands} 社以上必要）`);
    }
    for (const p of items) {
      if (p.name && !src.includes(p.name)) {
        report.error('article/spec-missing-product', `仕様データの製品「${p.name}」が本文に出てこない`);
      }
      if (policy.sources.requireOfficialSpecUrl && !p.officialUrl) {
        report.error('article/spec-source', `製品「${p.name}」にメーカー公式ページURLが無い`);
      }
    }
    if (spec.verifiedAt && daysSince(spec.verifiedAt) > policy.sources.maxSpecAgeDays) {
      report.warn('article/spec-stale', `仕様確認日 ${spec.verifiedAt} が ${policy.sources.maxSpecAgeDays} 日より古い`);
    }

    // 同時に買われやすい関連消耗品。24時間の成果条件を活かすため、比較対象の後に置く。
    const rel = spec.relatedProducts ?? [];
    if (rel.length < policy.comparison.minRelatedProducts) {
      report.warn(
        'article/related-missing',
        `関連消耗品が ${rel.length} 件。仕様データに relatedProducts を ${policy.comparison.minRelatedProducts} 件以上入れると、ついで買いの導線を作れる`
      );
    }
    for (const r of rel) {
      if (r.name && !src.includes(r.name)) {
        report.error('article/related-not-placed', `関連消耗品「${r.name}」が本文に出てこない`);
      }
    }
  }

  // --- 商品アセットの掲載状況（比較記事のみ） ---
  if (type !== 'comparison') {
    // 一般ガイドは対象外
  } else if (!products) {
    report.warn('article/products-missing', 'Amazon商品データが無いため、購入導線・製品画像なしの状態');
  } else if (validateProductsFor(slug, policy).ok) {
    for (const p of products.products) {
      if (!src.includes(p.url)) report.error('article/link-not-placed', `${p.title}: 直接商品リンクが本文に未掲載`);
      if (p.imageUrl && !src.includes(p.imageUrl)) {
        report.warn('article/image-not-placed', `${p.title}: 許諾済み商品画像が本文に未掲載`);
      }
    }
    for (const p of products.related ?? []) {
      if (!src.includes(p.url)) report.error('article/related-link-not-placed', `関連消耗品 ${p.title}: 直接商品リンクが本文に未掲載`);
    }
  } else {
    report.warn('article/products-invalid', '商品データがゲート不合格のため、購入導線は掲載できない');
  }

  // --- サイト内導線 ---
  const href = `/articles/${slug}/`;
  if (policy.publish.requireIndexEntry && !readFileSync(PATHS.index, 'utf8').includes(href)) {
    report.error('article/index-entry', `トップページ(index.astro)に ${href} へのリンクが無い`);
  }
  if (policy.publish.requireSitemapEntry && existsSync(PATHS.sitemap)) {
    if (!readFileSync(PATHS.sitemap, 'utf8').includes(href)) {
      report.error('article/sitemap-entry', `sitemap.xml に ${policy.site.origin}${href} が無い`);
    }
  }

  report.note(`Amazonリンク ${urls.length} 件 / 仕様データ ${spec ? 'あり' : 'なし'} / 商品データ ${products ? 'あり' : 'なし'}`);
  return report;
}

if (process.argv[1]?.endsWith('validate-article.mjs')) {
  const policy = loadPolicy();
  const queue = loadQueue();
  const slugs = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync(PATHS.articles).filter((f) => f.endsWith('.astro')).map((f) => f.replace(/\.astro$/, ''));
  let failed = 0;
  for (const slug of slugs) {
    if (!validateArticle(slug, policy, queue).print().ok) failed++;
  }
  console.log(`\n合計 ${slugs.length} 記事中 ${failed} 件がゲート不合格。`);
  process.exit(failed ? 1 : 0);
}
