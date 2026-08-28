#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: smoke_test_linux.sh <launcher executable>" >&2
  exit 2
fi

launcher="$1"
test -x "$launcher"

dependencies="$(ldd "$launcher")"
printf '%s\n' "$dependencies"
if grep -q 'not found' <<<"$dependencies"; then
  echo "launcher has unresolved shared-library dependencies" >&2
  exit 1
fi

QT_QPA_PLATFORM=offscreen "$launcher" --smoke-test
