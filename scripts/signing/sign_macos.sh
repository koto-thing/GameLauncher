#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: sign_macos.sh <app> <Developer ID Application identity> <notary profile>" >&2
  exit 2
fi

app_path="$1"
identity="$2"
notary_profile="$3"
if [[ ! -d "$app_path" || "$app_path" != *.app ]]; then
  echo "invalid app bundle: $app_path" >&2
  exit 2
fi

notary_directory="$(mktemp -d "${TMPDIR:-/tmp}/pandd-notary.XXXXXX")"
notary_archive="$notary_directory/submission.zip"
trap 'rm -rf "$notary_directory"' EXIT

# Sign nested code before the containing bundle
while IFS= read -r nested; do
  codesign --force --options runtime --timestamp --sign "$identity" "$nested"
done < <(find "$app_path/Contents" -type f \( -name '*.dylib' -o -perm -111 \) -print)
codesign --force --deep --options runtime --timestamp --sign "$identity" "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"

ditto -c -k --sequesterRsrc --keepParent "$app_path" "$notary_archive"
xcrun notarytool submit "$notary_archive" --keychain-profile "$notary_profile" --wait
xcrun stapler staple "$app_path"
xcrun stapler validate "$app_path"
spctl --assess --type execute --verbose=2 "$app_path"
