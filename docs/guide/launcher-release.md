# Launcher公開

Launcher本体の公開とゲーム作品の公開は別のパイプラインです。

## Staging

Staging workflowは手動で実行し、専用Environment、公開鍵、R2資格情報を使います。成果物のSHA-256、署名Manifest、オンラインInstallerを検証してからStaging配布先へ公開します。

## Production

レビュー済みの既定ブランチでバージョンを揃え、`v<major>.<minor>.<patch>` tagをpushするとProduction workflowが起動します。Productionは専用EnvironmentのRequired reviewers、専用署名鍵、専用R2 bucketを使い、Staging資格情報を共有しません。

必要な外部設定、受入基準、ロールバックは次を正とします。

- [Windows Production setup](../PRODUCTION_SETUP.md)
- [Release prerequisites](../RELEASE_PREREQUISITES.md)
- [Release checklist](../RELEASE_CHECKLIST.md)
- [Windows release acceptance](../WINDOWS_RELEASE_ACCEPTANCE.md)
- [Launcher更新手順](../LAUNCHER_UPDATE_JA.md)
- [Code signing policy](../CODE_SIGNING_POLICY.md)

## 配布ページの最新版ダウンロード

Windows用の固定URLは `/download/windows` です。本番publishジョブの最後に、公開EXEのSHA-256とIFWのバージョンを検証してからR2の最新版ポインターを更新します。初回デプロイ・サイト有効化の手順は[ダウンロードWorker](../../apps/launcher-download-worker/README.md)を参照してください。
