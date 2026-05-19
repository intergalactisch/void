# void Profile

## Purpose

AI-powered note-taking application with a custom ProseMirror block editor, pure markdown file output, and deep AI integration via multiple providers (Claude, OpenAI, Gemini, Ollama).

## Target Users

- Power users who want keyboard-driven workflows
- Writers who need AI assistance
- Developers who want clean markdown files
- Anyone who values local-first, privacy-respecting note storage

## Key Features

- **Block-based Editor** - ProseMirror with drag-drop blocks, slash commands (planned)
- **Pure Markdown Output** - Clean .md files that work in any editor
- **Rich Metadata** - Tags, categories, colors via separate .meta files
- **Multi-provider AI** - Claude, OpenAI, Gemini, Ollama support (planned)
- **Command Palette** - Quick access to all actions (Cmd+K) (planned)
- **Plugin System** - Extend functionality with local plugins (planned)
- **Full-text Search** - Fast search with Tantivy (planned)

## Technical Stack

| Layer | Technology |
|-------|------------|
| Desktop | Tauri v2 (Rust backend) |
| Frontend | Svelte 5 + SvelteKit |
| Editor | ProseMirror (planned) |
| Type Safety | TypeScript (strict mode) |
| Styling | Tailwind CSS v4 |
| Events | mitt (typed event bus) |
| Search | Tantivy (planned) |

## Architecture: Hexagonal (Ports & Adapters)

void uses **Hexagonal Architecture** to isolate business logic from infrastructure, enabling:

- **Testability** - Memory adapters enable unit testing without Tauri
- **Portability** - Domain logic is framework-agnostic
- **Maintainability** - Clear separation of concerns
- **Flexibility** - Add new adapters without touching domain

### Layer Structure

```
Primary Adapters (Driving)     - Svelte Components, Stores, Tests
  |
Inbound Ports                  - Service interfaces
  |
Application Layer              - Use case implementations
  |
Domain Layer                   - Entities, value objects (NO external deps)
  |
Outbound Ports                 - Infrastructure interfaces
  |
Secondary Adapters (Driven)    - Tauri adapters, Memory adapters
```

### Key Patterns

- **DI Container** - Clean dependency injection via tokens
- **Result Pattern** - All fallible operations return `Result<T, Error>`, never throw
- **Typed EventBus** - Loose coupling between modules with mitt
- **SOLID Principles** - Extensible, maintainable code

## Platform Support

- [x] macOS (primary target)
- [ ] Windows
- [ ] Linux

## Status

**Phase 1 Complete** - Foundation with hexagonal architecture scaffold.

### Completed

- Tauri v2 + Svelte 5 project setup
- Hexagonal architecture with domain/ports/adapters separation
- Result type and DI container
- Typed event bus with mitt
- Settings service with persistence
- File system service
- Credential service (macOS Keychain)
- Memory adapters for testing
- Svelte stores for UI state

### Next Phases

- Phase 2: ProseMirror block editor
- Phase 3: AI provider integration
- Phase 4: Full-text search with Tantivy
- Phase 5: Plugin system

## Notes

void stores notes as pure markdown files with metadata in a separate `.void/` folder. This ensures notes are portable and can be opened in Obsidian, Typora, VSCode, or any other markdown editor.
