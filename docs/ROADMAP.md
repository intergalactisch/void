# Roadmap

A high-level view of where Void is going. This roadmap reflects intent, not commitment.

## Now (next release)

Work currently underway, targeting the next tagged release.

- **AI Services finishing touches** — `AIAssistantService` and `ToolRegistryService` polish.
- **Prompt window UX** — Cmd+K global AI prompt is the primary entry point; refining latency, history, and result handling.
- **Public release infrastructure** — DMG bundle, ad-hoc signing, auto-update via `tauri-plugin-updater`, GitHub Actions release pipeline.

## Next (this quarter)

Committed near-term work after the next release.

- **Note storage hardening** — content addressing, conflict-free saves, atomic writes for the `.void/` sidecar.
- **Note list & navigation** — recent / pinned / tag-filtered views, sidebar improvements.
- **TODO system across notes** — task aggregation, due dates, view filters.
- **Search** — full-text plus structural search across notes and `.void/` history.

## Later

Direction we've committed to, further out on the horizon.

- **Folders, tags, organisation** — sidebar primitives for grouping at scale.
- **Export** — markdown bundle, PDF, HTML site.
- **Versions & replay** — surface the `.void/` lineage in the UI for time-travel and undo across sessions.
- **Pulse UX** — proactive intelligence (contradictions, stale notes, overdue items) integrated into the right rail.

## Ideas (not committed)

Worth surfacing but not on the schedule. PRs and discussions welcome.

- Sync between devices (CRDT or git-backed).
- iOS / iPadOS companion (read-only first).
- Plugin system for third-party document actions.
- Local-only AI providers (Ollama, MLX) as a first-class option alongside Claude / Codex CLIs.
- Web clipper.
- Voice capture.

---

This roadmap reflects intent, not commitment. See [CHANGELOG.md](../CHANGELOG.md) for shipped work.
