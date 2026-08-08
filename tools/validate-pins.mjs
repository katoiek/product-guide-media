#!/usr/bin/env node
// Pinterest 投稿案を配信ポリシーに照らして検証する。
// 使い方: node tools/validate-pins.mjs [slug ...]   引数なしで全件
import { existsSync, readFileSync } from 'node:fs';
import {
  loadPolicy, readJson, pinterestPath, listSlugs, PATHS,
  Report, checkText, extractAmazonUrls,
} from './lib/pipeline.mjs';

// 煽り表現。記事本文の deny リストとは別に、ピン特有のものを足す。
const HYPE = /(絶対|必ず|最強|神|これだけで|知らないと損|買ってはいけない|全員|誰でも|驚愕|裏技)/g;

export function validatePins(slug, policy = loadPolicy()) {
  const report = new Report(`pins: ${slug}`);
  if (!existsSync(pinterestPath(slug))) {
    return report.error('pins/missing', `${pinterestPath(slug)} が存在しない`);
  }
  const data = readJson(pinterestPath(slug));
  const cfg = policy.distribution.pinterest;

  const expectedUrl = `${policy.site.origin}/articles/${slug}/`;
  if (data.articleUrl !== expectedUrl) {
    report.error('pins/article-url', `articleUrl が ${data.articleUrl}。${expectedUrl} である必要がある`);
  }

  const pins = Array.isArray(data.pins) ? data.pins : [];
  if (pins.length !== cfg.pinsPerArticle) {
    report.error('pins/count', `投稿案が ${pins.length} 本。${cfg.pinsPerArticle} 本である必要がある`);
  }

  const titles = new Set();
  pins.forEach((pin, i) => {
    const at = `#${i + 1}`;
    for (const field of ['title', 'description', 'imageText', 'board', 'postAt']) {
      if (!pin[field] || (Array.isArray(pin[field]) && !pin[field].length)) {
        report.error('pins/field', `${at}: 必須項目 ${field} が空`);
      }
    }
    if (pin.title) {
      if ([...pin.title].length > cfg.titleMaxChars) {
        report.error('pins/title-length', `${at}: タイトルが ${[...pin.title].length} 文字（上限 ${cfg.titleMaxChars}）`);
      }
      if (titles.has(pin.title)) report.error('pins/title-dup', `${at}: タイトル「${pin.title}」が重複。切り口を変える`);
      titles.add(pin.title);
    }
    if (pin.description && [...pin.description].length > cfg.descriptionMaxChars) {
      report.error('pins/desc-length', `${at}: 説明文が ${[...pin.description].length} 文字（上限 ${cfg.descriptionMaxChars}）`);
    }
    if (Array.isArray(pin.imageText) && pin.imageText.length > 2) {
      report.error('pins/image-text', `${at}: 画像文字が ${pin.imageText.length} 行（2行以内）`);
    }
    if (cfg.forbidProductImages && pin.imageSource && !/自作|比較表/.test(pin.imageSource)) {
      report.error('pins/image-source', `${at}: imageSource が "${pin.imageSource}"。${cfg.imageSourceNote}`);
    }
  });

  const allText = pins.map((p) => `${p.title ?? ''} ${p.description ?? ''} ${(p.imageText ?? []).join(' ')}`).join('\n');
  if (cfg.forbidHypePhrases) {
    const hits = [...new Set(allText.match(HYPE) || [])];
    if (hits.length) report.error('pins/hype', `煽り表現を含む（${hits.join('、')}）`);
  }
  checkText(policy, allText, report, 'ピン文面');

  // 商品画像URL・Amazon直リンクがピンに混ざっていないか
  const amazon = extractAmazonUrls(JSON.stringify(data));
  if (amazon.length) {
    report.error('pins/amazon-link', `ピンにAmazonのURLが含まれる（${amazon.length}件）。遷移先は記事URLのみ`);
  }
  if (/m\.media-amazon\.com|images-na\.ssl-images-amazon\.com/.test(JSON.stringify(data))) {
    report.error('pins/product-image', 'Amazonの商品画像URLが含まれる。ピンには自作の比較表画像だけを使う');
  }

  // 記事が実在し公開されているか
  const articleSrc = `${PATHS.articles}/${slug}.astro`;
  if (!existsSync(articleSrc)) {
    report.error('pins/no-article', `対象記事 ${articleSrc} が存在しない`);
  } else if (!readFileSync(articleSrc, 'utf8').includes(`slug="${slug}"`)) {
    report.warn('pins/slug-mismatch', '記事の slug プロパティが一致しない');
  }

  report.note(`投稿案 ${pins.length} 本 / 切り口 ${titles.size} 種`);
  return report;
}

if (process.argv[1]?.endsWith('validate-pins.mjs')) {
  const policy = loadPolicy();
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : listSlugs(PATHS.pinterest);
  if (!slugs.length) {
    console.log('検証対象の投稿案がありません（content/pipeline/pinterest/*.json）。');
    process.exit(0);
  }
  let failed = 0;
  for (const slug of slugs) {
    if (!validatePins(slug, policy).print().ok) failed++;
  }
  console.log(`\n合計 ${slugs.length} 件中 ${failed} 件が不合格。`);
  process.exit(failed ? 1 : 0);
}
