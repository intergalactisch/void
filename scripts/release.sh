#!/usr/bin/env bash
#
# Cut a release end-to-end:
#   1. Verify preconditions (branch, tree, gh auth, changelog, tag uniqueness)
#   2. Bump version in package.json, tauri.conf.json, Cargo.toml
#   3. Commit and tag
#   4. Push commit + tag (triggers the Release workflow on GitHub)
#   5. Watch the workflow and confirm assets uploaded
#
# Usage:
#   scripts/release.sh [OPTIONS] <version>
#
# Examples:
#   scripts/release.sh 0.1.0          # full stable release
#   scripts/release.sh 0.2.0-rc.1     # pre-release (auto-marked on GitHub)
#   scripts/release.sh --dry-run 0.1.1
#
# Options:
#   --dry-run                Print every step but make no changes / pushes.
#   --no-push                Bump + commit + tag locally, stop before pushing.
#   --no-watch               Push, but don't block on CI.
#   --skip-changelog-check   Don't require a ## [<version>] heading in CHANGELOG.md.
#   --skip-git-checks        Skip branch / sync preconditions. DANGEROUS.
#   -y, --yes                Don't prompt before pushing (use only in CI).
#   -h, --help               Print this help.

set -euo pipefail
cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# Colors + helpers
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { printf '%s==>%s %s\n' "$BLUE$BOLD" "$RESET$BOLD" "$1$RESET"; }
ok()    { printf '%s ✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn()  { printf '%s ⚠%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()   { printf '%s ✗ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }

# Run a command, or print it if dry-running.
run() {
  if "$DRY_RUN"; then
    printf '%s   would run:%s %s\n' "$DIM" "$RESET" "$*"
  else
    "$@"
  fi
}

confirm() {
  if "$ASSUME_YES"; then return 0; fi
  if "$DRY_RUN"; then
    printf '%s   would prompt:%s %s [y/N]\n' "$DIM" "$RESET" "$1"
    return 0
  fi
  if [ ! -t 0 ]; then
    die "Non-interactive shell and no -y/--yes flag. Re-run with --yes to confirm '$1' without prompting."
  fi
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

usage() {
  sed -n '/^# /,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------

DRY_RUN=false
DO_PUSH=true
DO_WATCH=true
CHECK_CHANGELOG=true
CHECK_GIT=true
ASSUME_YES=false
NEW_VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)              DRY_RUN=true ;;
    --no-push)              DO_PUSH=false ;;
    --no-watch)             DO_WATCH=false ;;
    --skip-changelog-check) CHECK_CHANGELOG=false ;;
    --skip-git-checks)      CHECK_GIT=false ;;
    -y|--yes)               ASSUME_YES=true ;;
    -h|--help)              usage 0 ;;
    -*)                     die "Unknown option: $1 (try --help)" ;;
    *)
      if [ -n "$NEW_VERSION" ]; then
        die "Multiple version arguments given: '$NEW_VERSION' and '$1'"
      fi
      NEW_VERSION="$1"
      ;;
  esac
  shift
done

[ -n "$NEW_VERSION" ] || die "Missing <version>. Try --help."

# ---------------------------------------------------------------------------
# Constants + computed values
# ---------------------------------------------------------------------------

PACKAGE_JSON="package.json"
TAURI_CONF="src-tauri/tauri.conf.json"
CARGO_TOML="src-tauri/Cargo.toml"
CHANGELOG="CHANGELOG.md"
MAIN_BRANCH="main"

TAG="v$NEW_VERSION"
IS_PRERELEASE=false
if [[ "$NEW_VERSION" == *-* ]]; then
  IS_PRERELEASE=true
fi

# Derive repo slug from origin URL: handles both git@host:owner/repo[.git] and https://host/owner/repo[.git]
ORIGIN_URL="$(git config --get remote.origin.url 2>/dev/null || true)"
REPO_SLUG="$(printf '%s' "$ORIGIN_URL" | sed -E 's#^(git@[^:]+:|https?://[^/]+/)##; s#\.git$##')"

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------

step "Checking preconditions for $TAG"

# 1. SemVer
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]]; then
  die "'$NEW_VERSION' is not a valid SemVer (e.g. 0.1.1, 1.0.0-rc.1)."
fi
ok "version '$NEW_VERSION' is valid SemVer"

# 2. Required files exist
for f in "$PACKAGE_JSON" "$TAURI_CONF" "$CARGO_TOML" "$CHANGELOG"; do
  [ -f "$f" ] || die "Missing $f"
done
ok "all version files present"

# 3. `gh` available + authenticated
if ! command -v gh >/dev/null 2>&1; then
  die "GitHub CLI 'gh' not found. Install with: brew install gh"
fi
if ! gh auth status >/dev/null 2>&1; then
  die "gh is not authenticated. Run: gh auth login"
fi
[ -n "$REPO_SLUG" ] || die "Could not derive repo slug from origin URL: $ORIGIN_URL"
ok "gh authenticated for $REPO_SLUG"

# 4. Git state
if "$CHECK_GIT"; then
  current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
  [ "$current_branch" = "$MAIN_BRANCH" ] \
    || die "Not on $MAIN_BRANCH (currently on '$current_branch'). Switch first, or pass --skip-git-checks."
  [ -z "$(git status --porcelain)" ] \
    || die "Working tree is not clean. Commit or stash changes first."

  git fetch --quiet origin "$MAIN_BRANCH"
  local_sha="$(git rev-parse "$MAIN_BRANCH")"
  remote_sha="$(git rev-parse "origin/$MAIN_BRANCH")"
  [ "$local_sha" = "$remote_sha" ] \
    || die "$MAIN_BRANCH is out of sync with origin/$MAIN_BRANCH. Pull or push first."
  ok "on $MAIN_BRANCH, clean, synced with origin"
else
  warn "skipping git state checks (--skip-git-checks)"
fi

# 5. Tag doesn't already exist locally or on remote
if git rev-parse "$TAG" >/dev/null 2>&1; then
  die "Tag $TAG already exists locally. Delete it first: git tag -d $TAG"
fi
git fetch --quiet origin "refs/tags/$TAG:refs/tags/_remote_check_$TAG" 2>/dev/null && {
  git tag -d "_remote_check_$TAG" >/dev/null 2>&1 || true
  die "Tag $TAG already exists on origin. Pick a new version or delete it: gh release delete $TAG --repo $REPO_SLUG --cleanup-tag --yes"
}
ok "tag $TAG is unused"

# 6. CHANGELOG has a section for this version
if "$CHECK_CHANGELOG"; then
  if ! grep -qE "^## \[$NEW_VERSION\](\s|$)" "$CHANGELOG"; then
    die "$CHANGELOG has no '## [$NEW_VERSION]' section. Add one (move [Unreleased] items down and date it), then re-run. Bypass with --skip-changelog-check."
  fi
  ok "CHANGELOG has section for $NEW_VERSION"
else
  warn "skipping CHANGELOG check (--skip-changelog-check)"
fi

# ---------------------------------------------------------------------------
# Plan summary
# ---------------------------------------------------------------------------

echo
step "Plan"
cat <<EOF
  Version    : $NEW_VERSION
  Tag        : $TAG
  Channel    : $($IS_PRERELEASE && echo 'pre-release (will not be "latest")' || echo 'stable (becomes "latest")')
  Repo       : $REPO_SLUG
  Bump in    : $PACKAGE_JSON, $TAURI_CONF, $CARGO_TOML
  Commit     : "chore: release $TAG"
  Push       : $($DO_PUSH && echo 'yes (commit + tag)' || echo 'no (--no-push)')
  Watch CI   : $($DO_WATCH && $DO_PUSH && echo 'yes' || echo 'no')
  Dry run    : $DRY_RUN
EOF
echo

# ---------------------------------------------------------------------------
# Bump versions
# ---------------------------------------------------------------------------

step "Bumping version to $NEW_VERSION"

bump_json_version() {
  local file="$1"
  if "$DRY_RUN"; then
    printf '%s   would bump:%s %s\n' "$DIM" "$RESET" "$file"
    return
  fi
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
  ' "$file" "$NEW_VERSION"
}

bump_json_version "$PACKAGE_JSON"
bump_json_version "$TAURI_CONF"

if "$DRY_RUN"; then
  printf '%s   would bump:%s %s\n' "$DIM" "$RESET" "$CARGO_TOML"
else
  # Only touch the [package] version (line 3 by convention). If that
  # shifts, this will fail loudly via the sanity check below.
  sed -i.bak "3s/^version = .*/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
  rm "${CARGO_TOML}.bak"
  grep -q "^version = \"$NEW_VERSION\"$" "$CARGO_TOML" \
    || die "Cargo.toml version bump did not land on the [package] version. Check line 3."
fi

ok "bumped package.json, tauri.conf.json, Cargo.toml"

# ---------------------------------------------------------------------------
# Commit + tag
# ---------------------------------------------------------------------------

step "Creating release commit and tag"

run git add "$PACKAGE_JSON" "$TAURI_CONF" "$CARGO_TOML"
run git commit -m "chore: release $TAG"
run git tag -a "$TAG" -m "Release $TAG"

ok "committed and tagged $TAG"

# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

if ! "$DO_PUSH"; then
  echo
  step "Stopping before push (--no-push)"
  echo "  Inspect:   git show $TAG && git log -1 --stat"
  echo "  Then:      git push && git push origin $TAG"
  echo "  Or undo:   git tag -d $TAG && git reset --hard HEAD~1"
  exit 0
fi

echo
step "Ready to push to origin"
echo "  - $MAIN_BRANCH (new commit)"
echo "  - $TAG (new tag — triggers Release workflow)"
echo

if ! confirm "Push and let CI build the release?"; then
  echo
  warn "Skipping push. The commit and tag are local-only."
  echo "  When ready:    git push && git push origin $TAG"
  echo "  To abandon:    git tag -d $TAG && git reset --hard HEAD~1"
  exit 0
fi

run git push origin "$MAIN_BRANCH"
run git push origin "$TAG"
ok "pushed $MAIN_BRANCH and $TAG"

# ---------------------------------------------------------------------------
# Watch CI
# ---------------------------------------------------------------------------

if ! "$DO_WATCH"; then
  echo
  echo "  Track progress:  gh run watch --repo $REPO_SLUG"
  echo "  Release page:    https://github.com/$REPO_SLUG/releases/tag/$TAG"
  exit 0
fi

if "$DRY_RUN"; then
  printf '%s   would watch:%s gh run watch --repo %s\n' "$DIM" "$RESET" "$REPO_SLUG"
  exit 0
fi

echo
step "Waiting for CI to pick up $TAG"

# Give GitHub a few seconds to register the tag push and queue the workflow.
sleep 5

# Find the run for this tag (most recent matching head_branch). The run is
# associated with the tag name in GH's API as head_branch.
RUN_ID=""
for _ in 1 2 3 4 5 6; do
  RUN_ID="$(gh run list --repo "$REPO_SLUG" --workflow release.yml \
              --json databaseId,headBranch \
              --jq ".[] | select(.headBranch==\"$TAG\") | .databaseId" \
              2>/dev/null | head -n 1)"
  [ -n "$RUN_ID" ] && break
  sleep 3
done

[ -n "$RUN_ID" ] || die "Could not find a release workflow run for $TAG. Check: gh run list --repo $REPO_SLUG"
ok "run $RUN_ID detected"

step "Watching run $RUN_ID (Tauri matrix build, ~15 min)"
gh run watch "$RUN_ID" --repo "$REPO_SLUG" --exit-status \
  || die "Release workflow failed. Inspect: gh run view $RUN_ID --log-failed --repo $REPO_SLUG"

# ---------------------------------------------------------------------------
# Verify assets
# ---------------------------------------------------------------------------

step "Verifying release assets"

EXPECTED=(
  "Void_${NEW_VERSION}_aarch64.dmg"
  "Void_${NEW_VERSION}_x64.dmg"
  "Void_aarch64.app.tar.gz"
  "Void_aarch64.app.tar.gz.sig"
  "Void_x64.app.tar.gz"
  "Void_x64.app.tar.gz.sig"
  "latest.json"
)

ASSETS_JSON="$(gh release view "$TAG" --repo "$REPO_SLUG" --json assets --jq '[.assets[].name]')"
missing=()
for name in "${EXPECTED[@]}"; do
  printf '%s' "$ASSETS_JSON" | grep -q "\"$name\"" || missing+=("$name")
done

if [ "${#missing[@]}" -gt 0 ]; then
  warn "Some expected assets are missing:"
  printf '    %s\n' "${missing[@]}"
  die "Release published but incomplete. Inspect: https://github.com/$REPO_SLUG/releases/tag/$TAG"
fi
ok "all 7 expected assets present"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo
step "Release $TAG is live"
echo "  https://github.com/$REPO_SLUG/releases/tag/$TAG"
echo
if "$IS_PRERELEASE"; then
  echo "  This is a pre-release. The in-app updater won't fetch it."
else
  echo "  This is the new 'latest'. The in-app updater will pick it up on next check."
fi
