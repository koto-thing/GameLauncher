# Qt LGPL compliance and library replacement

PandD Game Launcher uses the Qt shared libraries listed in the release SBOM. Public
release archives must preserve the exact corresponding Qt source archive or provide a
durable written source offer, the LGPLv3 text, copyright notices, and this procedure.
The project does not impose a technical or contractual restriction on replacing the
Qt shared libraries for debugging or modification.

## Replacement procedure

1. Record the launcher version, Qt version, target OS, CPU, and the original deployment
   tree; make a recoverable copy before changing it
2. Build ABI-compatible shared Qt libraries for the same target using the Qt source
   identified by the release SBOM
3. Replace only Qt shared libraries and their matching plugins while the launcher and
   Maintenance Tool are stopped; do not replace the PandD executable or manifest key
4. Keep the original directory layout and `qt.conf`, then run the launcher's
   `--smoke-test` mode before normal use
5. On macOS, locally re-sign the modified bundle (for example with an ad-hoc identity)
   before execution; Apple notarization for the official unmodified build will no
   longer apply

Windows users replace DLLs and matching plugin DLLs in the installed tree. Linux users
may replace the installed `.so` files or launch with a controlled Qt library/plugin
path. macOS users replace frameworks/dylibs inside the app bundle and then re-sign the
whole modified bundle. Modified local builds are unsupported by the official updater,
so retain the original installer for recovery.

This document describes an engineering process and is not legal advice. The exact
license obligations and source-delivery method must be reviewed for every release.
