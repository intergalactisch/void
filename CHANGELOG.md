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

## [0.2.1] - 2026-06-01

### Added
- Todo due dates & scheduling — set due and scheduled dates on tasks through a calendar date picker (quick presets, ranges, and keyboard shortcuts). Dates persist in the markdown todo file. New reusable `DatePicker` component and date-picker helpers.
- Asset-folder image gallery — folders containing images now render a thumbnail grid with a full-size lightbox and per-image actions (open the referencing note, reveal in Finder, copy path, save as, delete) instead of an "empty folder" state. Adds `MediaAttachmentService.findReferencingNotePaths` to map an asset back to the note that references it.

### Changed
- AI command center reworked around a streaming model (`CommandStream`, `StreamEntry`, conversation detail), replacing the previous history/inspector panels. Adds a ProseMirror plugin for AI continuation from the final block.
- "Open folder as layout" now opens up to 8 notes (was 6).
- Empty paragraphs (blank lines) inserted in a note now round-trip through markdown as real blank lines instead of being collapsed away on reload.
- Trash and workspace views refactored.

### Fixed
- Date labels now render in a consistent format regardless of the operating system's locale.

## [0.2.0] - 2026-05-26

### Added
- Image & media attachments — insert images into notes by dragging files in from outside the app, picking a local file, pasting bytes, or downloading from a remote URL. Images are stored as content-addressed assets under `.void/` with metadata (dimensions, sha256, original name, source URL, creator/license, review status). New `MediaAttachmentService`, `AssetStoragePort` (Tauri + in-memory adapters), a Rust `assets` command, and image UI (insert popover, block toolbar, details popover, drop overlay).
- Media action tools — `/attach-image`, `/download-image`, `/list-assets`, and `/cleanup-orphans` for attaching, fetching, listing, and pruning unreferenced note images.
- Pane drag-and-drop — drag notes between and into split panes with a live drop overlay.
- External file drop flow — dropping files from the OS onto the editor routes them through the media attachment pipeline.

### Changed
- Smarter note workspace layouts — improved automatic split-pane layout selection and a substantial rework of the note workspace store.

### Fixed
- Sidebar rendering and interaction fixes.
- Note trash handling fixes.

## [0.1.4] - 2026-05-24

### Added
- Multi-pane note workspace with split panes, workspace tabs, drag/move interactions, and note previews.
- Protected note and locked-line flows, including unlock UI, protection runtime/adapters, and note metadata support.
- Folder access reconnect support for macOS-scoped notes directories.
- External markdown import and richer code block handling.

### Changed
- Reworked AI command center, command history, worker details, and operation previews.
- Expanded todo workspace UI and state handling for denser task management.
- Improved editor service lifecycle around mounted panes, saves, session state, and pane-specific metadata.

### Fixed
- Note title edits now propagate instantly to tabs, sidebars, recents, search results, and breadcrumbs.
- Editor title typing no longer reverses characters while optimistic title previews update the rest of the app.
- Multi-pane note title metadata saves back to the current document without opening duplicate tabs or renaming the file path.
- Several sidebar, folder access, sync, markdown parsing, and protected-content edge cases.

## [0.1.3] - 2026-05-22

### Added
- Inline AI threads — comment-thread-style AI conversations anchored to a text selection, with a new `InlineAIThread` domain entity, `InlineAIThreadService`, dedicated `aiThreads` ProseMirror plugin, and a `BlockNodeView` for rendering thread blocks inside the editor.
- AI continuation plugin — a ProseMirror plugin that drives streaming AI continuations directly inside the editor flow.
- Note AI activity tracking — `NoteAIActivityService` and `noteAIActivity` store expose per-note AI activity state to the UI (status bar, command center).
- `EditorPort` outbound port — decouples editor primitives from the ProseMirror adapter so services can drive the editor without reaching into the adapter directly.
- Lineage history workspace — a much expanded `LineageHistoryWorkspace` view for browsing provenance and AI lineage on a note.

### Changed
- Editor shell rewrite — `EditorShell.svelte` and `EditorServiceImpl` were substantially expanded to host inline AI threads, continuations, and the new editor port wiring.
- AI command center — `AICommandCenter`, `CommandComposer`, `CommandTranscript`, and `WorkerComposer` updated for the new inline-thread + activity model.
- Sync service — refactored sync flow and store to coordinate with note AI activity.
- Status bar and slash menu polish to surface inline AI state and new actions.

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

[Unreleased]: https://github.com/intergalactisch/void/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/intergalactisch/void/releases/tag/v0.2.1
[0.2.0]: https://github.com/intergalactisch/void/releases/tag/v0.2.0
[0.1.4]: https://github.com/intergalactisch/void/releases/tag/v0.1.4
[0.1.3]: https://github.com/intergalactisch/void/releases/tag/v0.1.3
[0.1.2]: https://github.com/intergalactisch/void/releases/tag/v0.1.2
[0.1.1]: https://github.com/intergalactisch/void/releases/tag/v0.1.1
[0.1.0]: https://github.com/intergalactisch/void/releases/tag/v0.1.0
