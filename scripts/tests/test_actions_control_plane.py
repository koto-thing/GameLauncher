from __future__ import annotations

import sys
import unittest
from unittest import mock

from scripts.deployment import actions_control_plane


class ActionsControlPlaneTests(unittest.TestCase):
    def test_authorize_checks_the_attempt_without_downloading_the_artifact(self) -> None:
        arguments = [
            "actions_control_plane.py",
            "authorize",
            "--request-id",
            "request-1",
            "--attempt-id",
            "attempt-1",
        ]
        response = {
            "artifact": {"downloadUrl": "https://private.example/artifact"},
        }
        with mock.patch.object(sys, "argv", arguments), mock.patch.object(
            actions_control_plane,
            "control_plane_request",
            return_value=response,
        ) as request:
            self.assertEqual(actions_control_plane.main(), 0)

        request.assert_called_once_with(
            "/api/actions/preflight",
            {"requestId": "request-1", "attemptId": "attempt-1"},
        )


if __name__ == "__main__":
    unittest.main()
