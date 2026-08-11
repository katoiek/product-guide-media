#!/usr/bin/env node
// 楽天市場商品検索API（Ichiba Item Search）クライアント。
// 自動では1件に確定しない。送料無料・安い順の候補を複数出し、
// 最終的にどれを採用するかは必ず人が確認して選ぶ（Amazon SiteStripe運用と同じ考え方）。
//
//   node tools/rakuten-fetch.mjs candidates <slug>   spec.json の products/related を検索し、
//                                                     候補一覧を content/pipeline/rakuten-input/<slug>-candidates.md に書き出す
//   node tools/rakuten-fetch.mjs ingest [slug ...]    content/pipeline/rakuten-input/rakuten.csv に人が記入したURLを取り込む
//
// 必要な環境変数（リポジトリには絶対に書かない）:
//   RAKUTEN_APP_ID / RAKUTEN_APP_SECRET / RAKUTEN_AFFILIATE_ID
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEnv, loadSpec, productsPath, writeJson, readJson, today, ROOT } from './lib/pipeline.mjs';

const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const SITE_ORIGIN = 'https://erabi-note.jp';
const RAKUTEN_INPUT_DIR = join(ROOT, 'content', 'pipeline', 'rakuten-input');
const CSV_PATH = join(RAKUTEN_INPUT_DIR, 'rakuten.csv');

function creds() {
  const appId = readEnv('RAKUTEN_APP_ID');
  const accessKey = readEnv('RAKUTEN_APP_SECRET');
  const affiliateId = readEnv('RAKUTEN_AFFILIATE_ID');
  const missing = [
    !appId && 'RAKUTEN_APP_ID',
    !accessKey && 'RAKUTEN_APP_SECRET',
    !affiliateId && 'RAKUTEN_AFFILIATE_ID',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`楽天APIの認証情報が未設定です: ${missing.join(', ')}\n.env に追記してください。`);
    process.exit(3);
  }
  return { appId, accessKey, affiliateId };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 申請QPS(1)を守るため、リクエスト間に最低1.1秒あける。
let lastCallAt = 0;
async function throttle() {
  const wait = lastCallAt + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function search(keyword, { hits = 10, retry = true } = {}) {
  const { appId, accessKey, affiliateId } = creds();
  const params = new URLSearchParams({
    applicationId: appId,
    accessKey,
    affiliateId,
    keyword,
    sort: '+itemPrice',
    postageFlag: '1',
    availability: '1',
    hits: String(hits),
  });
  await throttle();
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { Referer: `${SITE_ORIGIN}/`, Origin: SITE_ORIGIN },
  });
  const text = await res.text();
  if (res.status === 429 && retry) {
    await sleep(2000);
    return search(keyword, { hits, retry: false });
  }
  if (!res.ok) {
    console.error(`楽天API が ${res.status} を返しました:\n${text}`);
    process.exit(4);
  }
  const data = JSON.parse(text);
  return (data.Items ?? []).map((wrap) => wrap.Item);
}

/**
 * ブランド名が商品名・店舗名のどちらにも含まれない候補は明らかに無関係なので落とす。
 * これは「最終的に人が選ぶための候補を絞る」ためのフィルタであり、
 * 残った候補の中から1件に自動で確定することはしない
 * （同一ブランド内のライン違い・ライフステージ違いを機械的に区別できないため）。
 */
function filterByBrand(items, brand) {
  const norm = (s) => (s ?? '').replace(/[\s　･・【】\[\]]/g, '').toLowerCase();
  // 「ピュリナ／ネスレ日本」「マルカン（サンライズ）」のような複合表記は
  // 区切り文字で分割し、いずれか一致すれば候補として残す。
  const parts = (brand ?? '')
    .split(/[／/（）()・]/)
    .map(norm)
    .filter(Boolean);
  if (!parts.length) return items;
  return items.filter((it) => {
    const hay = norm(it.itemName) + norm(it.shopName);
    return parts.some((p) => hay.includes(p));
  });
}

/**
 * 犬用／猫用のように対象種が明確な商品名の場合、候補の商品名にも
 * 同じ種を示す語が含まれることを要求する。ブランド名だけで絞ると
 * 同ブランドの別種向けライン（例: ドッグフードのブランドのキャットフード）が
 * 紛れ込むことがあるため、これを機械的に弾く。
 */
function filterBySpecies(items, specName) {
  const hasDog = /犬|ドッグ|\bdog\b/i.test(specName);
  const hasCat = /猫|キャット|\bcat\b/i.test(specName);
  if (!hasDog && !hasCat) return items;
  return items.filter((it) => {
    const text = it.itemName ?? '';
    if (hasDog && !/犬|ドッグ|dog/i.test(text)) return false;
    if (hasCat && !/猫|キャット|cat/i.test(text)) return false;
    return true;
  });
}

function csvEscape(s) {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'candidates') {
  const [slug] = rest;
  if (!slug) { console.error('用法: rakuten-fetch.mjs candidates <slug>'); process.exit(2); }
  const spec = loadSpec(slug);
  if (!spec) { console.error(`spec が見つかりません: ${slug}`); process.exit(2); }

  const entries = [
    ...spec.products.map((p) => ({ kind: 'product', brand: p.brand, name: p.name })),
    ...(spec.relatedProducts ?? []).map((r) => ({ kind: 'related', brand: '', name: r.name })),
  ];

  let md = `# ${slug} 楽天候補一覧（送料無料・安い順、確認日 ${today()}）\n\n`;
  md += `**必ず人が確認して1件を選び、rakuten.csv の URL 列に貼り付けてください。**\n`;
  md += `同一ブランド内でもライン・ライフステージ違いの商品が混ざることがあります（例:「アダルト」と「アダルト8+」は別商品）。\n\n`;

  if (!existsSync(RAKUTEN_INPUT_DIR)) mkdirSync(RAKUTEN_INPUT_DIR, { recursive: true });

  const csvRows = [];
  // 括弧書きの説明（例:「ミニ アダルト（小型犬専用フード 成犬用）」の（…）部分）は
  // 検索キーワードに含めると精度が落ちるため取り除く。
  const coreName = (name) => name.replace(/[（(][^）)]*[）)]/g, '').trim();

  for (const e of entries) {
    const keyword = e.kind === 'product' ? `${e.brand} ${coreName(e.name)}` : e.name;
    let items = [];
    let usedKeyword = keyword;
    try {
      items = await search(keyword, { hits: 10 });
      // フルキーワードはAND検索で絞りすぎて0件になることがあるため、
      // 商品名の先頭2トークンだけに絞って再試行する（ブランド名は最初の1語だけ使う）。
      if (!items.length && e.kind === 'product') {
        const brandHead = (e.brand ?? '').split(/[／/（）()・\s　]+/).filter(Boolean)[0] ?? '';
        const nameTokens = coreName(e.name).split(/[\s　]+/).filter(Boolean);
        // 犬／猫のように対象種を示すトークンは、先頭2語から漏れても必ず残す
        // （同ブランドの別種向け商品が紛れ込むのを防ぐため）。
        const speciesToken = nameTokens.find((t) => /犬|ドッグ|猫|キャット/.test(t));
        const nameHead = [...new Set([...nameTokens.slice(0, 2), speciesToken].filter(Boolean))].join(' ');
        usedKeyword = `${brandHead} ${nameHead}`.trim();
        items = await search(usedKeyword, { hits: 10 });
      }
    } catch (err) {
      md += `## ${e.brand ? `${e.brand}｜` : ''}${e.name}\n\n検索エラー: ${err.message}\n\n`;
      csvRows.push([slug, e.kind, e.brand, e.name, '']);
      continue;
    }
    const candidates = e.kind === 'product' ? filterBySpecies(filterByBrand(items, e.brand), e.name) : items;

    md += `## ${e.brand ? `${e.brand}｜` : ''}${e.name}\n\n`;
    if (usedKeyword !== keyword) md += `（検索キーワードを短縮: "${usedKeyword}"）\n\n`;
    if (!candidates.length) {
      md += `候補なし（検索結果 ${items.length} 件中、ブランド名一致なし）。手動で検索するか、キーワードを見直してください。\n\n`;
    } else {
      for (const it of candidates.slice(0, 5)) {
        md += `- **${it.itemName}**\n`;
        md += `  店舗: ${it.shopName} / 価格: ${it.itemPrice}円 / 送料無料フラグ: ${it.postageFlag}\n`;
        md += `  ${it.affiliateUrl || it.itemUrl}\n\n`;
      }
    }
    csvRows.push([slug, e.kind, e.brand, e.name, '']);
  }

  const mdPath = join(RAKUTEN_INPUT_DIR, `${slug}-candidates.md`);
  writeFileSync(mdPath, md, 'utf8');
  console.log(`候補一覧を書き出しました: ${mdPath}`);

  // CSVは複数slugぶんを1ファイルに集約する。既存行（他slug・記入済み分）は残す。
  const header = 'slug,種別,ブランド,製品名,URL\n';
  let existingLines = [];
  if (existsSync(CSV_PATH)) {
    existingLines = readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('slug,'));
  }
  const keepLines = existingLines.filter((l) => !l.startsWith(`${slug},`));
  const newLines = csvRows.map((r) => r.map(csvEscape).join(','));
  writeFileSync(CSV_PATH, header + [...keepLines, ...newLines].join('\n') + '\n', 'utf8');
  console.log(`記入シートを更新しました: ${CSV_PATH}`);
  console.log(`\n次: ${mdPath} を見ながら ${CSV_PATH} の URL 列に選んだリンクを貼り付け、\n    node tools/rakuten-fetch.mjs ingest ${slug} を実行してください。`);
} else if (cmd === 'ingest') {
  const only = rest;
  if (!existsSync(CSV_PATH)) {
    console.error(`シートがありません: ${CSV_PATH}\n先に node tools/rakuten-fetch.mjs candidates <slug> を実行してください。`);
    process.exit(2);
  }
  const lines = readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('slug,'));

  function parseLine(line) {
    const cols = [];
    let cur = '', quoted = false;
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

  const bySlug = new Map();
  let filled = 0, empty = 0;
  for (const line of lines) {
    const [slug, kind, brand, name, url] = parseLine(line);
    if (!slug) continue;
    if (only.length && !only.includes(slug)) continue;
    if (!url) { empty++; continue; }
    let host = null;
    try { host = new URL(url).host; } catch { /* below */ }
    if (!host || !/rakuten/.test(host)) {
      console.error(`不正なURL（rakuten.co.jpドメインではない）: ${slug} / ${name} → ${url}`);
      process.exit(2);
    }
    if (!bySlug.has(slug)) bySlug.set(slug, {});
    bySlug.get(slug)[`${kind}|${brand}|${name}`] = { url, brand, name, kind };
    filled++;
  }

  if (!bySlug.size) {
    console.log('取り込む行がありませんでした（URL列が空、または対象slugなし）。');
    process.exit(0);
  }

  for (const [slug, map] of bySlug) {
    if (!existsSync(productsPath(slug))) {
      console.error(`products が見つかりません: ${slug}（先に Amazon 側を作成してください）`);
      continue;
    }
    const data = readJson(productsPath(slug));
    let updated = 0;
    for (const p of data.products ?? []) {
      const hit = Object.values(map).find((m) => m.kind === 'product' && m.brand === p.brand && (m.name === p.title || m.name.includes(p.title) || p.title.includes(m.name)));
      if (hit) { p.rakuten = { url: hit.url, verifiedAt: today() }; updated++; }
    }
    for (const r of data.related ?? []) {
      const hit = Object.values(map).find((m) => m.kind === 'related' && (m.name === r.title || m.name.includes(r.title) || r.title.includes(m.name)));
      if (hit) { r.rakutenUrl = hit.url; updated++; }
    }
    writeJson(productsPath(slug), data);
    console.log(`${slug}: ${updated} 件に楽天リンクを反映しました。`);
  }
  console.log(`\n記入済み ${filled} 行 / 未記入 ${empty} 行`);
  console.log(`次: node tools/validate-products.mjs`);
} else {
  console.error('用法: rakuten-fetch.mjs candidates <slug> | ingest [slug ...]');
  process.exit(2);
}
