"""Shared JSON contracts for Python intake and deployment orchestration"""

import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from jsonschema import Draft202012Validator, FormatChecker

CHUNK_SIZE = 64 * 1024 * 1024
SCHEMA_DIRECTORY = Path(__file__).resolve().parent / "schemas"
LOCALE_TAG_PATTERN = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")


def canonical_json(value: Any) -> bytes:
    """Encode the exact canonical JSON form shared with the client verifier."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def validate_contract(document: Any, schema_name: str) -> None:
    """Validate one source or public document against the checked-in contract."""
    schema = json.loads((SCHEMA_DIRECTORY / schema_name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)


def validate_relative_path(path: str) -> PurePosixPath:
    """Reject absolute, traversal, Windows separator, and unstable paths."""
    candidate = PurePosixPath(path)
    if not path or "\\" in path or candidate.is_absolute() or ".." in candidate.parts or "." in candidate.parts:
        raise ValueError(f"unsafe relative path: {path}")
    if str(candidate) != path or len(path) > 240:
        raise ValueError(f"non-canonical relative path: {path}")
    return candidate


def validate_locale_tag(locale: str) -> str:
    """Reject unsafe or malformed BCP 47-style locale tags used in public paths."""
    if not LOCALE_TAG_PATTERN.fullmatch(locale):
        raise ValueError(f"invalid locale tag: {locale}")
    return locale
