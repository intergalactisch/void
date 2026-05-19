/**
 * TodoServiceImpl - Application service for TODO management
 *
 * Implements the TodoService inbound port to provide TODO operations.
 * Orchestrates the repository, file watcher, and file system ports
 * to manage todos stored in markdown files.
 *
 * Features:
 * - Initialize with file watching for automatic updates
 * - CRUD operations that persist to markdown files
 * - Filtering and querying
 * - Statistics computation
 * - Reactive subscriptions for UI updates
 *
 * Part of Hexagonal Architecture application layer.
 */

import type { Result } from '$lib/core';
import { ok, err, toError } from '$lib/core';
import type { Todo, CreateTodoParams, TodoUpdatePatch } from '$lib/domain/entities/Todo';
import { applyTodoPatch, toggleTodo } from '$lib/domain/entities/Todo';
import type { TodoId } from '$lib/domain/values/TodoId';
import { parseTodoId } from '$lib/domain/values/TodoId';
import type { TodoFilter } from '$lib/domain/values/TodoFilter';
import { filterTodos } from '$lib/domain/values/TodoFilter';
import type { TodoSource } from '$lib/domain/values/TodoSource';
import { TODO_FILENAME, getDefaultTodoFilePath } from '$lib/domain/values/TodoConstants';
import {
  isTodoListMarkdown,
  type TodoListFile,
  type CreateTodoListFileParams,
  type UpdateTodoListFileParams,
} from '$lib/domain/values/TodoListFile';
import { DATE_MARKERS, formatCompletedAt, formatCreatedAt, formatDateOnly } from '$lib/domain/values/TodoDateMeta';
import type { TodoList } from '$lib/domain/values/TodoView';
import { parseQuickTodoInput } from './TodoQuickAddParser';
import type {
  TodoService,
  CreateTodoOptions,
  TodoStats,
  TodoSubscriptionCallback,
  TodoListSubscriptionCallback,
  Unsubscribe,
} from '$lib/ports/inbound/TodoService';
import type { TodoLineReference, TodoRepositoryPort } from '$lib/ports/outbound/TodoRepositoryPort';
import type { TodoWatcherPort } from '$lib/ports/outbound/TodoWatcherPort';
import type { FileSystemPort } from '$lib/ports/outbound/FileSystemPort';
import { events } from '$lib/events';
import { resourceLock } from '$lib/events/queue/ResourceLock';

/**
 * Default content for a new TODO.md file.
 */
const DEFAULT_TODO_FILE_CONTENT = `# TODO

## Inbox

## Anytime

## Someday

`;

/**
 * TodoServiceImpl configuration options.
 */
export interface TodoServiceConfig {
  /** Root path to the notes directory */
  notesPath: string;
}

/**
 * TodoServiceImpl implementation of TodoService.
 *
 * Orchestrates TODO operations using repository, watcher, and file system ports.
 */
export class TodoServiceImpl implements TodoService {
  private readonly repository: TodoRepositoryPort;
  private readonly watcher: TodoWatcherPort;
  private readonly fileSystem: FileSystemPort;
  private readonly notesPath: string;

  /** Subscription callbacks for todo updates */
  private subscribers: Set<TodoSubscriptionCallback> = new Set();
  private listSubscribers: Set<TodoListSubscriptionCallback> = new Set();

  /** Watcher unsubscribe functions */
  private watcherUnsubscribes: Unsubscribe[] = [];

  /** Initialized flag */
  private initialized = false;

  /** Paths recently written by this service -- watcher should ignore these */
  private recentWrites = new Set<string>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Unsaved editor snapshots keyed by absolute source file path */
  private liveSnapshots = new Map<string, Todo[]>();

  constructor(
    repository: TodoRepositoryPort,
    watcher: TodoWatcherPort,
    fileSystem: FileSystemPort,
    config: TodoServiceConfig
  ) {
    this.repository = repository;
    this.watcher = watcher;
    this.fileSystem = fileSystem;
    this.notesPath = config.notesPath;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the todo service.
   * Sets up file watching and does initial scan.
   */
  async initialize(): Promise<Result<void, Error>> {
    if (this.initialized) {
      return ok(undefined);
    }

    try {
      // Start file watcher
      await this.watcher.watch(this.notesPath);

      // Register change handlers to invalidate cache
      const changeUnsub = this.watcher.onFileChange((filePath) => {
        this.handleFileChange(filePath);
      });
      this.watcherUnsubscribes.push(changeUnsub);

      const createUnsub = this.watcher.onFileCreate((filePath) => {
        this.handleFileCreate(filePath);
      });
      this.watcherUnsubscribes.push(createUnsub);

      const deleteUnsub = this.watcher.onFileDelete((filePath) => {
        this.handleFileDelete(filePath);
      });
      this.watcherUnsubscribes.push(deleteUnsub);

      // Do initial scan
      const scanResult = await this.repository.getAll();
      if (!scanResult.ok) {
        // Log but don't fail - watcher is still running
        console.warn('[TodoService] Initial scan failed:', scanResult.error);
      }

      this.initialized = true;
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Shutdown the todo service.
   * Stops file watching and clears state.
   */
  shutdown(): void {
    // Unsubscribe from watcher events
    for (const unsub of this.watcherUnsubscribes) {
      unsub();
    }
    this.watcherUnsubscribes = [];

    // Stop watcher
    this.watcher.stop();

    // Clear subscribers
    this.subscribers.clear();
    this.listSubscribers.clear();
    this.liveSnapshots.clear();
    for (const timer of this.writeTimers.values()) {
      clearTimeout(timer);
    }
    this.writeTimers.clear();
    this.recentWrites.clear();

    this.initialized = false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get all todos, optionally filtered.
   */
  async getAll(filter?: TodoFilter): Promise<Result<Todo[], Error>> {
    if (this.liveSnapshots.size > 0) {
      const merged = await this.getMergedTodos();
      if (!merged.ok) return merged;
      if (filter) {
        return ok(filterTodos(merged.value, filter));
      }
      return merged;
    }

    if (filter) {
      return this.repository.query(filter);
    }
    return this.repository.getAll();
  }

  /**
   * Get a specific todo by ID.
   */
  async getById(id: TodoId): Promise<Result<Todo | null, Error>> {
    const snapshotTodo = this.getSnapshotTodo(id);
    if (snapshotTodo) {
      return ok(snapshotTodo);
    }
    return this.repository.getById(id);
  }

  /**
   * Get todos from a specific source type.
   */
  async getBySource(source: TodoSource): Promise<Result<Todo[], Error>> {
    const allResult = await this.getMergedTodos();
    if (!allResult.ok) {
      return allResult;
    }

    const filtered = allResult.value.filter((todo) => todo.source === source);
    return ok(filtered);
  }

  /**
   * Get user-managed todo-list files.
   */
  async getTodoLists(): Promise<Result<TodoListFile[], Error>> {
    return this.repository.getTodoLists();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Write Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Toggle the completion state of a todo.
   */
  async toggle(id: TodoId): Promise<Result<Todo, Error>> {
    const { filePath } = parseTodoId(id);
    return resourceLock.withLock(this.todoItemLockKey(id), async () => {
      const snapshotTodo = this.getSnapshotTodo(id);
      if (snapshotTodo) {
        const rawContent = extractRawTodoContent(snapshotTodo.rawLine);
        const nextTodo = toggleTodo(snapshotTodo);
        const toggled = {
          ...nextTodo,
          rawLine: withUpdatedRawTodoContent(snapshotTodo.rawLine, buildTodoText(nextTodo)),
        };
        this.replaceSnapshotTodo(id, toggled);
        events.emit('todo:sync-to-editor', {
          filePath,
          content: rawContent,
          checked: toggled.isCompleted,
        });
        this.emitTodoToggled(toggled);
        await this.notifySubscribers();
        return ok(toggled);
      }

      // Optimistically emit event BEFORE file I/O so the editor checkbox flips instantly.
      const lookupResult = await this.repository.getById(id);
      const expected = lookupResult.ok && lookupResult.value
        ? toTodoLineReference(lookupResult.value)
        : undefined;
      if (lookupResult.ok && lookupResult.value) {
        // Use raw content (with metadata markers) so it matches ProseMirror's textContent
        const rawContent = extractRawTodoContent(lookupResult.value.rawLine);
        events.emit('todo:sync-to-editor', {
          filePath,
          content: rawContent,
          checked: !lookupResult.value.isCompleted,
        });
      }

      // Persist to file (slow I/O)
      const result = await resourceLock.withLock(this.todoSaveLockKey(filePath), () => {
        this.markWrite(filePath);
        return this.repository.toggle(id, expected);
      });

      if (result.ok) {
        this.emitTodoToggled(result.value);
        if (result.value.isCompleted && result.value.dates.recurrence) {
          await this.createNextRecurringTodo(result.value);
        }
        await this.notifySubscribersForFile(filePath);
      }

      return result;
    });
  }

  /**
   * Toggle a todo from an editor-originated change.
   * Persists to file and notifies subscribers, but does NOT sync back to editor
   * (the editor already has the correct state).
   */
  async toggleFromEditor(blockId: string, content: string, checked: boolean, filePath: string): Promise<Result<void, Error>> {
    try {
      const result = await resourceLock.withLock(
        this.todoSaveLockKey(filePath),
        async (): Promise<Result<Todo | null, Error>> => {
          // Find the todo by content match in the given file
          const fileResult = await this.repository.getByFile(filePath);
          if (!fileResult.ok) {
            return err(fileResult.error);
          }

          const trimmedContent = content.trim();
          const todos = fileResult.value.filter((t) => {
            // Match by cleaned content (for simple todos without metadata)
            if (t.content.trim() === trimmedContent) return true;
            // Match by raw line content (for todos with metadata markers like dates/tags).
            // ProseMirror textContent includes the metadata text, but todo.content has it stripped.
            const rawContent = extractRawTodoContent(t.rawLine);
            if (rawContent === trimmedContent) return true;
            return false;
          });

          const todo = todos.length > 0 ? todos[0] : undefined;
          if (!todo) {
            return ok(null); // No matching todo found, ignore silently
          }

          // Only toggle if state actually differs
          if (todo.isCompleted === checked) {
            return ok(null);
          }

          // Mark this file so the watcher skips our own write
          this.markWrite(filePath);

          return await this.repository.toggle(todo.id, toTodoLineReference(todo));
        },
      );

      if (!result.ok) {
        return result;
      }
      if (!result.value) {
        return ok(undefined);
      }

      // Emit event + notify subscribers (skip editor sync, only rescan changed file)
      this.emitTodoToggled(result.value);
      if (result.value.isCompleted && result.value.dates.recurrence) {
        await this.createNextRecurringTodo(result.value);
      }
      await this.notifySubscribersForFile(filePath);

      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Create a new todo.
   */
  async create(content: string, options?: CreateTodoOptions): Promise<Result<Todo, Error>> {
    // Determine target file
    const targetFile = options?.targetFile ?? this.getDefaultTodoFilePathInternal();
    return resourceLock.withLock(this.todoCreateLockKey(targetFile), async () => {
      // Ensure file exists
      const ensureResult = await resourceLock.withLock(this.todoSaveLockKey(targetFile), () =>
        this.ensureTodoFileExists(targetFile),
      );
      if (!ensureResult.ok) {
        return ensureResult;
      }

      const isDedicated = await this.isDedicatedTodoFile(targetFile);

      // Build creation params
      const params: CreateTodoParams = {
        content,
        isCompleted: false,
        source: isDedicated ? 'dedicated' : 'inline',
        sourceFile: targetFile,
        lineNumber: 0, // Will be set by repository
        rawLine: '', // Will be set by repository
      };

      if (options?.targetList !== undefined && isDedicated) {
        params.list = options.targetList;
        params.section = getSectionForList(options.targetList);
      }

      // Add optional params (exactOptionalPropertyTypes compliance)
      if (options?.priority !== undefined) {
        params.priority = options.priority;
      }
      if (options?.tags !== undefined) {
        params.tags = options.tags;
      }
      // Always set createdAt for new todos
      params.dates = { createdAt: new Date() };
      if (options?.dueDate !== undefined) {
        params.dates.dueDate = options.dueDate;
      }
      if (options?.scheduledDate !== undefined) {
        params.dates.scheduledDate = options.scheduledDate;
      }
      if (options?.recurrence !== undefined) {
        params.dates.recurrence = options.recurrence;
      }

      const result = await resourceLock.withLock(this.todoSaveLockKey(targetFile), () => {
        this.markWrite(targetFile);
        return this.repository.create(params, targetFile);
      });

      if (result.ok) {
        this.emitTodoCreated(result.value);
        await this.notifySubscribersForFile(targetFile);
      }

      return result;
    });
  }

  /**
   * Create a new todo using Todoist-style natural language capture.
   */
  async quickCreate(input: string, defaults?: CreateTodoOptions): Promise<Result<Todo, Error>> {
    const parsed = parseQuickTodoInput(input, defaults);
    if (!parsed.ok) return parsed;
    return await this.create(parsed.value.content, parsed.value.options);
  }

  /**
   * Create a new user-managed todo-list file.
   */
  async createTodoList(params: CreateTodoListFileParams): Promise<Result<TodoListFile, Error>> {
    const result = await resourceLock.withLock(this.todoListCatalogLockKey(), async () => {
      const created = await this.repository.createTodoList(params);
      if (created.ok) this.markWrite(created.value.path);
      return created;
    });

    if (result.ok) {
      await this.notifyTodoListSubscribers();
      await this.notifySubscribers();
    }

    return result;
  }

  /**
   * Update a user-managed todo-list file.
   */
  async updateTodoList(path: string, patch: UpdateTodoListFileParams): Promise<Result<TodoListFile, Error>> {
    const result = await resourceLock.withLock(this.todoListCatalogLockKey(), async () => {
      this.markWrite(path);
      const updated = await this.repository.updateTodoList(path, patch);
      if (updated.ok) this.markWrite(updated.value.path);
      return updated;
    });

    if (result.ok) {
      this.repository.invalidate(path);
      this.repository.invalidate(result.value.path);
      this.liveSnapshots.delete(this.normalizePath(path));
      this.liveSnapshots.delete(this.normalizePath(result.value.path));
      await this.notifyTodoListSubscribers();
      await this.notifySubscribers();
    }

    return result;
  }

  /**
   * Delete a user-managed todo-list file.
   */
  async deleteTodoList(path: string): Promise<Result<void, Error>> {
    const result = await resourceLock.withLock(this.todoListCatalogLockKey(), async () => {
      this.markWrite(path);
      return this.repository.deleteTodoList(path);
    });

    if (result.ok) {
      this.repository.invalidate(path);
      this.liveSnapshots.delete(this.normalizePath(path));
      await this.notifyTodoListSubscribers();
      await this.notifySubscribers();
    }

    return result;
  }

  /**
   * Update the content of an existing todo.
   */
  async update(id: TodoId, content: string): Promise<Result<Todo, Error>> {
    const { filePath } = parseTodoId(id);
    return resourceLock.withLock(this.todoItemLockKey(id), async () => {
      const snapshotTodo = this.getSnapshotTodo(id);
      if (snapshotTodo) {
        return this.updateSnapshotTodo(id, snapshotTodo, { content });
      }

      const before = await this.repository.getById(id);
      const expected = before.ok && before.value ? toTodoLineReference(before.value) : undefined;
      const previousRawContent =
        before.ok && before.value ? extractRawTodoContent(before.value.rawLine) : undefined;
      const result = await resourceLock.withLock(this.todoSaveLockKey(filePath), () => {
        this.markWrite(filePath);
        return this.repository.updateContent(id, content, expected);
      });

      if (result.ok) {
        this.emitTodoUpdated(result.value);
        this.emitTodoContentSync(
          filePath,
          id,
          result.value,
          extractRawTodoContent(result.value.rawLine),
          previousRawContent,
        );
        await this.notifySubscribersForFile(filePath);
      }

      return result;
    });
  }

  /**
   * Update content and metadata of an existing todo.
   */
  async updatePatch(id: TodoId, patch: TodoUpdatePatch): Promise<Result<Todo, Error>> {
    const { filePath } = parseTodoId(id);
    return resourceLock.withLock(this.todoItemLockKey(id), async () => {
      const snapshotTodo = this.getSnapshotTodo(id);
      if (snapshotTodo) {
        return this.updateSnapshotTodo(id, snapshotTodo, patch);
      }

      const before = await this.repository.getById(id);
      const expected = before.ok && before.value ? toTodoLineReference(before.value) : undefined;
      const previousRawContent =
        before.ok && before.value ? extractRawTodoContent(before.value.rawLine) : undefined;

      const result = await resourceLock.withLock(this.todoSaveLockKey(filePath), () => {
        this.markWrite(filePath);
        return this.repository.updatePatch(id, patch, expected);
      });

      if (result.ok) {
        this.emitTodoUpdated(result.value);
        this.emitTodoContentSync(
          filePath,
          id,
          result.value,
          extractRawTodoContent(result.value.rawLine),
          previousRawContent,
        );
        await this.notifySubscribersForFile(filePath);
      }

      return result;
    });
  }

  /**
   * Delete a todo.
   */
  async delete(id: TodoId): Promise<Result<void, Error>> {
    const { filePath } = parseTodoId(id);
    return resourceLock.withLock(this.todoItemLockKey(id), async () => {
      const snapshotTodo = this.getSnapshotTodo(id);
      if (snapshotTodo) {
        const previousRawContent = extractRawTodoContent(snapshotTodo.rawLine);
        this.removeSnapshotTodo(id);
        const payload: { filePath: string; id: string; content?: string } = { filePath, id };
        if (previousRawContent) payload.content = previousRawContent;
        this.emitTodoDeleted(id);
        events.emit('todo:delete-from-editor', payload);
        await this.notifySubscribers();
        return ok(undefined);
      }

      const before = await this.repository.getById(id);
      const expected = before.ok && before.value ? toTodoLineReference(before.value) : undefined;
      const previousRawContent =
        before.ok && before.value ? extractRawTodoContent(before.value.rawLine) : undefined;
      const result = await resourceLock.withLock(this.todoSaveLockKey(filePath), () => {
        this.markWrite(filePath);
        return this.repository.delete(id, expected);
      });

      if (result.ok) {
        this.emitTodoDeleted(id);
        const payload: { filePath: string; id: string; content?: string } = { filePath, id };
        if (previousRawContent !== undefined) {
          payload.content = previousRawContent;
        }
        events.emit('todo:delete-from-editor', payload);
        await this.notifySubscribersForFile(filePath);
      }

      return result;
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // File Management
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Ensure the dedicated TODO file exists.
   */
  async ensureTodoFile(): Promise<Result<string, Error>> {
    const filePath = this.getDefaultTodoFilePathInternal();
    return resourceLock.withLock(this.todoCreateLockKey(filePath), async () => {
      const result = await resourceLock.withLock(this.todoSaveLockKey(filePath), () =>
        this.ensureTodoFileExists(filePath),
      );
      if (!result.ok) {
        return result;
      }
      return ok(filePath);
    });
  }

  /**
   * Sync an open editor markdown snapshot into the task index.
   */
  async syncFileSnapshot(filePath: string, markdown: string): Promise<Result<void, Error>> {
    const normalized = this.normalizePath(filePath);
    return resourceLock.withLock(this.todoFileLockKey(normalized), async () => {
      const parsed = await this.repository.parseSnapshot(normalized, markdown);
      if (!parsed.ok) return parsed;

      this.liveSnapshots.set(normalized, parsed.value);
      events.emit('todo:file-changed', { path: normalized });
      await this.notifySubscribers();
      return ok(undefined);
    });
  }

  /**
   * Clear a previously synced live snapshot.
   */
  async clearFileSnapshot(filePath: string): Promise<Result<void, Error>> {
    const normalized = this.normalizePath(filePath);
    return resourceLock.withLock(this.todoFileLockKey(normalized), async () => {
      if (!this.liveSnapshots.delete(normalized)) {
        return ok(undefined);
      }

      events.emit('todo:file-changed', { path: normalized });
      await this.notifySubscribers();
      return ok(undefined);
    });
  }

  /**
   * Sync a saved markdown file into the task index.
   */
  async syncSavedFile(filePath: string): Promise<Result<void, Error>> {
    try {
      const normalized = this.normalizeSavedFilePath(filePath);
      return await resourceLock.withLock(this.todoFileLockKey(normalized), async () => {
        this.repository.invalidate(normalized);
        this.liveSnapshots.delete(normalized);
        events.emit('todo:file-changed', { path: normalized });
        await this.notifySubscribers();
        return ok(undefined);
      });
    } catch (e) {
      return err(toError(e));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Statistics
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get statistics about all todos.
   */
  async getStats(): Promise<TodoStats> {
    const allResult = await this.getMergedTodos();

    if (!allResult.ok) {
      return {
        total: 0,
        open: 0,
        completed: 0,
        overdue: 0,
        dueToday: 0,
      };
    }

    const todos = allResult.value;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    let open = 0;
    let completed = 0;
    let overdue = 0;
    let dueToday = 0;

    for (const todo of todos) {
      if (todo.isCompleted) {
        completed++;
      } else {
        open++;

        if (todo.dates.dueDate) {
          const dueDate = todo.dates.dueDate;
          if (dueDate < today) {
            overdue++;
          } else if (dueDate >= today && dueDate < tomorrow) {
            dueToday++;
          }
        }
      }
    }

    return {
      total: todos.length,
      open,
      completed,
      overdue,
      dueToday,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Subscriptions
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to todo list updates.
   */
  subscribe(callback: TodoSubscriptionCallback): Unsubscribe {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Subscribe to user-managed todo-list file updates.
   */
  subscribeTodoLists(callback: TodoListSubscriptionCallback): Unsubscribe {
    this.listSubscribers.add(callback);
    this.repository.getTodoLists().then((result) => {
      if (result.ok && this.listSubscribers.has(callback)) {
        callback(result.value);
      }
    }).catch((error) => {
      console.error('[TodoService] Failed to load todo lists for subscriber:', error);
    });
    return () => {
      this.listSubscribers.delete(callback);
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Mark a file as recently written, so the watcher ignores our own writes.
   *
   * Emits `editor:self-write` so EditorService can stamp its grace window
   * for any open session on this path. Without this, an editor with the
   * file open would treat our write as an external modification and raise
   * a spurious conflict banner. Emit MUST be synchronous and BEFORE the
   * disk write begins — see types.ts for the contract.
   */
  private markWrite(filePath: string): void {
    this.recentWrites.add(filePath);
    const existing = this.writeTimers.get(filePath);
    if (existing) clearTimeout(existing);
    this.writeTimers.set(filePath, setTimeout(() => {
      this.recentWrites.delete(filePath);
      this.writeTimers.delete(filePath);
    }, 500));

    events.emit('editor:self-write', { path: filePath });
  }

  /**
   * Handle file change event from watcher.
   */
  private handleFileChange(filePath: string): void {
    if (this.recentWrites.has(filePath)) return;

    this.liveSnapshots.delete(this.normalizePath(filePath));
    this.repository.invalidate(filePath);
    events.emit('todo:file-changed', { path: filePath });
    this.notifySubscribers().catch((error) => {
      console.error('[TodoService] Error notifying subscribers:', error);
    });
    this.notifyTodoListSubscribers().catch((error) => {
      console.error('[TodoService] Error notifying todo list subscribers:', error);
    });
  }

  /**
   * Handle file create event from watcher.
   */
  private handleFileCreate(filePath: string): void {
    if (this.recentWrites.has(filePath)) return;

    this.liveSnapshots.delete(this.normalizePath(filePath));
    this.repository.invalidate(filePath);
    events.emit('todo:file-created', { path: filePath });
    this.notifySubscribers().catch((error) => {
      console.error('[TodoService] Error notifying subscribers:', error);
    });
    this.notifyTodoListSubscribers().catch((error) => {
      console.error('[TodoService] Error notifying todo list subscribers:', error);
    });
  }

  /**
   * Handle file delete event from watcher.
   */
  private handleFileDelete(filePath: string): void {
    if (this.recentWrites.has(filePath)) return;

    this.liveSnapshots.delete(this.normalizePath(filePath));
    this.repository.invalidate(filePath);
    events.emit('todo:file-deleted', { path: filePath });
    this.notifySubscribers().catch((error) => {
      console.error('[TodoService] Error notifying subscribers:', error);
    });
    this.notifyTodoListSubscribers().catch((error) => {
      console.error('[TodoService] Error notifying todo list subscribers:', error);
    });
  }

  /**
   * Notify all subscribers with current todo list.
   */
  private async notifySubscribers(): Promise<void> {
    if (this.subscribers.size === 0) {
      return;
    }

    const todosResult = await this.getMergedTodos();
    if (!todosResult.ok) {
      console.error('[TodoService] Failed to get todos for subscribers:', todosResult.error);
      return;
    }

    for (const callback of this.subscribers) {
      try {
        callback(todosResult.value);
      } catch (error) {
        console.error('[TodoService] Subscriber callback error:', error);
      }
    }
  }

  private async notifyTodoListSubscribers(): Promise<void> {
    if (this.listSubscribers.size === 0) {
      return;
    }

    const listsResult = await this.repository.getTodoLists();
    if (!listsResult.ok) {
      console.error('[TodoService] Failed to get todo lists for subscribers:', listsResult.error);
      return;
    }

    for (const callback of this.listSubscribers) {
      try {
        callback(listsResult.value);
      } catch (error) {
        console.error('[TodoService] Todo list subscriber callback error:', error);
      }
    }
  }

  /**
   * Notify subscribers after a change to a specific file.
   * Invalidates only that file's cache, so getAll() serves
   * all other files from memory and only re-parses the changed one.
   */
  private async notifySubscribersForFile(filePath: string): Promise<void> {
    this.repository.invalidate(filePath);
    this.liveSnapshots.delete(this.normalizePath(filePath));
    await this.notifySubscribers();
  }

  /**
   * Merge disk-backed todos with unsaved editor snapshots.
   * A snapshot replaces disk todos for the same source file.
   */
  private async getMergedTodos(): Promise<Result<Todo[], Error>> {
    const diskResult = await this.repository.getAll();
    if (!diskResult.ok) return diskResult;

    if (this.liveSnapshots.size === 0) {
      return diskResult;
    }

    const snapshotPaths = new Set(this.liveSnapshots.keys());
    const diskTodos = diskResult.value.filter(
      (todo) => !snapshotPaths.has(this.normalizePath(todo.sourceFile)),
    );
    const snapshotTodos = Array.from(this.liveSnapshots.values()).flat();

    return ok([...diskTodos, ...snapshotTodos]);
  }

  /**
   * Get the default TODO file path.
   */
  private getDefaultTodoFilePathInternal(): string {
    return getDefaultTodoFilePath(this.notesPath);
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  private todoFileLockKey(filePath: string): string {
    return `todo:file:${this.normalizePath(filePath)}`;
  }

  private todoItemLockKey(id: TodoId): string {
    const { filePath, lineNumber } = parseTodoId(id);
    return `todo:item:${this.normalizePath(filePath)}:${lineNumber}`;
  }

  private todoCreateLockKey(filePath: string): string {
    return `todo:create:${this.normalizePath(filePath)}`;
  }

  private todoSaveLockKey(filePath: string): string {
    return `todo:save:${this.normalizePath(filePath)}`;
  }

  private todoListCatalogLockKey(): string {
    return `todo:list-catalog:${this.normalizePath(this.notesPath)}`;
  }

  private normalizeSavedFilePath(filePath: string): string {
    const normalized = this.normalizePath(filePath);
    if (!normalized.trim()) {
      throw new Error('Cannot sync an empty file path');
    }
    if (normalized.startsWith('/')) {
      return normalized;
    }
    return `${this.normalizePath(this.notesPath).replace(/\/$/, '')}/${normalized.replace(/^\//, '')}`;
  }

  private getSnapshotTodo(id: TodoId): Todo | null {
    const { filePath, lineNumber } = parseTodoId(id);
    const todos = this.liveSnapshots.get(this.normalizePath(filePath));
    return todos?.find((todo) => todo.lineNumber === lineNumber) ?? null;
  }

  private replaceSnapshotTodo(id: TodoId, updated: Todo): void {
    const { filePath, lineNumber } = parseTodoId(id);
    const normalized = this.normalizePath(filePath);
    const todos = this.liveSnapshots.get(normalized);
    if (!todos) return;
    this.liveSnapshots.set(
      normalized,
      todos.map((todo) => (todo.lineNumber === lineNumber ? updated : todo)),
    );
  }

  private removeSnapshotTodo(id: TodoId): void {
    const { filePath, lineNumber } = parseTodoId(id);
    const normalized = this.normalizePath(filePath);
    const todos = this.liveSnapshots.get(normalized);
    if (!todos) return;
    this.liveSnapshots.set(
      normalized,
      todos.filter((todo) => todo.lineNumber !== lineNumber),
    );
  }

  private async updateSnapshotTodo(
    id: TodoId,
    todo: Todo,
    patch: TodoUpdatePatch,
  ): Promise<Result<Todo, Error>> {
    const { filePath } = parseTodoId(id);
    const previousContent = extractRawTodoContent(todo.rawLine);
    const updated = applyTodoPatch(todo, patch);
    const nextContent = buildTodoText(updated);
    const updatedWithRawLine = {
      ...updated,
      rawLine: withUpdatedRawTodoContent(todo.rawLine, nextContent),
    };

    this.replaceSnapshotTodo(id, updatedWithRawLine);
    this.emitTodoUpdated(updatedWithRawLine);
    this.emitTodoContentSync(filePath, id, updatedWithRawLine, nextContent, previousContent);
    await this.notifySubscribers();
    return ok(updatedWithRawLine);
  }

  /**
   * Check if a file path is the default TODO file.
   */
  private isDefaultTodoFile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const filename = normalizedPath.split('/').pop() ?? '';
    return filename.toLowerCase() === TODO_FILENAME.toLowerCase();
  }

  private async isDedicatedTodoFile(filePath: string): Promise<boolean> {
    if (this.isDefaultTodoFile(filePath)) return true;
    const contentResult = await this.fileSystem.readFile(filePath);
    if (!contentResult.ok) return false;
    return isTodoListMarkdown(contentResult.value);
  }

  /**
   * Ensure a TODO file exists, creating it if needed.
   */
  private async ensureTodoFileExists(filePath: string): Promise<Result<void, Error>> {
    const existsResult = await this.fileSystem.exists(filePath);
    if (!existsResult.ok) return existsResult;
    if (existsResult.value) {
      return ok(undefined);
    }

    // Create the file with default content
    this.markWrite(filePath);
    return this.fileSystem.writeFile(filePath, DEFAULT_TODO_FILE_CONTENT);
  }

  private async createNextRecurringTodo(completedTodo: Todo): Promise<void> {
    const recurrence = completedTodo.dates.recurrence;
    if (!recurrence) return;

    const nextDates = getNextRecurrenceDates(completedTodo, recurrence);
    if (!nextDates.dueDate && !nextDates.scheduledDate) return;

    const params: CreateTodoParams = {
      content: completedTodo.content,
      isCompleted: false,
      source: completedTodo.source,
      sourceFile: completedTodo.sourceFile,
      lineNumber: 0,
      indent: completedTodo.indent,
      dates: {
        ...nextDates,
        recurrence,
        createdAt: new Date(),
      },
      tags: completedTodo.tags,
      rawLine: '',
    };

    if (completedTodo.priority !== undefined) {
      params.priority = completedTodo.priority;
    }
    if (completedTodo.section !== undefined) {
      params.section = completedTodo.section;
    }
    if (completedTodo.list !== undefined) {
      params.list = completedTodo.list;
    }

    const result = await resourceLock.withLock(this.todoCreateLockKey(completedTodo.sourceFile), () =>
      resourceLock.withLock(this.todoSaveLockKey(completedTodo.sourceFile), () => {
        this.markWrite(completedTodo.sourceFile);
        return this.repository.create(params, completedTodo.sourceFile);
      }),
    );
    if (result.ok) {
      this.emitTodoCreated(result.value);
    } else {
      console.warn('[TodoService] Failed to create recurring todo:', result.error);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Event Emission
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Emit todo toggled event.
   */
  private emitTodoToggled(todo: Todo): void {
    events.emit('todo:toggled', { todo });
  }

  /**
   * Emit todo created event.
   */
  private emitTodoCreated(todo: Todo): void {
    events.emit('todo:created', { todo });
  }

  /**
   * Emit todo updated event.
   */
  private emitTodoUpdated(todo: Todo): void {
    events.emit('todo:updated', { todo });
  }

  private emitTodoContentSync(
    filePath: string,
    id: TodoId,
    todo: Todo,
    content: string,
    previousContent?: string,
  ): void {
    const payload: {
      filePath: string;
      id: string;
      content: string;
      previousContent?: string;
      checked: boolean;
    } = {
      filePath,
      id,
      content,
      checked: todo.isCompleted,
    };
    if (previousContent !== undefined) {
      payload.previousContent = previousContent;
    }
    events.emit('todo:update-in-editor', payload);
  }

  /**
   * Emit todo deleted event.
   */
  private emitTodoDeleted(id: TodoId): void {
    events.emit('todo:deleted', { id });
  }
}

/**
 * Extract the content portion from a raw todo line (everything after the checkbox).
 * Handles standard list markers (-, *, +), numbered lists, and bare checkboxes.
 */
function extractRawTodoContent(rawLine: string): string {
  // Standard/numbered list: "  - [ ] content" or "  1. [ ] content"
  const listMatch = rawLine.match(/^\s*(?:[-*+]|\d+[.)]\s*)\s*\[[xX ]\]\s+(.*)/);
  if (listMatch?.[1]) return listMatch[1].trim();
  // Bare checkbox: "[ ] content"
  const bareMatch = rawLine.match(/^\s*\[[xX ]\]\s+(.*)/);
  if (bareMatch?.[1]) return bareMatch[1].trim();
  return rawLine.trim();
}

function withUpdatedRawTodoContent(rawLine: string, content: string): string {
  const listMatch = rawLine.match(/^(\s*(?:[-*+]|\d+[.)]\s*)\s*\[[xX ]\]\s+)(.*)$/);
  if (listMatch?.[1]) return `${listMatch[1]}${content}`;
  const bareMatch = rawLine.match(/^(\s*\[[xX ]\]\s+)(.*)$/);
  if (bareMatch?.[1]) return `${bareMatch[1]}${content}`;
  return content;
}

function buildTodoText(todo: Todo): string {
  const parts = [todo.content];

  if (todo.priority) {
    switch (todo.priority) {
      case 'high':
        parts.push(DATE_MARKERS.HIGH_PRIORITY);
        break;
      case 'medium':
        parts.push(DATE_MARKERS.MEDIUM_PRIORITY);
        break;
      case 'low':
        parts.push(DATE_MARKERS.LOW_PRIORITY);
        break;
    }
  }

  if (todo.dates.dueDate) {
    parts.push(`${DATE_MARKERS.DUE} ${formatDate(todo.dates.dueDate)}`);
  }
  if (todo.dates.scheduledDate) {
    parts.push(`${DATE_MARKERS.SCHEDULED} ${formatDate(todo.dates.scheduledDate)}`);
  }
  if (todo.dates.recurrence) {
    parts.push(`${DATE_MARKERS.RECURRENCE} ${todo.dates.recurrence}`);
  }
  if (todo.dates.createdAt) {
    parts.push(formatCreatedAt(todo.dates.createdAt));
  }
  if (todo.isCompleted && todo.dates.completedAt) {
    parts.push(formatCompletedAt(todo.dates.completedAt));
  }

  for (const tag of todo.tags) {
    parts.push(`#${tag}`);
  }

  return parts.join(' ');
}

function formatDate(date: Date): string {
  return formatDateOnly(date);
}

function toTodoLineReference(todo: Todo): TodoLineReference {
  return {
    lineNumber: todo.lineNumber,
    rawLine: todo.rawLine,
  };
}

function getSectionForList(list: TodoList): string {
  switch (list) {
    case 'inbox':
      return 'Inbox';
    case 'anytime':
      return 'Anytime';
    case 'someday':
      return 'Someday';
  }
}

function getNextRecurrenceDates(
  todo: Todo,
  recurrence: string,
): { dueDate?: Date; scheduledDate?: Date } {
  const anchor = todo.dates.dueDate ?? todo.dates.scheduledDate ?? todo.dates.completedAt ?? new Date();
  const next = addRecurrence(anchor, recurrence);
  if (!next) return {};

  const dates: { dueDate?: Date; scheduledDate?: Date } = {};
  if (todo.dates.dueDate) {
    dates.dueDate = next;
  } else {
    dates.scheduledDate = next;
  }

  if (todo.dates.scheduledDate && todo.dates.dueDate) {
    const delta = todo.dates.dueDate.getTime() - todo.dates.scheduledDate.getTime();
    dates.scheduledDate = new Date(next.getTime() - delta);
  }

  return dates;
}

function addRecurrence(date: Date, recurrence: string): Date | null {
  const match = /^every\s+(?:(\d+)\s+)?(day|days|weekday|weekdays|week|weeks|month|months|year|years)\b/i.exec(
    recurrence.trim(),
  );
  if (!match?.[2]) return null;

  const amount = Number(match[1] ?? 1);
  const unit = match[2].toLowerCase();
  const next = new Date(date);

  if (unit === 'day' || unit === 'days' || unit === 'weekday' || unit === 'weekdays') {
    next.setDate(next.getDate() + amount);
    if (unit === 'weekday' || unit === 'weekdays') {
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
    }
    return startOfDay(next);
  }

  if (unit === 'week' || unit === 'weeks') {
    next.setDate(next.getDate() + amount * 7);
    return startOfDay(next);
  }

  if (unit === 'month' || unit === 'months') {
    next.setMonth(next.getMonth() + amount);
    return startOfDay(next);
  }

  next.setFullYear(next.getFullYear() + amount);
  return startOfDay(next);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Create a new TodoServiceImpl instance.
 */
export function createTodoService(
  repository: TodoRepositoryPort,
  watcher: TodoWatcherPort,
  fileSystem: FileSystemPort,
  config: TodoServiceConfig
): TodoService {
  return new TodoServiceImpl(repository, watcher, fileSystem, config);
}
