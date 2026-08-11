# Release checklist

## Required external prerequisites

- The test R2 bucket is connected to the `downloads.koto-thing.com` custom domain
- R2 write credentials belong only to the protected release environment
- Production Ed25519 private key is stored in the CI secret store; only its raw public key is compiled into the launcher
- Windows code-signing identity and macOS Developer ID identities are active
- Qt, Qt IFW, OpenSSL, and all module licenses have been reviewed for the exact resolved versions

## Automated gates

- Three-OS configure, build, grouped CTest, formatting, Doxygen/clang-tidy, Publisher
  tests, runtime schema tests, secret scan, and OSV dependency scan
- Release build and deployment tree generation
- Valid pinned vcpkg baseline, OpenSSL 3 production gate, and exact configured modules
- CI-verified SHA-256 sidecars for the unsigned Windows ZIP and online installer,
  macOS Hardened Runtime/notarization/staple, or Linux detached signing
- SBOM, hash-pinned license texts, and third-party notices generation
- Manifest signature, object existence, object size, and SHA-256 verification before pointer promotion
- Deployment-tree no-network smoke startup on every release target
- Local online IFW install, smoke, purge, and external game/save retention on main

## Manual clean-machine matrix

For Windows x86_64, Linux x86_64, macOS Intel, and macOS Apple Silicon:

1. Install as a standard user
2. Fetch catalog, install a game, launch it, and confirm `PANDD_SAVE_DIR`
3. Interrupt a download, restart the launcher, and confirm Range resume
4. Update, corrupt one file, verify, repair, and launch the previous good version after a forced update failure
5. Update the launcher through Maintenance Tool while preserving settings and installed-game state
6. Exercise startup, notifications, close behavior, Japanese, English, keyboard focus, and high DPI
7. Uninstall the launcher and confirm games remain until explicit game removal
8. Verify Windows SHA-256 sidecars and document the SmartScreen warning, verify macOS
   notarization/staple, or verify the Linux detached checksum/signature

Do not promote a release with a Critical or High open defect.
