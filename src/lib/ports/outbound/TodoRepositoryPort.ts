/**
 * TodoRepositoryPort - Outbound port for TODO storage and retrieval
 *
 * This port defines how the application stores, retrieves, and manipulates
 * TODO items from markdown files. TODOs are parsed from GFM-style checkboxes
 * in markdown files and can be modified, toggled, or deleted.
 *
 * Write operations modify the source markdown files directly.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core';
import type {
  Todo,
  CreateTodoParams,
  TodoMoveTarget,
  TodoSection,
  TodoSectionMovePosition,
  TodoUpdatePatch,
} from '$lib/domain/entities/Todo';
import type { TodoId } from '$lib/domain/values/TodoId';
import type { TodoFilter } from '$lib/domain/values/TodoFilter';
import type {
  TodoListFile,
  CreateTodoListFileParams,
  UpdateTodoListFileParams,
} from '$lib/domain/values/TodoListFile';

/**
 * Best-effort identity hint for rebasing line-number TODO mutations.
 *
 * Todo IDs are still filepath:lineNumber, but concurrent creates/deletes can
 * move a line before an item edit commits. Passing the raw line observed by
 * the caller lets repositories find the same todo in the latest file content
 * instead of blindly editing the stale line number.
 */
export interface TodoLineReference {
  lineNumber: number;
  rawLine: string;
}

/**
 * Outbound port for TODO repository operations.
 *
 * Implemented by adapters that parse and persist todos to markdown files.
 */
export interface TodoRepositoryPort {
  // ──────────────────────────────────────────────────────────────────────────
  // Read Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get all todos from all tracked files.
   * @returns Array of all todos
   */
  getAll(): Promise<Result<Todo[], Error>>;

  /**
   * Get a specific todo by ID.
   * @param id - Todo ID (filepath:lineNumber format)
   * @returns Todo if found, null otherwise
   */
  getById(id: TodoId): Promise<Result<Todo | null, Error>>;

  /**
   * Get all todos from a specific file.
   * @param filePath - Path to the markdown file
   * @returns Array of todos from the file
   */
  getByFile(filePath: string): Promise<Result<Todo[], Error>>;

  /**
   * Query todos matching the given filter criteria.
   * @param filter - Filter criteria to apply
   * @returns Array of matching todos
   */
  query(filter: TodoFilter): Promise<Result<Todo[], Error>>;

  /**
   * Parse todos from an in-memory markdown snapshot without touching disk/cache.
   * Used for open editor documents that have unsaved todo changes.
   */
  parseSnapshot(filePath: string, content: string): Promise<Result<Todo[], Error>>;

  /**
   * List user-managed dedicated todo-list markdown files.
   * Does not include the protected TODO.md file.
   */
  getTodoLists(): Promise<Result<TodoListFile[], Error>>;

  /**
   * List markdown sections from a dedicated todo-list file.
   */
  getSections(filePath: string): Promise<Result<TodoSection[], Error>>;

  // ──────────────────────────────────────────────────────────────────────────
  // Write Operations (modifies source files)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Toggle the completion state of a todo.
   * Updates the source file with the new state.
   * @param id - Todo ID to toggle
   * @returns Updated todo
   */
  toggle(id: TodoId, expected?: TodoLineReference): Promise<Result<Todo, Error>>;

  /**
   * Update the content of a todo.
   * Updates the source file with the new content.
   * @param id - Todo ID to update
   * @param content - New content (without checkbox marker)
   * @returns Updated todo
   */
  updateContent(id: TodoId, content: string, expected?: TodoLineReference): Promise<Result<Todo, Error>>;

  /**
   * Update task content and metadata in its source file.
   * @param id - Todo ID to update
   * @param patch - Structured patch; null clears optional metadata fields
   * @returns Updated todo
   */
  updatePatch(id: TodoId, patch: TodoUpdatePatch, expected?: TodoLineReference): Promise<Result<Todo, Error>>;

  /**
   * Move a todo line before/after another todo or to the end of a section.
   */
  move(id: TodoId, target: TodoMoveTarget, expected?: TodoLineReference): Promise<Result<Todo, Error>>;

  /**
   * Delete a todo from its source file.
   * Removes the entire line from the markdown file.
   * @param id - Todo ID to delete
   */
  delete(id: TodoId, expected?: TodoLineReference): Promise<Result<void, Error>>;

  /**
   * Create a new todo.
   * Appends to the target file (defaults to TODO.md).
   * @param params - Todo creation parameters
   * @param targetFile - Optional target file (defaults to dedicated TODO file)
   * @returns Created todo with assigned ID
   */
  create(params: CreateTodoParams, targetFile?: string): Promise<Result<Todo, Error>>;

  /**
   * Create a top-level markdown section in a dedicated todo-list file.
   */
  createSection(filePath: string, title: string): Promise<Result<TodoSection, Error>>;

  /**
   * Rename a top-level markdown section in a dedicated todo-list file.
   */
  renameSection(filePath: string, fromTitle: string, toTitle: string): Promise<Result<TodoSection, Error>>;

  /**
   * Move a top-level markdown section before or after another section.
   */
  moveSection(
    filePath: string,
    fromTitle: string,
    targetTitle: string,
    position: TodoSectionMovePosition,
  ): Promise<Result<TodoSection[], Error>>;

  /**
   * Create a user-managed dedicated todo-list markdown file in the notes root.
   */
  createTodoList(params: CreateTodoListFileParams): Promise<Result<TodoListFile, Error>>;

  /**
   * Update a user-managed todo-list file's display title and/or note.
   * Renames the file to todo-{slug}.md when the title changes.
   */
  updateTodoList(path: string, patch: UpdateTodoListFileParams): Promise<Result<TodoListFile, Error>>;

  /**
   * Delete a user-managed todo-list file.
   */
  deleteTodoList(path: string): Promise<Result<void, Error>>;

  // ──────────────────────────────────────────────────────────────────────────
  // Cache Control
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Invalidate the cache for a specific file or all files.
   * Call when files are externally modified.
   * @param filePath - Optional file path to invalidate; if omitted, invalidates all
   */
  invalidate(filePath?: string): void;

  /**
   * Refresh all todos by re-scanning files.
   * Clears cache and re-parses all tracked files.
   */
  refresh(): Promise<Result<void, Error>>;
}
