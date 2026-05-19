/**
 * TodoService - Inbound port for TODO management
 *
 * This service defines the public API for TODO operations. It orchestrates
 * reading, filtering, creating, updating, and deleting todos from markdown
 * files. The service maintains a reactive subscription model for UI updates.
 *
 * Features:
 * - Initialize and scan notes directory for todos
 * - Filter and query todos by various criteria
 * - CRUD operations that persist to markdown files
 * - Statistics computation
 * - Reactive subscriptions for UI updates
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';
import type { Todo, TodoUpdatePatch } from '$lib/domain/entities/Todo';
import type { TodoId } from '$lib/domain/values/TodoId';
import type { TodoFilter } from '$lib/domain/values/TodoFilter';
import type { TodoSource } from '$lib/domain/values/TodoSource';
import type { TodoPriority } from '$lib/domain/values/TodoPriority';
import type { TodoList } from '$lib/domain/values/TodoView';
import type {
  TodoListFile,
  CreateTodoListFileParams,
  UpdateTodoListFileParams,
} from '$lib/domain/values/TodoListFile';

/**
 * Options for creating a new todo.
 */
export interface CreateTodoOptions {
  /** Due date for the todo */
  dueDate?: Date;
  /** Scheduled date (when to start working on it) */
  scheduledDate?: Date;
  /** Recurrence pattern (e.g. every week) */
  recurrence?: string;
  /** Priority level */
  priority?: TodoPriority;
  /** Tags to attach */
  tags?: string[];
  /** Target file path (defaults to dedicated TODO file) */
  targetFile?: string;
  /** Dedicated TODO.md section/list target */
  targetList?: TodoList;
}

/**
 * Statistics about todos.
 */
export interface TodoStats {
  /** Total number of todos */
  total: number;
  /** Number of open (incomplete) todos */
  open: number;
  /** Number of completed todos */
  completed: number;
  /** Number of overdue todos */
  overdue: number;
  /** Number of todos due today */
  dueToday: number;
}

export type { TodoUpdatePatch };
export type { TodoListFile, CreateTodoListFileParams, UpdateTodoListFileParams };

/**
 * Callback for todo list updates.
 */
export type TodoSubscriptionCallback = (todos: Todo[]) => void;

/**
 * Callback for user-managed todo-list file updates.
 */
export type TodoListSubscriptionCallback = (lists: TodoListFile[]) => void;

/**
 * Unsubscribe function returned by subscribe().
 */
export type Unsubscribe = () => void;

/**
 * Inbound port for TODO operations.
 *
 * Primary adapters (UI components, stores) use this interface to interact
 * with the TODO system.
 */
export interface TodoService {
  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the todo service.
   * Scans the notes directory and loads all todos.
   * Sets up file watching for automatic updates.
   */
  initialize(): Promise<Result<void, Error>>;

  /**
   * Shutdown the todo service.
   * Stops file watching and clears state.
   */
  shutdown(): void;

  // ──────────────────────────────────────────────────────────────────────────
  // Read Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get all todos, optionally filtered.
   * @param filter - Optional filter criteria
   * @returns Array of todos (filtered if criteria provided)
   */
  getAll(filter?: TodoFilter): Promise<Result<Todo[], Error>>;

  /**
   * Get a specific todo by ID.
   * @param id - Todo ID (filepath:lineNumber format)
   * @returns Todo if found, null otherwise
   */
  getById(id: TodoId): Promise<Result<Todo | null, Error>>;

  /**
   * Get todos from a specific source type.
   * @param source - Source type ('dedicated' or 'inline')
   * @returns Array of todos from that source
   */
  getBySource(source: TodoSource): Promise<Result<Todo[], Error>>;

  /**
   * Get user-managed dedicated todo-list files.
   * The protected TODO.md file is intentionally omitted.
   */
  getTodoLists(): Promise<Result<TodoListFile[], Error>>;

  // ──────────────────────────────────────────────────────────────────────────
  // Write Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Toggle the completion state of a todo.
   * @param id - Todo ID to toggle
   * @returns Updated todo
   */
  toggle(id: TodoId): Promise<Result<Todo, Error>>;

  /**
   * Toggle a todo from an editor-originated change.
   * Persists to file and notifies subscribers, but does NOT
   * sync back to the editor (it already has the correct state).
   * @param blockId - Block ID from the editor (for tiebreaking duplicates)
   * @param content - Text content of the todo
   * @param checked - New checked state
   * @param filePath - Path to the file containing the todo
   */
  toggleFromEditor(blockId: string, content: string, checked: boolean, filePath: string): Promise<Result<void, Error>>;

  /**
   * Create a new todo.
   * @param content - Todo text content
   * @param options - Optional creation parameters
   * @returns Created todo with assigned ID
   */
  create(content: string, options?: CreateTodoOptions): Promise<Result<Todo, Error>>;

  /**
   * Create a new user-managed dedicated todo-list markdown file.
   */
  createTodoList(params: CreateTodoListFileParams): Promise<Result<TodoListFile, Error>>;

  /**
   * Rename and/or update the note attached to a user-managed todo-list file.
   */
  updateTodoList(path: string, patch: UpdateTodoListFileParams): Promise<Result<TodoListFile, Error>>;

  /**
   * Delete a user-managed todo-list file and all tasks stored in it.
   */
  deleteTodoList(path: string): Promise<Result<void, Error>>;

  /**
   * Create a todo from a Todoist-style natural language capture string.
   * Parses date, priority, tags, recurrence, and optional list target while
   * preserving markdown as the source of truth.
   */
  quickCreate(input: string, defaults?: CreateTodoOptions): Promise<Result<Todo, Error>>;

  /**
   * Update the content of an existing todo.
   * @param id - Todo ID to update
   * @param content - New content text
   * @returns Updated todo
   */
  update(id: TodoId, content: string): Promise<Result<Todo, Error>>;

  /**
   * Update task content and/or metadata in one markdown-preserving operation.
   * @param id - Todo ID to update
   * @param patch - Structured patch; null clears optional metadata fields
   * @returns Updated todo
   */
  updatePatch(id: TodoId, patch: TodoUpdatePatch): Promise<Result<Todo, Error>>;

  /**
   * Delete a todo.
   * @param id - Todo ID to delete
   */
  delete(id: TodoId): Promise<Result<void, Error>>;

  // ──────────────────────────────────────────────────────────────────────────
  // File Management
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Ensure the dedicated TODO file exists.
   * Creates TODO.md at the notes root if it doesn't exist.
   * @returns Path to the TODO file
   */
  ensureTodoFile(): Promise<Result<string, Error>>;

  /**
   * Sync an unsaved editor markdown snapshot for one file.
   * Makes inline note todos visible before autosave/file watching runs.
   */
  syncFileSnapshot(filePath: string, markdown: string): Promise<Result<void, Error>>;

  /**
   * Clear a live editor snapshot after save, close, or external reload.
   */
  clearFileSnapshot(filePath: string): Promise<Result<void, Error>>;

  /**
   * Sync a saved markdown file into the task index.
   * Accepts either an absolute file path or a note-relative path.
   */
  syncSavedFile(filePath: string): Promise<Result<void, Error>>;

  // ──────────────────────────────────────────────────────────────────────────
  // Statistics
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get statistics about all todos.
   * @returns Todo statistics object
   */
  getStats(): Promise<TodoStats>;

  // ──────────────────────────────────────────────────────────────────────────
  // Subscriptions
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to todo list updates.
   * Callback is called whenever the todo list changes.
   * @param callback - Function to call with updated todo list
   * @returns Unsubscribe function
   */
  subscribe(callback: TodoSubscriptionCallback): Unsubscribe;

  /**
   * Subscribe to user-managed todo-list file updates.
   */
  subscribeTodoLists(callback: TodoListSubscriptionCallback): Unsubscribe;
}
