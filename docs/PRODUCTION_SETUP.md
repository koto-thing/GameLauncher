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
- `R2_ACCESS_KEY_ID`: production bucket-scoped R2 access key
- `R2_SECRET_ACCESS_KEY`: matching R2 secret key
- `R2_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `R2_BUCKET`: `pandd-launcher-production`

The release workflow intentionally contains no private manifest key. Store that key
offline and use it only when publishing game manifests.

## Publish a production game

Prepare the game with the production URL and production private key into a clean output
tree:

```powershell
$env:OPENSSL_EXECUTABLE = "C:\Program Files\OpenSSL-Win64\bin\openssl.exe"
$env:AWS_ACCESS_KEY_ID = "<production R2 access key>"
$env:AWS_SECRET_ACCESS_KEY = "<production R2 secret key>"
$env:R2_ENDPOINT = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"

python publisher\publisher.py publish-game `
  --metadata local-test\metadata\release.json `
  --build-dir local-test\game-build `
  --output local-test\production-public `
  --base-url https://downloads.koto-thing.com `
  --private-key local-test\production-keys\manifest-private.pem `
  --platform windows `
  --arch x86_64

python publisher\publisher.py publish-announcements `
  --source backend\content\announcements `
  --output local-test\production-public

python publisher\publisher.py upload `
  --output local-test\production-public `
  --endpoint $env:R2_ENDPOINT `
  --bucket pandd-launcher-production
```

Verify the production catalog before releasing the launcher:

```text
https://downloads.koto-thing.com/v1/catalog/ja-JP/windows/x86_64.json
```

## Publish the production launcher

Use one version in `CMakeLists.txt`, both localized launcher release files, both
changelogs, and the Git tag. Commit and push the reviewed release, then create the tag:

```powershell
python scripts\validate_release_version.py v1.0.1
git tag v1.0.1
git push origin v1.0.1
```

The `Publish Windows production` workflow builds and smoke-tests the launcher, creates
the unsigned IFW installer and ZIP, verifies SHA-256 sidecars, publishes the IFW
repository and metadata to R2, and attaches all four downloadable files to the GitHub
Release.

Complete `docs/WINDOWS_RELEASE_ACCEPTANCE.md` on a clean Windows system before sharing
the installer URL publicly.
