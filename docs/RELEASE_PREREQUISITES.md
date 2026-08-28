# Release prerequisites

The tag workflow intentionally fails closed until all production identities and
infrastructure values below exist in the protected `production` GitHub environment.

The repository currently pins Qt 6.10.2, Qt Installer Framework 4.7.0, and vcpkg
baseline `ea1a7396b05637a53bf23c078647ecc0edee4b80` (OpenSSL 3.6.3). Review and update
these pins intentionally; production configuration rejects OpenSSL versions below 3.0.

## Required secrets

- `MANIFEST_PUBLIC_KEY_BASE64`: raw 32-byte production Ed25519 public key in Base64
- `MANIFEST_PRIVATE_KEY_PEM`: game-manifest signing key for the protected production game workflow
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`
- `LINUX_GPG_PRIVATE_KEY_BASE64`: exported Linux release private key, Base64-encoded
- `LINUX_GPG_KEY_ID`: full fingerprint of the Linux release signing key

The launcher release workflow reads the manifest public key and the Linux OpenPGP
release key; the approved game workflow is the only workflow that reads the manifest
private key. The launcher workflow targets unsigned Windows x86_64 and OpenPGP-signed
Linux x86_64. Follow
`PRODUCTION_SETUP.md` for its dedicated R2 bucket, custom domain, production Ed25519
key, and GitHub environment.

## Tag preparation

1. Update both localized `services/distribution-content/content/launcher/release.*.json` files to the tag
   version and reviewed release notes
2. Confirm `apps/launcher/installer/packages/org.pandd.launcher/meta/package.xml` contains the
   intended component policy; version, date, and repository URL are generated in CI
3. Run the release checklist on staging with a distinct staging key and bucket
4. Create `v<major>.<minor>.<patch>` only after the protected environment approver
   confirms the manifest key and R2 credentials

The workflow builds Windows and Linux x86_64, generates their platform-specific Qt IFW
repositories, runs deployment smoke tests, and promotes each `latest.json` last.
Windows artifacts are intentionally unsigned and ship with CI-verified SHA-256
sidecars, so Windows SmartScreen will identify an unknown publisher. Linux artifacts
ship with SHA-256 sidecars and detached armored OpenPGP signatures. A staging artifact
or local verification build must never be published as production.
