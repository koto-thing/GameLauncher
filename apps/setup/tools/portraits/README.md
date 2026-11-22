# ナビの立ち絵の書き出し

`apps/setup/assets/navi/*.png` は、ユーザー提供の VRM
`NewVTuberProject/Final/LongHair/Uniform_ShortHair_VRM1.vrm` を three-vrm で描いた立ち絵。
モデルの作者がインストーラーでの配布を許可している。

このモデルの表情は `Mouth_Open`、`Blink_L/R`、猫耳の `EarTwitch_L/R` だけなので、
目・口・耳と頭の傾きを組み合わせて表情を作る。頬の赤みや汗などはセットアップ画面が描く。

## 書き出し手順

1. このフォルダに VRM を `model.vrm` としてコピーする
2. `apps/launcher/vrm-viewer` で `npm ci` を実行し、同じ場所で次を実行する。
   `NODE_PATH` は render.js から three と three-vrm を解決するために使う

   ```text
   NODE_PATH=node_modules npx esbuild ../../setup/tools/portraits/render.js --bundle --format=esm --outfile=../../setup/tools/portraits/bundle.js
   ```

3. このフォルダで `python serve.py` を起動し、ブラウザで `http://127.0.0.1:8765/` を開く
4. `out/` に 640x960 の透過 PNG が保存される。`?preview=<表情名>` で1枚だけ確認できる
