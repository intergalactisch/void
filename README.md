<div align="center">

# Void

*An AI-powered, local-first note-taking app for macOS — your notes as artifacts, not chat logs.*

[![Latest release](https://img.shields.io/github/v/release/intergalactisch/void?display_name=tag&sort=semver)](https://github.com/intergalactisch/void/releases/latest)
[![CI](https://github.com/intergalactisch/void/actions/workflows/ci.yml/badge.svg)](https://github.com/intergalactisch/void/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://v2.tauri.app)
[![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00.svg)](https://svelte.dev)

</div>

## What is Void

Void is a Markdown note-taking app that treats AI as a citizen of your document, not a chat partner. Every note lives as a plain `.md` file you can edit anywhere; alongside it, a hidden `.void/` sidecar tracks provenance, branches, conversations, and indexes. The result is notes that remember every transformation, without ever locking your content into a proprietary store.

> ⚠️ Void is in alpha. Expect bugs, breaking changes, and the occasional crash. See [ROADMAP](docs/ROADMAP.md) for what's coming.

## Key features

- **Artifact System** — every note has a `.void/` sidecar tracking provenance, branches, conversations. Your `.md` files stay portable Markdown anywhere; `.void/` is derived, disposable, rebuildable.
- **Document actions** — `/distill`, `/morph`, `/thread`, `/bridge`, `/challenge`, `/synthesize`, `/extract`, `/continue`, `/versions`, `/replay`. AI as a tool you can compose, not a chatbot you have to negotiate with.
- **Local AI** — uses your local `claude` and `codex` CLIs. No API keys to manage, no per-prompt billing surprises; you bring the CLI auth.
- **Local-first** — pure Markdown on disk. No proprietary database, no sync lock-in. Works offline.
- **Hexagonal architecture** — clean separation of UI, application services, ports, and adapters. See [AGENTS.md](AGENTS.md).
- **macOS-native** — Tauri v2 with hardened runtime, per-arch DMG (~8 MB), menu-bar resident.

## Install

Void targets macOS 12+. Pick the DMG for your Mac:

- **Apple Silicon** (M1 / M2 / M3 / M4) → `Void_X.Y.Z_aarch64.dmg`
- **Intel** → `Void_X.Y.Z_x64.dmg`

Not sure? Apple menu → **About This Mac**. "Apple M…" = Apple Silicon.

1. Download the right DMG from [Releases](https://github.com/intergalactisch/void/releases/latest).
2. Open the DMG and drag **Void.app** to `/Applications`.
3. First launch — macOS will refuse to open Void because we don't have an Apple Developer ID. **Pick one:**
   - **System Settings → Privacy & Security → "Open Anyway"** after the first refusal, or
   - In Terminal: `xattr -d com.apple.quarantine /Applications/Void.app`

Subsequent launches and auto-updates run without any further prompts.

Longer guide with troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).

## Quick tour

- **Capture** — `Cmd+Shift+Enter` opens a quick-capture window that drops a timestamped block into your inbox or daily note.
- **Distill** — `/distill` rewrites the current note into a tighter version, recording the transformation in `.void/provenance/`.
- **Branch** — explore alternative versions of a note side by side without losing the original. Merge or drop with one click.
- **Bridge** — `/bridge` synthesises a paragraph that connects two notes, with sources you can audit.
- **Thread** — `/thread <topic>` orders notes that touch the topic into a coherent reading sequence with AI commentary.

## Architecture

Void uses **hexagonal architecture**: the UI calls inbound ports, application services orchestrate use cases, services depend on outbound ports, and infrastructure (Tauri commands, file system, AI CLIs, keychain) implements those ports. Everything is wired together in a single composition root — `src/lib/bootstrap.ts` — so swapping a real Tauri adapter for an in-memory one in tests is one line.

For the full architecture guide, the Artifact System, the event bus, and the DI container, see [AGENTS.md](AGENTS.md). For an index of internal documentation, see [docs/INDEX.md](docs/INDEX.md).

## Contributing

PRs welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, conventions, and the 7-step recipe for adding a feature. Browse [good first issues](https://github.com/intergalactisch/void/issues?q=is:open+label:%22good+first+issue%22) for low-friction places to dive in.

Security report? Don't open a public issue — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 intergalactisch.

## Acknowledgments

Void stands on the shoulders of [Tauri](https://v2.tauri.app), [Svelte](https://svelte.dev), [ProseMirror](https://prosemirror.net), [markdown-it](https://github.com/markdown-it/markdown-it), and the AI assistants from Anthropic ([Claude](https://www.anthropic.com)) and OpenAI ([Codex](https://github.com/openai/codex)).
