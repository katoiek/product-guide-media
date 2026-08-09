# えらびノート 自動化パイプライン

最終更新: 2026-08-08

比較記事の企画から公開までを、5体の専任エージェントと機械的な公開ゲートで回す仕組みです。
**認証情報、APIキー、トークン、パスワードはこのリポジトリに保存しません。**

## 0. ゴール

**アフィリエイトで安定した収益を自動的に得ること。** 「安定」の実体は3つで、以下の設計はすべてこれに紐づいています。

1. **1本の記事が繰り返し成約する** → 消耗品・買い替え頻度でジャンルを選ぶ（`policy.topicSelection`）
2. **季節や検索順位の変動で沈まない** → 通年需要のテーマに限り、検索とPinterestの2経路を作る
3. **アカウントが止まらない** → レビュー転載・未使用体験談・画像の無断利用を機械的に落とす

記事数を増やすことは目的ではありません。3を破ると1と2がまとめて消えます。

## 1. 全体像

```
idea ─▶ spec_research ─▶ assets_pending ─▶ drafting ─▶ gate ─▶ distribution ─▶ published
  │           │                │              │          │           │
  └───────────┴────────────────┴──────────────┴──────────┴───────────┴──▶ blocked
```

| state | 担当エージェント | やること | 抜ける条件 |
| --- | --- | --- | --- |
| `idea` | `erabi-topic-scout` | テーマ発掘、比較単位の成立判定 | 消耗品・通年需要・買い替え頻度の条件を満たし、異なる5〜7ブランドで成立 |
| `spec_research` | `erabi-spec-researcher` | メーカー公式ページのみで仕様収集 | 全製品の仕様と `officialUrl`、関連消耗品2件以上 |
| `assets_pending` | `erabi-asset-broker` | ASIN・直接リンク・許諾済み画像の取得 | `validate-products.mjs` が PASS |
| `drafting` | `erabi-article-writer` | 記事(.astro) + トップ導線 + sitemap | `validate-article.mjs` が PASS |
| `gate` | `erabi-publish-gate` | 全検証 + ビルド + commit + push | `gate.mjs` 全 PASS |
| `distribution` | `erabi-pinterest-scout` | Pinterest投稿案10本の生成 | `validate-pins.mjs` が PASS |
| `blocked` | — | 人の判断待ち | 理由を解消して差し戻す |

エージェント定義は `.claude/agents/erabi-*.md`、オーケストレータは `.claude/skills/erabi-pipeline/SKILL.md` にあります。

## 1-2. ジャンル選定の原則

**報酬率で選びません。買い替え頻度で選びます。** 率の高いカテゴリは検索需要が薄いか比較記事が飽和しています。率が低くても同じ人が半年ごとに買い続けるジャンルのほうが、記事1本あたりの累積収益が大きくなります。

`policy.topicSelection.required` が機械可読の条件です。

| 条件 | 理由 |
| --- | --- |
| 消耗品・定期的に買い替える日用品 | 1本の記事が繰り返し成約する |
| 季節変動が小さい | セール期だけ跳ねて閑散期に沈む構成を避ける |
| 仕様や対応条件で評価が割れやすい | 全製品が同仕様なら比較記事に価値がない |
| 実売1,500〜8,000円 | 単価が低すぎると件数が要り、高すぎると買い替えが起きない |
| 半年以内に再購入される | 過去記事が資産として積み上がる |

却下理由は `policy.topicSelection.rejectReasons` に定義しています。

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

### 定期実行と更新頻度

`.github/workflows/pipeline.yml` が週2回動きます。**役割が違います。**

| 曜日（JST） | モード | 内容 |
| --- | --- | --- |
| 火 07:00 | `new` | 新規記事を**1本だけ**進める |
| 金 07:00 | `refresh` | `queue.mjs stale` の最も古い1件を再確認。対象が無ければ何もしない |

手動実行では `mode` を `new` / `refresh` / `auto` から選べます。

**新規は週1本を上限にしています。** これを超えると公式ページとの突き合わせ検証が追いつかず、形骸化します。実際に製品名の不一致が2件見つかっており（ブランドサイトの表記と流通名の差、特にP&G系）、検証を省くと誤った商品にアフィリエイトリンクを貼ることになります。

**既存記事の再確認を新規と同じペースで回します。** 収益は記事数ではなく「成約している記事が生き続けていること」から出ます。仕様が古い記事を放置して新規を積むのは、資産を減らしながら増やしているのと同じです。記事が10本を超えたら新規を減らし、更新側に寄せてください。

再確認が必要になる条件:

| きっかけ | 対応 |
| --- | --- |
| `verifiedAt` から180日経過 | 全製品の公式ページを再確認 |
| 製品の廃番・リニューアル | 該当製品を差し替え、比較表を更新 |
| メーカーが仕様表示を変更 | `specs` を更新し `verifiedAt` を更新 |
| ASIN が別商品を指すようになった | `erabi-asset-broker` でリンクを取り直す |

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
| `npm run queue stale` | 仕様確認が180日以上古い公開済み記事 |
| `npm run queue set <slug> <state> "備考"` | 状態遷移（履歴に記録される） |
| `npm run queue add <slug> "<タイトル>" "<カテゴリ>" <categorySlug>` | 新規テーマ登録 |
| `npm run validate:products [slug]` | 商品アセットの検証 |
| `npm run validate:articles [slug]` | 記事の検証 |
| `npm run validate:pins [slug]` | Pinterest投稿案の検証 |
| `npm run gate [slug]` | 商品 + 記事 + 投稿案 + ビルドをまとめて検証 |
| `npm run gate:fast` | ビルドを省略して検証だけ |
| `npm run earnings:import -- <csv> --month YYYY-MM` | Amazonのレポートを取り込む |
| `npm run revenue` | 記事別の成果と次のテーマの手がかり |
| `node tools/amazon-fetch.mjs search "<語>" --brand <B>` | PA-API で ASIN 候補を探す |
| `node tools/amazon-fetch.mjs items <slug> <ASIN>...` | PA-API で商品データを書き出す |
| `npm run asin:sheet` | ASIN記入用CSVを生成（記入済みは引き継ぐ） |
| `npm run asin:ingest` | 記入済みCSVから商品データを作る |

## 4. データの置き場所

| パス | 役割 |
| --- | --- |
| `content/pipeline/policy.json` | 機械可読の公開ポリシー。**唯一の正** |
| `content/pipeline/queue.json` | 企画キューと状態機械 |
| `content/pipeline/specs/<slug>.json` | メーカー公式仕様（記事の根拠） |
| `content/pipeline/products/<slug>.json` | ASIN・直接リンク・画像（`products` = 比較対象、`related` = 関連消耗品） |
| `content/pipeline/pinterest/<slug>.json` | Pinterest投稿案（人が画像を作るための指示書） |
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
- **比較表より前にAmazonリンクがある**（冒頭リンクは購入まで進みにくく、記事の信頼も落ちる）
- 画像が `m.media-amazon.com` などのAmazonプログラム配信元でない（メーカーサイト画像の転載）
- 画像許諾種別が `amazon_program_content` 以外
- 製品にメーカー公式ページURL(`officialUrl`)が無い
- 比較表に「確認日」が無い
- 仕様データの関連消耗品が本文に出てこない／`related` のリンクが未掲載
- 一般ガイド(`type: guide`)に商品アフィリエイト導線がある
- Pinterest投稿案に煽り表現、Amazon直リンク、Amazon商品画像が含まれる
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

### アソシエイト審査の期限（PA-API 解禁の前提）

**申請から180日以内に適格販売3件**を満たさないとアカウントが取り消されます。PA-API の利用資格もこの条件に連動します。

したがって順番が重要です。**先に申請せず、購入導線を持つ比較記事を数本公開してから申請します。** 記事が0本の状態で申請すると、180日のカウントだけが進みます。

状態は `content/pipeline/queue.json` の `associateProgram` に記録します。`appliedOn` を埋めたら `deadline`（申請日 + 180日）を再計算してください。現在は `status: "unknown"` / `paapiAccess: false` です。

### 経路B: 手動でASIN記入 — アカウントがあれば即日使える

**PA-APIの承認を待つ必要はありません。** アソシエイトアカウントとタグがあれば、この経路で今日リンクを載せられます。

```bash
npm run asin:sheet          # 全記事ぶんの記入CSVを1枚作る
# → content/pipeline/asin-input/asins.csv に人がASINを記入
npm run asin:ingest         # 記入された記事をまとめて取り込む
npm run validate:products   # 検証
```

**詳しい手順は [`docs/ASIN-INPUT.md`](./ASIN-INPUT.md) を参照してください。**

記入するファイルは **`content/pipeline/asin-input/asins.csv` の1枚だけ**です。全記事の製品が `slug` 列付きで並んでおり、製品名・ブランドは事前に埋まっています。人がやるのはASINを探して貼ることだけです。

ASIN未記入の行は自動でスキップされるため、判断がつかない製品だけリンク無しで公開できます。1記事ぶんだけ記入して先に進めることもできます。記入ミス（ASINの桁数違い、Amazon以外の画像URL）は行番号付きで止まります。

CSVを再生成しても記入済みのASINは引き継がれます。記入済みCSVは `.gitignore` 済みです（タグを含むため）。

どちらの経路でも、**Amazonのページ・検索結果・画像CDN・レビューをスクレイピングしません。**

## 7. 止まる条件

エージェントは次の場合、回避策を探さずに止めて報告します。

- ポリシーを変更しないと通せない
- ASIN が未取得で、人手での記入が必要（docs/ASIN-INPUT.md）
- 公式仕様が5社ぶん揃わない
- 禁止ジャンルの疑いが出た
- `git push` が失敗した、`git status` に想定外のファイルがある

## 7-2. Pinterest 導線

検索順位が立ち上がるまでの空白を埋め、順位変動のリスクを分散するための第2経路です。`erabi-pinterest-scout` が記事1本につき投稿案を10本生成します。

- **ピンに Amazon の商品画像・メーカーの製品写真を使いません。** 自作の比較表画像だけを使います。Amazonプログラムの画像許諾はピン画像への転用を含みません
- ピンの遷移先は記事URLのみ。Amazon直リンクをピンに貼りません
- 煽り表現（「絶対」「必ず」「最強」「これだけで」「知らないと損」）は `validate-pins.mjs` が機械的に落とします
- 10本は同じ記事の**別の切り口**にします（比較軸ごと、先に外す条件、読者状況、意見が割れる仕様）

**比較表画像そのものの作成は自動化していません。** JSON の `imageText` / `palette` / `layout` は、人が Canva 等で作るための指示書です。ここが現在唯一の手作業です。

## 8. 既知のギャップ

- **PA-API 未接続。** 認証情報が未設定のため、**全4記事で購入導線と製品画像が未掲載**。
  これが収益ゼロの直接原因であり、最優先の課題。アソシエイト審査の状態も `unknown`。
- **比較表画像の作成が手作業。** Pinterest 投稿案は生成できるが、画像そのものは人が作る。
  Pinterest 導線（`distribution`）はまだ1本も実行していない。
- **収益の計測経路が無い。** どの記事がいくら生んだかをパイプラインが知らないため、
  「稼いでいるジャンルの隣を掘る」判断ができない。PA-API 接続後、アソシエイトのレポートを
  取り込んで `queue.json` に実績を戻す仕組みが次の課題。
- **エージェントの報告は検証が必要。** 実運用で製品名の不一致が2件見つかっている
  （アリエール、ジョイ。いずれもブランドサイトの表記と流通名の差）。
  ASIN を引く前に必ず製品名を公式ページと照合すること。

## 9. 収益の計測

**どの記事がいくら生んだかを測り、次に何を書くかの判断に使う仕組みです。**

記事数を増やすだけでは収益は安定しません。成約している記事とそうでない記事を見分け、当たっているジャンルの隣を掘るために計測します。

### 公開リポジトリなので金額は保存しない

このリポジトリは公開設定です。収益額をコミットすると誰でも見られるため、次のように分けています。

| データ | 置き場所 | コミット |
| --- | --- | --- |
| Amazonのレポート原本 | 任意（ローカル） | しない |
| 記事別の集計（金額を含む） | `content/pipeline/revenue/earnings.json` | **しない**（`.gitignore` 済み） |
| 順位・区分のみ | `queue.json` の `revenueRank` / `revenueTier` | する（金額なし） |

`revenueTier` は `high`（最上位の50%以上）／`mid`（15%以上）／`low`／`none`（成果なし）の4段階です。

### 手順

1. アソシエイト・セントラル → レポート → ダウンロード で「注文レポート」などのCSVを取得
2. 取り込む

```bash
npm run earnings:import -- <report.csv> --month 2026-08
```

3. 判断材料を見る

```bash
npm run revenue              # 直近月の内訳と提案
npm run revenue -- --all     # 月次推移も出す
npm run revenue -- --write-rank   # 順位だけを queue.json へ（金額は書かない）
```

CSVの文字コード（UTF-8／Shift_JIS）と列名は自動判定します。レポート種別で列名が変わるため、候補から探して見つかった列を表示します。

### 何が分かるか

**記事別の成果** — 比較対象と関連消耗品を分けて集計します。関連消耗品が稼いでいるなら、そのジャンル自体が記事になります。

**リンクしていない商品** — 読者が「ついで買い」した、記事でリンクしていない商品です。**ここが次のテーマの最有力候補**になります。読者が実際に金を払った証拠だからです。

**成果が出ていない公開記事** — 公開から3か月以上経って成果ゼロなら、検索順位が立ち上がっていないか、比較軸が読者の判断と合っていません。新規を足す前にこちらを見直します。

**カテゴリ別の成果** — 上位カテゴリの隣接テーマを優先します。

### 使うときの注意

- Amazonの成果は**24時間以内にカートへ入った商品すべて**が対象です。記事でリンクした商品以外の成果が多いのは正常で、むしろ「ついで買い」が効いている状態です
- ASINが複数の記事に登場する場合、その成果は最初に見つかった記事に寄せられます。厳密に分けたい場合は記事ごとに別のトラッキングIDを作り、リンクのタグを変えてください（アソシエイトは1アカウントで複数のIDを作れます）
- 返品・キャンセルは後から反映されます。月次で取り込み直すと数字が変わります
