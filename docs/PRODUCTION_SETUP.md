# Windows production setup

Production uses `https://downloads.koto-thing.com/`, a dedicated R2 bucket and token,
and a production-only Ed25519 manifest key. Never reuse staging credentials or keys.

## Cloudflare configuration

1. Create an R2 Standard bucket named `pandd-launcher-production`.
2. Create an Object Read & Write R2 API token scoped only to that bucket.
3. In the bucket **Settings > Custom Domains**, connect
   `downloads.koto-thing.com` and wait for the status to become Active.
4. Enable Always Use HTTPS for the hostname. Keep the bucket's `r2.dev` access disabled
   after verification so the custom domain is the only public path.

## GitHub production environment

Create the GitHub environment `production` and add these environment secrets:

- `MANIFEST_PUBLIC_KEY_BASE64`: raw production Ed25519 public key in Base64
- `MANIFEST_PRIVATE_KEY_PEM`: production Ed25519 private key used only by the approved game workflow
- `R2_ACCESS_KEY_ID`: production bucket-scoped R2 access key
- `R2_SECRET_ACCESS_KEY`: matching R2 secret key
- `R2_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `R2_BUCKET`: `pandd-launcher-production`
- `LINUX_GPG_PRIVATE_KEY_BASE64`, `LINUX_GPG_KEY_ID`: Linux release-signing key and fingerprint
- `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`: Developer ID Application certificate
- `MACOS_KEYCHAIN_PASSWORD`: password for the workflow's ephemeral signing keychain
- `MACOS_DEVELOPER_ID_APPLICATION`: complete Developer ID Application identity
- `MACOS_NOTARY_APPLE_ID`, `MACOS_NOTARY_TEAM_ID`, `MACOS_NOTARY_APP_PASSWORD`: Apple notarization credentials

The launcher release workflow does not read the private manifest key. The approved game
workflow reads it only from the protected `production` Environment and writes it to the
ephemeral runner with owner-only permissions.

The private intake ZIP is downloaded directly from private R2 only after the protected
Environment gate opens. It is never uploaded as a GitHub Actions artifact.

## Publish a production game

The normal operator path is the deployment control plane:

1. Publish and verify the same artifact in Staging.
2. Select `Production申請を作成` on the successful Staging request.
3. Have a separately authenticated designated reviewer approve it.
4. Select `PRODUCTIONへ実行`.
5. Verify the production catalog and launch the game.

The production request expires seven days after the source Staging deployment. The
workflow revalidates the artifact and creates a new production URL manifest signed by
the production-only key.

The following local commands are for recovery and administrator diagnostics only.
Prepare the game into a clean output tree:

For local publishing, copy `.env.production.example` to the Git-ignored
`.env.production`, fill in the production values, and load it into the current
PowerShell session:

```powershell
. .\scripts\local\Import-DotEnv.ps1 .env.production
```

```powershell
python services\deployment_publisher\publisher.py publish-game `
  --metadata local-test\metadata\release.json `
  --build-dir local-test\game-build `
  --output $env:PANDD_PUBLIC_OUTPUT `
  --base-url $env:PANDD_BASE_URL `
  --private-key $env:PANDD_PRIVATE_KEY `
  --platform windows `
  --arch x86_64

python services\deployment_publisher\publisher.py publish-announcements `
  --source services\distribution-content\content\announcements `
  --output $env:PANDD_PUBLIC_OUTPUT

python services\deployment_publisher\publisher.py upload `
  --output $env:PANDD_PUBLIC_OUTPUT `
  --endpoint $env:R2_ENDPOINT `
  --bucket $env:R2_BUCKET
```

Verify the production catalog before releasing the launcher:

```text
https://downloads.koto-thing.com/v1/catalog/ja-JP/windows/x86_64.json
```

## Publish the production launcher

Use one version in `CMakeLists.txt`, both localized launcher release files, both
changelogs, and the Git tag. Commit and push the reviewed release, then create the tag:

```powershell
python -m scripts.release.validate_release_version v1.0.1
git tag v1.0.1
git push origin v1.0.1
```

The `Publish desktop production` workflow builds and smoke-tests Windows x86_64,
Linux x86_64, and macOS arm64 launchers. It creates the unsigned Windows IFW installer
and ZIP, the OpenPGP-signed Linux IFW installer and `tar.gz`, and Developer ID signed,
notarized, and stapled macOS launcher/IFW ZIPs. It verifies their SHA-256 sidecars,
publishes platform-specific IFW repositories and metadata to R2, and attaches the
downloadable files to one GitHub Release.

Complete `docs/WINDOWS_RELEASE_ACCEPTANCE.md` on a clean Windows system before sharing
the Windows installer URL publicly. Verify the Linux installer, update, and uninstall
flow on a clean supported Linux system before sharing its URL. Because the current
maintainer has no macOS machine, complete `docs/MACOS_RELEASE_ACCEPTANCE.md` on a clean
Apple Silicon Mac before advertising the macOS download as verified.
