# macOS release acceptance

The production workflow builds macOS arm64 on a GitHub-hosted macOS runner and blocks
publication unless the launcher and online installer are Developer ID signed,
notarized, and stapled. The project maintainer does not currently own macOS hardware,
so these automated checks must not be described as end-user validation.

Complete this checklist on a clean, supported Apple Silicon Mac before advertising a
macOS release as verified:

1. Download both macOS ZIP files and their `.sha256` sidecars from the GitHub Release.
2. Verify both checksums with `shasum -a 256 -c <sidecar>`.
3. Extract the online installer ZIP and run
   `spctl --assess --type execute --verbose=2 <installer.app>` and
   `xcrun stapler validate <installer.app>`.
4. Install as a standard user and confirm Gatekeeper opens the installer without an
   unidentified-developer or damaged-application warning.
5. Launch PandD Game Launcher, fetch the catalog, install and launch a game, and verify
   its save directory.
6. Test interrupted-download resume, game verification/repair, and launcher update
   through the Maintenance Tool.
7. Restart the Mac and exercise startup behavior, Japanese and English UI, keyboard
   focus, Retina rendering, and close behavior.
8. Purge the launcher and confirm game data and saves outside the launcher installation
   remain intact.

Record the macOS version, hardware model, release tag, tester, date, and any deviations
in the release notes. Intel (`x86_64`) macOS is not currently built or published.
