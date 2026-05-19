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
- Bumped `happy-dom` 14 → 20.9 to resolve [GHSA-96mh-qhc7-93vh](https://github.com/advisories/GHSA-96mh-qhc7-93vh) (RCE via VM context escape) and two related advisories. Dev-dependency only — test runner.
- Bumped `vite` 6.0 → 6.4.2 to resolve [GHSA-859w-5945-r5v3](https://github.com/advisories/GHSA-859w-5945-r5v3) (path traversal in optimized-deps `.map` handling). Dev server only.
- Known transitive advisories deliberately left in place — fixes require breaking upgrades that aren't justified at this stage: `esbuild` (via vitest's bundled vite, would require vitest@4), `cookie` (via @sveltejs/kit, would require kit@0.0.30), `rand` and `glib` (transitive Tauri deps, await upstream bump).

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

[Unreleased]: https://github.com/intergalactisch/void/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/intergalactisch/void/releases/tag/v0.1.0
