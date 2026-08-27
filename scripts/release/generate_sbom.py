#!/usr/bin/env python3
"""Generate a small SPDX 2.3 SBOM from pinned project dependencies."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any

from scripts.release import collect_licenses


def generate_document(metadata: dict[str, Any], version: str,
                      ifw_version: str) -> dict[str, Any]:
    """Create an SPDX document from dependencies resolved by the actual CMake configure."""
    required = {"qtVersion", "qtModules", "opensslVersion", "compilerId",
                "compilerVersion", "systemName", "systemProcessor",
                "cubismVersion", "glewVersion"}
    if set(metadata) != required or not isinstance(metadata["qtModules"], list):
        raise ValueError("build metadata does not match the SBOM contract")
    required_qt_modules = {"Core", "Gui", "Widgets", "Network", "Concurrent",
                           "Svg", "OpenGL", "OpenGLWidgets"}
    if set(metadata["qtModules"]) != required_qt_modules:
        raise ValueError("build metadata must record the full Qt module set")
    try:
        openssl_major = int(str(metadata["opensslVersion"]).split(".", 1)[0])
    except ValueError as error:
        raise ValueError("OpenSSL version is not parseable") from error
    if openssl_major < 3:
        raise ValueError("release SBOM generation requires the production OpenSSL 3 line")
    project_root = Path(__file__).resolve().parents[2]
    manifest = json.loads((project_root / "vcpkg.json").read_text(encoding="utf-8"))
    vcpkg_dependencies = {
        item if isinstance(item, str) else item["name"] for item in manifest["dependencies"]
    }
    if vcpkg_dependencies != {"glew", "openssl"}:
        raise ValueError("SBOM generator must be updated for the resolved vcpkg dependencies")

    packages: list[dict[str, Any]] = [{
        "SPDXID": "SPDXRef-Package-Launcher",
        "name": "pandd-game-launcher",
        "versionInfo": version,
        "downloadLocation": "NOASSERTION",
        "filesAnalyzed": False,
        "licenseConcluded": "NOASSERTION",
        "licenseDeclared": "NOASSERTION",
    }]
    relationships: list[dict[str, str]] = [{
        "spdxElementId": "SPDXRef-DOCUMENT",
        "relationshipType": "DESCRIBES",
        "relatedSpdxElement": "SPDXRef-Package-Launcher",
    }]
    for module in metadata["qtModules"]:
        package_id = f"SPDXRef-Package-Qt-{module}"
        packages.append({
            "SPDXID": package_id,
            "name": f"Qt6 {module}",
            "versionInfo": metadata["qtVersion"],
            "downloadLocation": "https://download.qt.io/",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": "LGPL-3.0-only",
            "externalRefs": [{
                "referenceCategory": "PACKAGE-MANAGER",
                "referenceType": "purl",
                "referenceLocator": f"pkg:generic/qt/{module.lower()}@{metadata['qtVersion']}",
            }],
        })
        relationships.append({
            "spdxElementId": "SPDXRef-Package-Launcher",
            "relationshipType": "DEPENDS_ON",
            "relatedSpdxElement": package_id,
        })
    packages.extend([{
        "SPDXID": "SPDXRef-Package-OpenSSL",
        "name": "OpenSSL",
        "versionInfo": metadata["opensslVersion"],
        "downloadLocation": "https://www.openssl.org/source/",
        "filesAnalyzed": False,
        "licenseConcluded": "NOASSERTION",
        "licenseDeclared": "Apache-2.0",
        "externalRefs": [{
            "referenceCategory": "PACKAGE-MANAGER",
            "referenceType": "purl",
            "referenceLocator": f"pkg:generic/openssl@{metadata['opensslVersion']}",
        }],
    }, {
        "SPDXID": "SPDXRef-Package-QtIFW",
        "name": "Qt Installer Framework",
        "versionInfo": ifw_version,
        "downloadLocation": "https://download.qt.io/official_releases/qt-installer-framework/",
        "filesAnalyzed": False,
        "licenseConcluded": "NOASSERTION",
        "licenseDeclared": "GPL-3.0-only WITH Qt-GPL-exception-1.0",
    }, {
        "SPDXID": "SPDXRef-Package-CubismCore",
        "name": "Live2D Cubism Core",
        "versionInfo": metadata["cubismVersion"],
        "downloadLocation": "https://www.live2d.com/en/sdk/download/native/",
        "filesAnalyzed": False,
        "licenseConcluded": "NOASSERTION",
        "licenseDeclared": "NOASSERTION",
    }, {
        "SPDXID": "SPDXRef-Package-CubismFramework",
        "name": "Live2D Cubism Framework",
        "versionInfo": metadata["cubismVersion"],
        "downloadLocation": "https://www.live2d.com/en/sdk/download/native/",
        "filesAnalyzed": False,
        "licenseConcluded": "NOASSERTION",
        "licenseDeclared": "NOASSERTION",
    }, {
        "SPDXID": "SPDXRef-Package-GLEW",
        "name": "GLEW",
        "versionInfo": metadata["glewVersion"],
        "downloadLocation": "https://github.com/nigels-com/glew/releases",
        "filesAnalyzed": False,
        "licenseConcluded": "NOASSERTION",
        "licenseDeclared": "LicenseRef-GLEW",
    }])
    for dependency in ("SPDXRef-Package-OpenSSL", "SPDXRef-Package-QtIFW",
                       "SPDXRef-Package-CubismCore", "SPDXRef-Package-CubismFramework",
                       "SPDXRef-Package-GLEW"):
        relationships.append({
            "spdxElementId": "SPDXRef-Package-Launcher",
            "relationshipType": "DEPENDS_ON",
            "relatedSpdxElement": dependency,
        })

    platform = f"{metadata['systemName']}-{metadata['systemProcessor']}"
    return {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"pandd-game-launcher-{version}-{platform}",
        "documentNamespace": f"https://pandd.org/sbom/launcher/{version}/{platform}",
        "creationInfo": {
            "created": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace(
                "+00:00", "Z"),
            "creators": ["Tool: scripts/release/generate_sbom.py"],
            "comment": (f"Compiler {metadata['compilerId']} {metadata['compilerVersion']}; "
                        f"target {platform}"),
        },
        "packages": packages,
        "relationships": relationships,
        "hasExtractedLicensingInfos": [{
            "licenseId": "LicenseRef-GLEW",
            "name": "GLEW, Mesa and Khronos license notices",
            "extractedText": collect_licenses.read_verified(
                collect_licenses.SOURCE_DIRECTORY / "GLEW-LICENSE.txt",
                collect_licenses.LICENSE_SOURCES["GLEW-LICENSE.txt"],
            ).decode("utf-8"),
        }],
    }


def main() -> int:
    """Write deterministic package identities for the launcher and dependencies."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build-metadata", type=Path, required=True)
    parser.add_argument("--ifw-version", required=True)
    arguments = parser.parse_args()
    metadata = json.loads(arguments.build_metadata.read_text(encoding="utf-8"))
    document = generate_document(metadata, arguments.version, arguments.ifw_version)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
