#!/usr/bin/env bash
# setup-signing.sh — add or replace Tauri signing env vars in your shell rc.
#
# Idempotent: re-running detects the existing block and asks before replacing.
# Tool-agnostic: 1Password CLI, pasted values, or manual setup.
#
# Tauri's TAURI_SIGNING_PRIVATE_KEY env var accepts the base64 encoding of the
# raw key file contents. This script always exports that single-line base64
# form, regardless of where the raw key comes from, so multi-line content and
# stray characters never trip the build.

set -euo pipefail

MARKER_START="# >>> tauri-signing (void) >>>"
MARKER_END="# <<< tauri-signing (void) <<<"

# --- detect shell + rc file ---
case "${SHELL:-}" in
  */zsh) RC="${ZDOTDIR:-$HOME}/.zshrc" ;;
  */bash) RC="$HOME/.bashrc" ;;
  *)
    echo "Could not detect zsh or bash from \$SHELL ($SHELL)."
    echo "Set TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD manually."
    exit 1
    ;;
esac

# --- detect existing block ---
existing=false
if [[ -f "$RC" ]] && grep -qF "$MARKER_START" "$RC"; then
  existing=true
  echo "A tauri-signing block already exists in $RC."
  read -r -p "Replace it with a new configuration? [y/N]: " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Leaving the existing block in place. Exiting."
    exit 0
  fi
fi

# --- prompt: where is the raw private key? ---
echo
echo "Where is the raw Tauri private key (the void.key file contents)?"
echo "  1) 1Password CLI (op) — fetched on every shell, never on disk"
echo "  2) Paste it now (encoded into the rc block, plaintext-on-disk in rc)"
echo "  3) Skip — I'll set TAURI_SIGNING_PRIVATE_KEY myself"
read -r -p "[1-3, default 1]: " key_src
key_src="${key_src:-1}"

case "$key_src" in
  1)
    if ! command -v op >/dev/null 2>&1; then
      echo "Error: 1Password CLI ('op') not installed. Install: brew install --cask 1password-cli"
      exit 1
    fi
    read -r -p "1Password item path for key (e.g. op://Private/Void Tauri Signing): " key_item
    key_item="${key_item%/}"
    # Read once now to detect form (raw vs base64-encoded) so rc does the right thing.
    sample=$(op read "${key_item}/key" 2>/dev/null) || {
      echo "Error: could not read '${key_item}/key' from 1Password."
      echo "Verify the item exists with a 'key' field, and you are signed in ('op signin')."
      exit 1
    }
    if printf '%s' "$sample" | base64 -d 2>/dev/null | head -c 32 | grep -q '^untrusted comment: rsign'; then
      echo "Detected: 1Password stores the base64-encoded form — exporting as-is."
      KEY_LINE="export TAURI_SIGNING_PRIVATE_KEY=\"\$(op read '${key_item}/key' 2>/dev/null)\""
    elif [[ "$sample" == "untrusted comment: rsign"* ]]; then
      echo "Detected: 1Password stores the raw form — base64-encoding on each shell."
      KEY_LINE="export TAURI_SIGNING_PRIVATE_KEY=\"\$(op read '${key_item}/key' 2>/dev/null | base64 | tr -d '\\\\n')\""
    else
      echo "Error: the value in '${key_item}/key' doesn't look like a Tauri private key."
      exit 1
    fi
    unset sample
    ;;
  2)
    echo "Paste your Tauri private key. Either form works:"
    echo "  - the raw multi-line file contents (starts with 'untrusted comment: rsign…')"
    echo "  - the base64-encoded form (one long line of base64 — what most secrets managers store)"
    echo "Press Enter on a blank line when done."
    key_content=""
    while IFS= read -r line; do
      [[ -z "$line" ]] && break
      key_content+="${line}"$'\n'
    done
    key_content="${key_content%$'\n'}"
    if [[ -z "$key_content" ]]; then
      echo "Error: no key content provided."
      exit 1
    fi
    if [[ "$key_content" == *% ]]; then
      echo "Error: pasted key ends with '%' (zsh's no-newline display indicator)."
      echo "You probably ran 'cat ~/.tauri/void.key' then copied; use 'pbcopy < ...' instead."
      exit 1
    fi
    # Detect form: try decoding as base64; if result looks like the raw key, it was already encoded.
    if decoded=$(printf '%s' "$key_content" | base64 -d 2>/dev/null) \
        && [[ "$decoded" == "untrusted comment: rsign"* ]]; then
      echo "Detected: base64-encoded form — using as-is."
      encoded="$key_content"
    elif [[ "$key_content" == "untrusted comment: rsign"* ]]; then
      echo "Detected: raw form — base64-encoding for the env var."
      encoded=$(printf '%s' "$key_content" | base64 | tr -d '\n')
    else
      echo "Error: input doesn't look like a Tauri private key."
      echo "Expected to start with 'untrusted comment: rsign' (raw) or to be its base64 encoding."
      exit 1
    fi
    esc_encoded=${encoded//\'/\'\\\'\'}
    KEY_LINE="export TAURI_SIGNING_PRIVATE_KEY='$esc_encoded'"
    echo
    echo "Note: the key will be embedded as plaintext in your shell rc."
    echo "Use option 1 (1Password) for stronger isolation."
    ;;
  3)
    KEY_LINE="# TAURI_SIGNING_PRIVATE_KEY intentionally unset — set it yourself."
    ;;
  *)
    echo "Invalid choice."
    exit 1
    ;;
esac

# --- prompt: where is the key's password? ---
echo
echo "Where is the key's password?"
echo "  1) 1Password CLI (op)"
echo "  2) Paste it now (embedded plaintext in rc)"
echo "  3) Skip — I'll set TAURI_SIGNING_PRIVATE_KEY_PASSWORD myself"
read -r -p "[1-3, default 1]: " pw_src
pw_src="${pw_src:-1}"

case "$pw_src" in
  1)
    if ! command -v op >/dev/null 2>&1; then
      echo "Error: 1Password CLI ('op') not installed."
      exit 1
    fi
    read -r -p "1Password item path for password (e.g. op://Private/Void Tauri Signing): " pw_item
    pw_item="${pw_item%/}"
    if ! op read "${pw_item}/password" >/dev/null 2>&1; then
      echo "Error: could not read '${pw_item}/password' from 1Password."
      exit 1
    fi
    PW_LINE="export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\"\$(op read '${pw_item}/password' 2>/dev/null)\""
    ;;
  2)
    read -r -s -p "Password: " pw
    echo
    esc_pw=${pw//\'/\'\\\'\'}
    PW_LINE="export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='$esc_pw'"
    ;;
  3)
    PW_LINE="# TAURI_SIGNING_PRIVATE_KEY_PASSWORD intentionally unset — set it yourself."
    ;;
  *)
    echo "Invalid choice."
    exit 1
    ;;
esac

# --- write (atomic): filter out existing block + trim trailing blanks + append new block ---
{
  if [[ -f "$RC" ]]; then
    awk -v start="$MARKER_START" -v end="$MARKER_END" '
      $0 == start {skip = 1; next}
      skip && $0 == end {skip = 0; next}
      skip {next}
      /./ {has_data=1; for(i=0;i<blanks;i++)print ""; blanks=0; print; next}
      has_data {blanks++}
    ' "$RC"
  fi
  printf '\n%s\n' "$MARKER_START"
  printf '%s\n' "# Generated by scripts/setup-signing.sh — re-run to replace."
  printf '%s\n' "$KEY_LINE"
  printf '%s\n' "$PW_LINE"
  printf '%s\n' "$MARKER_END"
} > "$RC.tmp" && mv "$RC.tmp" "$RC"

echo
if [[ "$existing" == "true" ]]; then
  echo "Replaced tauri-signing block in $RC."
else
  echo "Added tauri-signing block to $RC."
fi
echo "Run 'source $RC' (or open a new shell), then 'npm run tauri:install'."
