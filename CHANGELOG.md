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
