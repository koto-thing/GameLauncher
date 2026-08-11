"""Tests for exact dependency identities in generated SPDX documents."""

from __future__ import annotations

import unittest

from scripts.generate_sbom import generate_document


class SbomTests(unittest.TestCase):
    """Ensure distributed and packaging dependencies cannot disappear silently."""

    metadata = {
        "qtVersion": "6.10.2",
        "qtModules": ["Core", "Gui", "Widgets", "Network", "Concurrent", "Svg"],
        "opensslVersion": "3.5.4",
        "compilerId": "GNU",
        "compilerVersion": "15.2.0",
        "systemName": "Linux",
        "systemProcessor": "x86_64",
    }

    def test_document_contains_exact_qt_openssl_and_ifw_versions(self) -> None:
        """Every shipped runtime family and the installer framework are versioned."""
        document = generate_document(self.metadata, "1.0.0", "4.7.0")
        versions = {package["name"]: package["versionInfo"]
                    for package in document["packages"]}
        self.assertEqual(versions["Qt6 Core"], "6.10.2")
        self.assertEqual(versions["Qt6 Svg"], "6.10.2")
        self.assertEqual(versions["OpenSSL"], "3.5.4")
        self.assertEqual(versions["Qt Installer Framework"], "4.7.0")
        self.assertTrue(document["relationships"])

    def test_unknown_metadata_is_rejected(self) -> None:
        """Adding an unhandled build field requires an intentional SBOM update."""
        metadata = dict(self.metadata)
        metadata["untrackedDependency"] = "1.0"
        with self.assertRaises(ValueError):
            generate_document(metadata, "1.0.0", "4.7.0")

    def test_end_of_life_openssl_is_rejected(self) -> None:
        """A release SBOM cannot bless the pre-Apache OpenSSL 1.1 license line."""
        metadata = dict(self.metadata)
        metadata["opensslVersion"] = "1.1.1k"
        with self.assertRaises(ValueError):
            generate_document(metadata, "1.0.0", "4.7.0")


if __name__ == "__main__":
    unittest.main()
