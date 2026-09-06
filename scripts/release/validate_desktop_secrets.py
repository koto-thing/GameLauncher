"""Validate desktop release configuration without logging secret values."""

from __future__ import annotations

import base64
import binascii
import os
import sys
from collections.abc import Mapping


REQUIRED_SECRETS = (
    "MANIFEST_PUBLIC_KEY_BASE64",
    "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET",
    "LINUX_GPG_PRIVATE_KEY_BASE64", "LINUX_GPG_KEY_ID",
)


def validate(environment: Mapping[str, str]) -> list[str]:
    """Return all missing or malformed settings, naming only their variables."""
    errors = []
    for name in REQUIRED_SECRETS:
        value = environment.get(name, "")
        if not value.strip():
            errors.append(f"{name}: required production secret is missing")
            continue
        if name.endswith("_BASE64"):
            try:
                payload = base64.b64decode(value, validate=True)
            except (ValueError, binascii.Error):
                errors.append(f"{name}: expected single-line Base64 of the exported file")
                continue
            if not payload:
                errors.append(f"{name}: decoded payload is empty")
            elif name == "MANIFEST_PUBLIC_KEY_BASE64" and len(payload) != 32:
                errors.append(f"{name}: expected a raw 32-byte Ed25519 public key")
    return errors


def main() -> int:
    errors = validate(os.environ)
    for error in errors:
        print(error, file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
