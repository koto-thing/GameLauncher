# Reviewed license sources

Release builds copy the license payloads from this directory and verify every file
against the SHA-256 pins in `scripts/release/collect_licenses.py`. No license download
is required during a build.

The Live2D HTML files are exact copies of the previously pinned official pages:

- `Live2D-Proprietary-Software-License-Agreement.html`:
  https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
- `Live2D-Open-Software-License-Agreement.html`:
  https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html

Git preserves the HTML bytes without line-ending conversion. To update a license,
review the official source, replace the complete file, and update its SHA-256 pin
together. This directory contains license notices only, not Cubism SDK sources or
binaries; SDK download still requires explicit license acceptance.
