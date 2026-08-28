#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: sign_linux.sh <artifact> <GPG key id>" >&2
  exit 2
fi

artifact="$1"
key_id="$2"
test -f "$artifact"

artifact_dir="$(dirname -- "$artifact")"
artifact_name="$(basename -- "$artifact")"
(
  cd "$artifact_dir"
  sha256sum "$artifact_name" > "$artifact_name.sha256"
  gpg --batch --yes --local-user "$key_id" --armor --detach-sign "$artifact_name"
  gpg --verify "$artifact_name.asc" "$artifact_name"
  sha256sum --check "$artifact_name.sha256"
)
