"""Regression checks for missing and malformed production signing secrets."""

import base64
import unittest

from scripts.release.validate_desktop_secrets import REQUIRED_SECRETS, validate


class DesktopSecretsTests(unittest.TestCase):
    def valid_environment(self):
        environment = dict.fromkeys(REQUIRED_SECRETS, "configured")
        for name in REQUIRED_SECRETS:
            if name.endswith("_BASE64"):
                environment[name] = base64.b64encode(b"x" * 32).decode("ascii")
        environment["LINUX_GPG_KEY_ID"] = "A" * 40
        return environment

    def test_complete_configuration_passes(self):
        self.assertEqual(validate(self.valid_environment()), [])

    def test_reports_all_missing_secrets(self):
        errors = validate({})
        self.assertEqual(len(errors), len(REQUIRED_SECRETS))
        for name, error in zip(REQUIRED_SECRETS, errors):
            self.assertIn(name, error)

    def test_rejects_raw_armored_key_without_disclosing_it(self):
        environment = self.valid_environment()
        secret = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nsensitive-payload"
        environment["LINUX_GPG_PRIVATE_KEY_BASE64"] = secret
        errors = validate(environment)
        self.assertEqual(len(errors), 1)
        self.assertIn("LINUX_GPG_PRIVATE_KEY_BASE64", errors[0])
        self.assertNotIn("sensitive-payload", str(errors))

    def test_rejects_wrapped_base64_and_wrong_manifest_key_size(self):
        for value in ("eA==\n", "eA==", "!!!!"):
            environment = self.valid_environment()
            environment["MANIFEST_PUBLIC_KEY_BASE64"] = value
            self.assertEqual(len(validate(environment)), 1)
