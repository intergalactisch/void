/**
 * MarkdownTodoRepository - Repository for TODO items in markdown files
 *
 * Implements TodoRepositoryPort to provide CRUD operations for TODOs stored
 * in markdown files. Uses the file system port for I/O, the parser port for
 * parsing, and an internal cache for performance.
 *
 * Features:
 * - Scan all markdown files for todos
 * - Cache parsed todos with hash-based invalidation
 * - Toggle, update, delete, and create todos
 * - Persist changes back to source files
 *
 * Part of the Hexagonal Architecture adapter layer.
 */

import type { FileEntry, Result } from '$lib/core';
import { ok, err, toError } from '$lib/core';
import type { Todo, CreateTodoParams, TodoUpdatePatch } from '$lib/domain/entities/Todo';
import { applyTodoPatch, createTodo, toggleTodo } from '$lib/domain/entities/Todo';
import type { TodoId } from '$lib/domain/values/TodoId';
import { parseTodoId, generateTodoId } from '$lib/domain/values/TodoId';
import type { TodoFilter } from '$lib/domain/values/TodoFilter';
import { filterTodos } from '$lib/domain/values/TodoFilter';
import { getDefaultTodoFilePath } from '$lib/domain/values/TodoConstants';
import type { TodoSource } from '$lib/domain/values/TodoSource';
import {
  createTodoListMarkdown,
  getTodoListFileName,
  isDefaultTodoFilePath,
  isTodoListMarkdown,
  parseTodoListMarkdown,
  updateTodoListMarkdown,
  validateTodoListTitle,
  type TodoListFile,
  type CreateTodoListFileParams,
  type UpdateTodoListFileParams,
} from '$lib/domain/values/TodoListFile';
import { getTodoListHeading, type TodoList } from '$lib/domain/values/TodoView';
import type { TodoLineReference, TodoRepositoryPort } from '$lib/ports/outbound/TodoRepositoryPort';
import type { FileSystemPort } from '$lib/ports/outbound/FileSystemPort';
import type { TodoParserPort } from '$lib/ports/outbound/TodoParserPort';
import { TodoCache, hashContent } from './TodoCache';
import {
  toggleCheckbox,
  addCompletionTimestamp,
  removeCompletionTimestamp,
  updateLineInContent,
  deleteLineFromContent,
  createNewTodoLine,
  type NewTodoOptions,
} from './serializer';

interface FileIndexEntry {
  size?: number;
  modifiedAt?: number;
}

interface TodoPlacement {
  content: string;
  lineNumber: number;
  section?: string;
}

/**
 * Repository configuration options.
 */
export interface MarkdownTodoRepositoryConfig {
  /** Root path to the notes directory */
  notesPath: string;
  /** Cache max age in milliseconds (default: 5 minutes) */
  cacheMaxAge?: number;
}

/**
 * MarkdownTodoRepository implementation of TodoRepositoryPort.
 *
 * Manages TODO items stored across markdown files in a notes directory.
 */
export class MarkdownTodoRepository implements TodoRepositoryPort {
  private readonly fileSystem: FileSystemPort;
  private readonly parser: TodoParserPort;
  private readonly cache: TodoCache;
  private readonly notesPath: string;
  private readonly fileIndex = new Map<string, FileIndexEntry>();

  constructor(
    fileSystem: FileSystemPort,
    parser: TodoParserPort,
    config: MarkdownTodoRepositoryConfig
  ) {
    this.fileSystem = fileSystem;
    this.parser = parser;
    this.notesPath = config.notesPath;
    this.cache = new TodoCache(config.cacheMaxAge);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get all todos from all tracked markdown files.
   */
  async getAll(): Promise<Result<Todo[], Error>> {
    const filesResult = await this.scanMarkdownFileEntries();
    if (!filesResult.ok) {
      return err(filesResult.error);
    }

    const allTodos: Todo[] = [];
    const seenFiles = new Set<string>();

    for (const entry of filesResult.value) {
      seenFiles.add(entry.path);
      const indexed = buildFileIndexEntry(entry);
      const cached = this.isIndexUnchanged(entry.path, indexed)
        ? this.cache.getFresh(entry.path)
        : null;
      if (cached) {
        allTodos.push(...cached);
        continue;
      }

      const todosResult = await this.getByFile(entry.path);
      if (todosResult.ok) {
        allTodos.push(...todosResult.value);
        this.fileIndex.set(entry.path, indexed);
      }
      // Continue on file errors - don't fail the whole scan
    }

    for (const filePath of this.fileIndex.keys()) {
      if (!seenFiles.has(filePath)) {
        this.fileIndex.delete(filePath);
        this.cache.invalidate(filePath);
      }
    }

    return ok(allTodos);
  }

  /**
   * Get a specific todo by ID.
   */
  async getById(id: TodoId): Promise<Result<Todo | null, Error>> {
    try {
      const { filePath, lineNumber } = parseTodoId(id);

      const todosResult = await this.getByFile(filePath);
      if (!todosResult.ok) {
        return todosResult;
      }

      const todo = todosResult.value.find((t) => t.lineNumber === lineNumber);
      return ok(todo ?? null);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Get all todos from a specific file with caching.
   */
  async getByFile(filePath: string): Promise<Result<Todo[], Error>> {
    // Read file content
    const contentResult = await this.fileSystem.readFile(filePath);
    if (!contentResult.ok) {
      return contentResult;
    }

    const content = contentResult.value;
    const contentHash = hashContent(content);

    // Check cache
    const cached = this.cache.get(filePath, contentHash);
    if (cached !== null) {
      return ok(cached);
    }

    // Parse todos
    const todos = this.parser.parse(content, filePath, {
      source: getTodoSourceForFile(filePath, content),
    });

    // Cache result
    this.cache.set(filePath, todos, contentHash);

    return ok(todos);
  }

  /**
   * Query todos matching the given filter criteria.
   */
  async query(filter: TodoFilter): Promise<Result<Todo[], Error>> {
    const allResult = await this.getAll();
    if (!allResult.ok) {
      return allResult;
    }

    const filtered = filterTodos(allResult.value, filter);
    return ok(filtered);
  }

  /**
   * Parse a markdown snapshot without reading/writing files or mutating cache.
   */
  async parseSnapshot(filePath: string, content: string): Promise<Result<Todo[], Error>> {
    try {
      return ok(this.parser.parse(content, filePath, {
        source: getTodoSourceForFile(filePath, content),
      }));
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * List user-managed todo-list markdown files in the notes root.
   */
  async getTodoLists(): Promise<Result<TodoListFile[], Error>> {
    const entriesResult = await this.fileSystem.listDirectory(this.notesPath);
    if (!entriesResult.ok) return err(entriesResult.error);

    const lists: TodoListFile[] = [];
    for (const entry of entriesResult.value) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.md')) continue;
      if (isDefaultTodoFilePath(entry.path)) continue;

      const contentResult = await this.fileSystem.readFile(entry.path);
      if (!contentResult.ok) continue;

      const list = parseTodoListMarkdown(
        entry.path,
        contentResult.value,
        entry.modifiedAt ?? new Date(),
      );
      if (list) lists.push(list);
    }

    lists.sort((a, b) => a.title.localeCompare(b.title));
    return ok(lists);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Write Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Toggle the completion state of a todo.
   */
  async toggle(id: TodoId, expected?: TodoLineReference): Promise<Result<Todo, Error>> {
    try {
      const { filePath, lineNumber } = parseTodoId(id);

      // Read current file
      const contentResult = await this.fileSystem.readFile(filePath);
      if (!contentResult.ok) {
        return contentResult;
      }

      const content = contentResult.value;
      const lines = content.split('\n');

      const source = getTodoSourceForFile(filePath, content);
      const resolved = resolveTodoLine(lines, filePath, lineNumber, this.parser, source, expected);
      if (!resolved.ok) return resolved;

      const originalLine = resolved.value.line;
      const resolvedLineNumber = resolved.value.lineNumber;

      // Parse the original todo
      const originalTodo = resolved.value.todo;

      // Toggle state
      const toggledTodo = toggleTodo(originalTodo);

      // Build new line
      let newLine: string;
      if (toggledTodo.isCompleted) {
        // Mark as completed: toggle checkbox and add timestamp
        newLine = toggleCheckbox(originalLine);
        newLine = addCompletionTimestamp(newLine, toggledTodo.dates.completedAt ?? new Date());
      } else {
        // Mark as incomplete: toggle checkbox and remove timestamp
        newLine = toggleCheckbox(originalLine);
        newLine = removeCompletionTimestamp(newLine);
      }

      // Update file
      const updatedContent = updateLineInContent(content, resolvedLineNumber, newLine);
      const writeResult = await this.fileSystem.writeFile(filePath, updatedContent);
      if (!writeResult.ok) {
        return writeResult;
      }

      // Invalidate cache for this file
      this.cache.invalidate(filePath);

      // Return the updated todo with new rawLine
      return ok({
        ...toggledTodo,
        id: generateTodoId(filePath, resolvedLineNumber),
        lineNumber: resolvedLineNumber,
        rawLine: newLine,
      });
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Update the content of a todo.
   */
  async updateContent(
    id: TodoId,
    content: string,
    expected?: TodoLineReference,
  ): Promise<Result<Todo, Error>> {
    try {
      const { filePath, lineNumber } = parseTodoId(id);

      // Read current file
      const fileContentResult = await this.fileSystem.readFile(filePath);
      if (!fileContentResult.ok) {
        return fileContentResult;
      }

      const fileContent = fileContentResult.value;
      const lines = fileContent.split('\n');

      const source = getTodoSourceForFile(filePath, fileContent);
      const resolved = resolveTodoLine(lines, filePath, lineNumber, this.parser, source, expected);
      if (!resolved.ok) return resolved;

      const resolvedLineNumber = resolved.value.lineNumber;

      // Parse the original todo
      const originalTodo = resolved.value.todo;

      // Update the todo content
      const updatedTodo: Todo = {
        ...originalTodo,
        content,
      };

      // Serialize to new line
      const newLine = this.parser.serialize(updatedTodo);

      // Update file
      const updatedFileContent = updateLineInContent(fileContent, resolvedLineNumber, newLine);
      const writeResult = await this.fileSystem.writeFile(filePath, updatedFileContent);
      if (!writeResult.ok) {
        return writeResult;
      }

      // Invalidate cache
      this.cache.invalidate(filePath);

      return ok({
        ...updatedTodo,
        id: generateTodoId(filePath, resolvedLineNumber),
        lineNumber: resolvedLineNumber,
        rawLine: newLine,
      });
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Update content and metadata of a todo.
   */
  async updatePatch(
    id: TodoId,
    patch: TodoUpdatePatch,
    expected?: TodoLineReference,
  ): Promise<Result<Todo, Error>> {
    try {
      const { filePath, lineNumber } = parseTodoId(id);

      const fileContentResult = await this.fileSystem.readFile(filePath);
      if (!fileContentResult.ok) {
        return fileContentResult;
      }

      const fileContent = fileContentResult.value;
      const lines = fileContent.split('\n');

      const source = getTodoSourceForFile(filePath, fileContent);
      const resolved = resolveTodoLine(lines, filePath, lineNumber, this.parser, source, expected);
      if (!resolved.ok) return resolved;

      const originalTodo = resolved.value.todo;

      const updatedTodo = applyTodoPatch(originalTodo, patch);
      const newLine = this.parser.serialize(updatedTodo);
      let updatedFileContent: string;
      let updatedLineNumber = resolved.value.lineNumber;
      let updatedSection = updatedTodo.section;

      if (patch.targetList && originalTodo.source === 'dedicated') {
        const withoutOriginal = deleteLineFromContent(fileContent, resolved.value.lineNumber);
        const placement = insertTodoIntoListSection(withoutOriginal, newLine, patch.targetList);
        updatedFileContent = placement.content;
        updatedLineNumber = placement.lineNumber;
        updatedSection = placement.section;
      } else {
        updatedFileContent = updateLineInContent(fileContent, resolved.value.lineNumber, newLine);
      }

      const writeResult = await this.fileSystem.writeFile(filePath, updatedFileContent);
      if (!writeResult.ok) {
        return writeResult;
      }

      this.cache.invalidate(filePath);

      return ok({
        ...updatedTodo,
        id: generateTodoId(filePath, updatedLineNumber),
        lineNumber: updatedLineNumber,
        rawLine: newLine,
        ...(updatedSection !== undefined ? { section: updatedSection } : {}),
      });
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Delete a todo from its source file.
   */
  async delete(id: TodoId, expected?: TodoLineReference): Promise<Result<void, Error>> {
    try {
      const { filePath, lineNumber } = parseTodoId(id);

      // Read current file
      const contentResult = await this.fileSystem.readFile(filePath);
      if (!contentResult.ok) {
        return contentResult;
      }

      const content = contentResult.value;

      const source = getTodoSourceForFile(filePath, content);
      const resolved = resolveTodoLine(content.split('\n'), filePath, lineNumber, this.parser, source, expected);
      if (!resolved.ok) return err(resolved.error);

      // Delete the line
      const updatedContent = deleteLineFromContent(content, resolved.value.lineNumber);

      // Write back
      const writeResult = await this.fileSystem.writeFile(filePath, updatedContent);
      if (!writeResult.ok) {
        return writeResult;
      }

      // Invalidate cache
      this.cache.invalidate(filePath);

      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Create a new todo.
   */
  async create(
    params: CreateTodoParams,
    targetFile?: string
  ): Promise<Result<Todo, Error>> {
    try {
      // Determine target file
      const filePath = targetFile ?? this.getDefaultTodoFilePathInternal();

      // Ensure file exists
      const existsResult = await this.fileSystem.exists(filePath);
      if (!existsResult.ok) return existsResult;
      let content = '';

      if (existsResult.value) {
        const contentResult = await this.fileSystem.readFile(filePath);
        if (!contentResult.ok) {
          return contentResult;
        }
        content = contentResult.value;
      }

      // Create new line - build options object conditionally for exactOptionalPropertyTypes
      const newLineOptions: NewTodoOptions = {};
      if (params.indent !== undefined) {
        newLineOptions.indent = params.indent;
      }
      if (params.dates?.dueDate !== undefined) {
        newLineOptions.dueDate = params.dates.dueDate;
      }
      if (params.dates?.scheduledDate !== undefined) {
        newLineOptions.scheduledDate = params.dates.scheduledDate;
      }
      if (params.dates?.recurrence !== undefined) {
        newLineOptions.recurrence = params.dates.recurrence;
      }
      if (params.dates?.createdAt !== undefined) {
        newLineOptions.createdAt = params.dates.createdAt;
      }
      if (params.priority !== undefined) {
        newLineOptions.priority = params.priority;
      }
      if (params.tags !== undefined) {
        newLineOptions.tags = params.tags;
      }

      const newLine = createNewTodoLine(params.content, newLineOptions);

      const placement: TodoPlacement =
        params.source === 'dedicated' && params.list
          ? insertTodoIntoListSection(content, newLine, params.list)
          : appendTodoToContent(content, newLine);

      const updatedContent = placement.content;
      const writeResult = await this.fileSystem.writeFile(filePath, updatedContent);
      if (!writeResult.ok) {
        return writeResult;
      }

      // Create the todo entity
      const createdParams: CreateTodoParams = {
        ...params,
        sourceFile: filePath,
        lineNumber: placement.lineNumber,
        rawLine: newLine,
      };
      if (placement.section !== undefined) {
        createdParams.section = placement.section;
      }
      if (params.list !== undefined) {
        createdParams.list = params.list;
      }
      const todo = createTodo(createdParams);

      // Invalidate cache
      this.cache.invalidate(filePath);

      return ok(todo);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Create a user-managed todo-list markdown file.
   */
  async createTodoList(params: CreateTodoListFileParams): Promise<Result<TodoListFile, Error>> {
    try {
      const validationError = validateTodoListTitle(params.title);
      if (validationError) return err(new Error(validationError));

      const filename = getTodoListFileName(params.title);
      if (!filename) return err(new Error('Todo list name must contain at least one letter or number'));

      const filePath = joinPath(this.notesPath, filename);
      const existsResult = await this.fileSystem.exists(filePath);
      if (!existsResult.ok) return existsResult;
      if (existsResult.value) {
        return err(new Error(`Todo list already exists: ${filename}`));
      }

      const now = new Date();
      const content = createTodoListMarkdown(params, now);
      const writeResult = await this.fileSystem.writeFile(filePath, content);
      if (!writeResult.ok) return writeResult;

      this.cache.invalidate(filePath);
      this.fileIndex.delete(filePath);

      return await this.findTodoListByFilename(filename, filePath, content, now);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Update a user-managed todo-list markdown file.
   */
  async updateTodoList(
    path: string,
    patch: UpdateTodoListFileParams,
  ): Promise<Result<TodoListFile, Error>> {
    try {
      const pathResult = this.validateManagedTodoListPath(path);
      if (!pathResult.ok) return pathResult;
      const currentPath = pathResult.value;

      const contentResult = await this.fileSystem.readFile(currentPath);
      if (!contentResult.ok) return contentResult;
      if (!isTodoListMarkdown(contentResult.value)) {
        return err(new Error(`Not a managed todo list: ${path}`));
      }

      if (patch.title !== undefined) {
        const validationError = validateTodoListTitle(patch.title);
        if (validationError) return err(new Error(validationError));
      }

      const updated = updateTodoListMarkdown(contentResult.value, patch);
      const filename = patch.title !== undefined ? getTodoListFileName(patch.title) : getFileName(currentPath);
      if (!filename) return err(new Error('Todo list name must contain at least one letter or number'));
      const nextPath = joinPath(this.getManagedRootForPath(currentPath), filename);

      if (normalizePath(nextPath) !== normalizePath(currentPath)) {
        const existsResult = await this.fileSystem.exists(nextPath);
        if (!existsResult.ok) return existsResult;
        if (existsResult.value) {
          return err(new Error(`Todo list already exists: ${filename}`));
        }

        const renameResult = await this.fileSystem.renamePath(currentPath, nextPath);
        if (!renameResult.ok) return renameResult;
        this.cache.invalidate(currentPath);
        this.fileIndex.delete(currentPath);
      }

      const writeResult = await this.fileSystem.writeFile(nextPath, updated.content);
      if (!writeResult.ok) return writeResult;

      this.cache.invalidate(nextPath);
      this.fileIndex.delete(nextPath);

      return await this.findTodoListByFilename(filename, nextPath, updated.content, updated.updatedAt);
    } catch (e) {
      return err(toError(e));
    }
  }

  /**
   * Delete a user-managed todo-list markdown file.
   */
  async deleteTodoList(path: string): Promise<Result<void, Error>> {
    try {
      const pathResult = this.validateManagedTodoListPath(path);
      if (!pathResult.ok) return pathResult;
      const filePath = pathResult.value;

      const contentResult = await this.fileSystem.readFile(filePath);
      if (!contentResult.ok) return contentResult;
      if (!isTodoListMarkdown(contentResult.value)) {
        return err(new Error(`Not a managed todo list: ${path}`));
      }

      const deleteResult = await this.fileSystem.deleteFile(filePath);
      if (!deleteResult.ok) return deleteResult;

      this.cache.invalidate(filePath);
      this.fileIndex.delete(filePath);
      return ok(undefined);
    } catch (e) {
      return err(toError(e));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cache Control
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Invalidate cache for a specific file or all files.
   */
  invalidate(filePath?: string): void {
    this.cache.invalidate(filePath);
    if (filePath) {
      this.fileIndex.delete(filePath);
    } else {
      this.fileIndex.clear();
    }
  }

  /**
   * Refresh all todos by re-scanning files.
   */
  async refresh(): Promise<Result<void, Error>> {
    // Clear the entire cache and file metadata index
    this.cache.invalidate();
    this.fileIndex.clear();

    // Re-scan to populate cache
    const result = await this.getAll();
    if (!result.ok) {
      return err(result.error);
    }

    return ok(undefined);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Scan the notes directory for all markdown files.
   */
  private async scanMarkdownFileEntries(): Promise<Result<FileEntry[], Error>> {
    return this.scanDirectoryRecursive(this.notesPath);
  }

  /**
   * Recursively scan a directory for markdown files.
   */
  private async scanDirectoryRecursive(dirPath: string): Promise<Result<FileEntry[], Error>> {
    const entriesResult = await this.fileSystem.listDirectory(dirPath);
    if (!entriesResult.ok) {
      return entriesResult;
    }

    const mdFiles: FileEntry[] = [];

    for (const entry of entriesResult.value) {
      if (entry.isDirectory) {
        // Skip hidden directories
        if (entry.name.startsWith('.')) {
          continue;
        }
        // Recurse into subdirectory
        const subResult = await this.scanDirectoryRecursive(entry.path);
        if (subResult.ok) {
          mdFiles.push(...subResult.value);
        }
      } else if (entry.name.endsWith('.md')) {
        mdFiles.push(entry);
      }
    }

    return ok(mdFiles);
  }

  private isIndexUnchanged(filePath: string, next: FileIndexEntry): boolean {
    const previous = this.fileIndex.get(filePath);
    if (!previous) return false;
    if (previous.size !== next.size) return false;
    if (previous.modifiedAt !== next.modifiedAt) return false;
    return next.size !== undefined || next.modifiedAt !== undefined;
  }

  /**
   * Get the default TODO file path.
   */
  private getDefaultTodoFilePathInternal(): string {
    return getDefaultTodoFilePath(this.notesPath);
  }

  private validateManagedTodoListPath(path: string): Result<string, Error> {
    const normalizedPath = normalizePath(path);

    if (isDefaultTodoFilePath(normalizedPath)) {
      return err(new Error(`${getFileName(normalizedPath)} is protected`));
    }

    const root = getMatchingRootAlias(normalizedPath, this.notesPath);
    if (!root) {
      return err(new Error(`Todo list must live in the notes root: ${path}`));
    }

    const relative = normalizedPath.slice(root.length + 1);
    if (!relative || relative.includes('/')) {
      return err(new Error(`Todo list must live in the notes root: ${path}`));
    }
    if (!relative.toLowerCase().endsWith('.md')) {
      return err(new Error(`Todo list must be a markdown file: ${path}`));
    }

    return ok(path);
  }

  private getManagedRootForPath(path: string): string {
    return getMatchingRootAlias(normalizePath(path), this.notesPath) ?? normalizePath(this.notesPath).replace(/\/+$/, '');
  }

  private async findTodoListByFilename(
    filename: string,
    fallbackPath: string,
    fallbackContent: string,
    fallbackDate: Date,
  ): Promise<Result<TodoListFile, Error>> {
    const listsResult = await this.getTodoLists();
    if (listsResult.ok) {
      const list = listsResult.value.find((item) => getFileName(item.path).toLowerCase() === filename.toLowerCase());
      if (list) return ok(list);
    }

    const fallback = parseTodoListMarkdown(fallbackPath, fallbackContent, fallbackDate);
    if (fallback) return ok(fallback);
    return err(new Error(`File is not a valid todo list: ${filename}`));
  }
}

function buildFileIndexEntry(entry: FileEntry): FileIndexEntry {
  const indexed: FileIndexEntry = {};
  if (entry.size !== undefined) indexed.size = entry.size;
  if (entry.modifiedAt !== undefined) indexed.modifiedAt = entry.modifiedAt.getTime();
  return indexed;
}

function getTodoSourceForFile(filePath: string, content: string): TodoSource {
  return isDefaultTodoFilePath(filePath) || isTodoListMarkdown(content) ? 'dedicated' : 'inline';
}

interface ResolvedTodoLine {
  lineNumber: number;
  line: string;
  todo: Todo;
}

function resolveTodoLine(
  lines: string[],
  filePath: string,
  requestedLineNumber: number,
  parser: TodoParserPort,
  source: TodoSource,
  expected?: TodoLineReference,
): Result<ResolvedTodoLine, Error> {
  const direct = parseTodoLineAt(lines, filePath, requestedLineNumber, parser, source);

  if (!expected) {
    if (!direct.ok) return direct;
    return ok(direct.value);
  }

  if (direct.ok && direct.value.line === expected.rawLine) {
    return direct;
  }

  const rebased = findExpectedTodoLine(lines, filePath, expected, parser, source);
  if (rebased) {
    return ok(rebased);
  }

  if (!direct.ok) {
    return direct;
  }

  return err(
    new Error(
      `Todo at line ${expected.lineNumber} in ${filePath} changed before the mutation could be applied`,
    ),
  );
}

function parseTodoLineAt(
  lines: string[],
  filePath: string,
  lineNumber: number,
  parser: TodoParserPort,
  source: TodoSource,
): Result<ResolvedTodoLine, Error> {
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return err(new Error(`Line ${lineNumber} out of bounds in ${filePath}`));
  }

  const line = lines[lineNumber]!;
  const todo = parser.parseLine(line, lineNumber, filePath, undefined, { source });
  if (!todo) {
    return err(new Error(`Line ${lineNumber} is not a valid todo`));
  }

  return ok({ lineNumber, line, todo });
}

function findExpectedTodoLine(
  lines: string[],
  filePath: string,
  expected: TodoLineReference,
  parser: TodoParserPort,
  source: TodoSource,
): ResolvedTodoLine | null {
  const matches: ResolvedTodoLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line !== expected.rawLine) continue;

    const todo = parser.parseLine(line, index, filePath, undefined, { source });
    if (todo) {
      matches.push({ lineNumber: index, line, todo });
    }
  }

  if (matches.length === 0) return null;

  matches.sort(
    (a, b) =>
      Math.abs(a.lineNumber - expected.lineNumber) -
      Math.abs(b.lineNumber - expected.lineNumber),
  );
  return matches[0]!;
}

function appendTodoToContent(content: string, newLine: string): TodoPlacement {
  const trimmedContent = content.trimEnd();
  if (trimmedContent.length === 0) {
    return { content: newLine, lineNumber: 0 };
  }

  const next = `${trimmedContent}\n${newLine}`;
  return { content: next, lineNumber: next.split('\n').length - 1 };
}

function insertTodoIntoListSection(
  content: string,
  newLine: string,
  list: TodoList,
): TodoPlacement {
  const section = getTodoListHeading(list);
  const lines = content.trimEnd().length > 0 ? content.trimEnd().split('\n') : ['# TODO'];
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'i');

  let headingIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (headingIndex === -1) {
    if (lines.length > 0 && lines[lines.length - 1]!.trim() !== '') {
      lines.push('');
    }
    headingIndex = lines.length;
    lines.push(`## ${section}`, '');
  }

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && /^#{1,6}\s+/.test(line),
  );
  let insertAt = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;

  while (insertAt > headingIndex + 1 && lines[insertAt - 1]!.trim() === '') {
    insertAt--;
  }

  const insertion = insertAt === headingIndex + 1 ? ['', newLine] : [newLine];
  if (nextHeadingIndex !== -1) {
    insertion.push('');
  }

  lines.splice(insertAt, 0, ...insertion);
  const lineNumber = insertAt + insertion.indexOf(newLine);
  return { content: lines.join('\n'), lineNumber, section };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function joinPath(root: string, child: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${child.replace(/^[\\/]+/, '')}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function getFileName(path: string): string {
  const parts = normalizePath(path).split('/');
  return parts[parts.length - 1] ?? path;
}

function getRootAliases(root: string): string[] {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  const aliases = new Set<string>();
  if (normalizedRoot) aliases.add(normalizedRoot);
  if (normalizedRoot.startsWith('~/')) aliases.add(`/${normalizedRoot}`);
  if (normalizedRoot.startsWith('/~/')) aliases.add(normalizedRoot.slice(1));
  return [...aliases].sort((a, b) => b.length - a.length);
}

function getMatchingRootAlias(path: string, root: string): string | null {
  const normalizedPath = normalizePath(path);
  return getRootAliases(root).find((alias) => normalizedPath.startsWith(`${alias}/`)) ?? null;
}

/**
 * Create a new MarkdownTodoRepository instance.
 */
export function createMarkdownTodoRepository(
  fileSystem: FileSystemPort,
  parser: TodoParserPort,
  config: MarkdownTodoRepositoryConfig
): TodoRepositoryPort {
  return new MarkdownTodoRepository(fileSystem, parser, config);
}
