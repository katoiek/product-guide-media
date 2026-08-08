# ASIN記入からリンク公開までの手順

比較記事にAmazonの購入リンクと商品画像を載せるための手順です。
**この作業だけは人が行います。** ASINを推測で作ると別商品へ誘導するリンクになり、アソシエイト規約違反になるためです。

所要時間の目安: 1記事あたり15〜25分（製品5〜7件 + 関連消耗品2〜4件）。

## 0. 一度だけ: アソシエイトタグを設定する

リポジトリ直下の `.env` に追記します（`.gitignore` 済み。コミットされません）。

```
AMAZON_ASSOCIATE_TAG=あなたのトラッキングID
```

トラッキングIDは `〜-22` の形式です。アソシエイト管理画面の右上、または「トラッキングID の管理」で確認できます。

## 1. 記入用シートを作る

```bash
node tools/make-asin-sheet.mjs <slug>
```

`content/pipeline/asin-input/<slug>.tsv` に、仕様データの製品名を並べたファイルができます。4記事ぶんは作成済みです。

| slug | 比較対象 | 関連消耗品 |
| --- | --- | --- |
| `cat-litter-clumping-comparison` | 5件 | 3件 |
| `dishwasher-detergent-comparison` | 6件 | 2件 |
| `laundry-liquid-detergent-comparison` | 6件 | 3件 |
| `kitchen-sponge-comparison` | 6件 | 2件 |

## 2. ASINを記入する

各行の製品を Amazon.co.jp で検索し、商品ページURLからASINを取り出して2列目に貼ります。

```
https://www.amazon.co.jp/dp/B08XYZ1234/
                             ~~~~~~~~~~
                             ここの10桁がASIN
```

タブ区切りです。Excel や Google スプレッドシートで開いても構いません（保存時はタブ区切りテキストのまま）。

```
ライオンペット｜ニオイをとる砂 5L	B08XYZ1234	https://m.media-amazon.com/images/I/xxxx.jpg
```

3列目の商品画像URLは省略できます。入れる場合は SiteStripe の「画像」リンクから取得したURL（`m.media-amazon.com` で始まるもの）を使ってください。**メーカーサイトの写真を貼らないでください。**

### 選ぶときの注意

**メーカー名と容量まで一致する商品を選んでください。** 次はすべて別商品です。

- 容量違い（5L と 10L）
- 詰め替え用と本体
- セット品・まとめ買い
- 並行輸入品

判断がつかない製品は、**ASIN欄を空のままにしてください。** 行を削除する必要はありません。空欄の行は自動でスキップされ、その製品にはリンクが付きません（記事は他の製品のリンクだけで公開できます）。

関連消耗品はブランド指定がありません。その用途の代表的な商品を1つ選んでください。

## 3. 取り込む

```bash
node tools/ingest-sitestripe.mjs <slug>
```

`content/pipeline/products/<slug>.json` が作られます。直接商品リンクは、記入されたASINとタグから
`https://www.amazon.co.jp/dp/<ASIN>?tag=<タグ>` の形で自動生成されます。

## 4. 検証する

```bash
node tools/validate-products.mjs <slug>
```

`[PASS]` になればデータは公開可能です。落ちる主な理由:

| エラー | 意味 |
| --- | --- |
| `products/asin-format` | ASINが10桁の英数字になっていない |
| `products/asin-dup` | 同じASINを複数行に書いている（別商品を選び直す） |
| `products/image-host` | 画像URLがAmazon配信元でない（メーカーサイトの写真は使えない） |
| `products/count` | 比較対象が5〜7件の範囲外 |
| `products/brands` | 異なるメーカーが5社未満 |

## 5. 記事にリンクを差し込む

商品データが `[PASS]` になったら、記事本文へのリンク配置は自動化されています。

```
node tools/queue.mjs set <slug> drafting "ASIN取得済み。購入導線を追加する"
```

そのうえで Claude Code に「`erabi-article-writer` で `<slug>` に購入導線を追加して」と指示してください。比較表への購入リンク列、製品カードの画像、関連消耗品のリンクが追加されます。

**リンクは比較表より後ろにしか置けません**（冒頭リンクは公開ゲートが機械的に落とします）。

## 6. 公開する

```bash
npm run gate
```

全項目 PASS を確認してから commit / push します。Cloudflare Pages が本番ビルドします。

## アソシエイト審査の期限

**申請から180日以内に適格販売3件**を満たさないとアカウントが取り消されます。
`content/pipeline/queue.json` の `associateProgram.appliedOn` に申請日を記録し、`deadline` を申請日+180日で埋めてください。

条件を満たすと PA-API（Product Advertising API）が使えるようになり、以降は
`node tools/amazon-fetch.mjs items <slug> <ASIN>...` でこの手作業が不要になります。
