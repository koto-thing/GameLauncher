# ゲームArtifactとデプロイ

ゲーム配信は、Artifact作成、非公開Intake、Staging検証、Production承認の順で進めます。ブラウザーやデスクトップUploaderへ署名秘密鍵・R2書き込み資格情報を渡しません。

1. Admin Webでゲームフォルダーとrelease metadataを選び、ZIP64 Artifactとdescriptorを作成する。
2. Artifactを非公開Intakeへmultipart uploadし、sealする。
3. Staging申請を作り、指名された別アカウントが承認する。
4. PublisherがArtifactを検証・署名し、Stagingへ公開する。
5. Launcherで起動、更新、保存データを確認する。
6. 成功したStaging申請と同一Artifact/SHA-256から、期限内にProduction申請を作る。
7. Production専用承認とPublisherで公開し、公開カタログとLauncher起動を確認する。

再試行は既存のArtifact IDとdescriptorが一致する場合にuploadを再開します。Productionへ進められるのはStaging成功後7日以内です。詳細とゲームエンジン別要件は [ゲーム作品をランチャーへデプロイする手順](../GAME_DEPLOYMENT_JA.md) を参照してください。
