#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: sign_linux.sh <artifact> <GPG key id>" >&2
  exit 2
fi

artifact="$1"
key_id="$2"
test -f "$artifact"
sha256sum "$artifact" > "$artifact.sha256"
gpg --batch --yes --local-user "$key_id" --armor --detach-sign "$artifact"
gpg --verify "$artifact.asc" "$artifact"
sha256sum --check "$artifact.sha256"
