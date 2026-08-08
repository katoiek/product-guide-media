# えらびノート 自動化パイプライン

最終更新: 2026-08-08

比較記事の企画から公開までを、5体の専任エージェントと機械的な公開ゲートで回す仕組みです。
**認証情報、APIキー、トークン、パスワードはこのリポジトリに保存しません。**

## 1. 全体像

```
idea ──▶ spec_research ──▶ assets_pending ──▶ drafting ──▶ gate ──▶ published
  │            │                  │               │           │
  └────────────┴──────────────────┴───────────────┴───────────┴──▶ blocked
```

| state | 担当エージェント | やること | 抜ける条件 |
| --- | --- | --- | --- |
| `idea` | `erabi-topic-scout` | テーマ発掘、比較単位の成立判定 | 異なる5〜7ブランドで成立し、禁止ジャンルでない |
| `spec_research` | `erabi-spec-researcher` | メーカー公式ページのみで仕様収集 | 全製品の仕様と `officialUrl` が揃う |
| `assets_pending` | `erabi-asset-broker` | ASIN・直接リンク・許諾済み画像の取得 | `validate-products.mjs` が PASS |
| `drafting` | `erabi-article-writer` | 記事(.astro) + トップ導線 + sitemap | `validate-article.mjs` が PASS |
| `gate` | `erabi-publish-gate` | 全検証 + ビルド + commit + push | `gate.mjs` 全 PASS |
| `blocked` | — | 人の判断待ち | 理由を解消して差し戻す |

エージェント定義は `.claude/agents/erabi-*.md`、オーケストレータは `.claude/skills/erabi-pipeline/SKILL.md` にあります。

## 2. 動かし方

### Claude Code から1周回す

```
/erabi-pipeline
```

キューの最優先1件を、進める限り進めます。特定のテーマを指定する場合は `/erabi-pipeline kitchen-sponge-comparison`。

### 単一工程だけ動かす

エージェント名を指定して呼びます。例:

- 「erabi-spec-researcher で kitchen-sponge-comparison の公式仕様を調べて」
- 「erabi-publish-gate で全記事のゲートを回して」

### 定期実行

`.github/workflows/pipeline.yml` が毎週 月・木 07:00 JST に1周回します。
有効化には次が必要です。

1. リポジトリ Secrets に `ANTHROPIC_API_KEY`
2. PA-API を使う場合は `AMAZON_ACCESS_KEY` / `AMAZON_SECRET_KEY` / `AMAZON_ASSOCIATE_TAG`
3. Settings > Actions > General > Workflow permissions を **Read and write permissions**

`ANTHROPIC_API_KEY` が未設定の間、ジョブは自動でスキップされます。
`.github/workflows/publish-gate.yml`（検証のみ）はシークレット不要で、push と PR のたびに走ります。

## 3. コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run queue status` | キュー一覧と担当エージェント |
| `npm run queue next` | 次に着手すべき1件（JSON） |
| `npm run queue set <slug> <state> "備考"` | 状態遷移（履歴に記録される） |
| `npm run queue add <slug> "<タイトル>" "<カテゴリ>" <categorySlug>` | 新規テーマ登録 |
| `npm run validate:products [slug]` | 商品アセットの検証 |
| `npm run validate:articles [slug]` | 記事の検証 |
| `npm run gate [slug]` | 商品 + 記事 + ビルドをまとめて検証 |
| `npm run gate:fast` | ビルドを省略して検証だけ |
| `node tools/amazon-fetch.mjs search "<語>" --brand <B>` | PA-API で ASIN 候補を探す |
| `node tools/amazon-fetch.mjs items <slug> <ASIN>...` | PA-API で商品データを書き出す |
| `node tools/ingest-sitestripe.mjs <slug> <tsv>` | SiteStripe の取得結果を取り込む |

## 4. データの置き場所

| パス | 役割 |
| --- | --- |
| `content/pipeline/policy.json` | 機械可読の公開ポリシー。**唯一の正** |
| `content/pipeline/queue.json` | 企画キューと状態機械 |
| `content/pipeline/specs/<slug>.json` | メーカー公式仕様（記事の根拠） |
| `content/pipeline/products/<slug>.json` | ASIN・直接リンク・画像（購入導線） |
| `src/pages/articles/<slug>.astro` | 公開記事 |
| `tools/` | 検証・取得スクリプト（Node標準ライブラリのみ、依存追加なし） |

記事には `type` があります。`comparison` は比較記事（アフィリエイト導線あり、全条件を検証）、`guide` は一般ガイド（商品導線を持たない。持っていたらエラー）。すべての記事は `queue.json` への登録が必須で、未登録の記事はゲートで落ちます。

## 5. 公開ゲートが落とすもの

`content/pipeline/policy.json` に定義された条件です。**通すためにポリシーを緩めることは禁止**です。

- 製品数が5〜7件でない／異なるブランドが5社未満
- 禁止ジャンル（金融・転職・医療・法律・健康効果訴求）の語が複数含まれる
- 効果の断定・結果保証・最上級表現（`必ず◯◯できる`、`絶対に安全`、`最強`、`No.1` など）
  - 「購入前に必ず確認してください」のような確認喚起は WARN 止まりで通る
- 未実使用製品の使用感・実測値・レビュー要約
- `amazon.co.jp/s?k=` の検索結果リンク、`tag=` の無いリンク、`/gp/product` 形式
- URL の ASIN と商品データの ASIN が不一致
- 画像が `m.media-amazon.com` などのAmazonプログラム配信元でない（メーカーサイト画像の転載）
- 画像許諾種別が `amazon_program_content` 以外
- 製品にメーカー公式ページURL(`officialUrl`)が無い
- 比較表に「確認日」が無い
- トップページ(`index.astro`)または `sitemap.xml` に導線が無い
- `astro build` が失敗する

## 6. Amazon商品データの2経路

### 経路A: PA-API v5（Creators API）— 本命

環境変数（**リポジトリには書かない**。ローカルはシェル、CI は GitHub Secrets）:

```
AMAZON_ACCESS_KEY
AMAZON_SECRET_KEY
AMAZON_ASSOCIATE_TAG
```

`tools/amazon-fetch.mjs` が AWS Signature V4 で署名し、`webservices.amazon.co.jp` の
`SearchItems` / `GetItems` を呼びます。直接商品リンクは API の返す URL ではなく、
検証済み ASIN とタグから `https://www.amazon.co.jp/dp/<ASIN>?tag=<tag>` を自前で組み立てます。

PA-API の利用には Amazonアソシエイト側の資格条件（一定期間内の適格販売実績など）があります。
条件を満たしていない間は経路Bを使います。

### 経路B: SiteStripe — 暫定

人がアソシエイト管理画面で ASIN と商品画像URLを取得し、TSV にして取り込みます。

```
# ASIN	商品名	メーカー／ブランド	商品画像URL
B0XXXXXXXX	製品名A	メーカーA	https://m.media-amazon.com/images/I/xxxx.jpg
```

```
export AMAZON_ASSOCIATE_TAG=your-tag-22
node tools/ingest-sitestripe.mjs <slug> input.tsv
node tools/validate-products.mjs <slug>
```

どちらの経路でも、**Amazonのページ・検索結果・画像CDN・レビューをスクレイピングしません。**

## 7. 止まる条件

エージェントは次の場合、回避策を探さずに止めて報告します。

- ポリシーを変更しないと通せない
- PA-API 認証情報が無く、人手の SiteStripe 取得が必要
- 公式仕様が5社ぶん揃わない
- 禁止ジャンルの疑いが出た
- `git push` が失敗した、`git status` に想定外のファイルがある

## 8. 既知のギャップ

- **PA-API 未接続。** 認証情報が未設定のため、全記事で購入導線と製品画像が未掲載。
- **猫砂記事の `officialUrl` が未記録。** 記事作成時に根拠URLが保存されておらず、
  `content/pipeline/specs/cat-litter-clumping-comparison.json` の `officialUrl` が `null`。
  現在この記事は公開ゲートで落ちる。`erabi-spec-researcher` での再取得が必要。
- **食洗機用洗剤・洗濯用液体洗剤・キッチンスポンジ**は `spec_research` のまま未着手。
