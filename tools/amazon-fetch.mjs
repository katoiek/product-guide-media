#!/usr/bin/env node
// Amazon Product Advertising API v5（Creators API）クライアント。
// 正規のASIN・直接商品リンク・プログラム配信の商品画像だけを取得する。スクレイピングは行わない。
//
//   node tools/amazon-fetch.mjs search "食洗機 洗剤" [--brand 花王] [--count 10]
//   node tools/amazon-fetch.mjs items <slug> <ASIN> <ASIN> ...     -> products JSON を書き出す
//
// 必要な環境変数（リポジトリには絶対に書かない）:
//   AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_ASSOCIATE_TAG
import { createHmac, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadPolicy, productsPath, writeJson, readJson, today } from './lib/pipeline.mjs';

const REGION = 'us-west-2';
const HOST = 'webservices.amazon.co.jp';
const SERVICE = 'ProductAdvertisingAPI';
const MARKETPLACE = 'www.amazon.co.jp';

const RESOURCES = [
  'ItemInfo.Title',
  'ItemInfo.ByLineInfo',
  'ItemInfo.ProductInfo',
  'Images.Primary.Large',
];

function creds() {
  const accessKey = process.env.AMAZON_ACCESS_KEY;
  const secretKey = process.env.AMAZON_SECRET_KEY;
  const partnerTag = process.env.AMAZON_ASSOCIATE_TAG;
  const missing = [
    !accessKey && 'AMAZON_ACCESS_KEY',
    !secretKey && 'AMAZON_SECRET_KEY',
    !partnerTag && 'AMAZON_ASSOCIATE_TAG',
  ].filter(Boolean);
  if (missing.length) {
    console.error(
      `PA-APIの認証情報が未設定です: ${missing.join(', ')}\n` +
      `PA-APIを使えない場合は npm run asin:sheet で記入CSVを作り、npm run asin:ingest で取り込んでください（docs/ASIN-INPUT.md）。`
    );
    process.exit(3);
  }
  return { accessKey, secretKey, partnerTag };
}

const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();
const sha256hex = (data) => createHash('sha256').update(data, 'utf8').digest('hex');

/** AWS Signature Version 4 でリクエストに署名して送信する。 */
async function call(operation, path, payload) {
  const { accessKey, secretKey, partnerTag } = creds();
  const body = JSON.stringify({
    ...payload,
    PartnerTag: partnerTag,
    PartnerType: 'Associates',
    Marketplace: MARKETPLACE,
  });

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const target = `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${operation}`;

  const headers = {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host: HOST,
    'x-amz-date': amzDate,
    'x-amz-target': target,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join('');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, sha256hex(body)].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  let key = hmac(`AWS4${secretKey}`, dateStamp);
  key = hmac(key, REGION);
  key = hmac(key, SERVICE);
  key = hmac(key, 'aws4_request');
  const signature = hmac(key, stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${HOST}${path}`, {
    method: 'POST',
    headers: { ...headers, Authorization: authorization },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`PA-API ${operation} が ${res.status} を返しました:\n${text}`);
    process.exit(4);
  }
  return JSON.parse(text);
}

/** PA-APIのItemを、公開ポリシーが要求する商品レコードへ正規化する。 */
function normalize(item, partnerTag) {
  const asin = item.ASIN;
  return {
    asin,
    title: item.ItemInfo?.Title?.DisplayValue ?? '',
    brand:
      item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ??
      item.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue ??
      '',
    // 検索URLではなく、必ず /dp/<ASIN> の直接リンクを自前で組み立てる。
    url: `https://www.amazon.co.jp/dp/${asin}?tag=${partnerTag}`,
    imageUrl: item.Images?.Primary?.Large?.URL ?? '',
    imageLicense: 'amazon_program_content',
    verifiedAt: today(),
  };
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'search') {
  const keywords = rest.find((a) => !a.startsWith('--'));
  if (!keywords) { console.error('用法: amazon-fetch.mjs search "キーワード" [--brand X] [--count N]'); process.exit(2); }
  const brand = rest[rest.indexOf('--brand') + 1];
  const count = Number(rest[rest.indexOf('--count') + 1]) || 10;
  const payload = { Keywords: keywords, SearchIndex: 'All', ItemCount: count, Resources: RESOURCES };
  if (rest.includes('--brand') && brand) payload.Brand = brand;
  const data = await call('SearchItems', '/paapi5/searchitems', payload);
  const { partnerTag } = creds();
  const items = (data.SearchResult?.Items ?? []).map((i) => normalize(i, partnerTag));
  console.log(JSON.stringify(items, null, 2));
} else if (cmd === 'items') {
  const isRelated = rest.includes('--related');
  const args = rest.filter((a) => a !== '--related');
  const [slug, ...asins] = args;
  if (!slug || !asins.length) { console.error('用法: amazon-fetch.mjs items <slug> [--related] <ASIN> ...'); process.exit(2); }
  const bad = asins.filter((a) => !/^[A-Z0-9]{10}$/.test(a));
  if (bad.length) { console.error(`ASIN形式が不正: ${bad.join(', ')}`); process.exit(2); }

  const policy = loadPolicy();
  const { minProducts, maxProducts, minRelatedProducts, maxRelatedProducts } = policy.comparison;
  const [lo, hi] = isRelated ? [minRelatedProducts, maxRelatedProducts] : [minProducts, maxProducts];
  if (asins.length < lo || asins.length > hi) {
    console.error(`ASINが ${asins.length} 件。公開ポリシーは${isRelated ? '関連消耗品' : '比較製品'}に ${lo}〜${hi} 件を要求します。`);
    process.exit(2);
  }

  const data = await call('GetItems', '/paapi5/getitems', { ItemIds: asins, Resources: RESOURCES });
  const { partnerTag } = creds();
  const items = (data.ItemsResult?.Items ?? []).map((i) => normalize(i, partnerTag));

  const missing = asins.filter((a) => !items.some((i) => i.asin === a));
  if (missing.length) console.error(`取得できなかったASIN: ${missing.join(', ')}`);

  // --related は既存ファイルの products を残したまま related だけを差し替える。
  const existing = (isRelated && existsSync(productsPath(slug))) ? readJson(productsPath(slug)) : {};
  writeJson(productsPath(slug), {
    ...existing,
    slug,
    source: 'paapi5',
    associateTag: partnerTag,
    verifiedAt: today(),
    products: isRelated ? (existing.products ?? []) : items,
    ...(isRelated ? { related: items } : existing.related ? { related: existing.related } : {}),
  });
  console.log(`${productsPath(slug)} の ${isRelated ? 'related' : 'products'} に ${items.length} 件を書き出しました。`);
  console.log(`次: node tools/validate-products.mjs ${slug}`);
} else {
  console.error('用法: amazon-fetch.mjs search "キーワード" | items <slug> [--related] <ASIN> ...');
  process.exit(2);
}
