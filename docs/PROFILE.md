# Void Profile

## Purpose

AI-powered, local-first note-taking app for macOS. Markdown notes on disk; a `.void/` sidecar that tracks provenance, branches, and conversations; AI as a citizen of the document rather than a chat partner.

## Target Users

- Power users who want keyboard-driven workflows
- Writers who want AI as a transformation tool, not a chatbot
- Developers and researchers who want notes to stay as plain `.md` files they can open anywhere
- Anyone who values local-first, privacy-respecting note storage

## Key Features (v0.1.0)

- **Artifact System** — every note has a `.void/` sidecar tracking provenance, branches, conversations. The `.md` files stay portable Markdown; `.void/` is derived, disposable, rebuildable.
- **Block-based editor** — ProseMirror-backed editor with per-line blocks, drag-and-drop, slash menu, and inline AI rewrites.
- **Document actions** — `/distill`, `/morph`, `/thread`, `/bridge`, `/challenge`, `/synthesize`, `/extract`, `/continue`, `/versions`, `/replay`. Composable transformations, each recorded in `.void/provenance/`.
- **Local AI via CLIs** — uses your local `claude` and `codex` CLIs. No API keys to manage in-app; you bring the CLI auth.
- **Quick capture** — `Cmd+Shift+Enter` opens a floating capture window from anywhere on macOS.
- **macOS-native packaging** — Tauri v2, hardened runtime, ad-hoc signed per-arch DMGs, in-app updater signed with our own minisign key.

See [ROADMAP.md](ROADMAP.md) for what's coming after v0.1.0 (sync, plugins, additional AI providers, etc.).

## Technical Stack

| Layer | Technology |
|-------|------------|
| Desktop | Tauri v2 (Rust backend) |
| Frontend | Svelte 5 + SvelteKit (static adapter) |
| Editor | ProseMirror |
| Styling | Tailwind CSS v4 |
| Events | mitt (typed event bus) |
| Type safety | TypeScript (strict) |
| Credential storage | macOS Keychain via `keyring` crate |

## Architecture: Hexagonal (Ports & Adapters)

Void uses hexagonal architecture to isolate business logic from infrastructure:

- **Testability** — in-memory adapters enable unit testing without Tauri
- **Portability** — domain logic is framework-agnostic
- **Maintainability** — clear separation of concerns
- **Flexibility** — add new adapters without touching domain

### Layer Structure

```
Primary Adapters (Driving)     - Svelte Components, Stores, Tests
  |
Inbound Ports                  - Service interfaces
  |
Application Layer              - Use case implementations
  |
Domain Layer                   - Entities, value objects (no external deps)
  |
Outbound Ports                 - Infrastructure interfaces
  |
Secondary Adapters (Driven)    - Tauri adapters, Memory adapters
```

### Key Patterns

- **DI Container** — dependency injection via tokens (`$lib/core/container.ts`)
- **Result Pattern** — all fallible operations return `Result<T, Error>`, never throw
- **Typed EventBus** — loose coupling between modules with mitt
- **Single composition root** — `$lib/bootstrap.ts` wires the whole app

See [AGENTS.md](../AGENTS.md) for the full architecture guide.

## Platform Support

- [x] macOS 12+ (Apple Silicon and Intel, separate DMGs)
- [ ] Windows
- [ ] Linux

## Status

**v0.1.0 — public alpha.** Expect bugs, breaking changes, and the occasional crash.

Notes live as plain Markdown in the directory you configure (default `~/Documents/void/`). They are portable to Obsidian, Typora, VSCode, or any other Markdown editor — `.void/` is metadata only.
