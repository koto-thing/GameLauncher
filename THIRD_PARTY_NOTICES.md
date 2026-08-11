# Third-party notices

PandD Game Launcher dynamically links to Qt 6 modules Core, Gui, Widgets, Network,
Concurrent, and Svg, and links to OpenSSL Crypto. The Test module is used only by
the non-distributed test executables. Release artifacts
include the pinned canonical texts in `licenses/`; the generated SBOM is the
authoritative version inventory for each platform release.

- Qt 6: LGPL-3.0-only or the applicable module-specific license
- Qt Installer Framework: GPL-3.0 with the Qt Company GPL exception
- OpenSSL 3.x (required for production artifacts): Apache-2.0

This file is an inventory, not legal advice. Before public distribution, audit the
resolved module-specific notices and the generated `licenses/` directory.
