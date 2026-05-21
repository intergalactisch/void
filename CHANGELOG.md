# Changelog

All notable changes to Void are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Fixed
### Removed
### Security

## [0.1.2] - 2026-05-21

### Fixed
- Editor "Unsaved changes" indicator could stay lit after a successful save and only clear by switching tabs. The save flow now uses a per-session edit counter instead of comparing two derived document snapshots (which were prone to false-positive inequality from block-id regeneration in the PM-to-domain converter).

## [0.1.1] - 2026-05-20

### Added
- Workspace and GitHub sync infrastructure (ports, adapters, services, stores, settings UI, Rust commands) — enables syncing notes to a GitHub repository, including diff3-based conflict resolution.
- `scripts/setup-signing.sh` (`npm run setup:signing`) — interactive helper for adding or replacing Tauri signing env vars in your shell rc. Auto-detects raw vs base64-encoded forms, supports 1Password CLI, paste, or manual setup. Re-running detects an existing block and prompts to replace it. Documented in [CONTRIBUTING.md](CONTRIBUTING.md#release-signing-keys).
- `.github/workflows/release.yml` fails fast with a clear error if `TAURI_SIGNING_PRIVATE_KEY` is missing, pointing forkers at the fork-release docs.
- `.github/dependabot.yml` schedules monthly version-update PRs across npm, cargo, and github-actions (with grouping) to keep PR noise low.

### Changed
- **Breaking for v0.1.0 installs:** rotated the Tauri updater signing key. The previous private key was unrecoverable. Existing v0.1.0 installs silently stop receiving auto-updates and need to re-download v0.1.1 manually from GitHub Releases. After this one-time hop, auto-update resumes normally.
- Bumped Tauri plugins (`tauri-plugin-dialog` 2.6.0 → 2.7.1, `tauri-plugin-fs` 2.4.5 → 2.5.1, `tauri-plugin-opener` 2.5.3 → 2.5.4) and matching JS-side `@tauri-apps/*` packages.
- Bumped Rust deps: `thiserror` 1 → 2 (major), `keyring` 2 → 3 (major, with `apple-native` feature), added `base64` 0.22.
- Bumped npm deps: `@vitest/*` and `vitest` 2 → 4 (major), `@playwright/test` 1.41 → 1.60, `@tailwindcss/vite` 4.1.18 → 4.3.0, `prosemirror-*` patches, `autoprefixer`, `postcss`.
- Bumped CI actions: `actions/checkout` 4 → 6, `actions/setup-node` 4 → 6.

### Security
- Bumped `happy-dom` 14 → 20.9 to resolve [GHSA-96mh-qhc7-93vh](https://github.com/advisories/GHSA-96mh-qhc7-93vh) (RCE via VM context escape) and two related advisories. Dev-dependency only — test runner.
- Bumped `vite` 6.0 → 6.4.2 to resolve [GHSA-859w-5945-r5v3](https://github.com/advisories/GHSA-859w-5945-r5v3) (path traversal in optimized-deps `.map` handling). Dev server only.
- The `vitest` 2 → 4 bump above retires the previously-deferred `esbuild` advisory (vitest 2 bundled the vulnerable vite).

## [0.1.0] - 2026-05-19

Initial public alpha release.

### Added
- Hexagonal architecture (Svelte 5 UI ↔ application services ↔ Tauri/Rust adapters).
- Artifact System: `.void/` sidecar for provenance, branches, conversations, indexes.
- Document actions: `/distill`, `/morph`, `/thread`, `/bridge`, `/challenge`, `/synthesize`, `/extract`, `/continue`, `/versions`, `/replay`.
- Local AI via Claude and Codex CLIs.
- macOS-native packaging (Tauri v2, hardened runtime, ad-hoc signed DMG).
- Auto-update via `tauri-plugin-updater`.

### Security
- SSRF guards on `web_fetch` (DNS resolution + private/loopback/cloud-metadata blocklists, re-validated per redirect).
- Path validation on every file-system command.
- Tightened CSP with `object-src 'none'`, `frame-ancestors 'none'`, scoped `img-src` / `connect-src`.
- URL scheme allowlist on `openUrl` (http, https, mailto only).
- Concurrent-process cap on CLI spawns.

[Unreleased]: https://github.com/intergalactisch/void/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/intergalactisch/void/releases/tag/v0.1.2
[0.1.1]: https://github.com/intergalactisch/void/releases/tag/v0.1.1
[0.1.0]: https://github.com/intergalactisch/void/releases/tag/v0.1.0
