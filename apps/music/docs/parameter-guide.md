# パラメータ変更

| 場所                                    | 値・単位                                                          | 影響                                         | 反映                 |
| --------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- | -------------------- |
| `src/config/domain-policy.defaults.ts`  | maxAudioFileBytes=64MiB、maxImageFileBytes=8MiB                   | 新規アップロードの容量制限                   | 再ビルド・再配信     |
| 同上                                    | maxAudioDurationSeconds=600秒                                     | 音源登録とループ検証                         | 再ビルド・再配信     |
| 同上                                    | maxImageEdgePixels=4096px                                         | 画像の最長辺                                 | 再ビルド・再配信     |
| 同上                                    | minimumLengthSeconds=0.1秒                                        | 新規ループ設定の最小長                       | 再ビルド・再配信     |
| 同上                                    | titleMax=160、descriptionMax=4000、creditMax=24                   | 公開テキストとクレジット数                   | 再ビルド・再配信     |
| 同上                                    | creditNameMax=160、creditRoleMax=80、imageAltMax=300、urlMax=2048 | 名前・役割・画像代替文・外部URLの文字数      | 再ビルド・再配信     |
| `src/config/player-runtime.defaults.ts` | decodedAudioBudgetBytes=96MiB                                     | 区間ループのPCM上限、公開時にも検証          | 再ビルド・再配信     |
| 同上                                    | decodeSampleRateHz=48000Hz                                        | AudioContextのPCM展開レート                  | 再ビルド・再配信     |
| 同上                                    | loopPreviewLeadInSeconds=3秒                                      | 継ぎ目試聴の先行時間                         | 再ビルド・再配信     |
| 同上                                    | displayIntervalMs=200ms                                           | 表示更新のみ。音声精度に影響しない           | 再ビルド・再配信     |
| 同上                                    | simultaneousDecodeLimit=1、nextTrackAudioPrefetchEnabled=false    | 初期版の固定サポート条件。他の値は起動時拒否 | 実装拡張が必要       |
| `src/config/server-config.ts`           | session=8時間、OAuth途中状態=10分                                 | 新規発行の有効期限                           | 再ビルド・再配信     |
| 同上                                    | 認証10回/IP/分、素材20回/人/分、更新120回/人/分                   | 429を返す回数制限                            | 再ビルド・再配信     |
| 同上                                    | jsonMaxBytes=32KiB                                                | 管理JSONの実測本文上限                       | 再ビルド・再配信     |
| `src/config/design-tokens.css`          | 色・余白・44px操作領域等                                          | 見た目                                       | 再ビルド・再配信     |
| DB（管理画面）                          | 曲順、画像、クレジット、loop開始/終了秒                           | 下書き保存後、公開反映時に切替               | 再起動不要           |
| DB（運営画面）                          | 広告ON/OFF、画像・リンク・alt、担当者・停止                       | 次のAPI操作から反映                          | 再起動不要           |
| Worker環境/Secrets                      | SITE_ORIGIN、CONTACT_URL、GitHub認証設定                          | 環境固有の動作                               | 対象環境への設定反映 |

ループ秒数の小数を保存時に丸めません。UI上の経過時間だけ分秒表示です。サンプルレートとチャンネル数はサーバーが検証した音源情報を使用します。音源差し替えでは古いループをいったん解除し、保存後に再設定します。

初期値の変更は既存レコードを書き換えません。上限を厳しくした場合、次回の編集・公開検証に影響します。認可や秘密は担当者が編集できません。PCM予算は端末の安全な総メモリ量の保証ではありません。
