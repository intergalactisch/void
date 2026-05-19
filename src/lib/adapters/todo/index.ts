/**
 * TODO Adapter Module
 *
 * Provides markdown parsing, serialization, caching, and repository for TODO items.
 * Implements TodoParserPort, TodoRepositoryPort, and TodoWatcherPort interfaces.
 *
 * Exports:
 * - MarkdownTodoParser: Parser implementation for parsing todos from markdown
 * - MarkdownTodoRepository: Repository for CRUD operations on todos
 * - TodoCache: In-memory cache with hash-based invalidation
 * - TauriTodoWatcher: File watcher using Tauri's FS events
 * - MemoryTodoWatcher: Mock watcher for testing
 * - Regex utilities: Pattern matching for todos
 * - Serializer utilities: Functions for writing todos back to files
 */

// Main parser
export { MarkdownTodoParser, createMarkdownTodoParser } from './MarkdownTodoParser';

// Repository
export {
  MarkdownTodoRepository,
  createMarkdownTodoRepository,
  type MarkdownTodoRepositoryConfig,
} from './MarkdownTodoRepository';

// Cache
export {
  TodoCache,
  hashContent,
  createTodoCache,
  type CacheStats,
} from './TodoCache';

// Watchers
export { TauriTodoWatcher, createTauriTodoWatcher } from './TauriTodoWatcher';
export { MemoryTodoWatcher, createMemoryTodoWatcher } from './MemoryTodoWatcher';

// Regex patterns and utilities
export {
  TODO_PATTERN,
  DATE_PATTERNS,
  PRIORITY_PATTERNS,
  TAG_PATTERN,
  isTodoLine,
  extractTags,
  stripMetadata,
  calculateIndentLevel,
  createIndentation,
} from './regex';

// Serialization utilities
export {
  toggleCheckbox,
  setCheckboxCompleted,
  setCheckboxIncomplete,
  addCompletionTimestamp,
  removeCompletionTimestamp,
  replaceContent,
  updateLineInContent,
  deleteLineFromContent,
  insertLineInContent,
  appendLineToContent,
  createNewTodoLine,
  batchUpdateLines,
  type NewTodoOptions,
  type BatchUpdateResult,
} from './serializer';
