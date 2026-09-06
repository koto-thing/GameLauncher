import hashlib
import io
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from scripts.release import promote_installer as p

class Response(io.BytesIO):
    def geturl(self):
        return p.ORIGIN + "/v1/launcher/installers/windows/x86_64/1.0.5/PandD-Game-Launcher-Online-Installer.exe"

class PromotionTests(unittest.TestCase):
    def test_version_guard(self):
        p.guard("1.10.0", {"version": "1.9.0"})
        p.guard("1.0.5", None)
        for version in ["1.0.4", "../a", "1.0.6-beta"]:
            with self.assertRaises(ValueError): p.guard(version, {"version": "1.0.5"})

    def test_public_verification_and_failed_upload_do_not_promote(self):
        with tempfile.TemporaryDirectory() as temp:
            artifact = Path(temp) / "PandD-Game-Launcher-Online-Installer.exe"
            artifact.write_bytes(b"exe")
            digest = hashlib.sha256(b"exe").hexdigest()
            artifact.with_name(artifact.name + ".sha256").write_text(digest + "  " + artifact.name)
            xml = b"<Updates><PackageUpdate><Name>org.pandd.launcher</Name><Version>1.0.5</Version></PackageUpdate></Updates>"
            with patch.object(p, "urlopen", side_effect=[Response(b"exe"), Response(xml)]) as requests:
                self.assertEqual(p.verify_public("1.0.5", artifact)["sha256"], digest)
                self.assertEqual(requests.call_count, 2)
                for call in requests.call_args_list:
                    request = call.args[0]
                    self.assertEqual(request.get_header("User-agent"), p.USER_AGENT)
                    self.assertEqual(request.get_header("Cache-control"), "no-cache")
            with patch.object(p, "current_pointer", return_value=None), patch.object(p, "aws") as write, patch.object(p, "urlopen", return_value=Response(b"bad")):
                with self.assertRaises(ValueError): p.promote("1.0.5", artifact, "endpoint", "bucket")
                write.assert_not_called()
            with patch.object(p, "urlopen", side_effect=[Response(b"exe"), Response(xml.replace(b"1.0.5", b"1.0.4"))]):
                with self.assertRaises(ValueError): p.verify_public("1.0.5", artifact)

    def test_upload_is_last_and_read_back_checked(self):
        doc = {"version": "1.0.5"}
        with patch.object(p, "current_pointer", side_effect=[None, doc]), patch.object(p, "verify_public", return_value=doc), patch.object(p, "aws") as write:
            p.promote("1.0.5", Path("unused"), "endpoint", "bucket")
            self.assertEqual(write.call_count, 1)
            self.assertIn("no-store", write.call_args.args)

if __name__ == "__main__": unittest.main()
