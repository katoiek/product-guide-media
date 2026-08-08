// パイプライン共通ユーティリティ。依存パッケージなし（Node 標準のみ）。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  policy: join(ROOT, 'content', 'pipeline', 'policy.json'),
  queue: join(ROOT, 'content', 'pipeline', 'queue.json'),
  specs: join(ROOT, 'content', 'pipeline', 'specs'),
  products: join(ROOT, 'content', 'pipeline', 'products'),
  pinterest: join(ROOT, 'content', 'pipeline', 'pinterest'),
  articles: join(ROOT, 'src', 'pages', 'articles'),
  index: join(ROOT, 'src', 'pages', 'index.astro'),
  sitemap: join(ROOT, 'public', 'sitemap.xml'),
};

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const writeJson = (path, data) =>
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');

export const loadPolicy = () => readJson(PATHS.policy);
export const loadQueue = () => readJson(PATHS.queue);
export const saveQueue = (queue) => writeJson(PATHS.queue, queue);

export const specPath = (slug) => join(PATHS.specs, `${slug}.json`);
export const productsPath = (slug) => join(PATHS.products, `${slug}.json`);
export const pinterestPath = (slug) => join(PATHS.pinterest, `${slug}.json`);
export const articlePath = (slug) => join(PATHS.articles, `${slug}.astro`);

export const loadSpec = (slug) =>
  existsSync(specPath(slug)) ? readJson(specPath(slug)) : null;
export const loadProducts = (slug) =>
  existsSync(productsPath(slug)) ? readJson(productsPath(slug)) : null;

export const listSlugs = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
    : [];

/** アソシエイトタグ。環境変数を優先し、なければ policy の既定値。 */
export const associateTag = (policy) =>
  process.env[policy.site.associateTagEnv] || policy.site.associateTag || null;

/** 検証結果コレクタ。error が1件でもあれば公開ゲートは落ちる。 */
export class Report {
  constructor(subject) {
    this.subject = subject;
    this.errors = [];
    this.warnings = [];
    this.notes = [];
  }
  error(code, message) {
    this.errors.push({ code, message });
    return this;
  }
  warn(code, message) {
    this.warnings.push({ code, message });
    return this;
  }
  note(message) {
    this.notes.push(message);
    return this;
  }
  get ok() {
    return this.errors.length === 0;
  }
  merge(other) {
    this.errors.push(...other.errors);
    this.warnings.push(...other.warnings);
    this.notes.push(...other.notes);
    return this;
  }
  print() {
    const mark = this.ok ? 'PASS' : 'FAIL';
    console.log(`\n[${mark}] ${this.subject}`);
    for (const n of this.notes) console.log(`   ・${n}`);
    for (const w of this.warnings) console.log(`   ! WARN  ${w.code}: ${w.message}`);
    for (const e of this.errors) console.log(`   x ERROR ${e.code}: ${e.message}`);
    return this;
  }
}

/** 記事・スペックの本文テキストから禁止表現を検出する。 */
export function checkText(policy, text, report, where) {
  for (const rule of policy.text.deny) {
    const re = new RegExp(rule.pattern, 'g');
    const hits = [...text.matchAll(re)].map((m) => m[0]);
    if (hits.length) {
      report.error(
        `text/${rule.id}`,
        `${where}: ${rule.reason}（該当: ${[...new Set(hits)].slice(0, 3).join('、')}）`
      );
    }
  }
  for (const rule of policy.text.warn) {
    const re = new RegExp(rule.pattern, 'g');
    const hits = [...text.matchAll(re)].map((m) => m[0]);
    if (hits.length) {
      report.warn(
        `text/${rule.id}`,
        `${where}: ${rule.reason}（${[...new Set(hits)].slice(0, 3).join('、')} × ${hits.length}）`
      );
    }
  }
}

/** 禁止ジャンルに触れていないかを判定する。 */
export function checkCategory(policy, text, report, where) {
  for (const cat of policy.blockedCategories) {
    const hit = cat.patterns.filter((p) => text.includes(p));
    if (hit.length >= 2) {
      report.error(
        `category/${cat.id}`,
        `${where}: 自動公開対象外ジャンル「${cat.label}」の語が複数含まれる（${hit.join('、')}）`
      );
    } else if (hit.length === 1) {
      report.warn(`category/${cat.id}`, `${where}: 「${hit[0]}」を含む。${cat.label} に該当しないか確認`);
    }
  }
}

/** 文字列から amazon.co.jp のURLをすべて抜き出す。 */
export function extractAmazonUrls(text) {
  const re = /https?:\/\/(?:www\.)?amazon\.co\.jp\/[^\s"'<>)）]+/g;
  return [...new Set(text.match(re) || [])];
}

/** Amazon直接商品リンクとして妥当かを判定する。 */
export function validateAmazonUrl(policy, url, expectedAsin) {
  const re = new RegExp(policy.amazon.directLinkPattern);
  const m = url.match(re);
  if (!m) {
    if (/amazon\.co\.jp\/s\?/.test(url)) return { ok: false, reason: '検索結果リンク（/s?k=...）は使用できない' };
    if (/\/gp\/product/.test(url)) return { ok: false, reason: '/dp/<ASIN> 形式へ正規化されていない' };
    if (!/\btag=/.test(url)) return { ok: false, reason: 'アソシエイトタグ（tag=）が付いていない' };
    return { ok: false, reason: '/dp/<ASIN>?tag=... の形式に一致しない' };
  }
  const asin = m[1];
  if (expectedAsin && asin !== expectedAsin) {
    return { ok: false, reason: `URLのASIN(${asin})が商品データのASIN(${expectedAsin})と一致しない` };
  }
  return { ok: true, asin };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function daysSince(dateStr) {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}
