# Windows release acceptance

Use a clean Windows 11 VM or a Windows Sandbox instance that has never installed the
launcher. Record the tested tag, installer SHA-256, date, and tester before production
promotion.

## Installation and trust warning

- Download the installer and `.sha256` from `downloads.koto-thing.com`.
- Verify `Get-FileHash -Algorithm SHA256` matches the published sidecar.
- Confirm SmartScreen reports an unknown publisher, then use **More info > Run anyway**.
- Install as a standard user and confirm `maintenancetool.exe` is present.

## Launcher and game

- Start the launcher and confirm the production build has no `STAGING` badge.
- Fetch the Japanese and English catalogs over HTTPS.
- Install a game from an empty machine, launch it, exit it, and launch it again.
- Interrupt a download, restart the launcher, and confirm it resumes.
- Publish a newer game version and confirm only changed chunks are downloaded.
- Corrupt one installed file, run Verify and Repair, then launch successfully.

## Launcher update

- Install version N, publish N+1 through the production workflow, and check for updates.
- Apply the update through Maintenance Tool and confirm the displayed version is N+1.
- Confirm settings and installed-game state remain intact.

## Uninstallation and retained user data

- Create identifiable game and save data outside the launcher installation directory.
- Purge the launcher through Maintenance Tool.
- Confirm launcher binaries are removed while game and save data remain.
- Reinstall the launcher and confirm the external game can be located again.

Do not publish the production URL to users until every item passes. Preserve the
completed checklist with the release notes.
