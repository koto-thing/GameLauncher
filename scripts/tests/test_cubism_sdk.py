"""Tests for pinned Cubism downloads and cross-platform extraction safety."""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request
import zipfile

from scripts.dependencies import cubism_sdk


class FakeResponse(io.BytesIO):
    def __init__(self, payload: bytes, url: str) -> None:
        super().__init__(payload)
        self.url = url

    def geturl(self) -> str:
        return self.url


class CubismSdkTests(unittest.TestCase):
    """Verify failures never publish partial downloads or extracted SDKs."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def make_archive(self, entries: dict[str, bytes]) -> Path:
        path = self.root / "sdk.zip"
        with zipfile.ZipFile(path, "w") as archive:
            for name, content in entries.items():
                archive.writestr(f"{cubism_sdk.OFFICIAL_CUBISM_DIRECTORY_NAME}/{name}", content)
        return path

    def valid_entries(self) -> dict[str, bytes]:
        entries = {
            "cubism-info.yml": b"version: 5-r.5\n",
            "Core/include/Live2DCubismCore.h": b"header",
            "Framework/src/Rendering/OpenGL/Shaders/Standard/test.frag": b"shader",
        }
        entries.update({path.as_posix(): b"core" for path in cubism_sdk.REQUIRED_CORE_RELATIVE_PATHS})
        return entries

    def test_license_acceptance_requires_exact_value(self) -> None:
        for value in (None, "", "true", "ACCEPT", " accept"):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "license consent"):
                cubism_sdk.require_explicit_license_acceptance(
                    {} if value is None else {cubism_sdk.LICENSE_CONSENT_ENV: value}
                )
        cubism_sdk.require_explicit_license_acceptance({cubism_sdk.LICENSE_CONSENT_ENV: "accept"})

    def test_no_network_or_files_without_license_acceptance(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(
            cubism_sdk, "build_opener"
        ) as opener:
            with self.assertRaises(RuntimeError):
                cubism_sdk.download_official_cubism_archive(self.root / "sdk.zip")
        opener.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_rejects_unsafe_urls(self) -> None:
        for url in (
            "http://cubism.live2d.com/file", "https://example.com/file",
            "https://cubism.live2d.com.evil.test/file", "https://cubism.live2d.com:444/file",
            "https://user@cubism.live2d.com/file", "https://@cubism.live2d.com/file",
            "https://cubism.live2d.com/file?token=1", "https://cubism.live2d.com/file#fragment",
            "https://cubism.live2d.com/file;params", "https://cubism.live2d.com/\\file",
            "https://cubism.live2d.com/\nfile", "https://cubism.live2d.com:invalid/file",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                cubism_sdk._validate_https_url(url, cubism_sdk.ALLOWED_ARCHIVE_HOSTS)

    def test_redirect_is_checked_before_following(self) -> None:
        handler = cubism_sdk._OfficialRedirectHandler(cubism_sdk.ALLOWED_ARCHIVE_HOSTS)
        request = Request(cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL)
        handler.parent = mock.Mock()
        for url in ("https://evil.test/sdk.zip", "http://cubism.live2d.com/sdk.zip",
                    "https://cubism.live2d.com:444/sdk.zip"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                handler.http_error_302(request, io.BytesIO(), 302, "Found", {"location": url})
        handler.parent.open.assert_not_called()
        target = "https://cubism.live2d.com/official.zip"
        redirected = handler.redirect_request(request, None, 302, "Found", {}, target)
        self.assertEqual(redirected.full_url, target)

    def test_redirect_loop_is_bounded(self) -> None:
        handler = cubism_sdk._OfficialRedirectHandler(cubism_sdk.ALLOWED_ARCHIVE_HOSTS)
        request = Request(cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL)
        request.redirect_dict = {request.full_url: handler.max_repeats}
        handler.parent = mock.Mock()
        with self.assertRaises(HTTPError) as raised:
            handler.http_error_302(request, io.BytesIO(), 302, "Found", {"location": request.full_url})
        raised.exception.close()
        handler.parent.open.assert_not_called()

    def test_download_publishes_only_verified_bytes(self) -> None:
        payload = b"verified archive"
        destination = self.root / "sdk.zip"
        with mock.patch.object(cubism_sdk, "build_opener") as factory:
            factory.return_value.open.return_value = FakeResponse(
                payload, cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL
            )
            cubism_sdk._download_with_sha256(
                cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL, destination,
                hashlib.sha256(payload).hexdigest(), cubism_sdk.ALLOWED_ARCHIVE_HOSTS, len(payload),
            )
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL)
            self.assertEqual(request.get_header("Accept"), "application/octet-stream")
            self.assertEqual(request.get_header("User-agent"), cubism_sdk.DOWNLOAD_USER_AGENT)
            self.assertEqual(
                factory.return_value.open.call_args.kwargs,
                {"timeout": cubism_sdk.NETWORK_TIMEOUT_SECONDS},
            )
        self.assertEqual(destination.read_bytes(), payload)
        self.assertEqual(list(self.root.iterdir()), [destination])

    def test_bad_downloads_preserve_destination_and_remove_temporary_files(self) -> None:
        destination = self.root / "sdk.zip"
        destination.write_bytes(b"existing")
        for payload, final_url, limit, message in (
            (b"changed", cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL, 100, "hash mismatch"),
            (b"oversize", cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL, 3, "size limit"),
            (b"changed", "https://evil.test/sdk.zip", 100, "unexpected download host"),
        ):
            with self.subTest(message=message), mock.patch.object(cubism_sdk, "build_opener") as factory:
                factory.return_value.open.return_value = FakeResponse(payload, final_url)
                with self.assertRaisesRegex(ValueError, message):
                    cubism_sdk._download_with_sha256(
                        cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL, destination, "0" * 64,
                        cubism_sdk.ALLOWED_ARCHIVE_HOSTS, limit,
                    )
            self.assertEqual(destination.read_bytes(), b"existing")
            self.assertEqual(list(self.root.iterdir()), [destination])

    def test_interrupted_download_does_not_leave_a_payload(self) -> None:
        with mock.patch.object(cubism_sdk, "build_opener") as factory:
            response = factory.return_value.open.return_value.__enter__.return_value
            response.geturl.return_value = cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL
            response.read.side_effect = [b"partial", TimeoutError("interrupted")]
            with self.assertRaises(TimeoutError):
                cubism_sdk._download_with_sha256(
                    cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_URL, self.root / "sdk.zip", "0" * 64,
                    cubism_sdk.ALLOWED_ARCHIVE_HOSTS, 100,
                )
        self.assertEqual(list(self.root.iterdir()), [])

    def test_extracts_complete_cross_platform_sdk(self) -> None:
        entries = self.valid_entries()
        entries["empty/"] = b""
        destination = self.root / "sdk"
        cubism_sdk.extract_cubism_archive(self.make_archive(entries), destination)
        for name, content in entries.items():
            if name.endswith("/"):
                self.assertTrue((destination / name).is_dir())
            else:
                self.assertEqual((destination / name).read_bytes(), content)

    def test_incomplete_sdk_is_not_published(self) -> None:
        entries = self.valid_entries()
        for name in entries:
            with self.subTest(missing=name):
                incomplete = dict(entries)
                del incomplete[name]
                archive = self.make_archive(incomplete)
                with self.assertRaisesRegex(ValueError, "missing required reviewed files"):
                    cubism_sdk.extract_cubism_archive(archive, self.root / "sdk")
                self.assertEqual(list(self.root.iterdir()), [archive])

    def test_extraction_does_not_replace_existing_destination(self) -> None:
        destination = self.root / "sdk"
        destination.mkdir()
        sentinel = destination / "keep"
        sentinel.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            cubism_sdk.extract_cubism_archive(self.make_archive(self.valid_entries()), destination)
        self.assertEqual(sentinel.read_bytes(), b"existing")

    def test_extract_rejects_posix_and_windows_unsafe_paths(self) -> None:
        for name in (
            "../../escape", "../", "/absolute", "C:/escape", "C:escape",
            "dir\\..\\escape", "\\\\server\\share", "file:stream", "NUL.txt",
            "CON/file", "COM1", "LPT9.txt", "COM¹.txt", "trailing./file", "space /file",
            "./alias", "dir//alias", "wild*card", "file?", "line\nbreak", "nul\x00suffix",
        ):
            with self.subTest(name=name):
                archive = self.make_archive({name: b"bad"})
                with self.assertRaisesRegex(ValueError, "unsafe archive entry"):
                    cubism_sdk.extract_cubism_archive(archive, self.root / "sdk")
                self.assertEqual(list(self.root.iterdir()), [archive])

    def test_extract_rejects_case_aliases(self) -> None:
        archive = self.make_archive({"file": b"one", "FILE": b"two"})
        with self.assertRaisesRegex(ValueError, "duplicate archive entry"):
            cubism_sdk.extract_cubism_archive(archive, self.root / "sdk")

    def test_extract_rejects_symlinks_and_special_files_including_directories(self) -> None:
        for kind, suffix in ((stat.S_IFLNK, "link"), (stat.S_IFLNK, "link/"), (stat.S_IFIFO, "fifo")):
            with self.subTest(kind=kind, suffix=suffix):
                path = self.root / "sdk.zip"
                with zipfile.ZipFile(path, "w") as archive:
                    info = zipfile.ZipInfo(f"{cubism_sdk.OFFICIAL_CUBISM_DIRECTORY_NAME}/{suffix}")
                    info.create_system = 3
                    info.external_attr = (kind | 0o777) << 16
                    archive.writestr(info, b"target")
                with self.assertRaisesRegex(ValueError, "non-regular entries"):
                    cubism_sdk.extract_cubism_archive(path, self.root / "sdk")

    def test_extract_rejects_wrong_root(self) -> None:
        path = self.root / "sdk.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("other/file", b"x")
        with self.assertRaisesRegex(ValueError, "archive root changed"):
            cubism_sdk.extract_cubism_archive(path, self.root / "sdk")

    def test_extraction_limits_are_checked_before_writing(self) -> None:
        path = self.make_archive({"one": b"123", "two": b"456"})
        for setting, limit in (("MAX_ARCHIVE_MEMBERS", 1), ("MAX_EXTRACTED_BYTES", 5)):
            with self.subTest(setting=setting), mock.patch.object(cubism_sdk, setting, limit):
                with self.assertRaises(ValueError):
                    cubism_sdk.extract_cubism_archive(path, self.root / "sdk")
                self.assertEqual(list(self.root.iterdir()), [path])

    def test_fetch_verified_live2d_license_rejects_changed_bytes(self) -> None:
        name, source = next(iter(cubism_sdk.LIVE2D_REMOTE_LICENSES.items()))
        with mock.patch.object(cubism_sdk, "build_opener") as factory:
            factory.return_value.open.return_value = FakeResponse(b"changed", source["url"])
            with self.assertRaisesRegex(ValueError, "download hash mismatch"):
                cubism_sdk.fetch_verified_live2d_license(name)


if __name__ == "__main__":
    unittest.main()
