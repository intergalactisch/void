# void

AI-powered note-taking app built with Tauri v2 + Svelte 5.

## Architecture: Hexagonal (Ports & Adapters)

This project uses **Hexagonal Architecture** to isolate business logic from infrastructure.

### Layer Structure

```
+---------------------------------------------------------+
|  PRIMARY ADAPTERS (Driving)                             |
|  Svelte Components, Stores, Tests                       |
+---------------------------------------------------------+
|  INBOUND PORTS                                          |
|  $lib/ports/inbound/ - Service interfaces               |
+---------------------------------------------------------+
|  APPLICATION LAYER                                      |
|  $lib/application/services/ - Use case implementations  |
+---------------------------------------------------------+
|  DOMAIN LAYER                                           |
|  $lib/domain/ - Entities, value objects (NO deps)       |
+---------------------------------------------------------+
|  OUTBOUND PORTS                                         |
|  $lib/ports/outbound/ - Infrastructure interfaces       |
+---------------------------------------------------------+
|  SECONDARY ADAPTERS (Driven)                            |
|  $lib/adapters/tauri/, $lib/adapters/memory/            |
+---------------------------------------------------------+
```

### Directory Structure

```
src/lib/
├── domain/              # Pure business logic, ZERO external dependencies
│   └── entities/        # Core domain objects (Settings, Note, etc.)
├── ports/               # Interfaces (contracts)
│   ├── inbound/         # Service interfaces (what the app exposes)
│   └── outbound/        # Infrastructure interfaces (what the app needs)
├── application/         # Use cases, orchestration
│   └── services/        # Service implementations
├── adapters/            # Infrastructure implementations
│   ├── tauri/           # Tauri implementations of outbound ports
│   └── memory/          # In-memory implementations for testing
├── stores/              # Svelte stores (primary adapters connecting UI to services)
├── core/                # Framework-agnostic utilities
│   ├── result.ts        # Result<T, E> type
│   ├── container.ts     # DI container
│   └── types.ts         # Shared types
├── events/              # Typed event system
│   ├── types.ts         # EventMap interface
│   └── bus.ts           # mitt singleton
├── bootstrap.ts         # App initialization, DI wiring (composition root)
└── index.ts             # Public API exports
```

### Rules

1. **Domain is pure** - `$lib/domain/` must have NO imports from adapters, Tauri, or external libs
2. **Depend on ports, not adapters** - Services import from `$lib/ports`, never `$lib/adapters`
3. **Bootstrap is the composition root** - `$lib/bootstrap.ts` is the ONLY file that imports adapters
4. **Use Result type** - All fallible operations return `Result<T, Error>`, never throw

### Adding New Features

1. Define entity/value object in `$lib/domain/` if needed
2. Define port interface in `$lib/ports/outbound/` (what you need from infrastructure)
3. Define service interface in `$lib/ports/inbound/` (what you expose to UI)
4. Implement adapter in `$lib/adapters/tauri/` (and optionally `memory/` for testing)
5. Implement service in `$lib/application/services/`
6. Register in `$lib/bootstrap.ts`
7. Create store in `$lib/stores/` if needed for reactive UI state

### Testing

Use memory adapters for unit tests:

```typescript
import { MemorySettingsAdapter } from '$lib/adapters/memory';
import { SettingsServiceImpl } from '$lib/application/services';

const adapter = new MemorySettingsAdapter();
const service = new SettingsServiceImpl(adapter);
// Test service without Tauri
```

### Development

```bash
npm run tauri dev          # Full app with Tauri
npm run dev                # Browser only (requires useMocks: true in bootstrap)
npm run check              # TypeScript type checking
npm run build              # Build frontend for production
npm run tauri:install      # Build + sign + install to /Applications
npm run install:app        # Install last build to /Applications (skip rebuild)
```

**Important:** When building the Tauri app for local use, always run `npm run tauri:install` (or `npm run install:app` after a build). This signs the app, strips macOS quarantine attributes, and copies it to `/Applications`. Without this, macOS Sequoia silently blocks the unsigned app.

### Rust Backend

Commands are in `src-tauri/src/commands/`:

- `files.rs` - File system operations
- `settings.rs` - Settings persistence
- `credentials.rs` - Keychain credential storage

All commands return `Result<T, VoidError>` where `VoidError` is defined in `src-tauri/src/error.rs`.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Svelte 5 + SvelteKit (static adapter) |
| Desktop | Tauri v2 (Rust backend) |
| Styling | Tailwind CSS v4 |
| Events | mitt (typed event bus) |
| DI | Custom lightweight container |
| Type Safety | TypeScript (strict) |

## Key Patterns

### Result Type

All fallible operations return `Result<T, Error>` instead of throwing:

```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Usage
const result = await service.load();
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

### DI Container

Services are resolved via tokens:

```typescript
import { TOKENS, container } from '$lib/core';

const settings = container.resolve<SettingsService>(TOKENS.SettingsService);
```

### Event Bus

Typed events for loose coupling:

```typescript
import { events } from '$lib/events';

// Emit
events.emit('settings:changed', { key: 'theme', value: 'dark' });

// Listen
events.on('settings:changed', (payload) => {
  console.log(payload.key, payload.value);
});
```

## File Naming Conventions

- Interfaces: `SettingsService.ts` (PascalCase)
- Implementations: `SettingsServiceImpl.ts` (PascalCase + Impl suffix)
- Adapters: `TauriSettingsAdapter.ts` (PascalCase with prefix)
- Stores: `settings.svelte.ts` (lowercase.svelte.ts)
- Index files: `index.ts` (re-exports only)

## Rust Conventions

- Commands in `src-tauri/src/commands/`
- Error types in `src-tauri/src/error.rs`
- All commands use `async` and return `Result<T, VoidError>`
- Serde for serialization between Rust and TypeScript

## Artifact System

The Artifact System is the core paradigm: every document is shaped by human-AI collaboration. Intelligence lives alongside markdown in `.void/` sidecar files.

**The markdown contract:** `.md` files are always portable and readable anywhere. `.void/` data is derived, disposable, rebuildable.

### `.void/` Directory Structure
```
{notesDir}/
  .void/
    provenance/{note-name}.jsonl   — Append-only interaction history (JSONL)
    conversations/{note-name}/     — Document-bound conversation persistence
    branches/{note-name}/          — Alternative versions (draft branches)
    index/                         — Disposable caches
      graph.json                   — Note relationship data
      checksums.json               — File hashes for reconciliation
    insights/
      pending.json                 — Pulse notifications
```

### Key Services
- **VoidStoragePort** — Outbound port for `.void/` file operations (Tauri/memory adapters)
- **ProvenanceService** — Records interaction history per note (ai_rewrite, ai_action, user_edit events)
- **IndexService** — Concept extraction, note relationships, semantic search
- **BranchService** — Draft branches (alternative versions of content)
- **PulseService** — Proactive intelligence (contradictions, stale notes, overdue items)

### Document Actions (Tools)
Single-note: `/distill`, `/challenge`, `/morph [format]`, `/continue`
Cross-note: `/thread [topic]`, `/bridge`, `/extract [type]`, `/synthesize`
Version: `/versions`, `/replay`

All action tools follow the `defineTool()` pattern in `src/lib/tools/actions/`.

### Note Info (Frontmatter)
```yaml
---
title: Meeting Notes
created: 2026-02-21
modified: 2026-02-21
tags: [meetings, backend]
status: draft
intent: meeting-notes
ai_touches: 3
---
```

Intent types: general, meeting-notes, project-plan, blog-post, journal, research, brainstorm, specification, letter, reference. AI behavior adapts per intent.
