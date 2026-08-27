# Implementation status

This document records the repository state after implementing
`LUNA_IMPLEMENTATION_PLAN.md`. “Implemented” means production code and a reproducible
local or CI verification path exist. Work requiring real infrastructure, legal review,
hardware-backed identities, or clean machines remains a release gate.

## Implemented

- `apps/launcher/` clean architecture with one composition root and no legacy `src/` route
- Portable CMake/CTest, presets, warnings, formatting, clang-tidy, Doxygen, Qt
  Deployment API, a valid pinned vcpkg baseline, production OpenSSL 3 enforcement,
  and Windows OpenSSL runtime deployment
- Versioned source/public JSON schemas for catalog, announcements, game releases,
  launcher releases, and launcher changelog
- Pinned-host HTTPS without redirects, bounded JSON/image/chunk responses, Ed25519
  manifests, SHA-256-only artifacts, path/traversal/management-symlink/junction checks,
  exact JSON keys and types, and stable localized errors
- Atomic settings and installed-game state, active-marker reconciliation, strict
  setting validation, build number, and OS/architecture diagnostics
- Persistent content-addressed chunks, active-release chunk recovery after cache cleanup,
  selective repair, Range resume with full-download fallback, three parallel transfers,
  shared throttling, pause/resume, cancellation, retry, disk preflight, staging, atomic
  activation, rollback preservation, and one previous release
- Install/update-before-launch/verify/repair/uninstall, exact uninstall path and size,
  verified existing-game import, temporary-data cleanup, and save-data retention
- Monitored Unity/Godot/Siv3D-compatible process launch, non-zero/crash reporting,
  same-game update exclusion, optional other-game download, and `PANDD_SAVE_DIR`
- HoYoPlay-inspired installed sidebar, catalog, focal-point hero, detail screen,
  announcements, progress, settings, tool menu, tray behavior, notification state,
  accessibility labels, and permanent staging badge
- Japanese UI, English translation, OS startup adapters, close-to-tray behavior,
  single-instance control, rotating redacted logs, operation/retry context, and
  privacy/terms/license/diagnostic views
- Launcher metadata and changelog retrieval, current/latest/last-check display,
  mandatory UI lock, update-content confirmation, serialized ViewModel operations,
  and Qt IFW Maintenance Tool check/apply handoff
- Publisher runtime Draft 2020-12 validation, chunks/signatures/catalog/announcements/
  launcher metadata, one-command game promotion, immutable-overwrite refusal, remote
  size/SHA-256/content-type verification, latest-last promotion, idempotency, and
  local/remote current/previous plus seven-day cleanup
- Qt IFW metadata generation in a temporary tree, platform-specific repositories,
  online installer creation, correct installed Maintenance Tool resolution, signing
  scripts, exact configured-dependency SBOM, hash-pinned license collection, OSV scan,
  four-target release workflow, rollback/stop procedures, prerequisites, and checklist

## Verified locally

- Windows Debug configure/build with GCC 15.2 and Qt 6.10.2 MinGW libraries
- Four CTest groups, including local HTTP Range/fallback/mid-stream disconnect,
  4xx/5xx/oversized response, SHA mismatch, cancellation, speed limit, disk/layout
  failures, selective repair, activation, import/cleanup, Ed25519, launcher-update rules,
  Maintenance Tool layout, changelog, and engine process/crash fixtures
- Draft 2020-12 runtime contract validation plus Publisher retention, local/remote GC,
  platform repository, promotion-order, remote metadata, signing, and idempotency tests
- Installer metadata/path tests and Python compile checks; main CI defines local online
  install, deployed smoke, Maintenance Tool purge, and game-data retention E2E
- Release-optimized Windows staging build, Qt deployment tree, and no-network smoke
  startup; production configure was verified to reject the local OpenSSL 1.1/test setup
- SBOM tests reject untracked dependencies and pre-OpenSSL-3 release metadata; pinned
  LGPLv3, GPLv3, Apache-2.0, and Qt IFW exception texts pass their SHA-256 pins
- `clang-format --dry-run --Werror` over production and test C++ sources

## Release blockers outside this workspace

- Create real staging/production R2 buckets, custom domains, DNS, cache/WAF/lifecycle,
  cost alerts, least-privilege credentials, and remote backup; then run promotion,
  failure-before-latest, rollback, and remote-GC drills against those buckets
- Supply reviewed Unity/Godot/Siv3D game builds, stable game IDs, save names, artwork,
  metadata, and production Ed25519 signatures
- Install Qt IFW locally if a local installer is needed; this machine has no IFW tools
- Obtain/import the Windows public code-signing certificate, Apple Developer ID and
  notarization credentials, and Linux release key required by the protected tag job
- Run the three-OS PR/main matrix and four GitHub-hosted tag build/sign/package jobs,
  including OSV, Doxygen, clang-tidy, IFW E2E, OpenSSL 3 SBOM, and license collection;
  workflow definitions cannot substitute for successful external runs
- Execute clean-machine/VM E2E on Windows x86_64, Linux x86_64, macOS Intel, and macOS
  Apple Silicon for install, startup, notifications, game lifecycle, self-update,
  rollback, uninstall, code-signature verification, and high-DPI/localization review
- Exercise a real two-version Qt IFW repository, including failed update recovery,
  installed Maintenance Tool signature checks, and post-update launcher restart while
  preserving settings and installed games
- Finish destructive fault injection for disk-full, permissions, forced termination,
  and power-loss boundaries on disposable VMs
- Perform the exact Qt module, Qt IFW exception, OpenSSL, MinGW/runtime, source-offer,
  and license-text audit with qualified legal review before public distribution

These blockers must not be replaced with placeholder credentials, the RFC fixture key,
unsigned artifacts, or simulated infrastructure.
