#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

die() {
  echo "Error: $*" >&2
  exit 1
}

if [ $# -lt 1 ]; then
  die "Usage: scripts/release.sh <version>  (e.g. 0.1.1)"
fi

NEW_VERSION="$1"

if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]]; then
  die "Version '$NEW_VERSION' is not a valid semver (e.g. 0.1.1, 1.0.0-rc.1)"
fi

if [ -n "$(git status --porcelain)" ]; then
  die "Working tree is not clean. Commit or stash changes first."
fi

PACKAGE_JSON="package.json"
TAURI_CONF="src-tauri/tauri.conf.json"
CARGO_TOML="src-tauri/Cargo.toml"

[ -f "$PACKAGE_JSON" ] || die "Missing $PACKAGE_JSON"
[ -f "$TAURI_CONF" ]   || die "Missing $TAURI_CONF"
[ -f "$CARGO_TOML" ]   || die "Missing $CARGO_TOML"

echo "Bumping version to $NEW_VERSION..."

bump_json_version() {
  local file="$1"
  local version="$2"
  node -e '
    const fs = require("fs");
    const [file, version] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8");
    const updated = text.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
    if (updated === text) {
      console.error("Failed to update version field in", file);
      process.exit(1);
    }
    fs.writeFileSync(file, updated);
  ' "$file" "$version"
}

bump_json_version "$PACKAGE_JSON" "$NEW_VERSION"
bump_json_version "$TAURI_CONF" "$NEW_VERSION"

sed -i.bak "3s/^version = .*/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
rm "${CARGO_TOML}.bak"

git add "$PACKAGE_JSON" "$TAURI_CONF" "$CARGO_TOML"
git commit -m "chore: release v$NEW_VERSION"
git tag "v$NEW_VERSION"

echo ""
echo "Release commit + tag created."
echo "Now run: git push && git push --tags"
