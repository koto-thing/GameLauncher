# Release prerequisites

The tag workflow intentionally fails closed until all production identities and
infrastructure values below exist in the protected `production` GitHub environment.

The repository currently pins Qt 6.10.2, Qt Installer Framework 4.11.0, and vcpkg
baseline `ea1a7396b05637a53bf23c078647ecc0edee4b80` (OpenSSL 3.6.3). Review and update
these pins intentionally; production configuration rejects OpenSSL versions below 3.0.

## Required secrets

- `MANIFEST_PUBLIC_KEY_BASE64`: raw 32-byte production Ed25519 public key in Base64
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`
- `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_KEYCHAIN_PASSWORD`, `MACOS_SIGNING_IDENTITY`
- `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`
- `LINUX_GPG_PRIVATE_KEY`, `LINUX_GPG_KEY_ID`

## Tag preparation

1. Update both localized `backend/content/launcher/release.*.json` files to the tag
   version and reviewed release notes
2. Confirm `installer/packages/org.pandd.launcher/meta/package.xml` contains the
   intended component policy; version, date, and repository URL are generated in CI
3. Run the release checklist on staging with a distinct staging key and bucket
4. Create `v<major>.<minor>.<patch>` only after the protected environment approver
   confirms signing and R2 credentials

The workflow builds four targets, generates platform-specific Qt IFW repositories,
signs/notarizes platforms with configured identities, runs a deployment smoke test,
and promotes `latest.json` last. Windows artifacts are intentionally unsigned and ship
with CI-verified SHA-256 sidecars, so Windows SmartScreen will identify an unknown
publisher. A staging artifact or local verification build must never be published as
production.
