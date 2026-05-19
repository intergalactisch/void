/**
 * Adapters - Infrastructure implementations of ports
 *
 * This module re-exports all adapter implementations.
 * Adapters are the "driven" side of the Hexagonal Architecture.
 *
 * Available adapters:
 * - tauri/ - Real implementations using Tauri APIs (production)
 * - memory/ - In-memory implementations (testing, browser dev)
 * - prosemirror/ - ProseMirror editor adapter
 * - commands/ - Command registry adapter
 *
 * IMPORTANT: Only bootstrap.ts should import from this module directly.
 * Application services should depend on ports, not adapters.
 */

// Tauri adapters (production)
export * from './tauri';

// Memory adapters (testing)
export * from './memory';

// ProseMirror editor adapter
export * from './prosemirror';

// Command registry adapter
export * from './commands';

// Markdown adapter (document persistence)
export * from './markdown';

// AI adapters
export * from './ai';

// Tools adapters (tool registry and executor)
export * from './tools';

// Context provider adapter
export * from './context';

// TODO adapters (parser, repository, watcher)
export * from './todo';

// Agent orchestration adapters
export * from './agent';

// Lineage sidecar adapters
export * from './lineage';
