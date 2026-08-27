"""Executable module for the PandD desktop intake uploader."""

import os
from pathlib import Path
import sys
import traceback


def main() -> int:
    if "--self-test" in sys.argv:
        result_path = os.environ.get("PANDD_SELF_TEST_RESULT")
        try:
            from services.deployment_publisher.publisher import validate_contract

            validate_contract({
                "schemaVersion": 1,
                "artifactId": "12345678-1234-4123-8123-123456789abc",
                "artifactFile": "self-test.zip",
                "gameId": "self-test",
                "version": "1.0.0",
                "platform": "windows",
                "arch": "x86_64",
                "sizeBytes": 1,
                "fileCount": 1,
                "sha256": "0" * 64,
                "createdAt": "2026-08-13T00:00:00Z",
            }, "deployment-artifact-descriptor.schema.json")
            if result_path:
                Path(result_path).write_text("ok\n", encoding="utf-8")
            return 0
        except Exception:
            if result_path:
                Path(result_path).write_text(traceback.format_exc(), encoding="utf-8")
            return 1

    try:
        from pandd_intake_uploader.gui import run

        return run()
    except Exception:
        crash_log = Path(os.environ.get("TEMP", Path.home())) / "PandDIntakeUploader-error.log"
        crash_log.write_text(traceback.format_exc(), encoding="utf-8")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
