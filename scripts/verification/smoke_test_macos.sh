#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: smoke_test_macos.sh <launcher app>" >&2
  exit 2
fi

app_path="$1"
executable="$app_path/Contents/MacOS/PandD Game Launcher"
if [[ ! -d "$app_path" || "$app_path" != *.app || ! -x "$executable" ]]; then
  echo "invalid launcher app bundle: $app_path" >&2
  exit 2
fi

otool -L "$executable"
QT_QPA_PLATFORM=offscreen PANDD_SMOKE_TEST=1 "$executable" --smoke-test
