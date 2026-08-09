# ASIN記入からリンク公開までの手順

比較記事にAmazonの購入リンクと商品画像を載せるための手順です。
**この作業だけは人が行います。** ASINを推測で作ると別商品へ誘導するリンクになり、アソシエイト規約違反になるためです。

**記入するファイルは1つだけです。**

```
content/pipeline/asin-input/asins.csv
```

全記事ぶんの製品がこの1ファイルに入っています（現在33行）。

## 0. 一度だけ: アソシエイトタグを設定する

リポジトリ直下の `.env` に追記します（`.gitignore` 済み。コミットされません）。

```
AMAZON_ASSOCIATE_TAG=あなたのトラッキングID
```

トラッキングIDは `〜-22` の形式です。アソシエイト管理画面の右上、または「トラッキングID の管理」で確認できます。

## 1. CSVを開いてASINを記入する

Excel、Google スプレッドシート、メモ帳のいずれでも開けます。

| 列 | 内容 |
| --- | --- |
| `slug` | 記事のID。**編集しない** |
| `記事` | カテゴリ。目印用 |
| `種別` | `product`=比較対象、`related`=関連消耗品。**編集しない** |
| `製品名` | `メーカー｜製品名`。**編集しない** |
| **`ASIN`** | **ここに記入する** |
| **`画像URL`** | 任意。省略可 |

各行の製品を Amazon.co.jp で検索し、商品ページURLからASINを取り出します。

```
https://www.amazon.co.jp/dp/B08XYZ1234/
                             ~~~~~~~~~~
                             この10桁がASIN
```

画像URLは省略できます。入れる場合は SiteStripe の「画像」リンクから取得したURL（`m.media-amazon.com` で始まるもの）だけを使ってください。**メーカーサイトの写真は使えません**（取り込み時にエラーで止まります）。

### 選ぶときの注意

**メーカー名と容量まで一致する商品を選んでください。** 次はすべて別商品です。

- 容量違い（5L と 10L）
- 詰め替え用と本体
- セット品・まとめ買い
- 並行輸入品

判断がつかない製品は、**ASIN欄を空のままにしてください。** 行を削除する必要はありません。空欄の行は自動でスキップされ、その製品だけリンク無しで記事が公開されます。

関連消耗品（`related`）はブランド指定がありません。その用途の代表的な商品を1つ選んでください。

**全記事ぶんが揃うまで待つ必要はありません。** 1記事ぶんだけ記入して先に進められます。

## 2. 取り込む

```bash
node tools/ingest-asins.mjs
```

記入されている記事をすべて自動で判別し、`content/pipeline/products/<slug>.json` を記事ごとに書き出します。
直接商品リンクは `https://www.amazon.co.jp/dp/<ASIN>?tag=<タグ>` の形で自動生成されます。

特定の記事だけ取り込む場合:

```bash
node tools/ingest-asins.mjs cat-litter-clumping-comparison
```

記入ミスがあると、**行番号付きでエラーを出して止まります**（ASINの桁数違い、Amazon以外の画像URLなど）。

## 3. 検証する

```bash
npm run validate:products
```

`[PASS]` になればデータは公開可能です。落ちる主な理由:

| エラー | 意味 |
| --- | --- |
| `products/asin-format` | ASINが10桁の英数字になっていない |
| `products/asin-dup` | 同じASINを複数行に書いている（別商品を選び直す） |
| `products/image-host` | 画像URLがAmazon配信元でない |
| `products/count` | 比較対象が5〜7件の範囲外 |
| `products/brands` | 異なるメーカーが5社未満 |

## 4. 記事にリンクを差し込む

商品データが `[PASS]` になったら、Claude Code に

> 「ASINを記入したので取り込んで、記事にリンクを差し込んで」

と指示してください。比較表への購入リンク列、製品カードの画像、関連消耗品のリンクが追加され、ゲート通過後に公開されます。

**リンクは比較表より後ろにしか置けません**（冒頭リンクは公開ゲートが機械的に落とします）。

## CSVの行は自動で作られます

**新しい記事のためにシートを作る操作は、基本的に不要です。**

仕様データが揃って `assets_pending` に進んだ時点で、記入シートが自動的に作り直され、
その記事の行が並びます。

```
$ node tools/queue.mjs set <slug> assets_pending "公式仕様を確認"

── ASINの記入が必要な記事 3 件（残り 20 行）──
  floor-dry-sheet-comparison                 残り  8 行（0/8）
  cat-litter-deodorizing-sheet-comparison    残り  9 行（0/9）
  laundry-bleach-comparison                  残り  3 行（7/10）
```

`npm run gate` でも、購入導線が無い記事の一覧が出ます。

手動で作り直したいときは次を実行してください。

```bash
npm run asin:sheet
```

**記入済みのASINは引き継がれます**（既存CSVと商品データの両方から復元します）。
製品名をAmazonの表記に書き換えていても引き継がれるので、上書きを恐れず実行できます。

## アソシエイト審査の期限

**申請から180日以内に適格販売3件**を満たさないとアカウントが取り消されます。
`content/pipeline/queue.json` の `associateProgram.appliedOn` に申請日を記録し、`deadline` を申請日+180日で埋めてください。

条件を満たすと PA-API（Product Advertising API）が使えるようになり、以降は
`node tools/amazon-fetch.mjs items <slug> <ASIN>...` でこの手作業が不要になります。
