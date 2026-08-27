# Third-party notices

PandD Game Launcher release metadata tracks Qt 6 modules Core, Gui, Widgets,
Network, Concurrent, Svg, OpenGL, and OpenGLWidgets, and links to OpenSSL Crypto.
The Test module is used only by the non-distributed test executables. All client
CI builds use Live2D Cubism SDK for Native 5-r.5 and vcpkg GLEW 2.3.1 for the
OpenGL integration. CMake records the resolved versions and modules directly.
Release artifacts include the reviewed canonical texts in `licenses/`; the
generated SBOM is the authoritative version inventory for each platform release.

- Qt 6: LGPL-3.0-only or the applicable module-specific license
- Qt Installer Framework: GPL-3.0 with the Qt Company GPL exception
- OpenSSL 3.x (required for production artifacts): Apache-2.0
- Live2D Cubism Core: Live2D Proprietary Software License Agreement
- Live2D Cubism Framework: Live2D Open Software License Agreement
- GLEW 2.3.1: the complete GLEW, Mesa, and Khronos notices in
  `licenses/GLEW-LICENSE.txt`, represented as `LicenseRef-GLEW` in the SBOM

The GLEW text is an exact copy of vcpkg 2.3.1's installed
`share/glew/copyright`, reviewed locally at
`build/dependencies/installed/x64-windows/share/glew/copyright`. It is not derived
from the Cubism sample helper's GLEW 2.2.0 download. The
[upstream GLEW 2.3.1 license](https://github.com/nigels-com/glew/blob/glew-2.3.1/LICENSE.txt)
contains all three notices; a BSD-3-Clause-only label does not capture them.

CI downloads the pinned archive from the official Live2D host into `runner.temp`
only when `PANDD_CUBISM_LICENSE_ACCEPTED=accept` is explicitly configured. The SDK
archive and extracted source tree are neither cached nor uploaded as artifacts.
Automatic retrieval is a technical capability, not a determination of permission
to use or redistribute the SDK. Review the
[official download terms](https://www.live2d.com/en/sdk/download/native/) and the
applicable agreements before recording acceptance or distributing a release.

This file is an inventory, not legal advice. Before public distribution, audit the
resolved module-specific notices and the generated `licenses/` directory.
