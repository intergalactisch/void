/**
 * TodoCache - In-memory cache for parsed TODO items
 *
 * Caches parsed todos by file path with content hashing for invalidation.
 * When file content changes (detected via hash comparison), the cache
 * entry is automatically invalidated.
 *
 * Features:
 * - Hash-based invalidation (content change detection)
 * - Time-based expiration (configurable max age)
 * - Per-file and full cache invalidation
 * - Aggregated access to all cached todos
 *
 * Part of the TODO repository adapter layer.
 */

import type { Todo } from '$lib/domain/entities/Todo';

/**
 * Cache entry storing todos, content hash, and timestamp.
 */
interface CacheEntry {
  /** Parsed todos from the file */
  todos: Todo[];
  /** Hash of file content when parsed */
  hash: string;
  /** Timestamp when cached */
  timestamp: number;
}

/**
 * In-memory cache for TODO items parsed from markdown files.
 */
export class TodoCache {
  /** Internal cache storage keyed by file path */
  private cache = new Map<string, CacheEntry>();

  /** Maximum age in milliseconds before entries expire */
  private readonly maxAge: number;

  /**
   * Create a new TodoCache instance.
   * @param maxAgeMs - Maximum cache age in milliseconds (default: 5 minutes)
   */
  constructor(maxAgeMs: number = 5 * 60 * 1000) {
    this.maxAge = maxAgeMs;
  }

  /**
   * Get cached todos for a file if the cache is valid.
   *
   * Cache is considered invalid if:
   * - No entry exists for the file
   * - Content hash doesn't match (file was modified)
   * - Entry has expired (older than maxAge)
   *
   * @param filePath - Path to the markdown file
   * @param currentHash - Hash of the current file content
   * @returns Cached todos or null if cache miss/invalid
   */
  get(filePath: string, currentHash: string): Todo[] | null {
    const entry = this.cache.get(filePath);

    if (!entry) {
      return null;
    }

    // Check if content has changed
    if (entry.hash !== currentHash) {
      this.cache.delete(filePath);
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(filePath);
      return null;
    }

    return entry.todos;
  }

  /**
   * Get cached todos for a file when an external file index has already
   * proven the file is unchanged. Still respects cache max age.
   */
  getFresh(filePath: string): Todo[] | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(filePath);
      return null;
    }

    return entry.todos;
  }

  /**
   * Store parsed todos in the cache.
   *
   * @param filePath - Path to the markdown file
   * @param todos - Parsed todo items from the file
   * @param hash - Hash of the file content
   */
  set(filePath: string, todos: Todo[], hash: string): void {
    this.cache.set(filePath, {
      todos,
      hash,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidate cache entries.
   *
   * @param filePath - Optional file path to invalidate; if omitted, clears all
   */
  invalidate(filePath?: string): void {
    if (filePath) {
      this.cache.delete(filePath);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get all cached todos across all files.
   * Does not validate entries; returns whatever is currently cached.
   *
   * @returns Array of all cached todos
   */
  getAllCached(): Todo[] {
    const allTodos: Todo[] = [];
    for (const entry of this.cache.values()) {
      allTodos.push(...entry.todos);
    }
    return allTodos;
  }

  /**
   * Get all file paths that have cached entries.
   *
   * @returns Array of cached file paths
   */
  getCachedFilePaths(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the current size of the cache.
   *
   * @returns Number of cached files
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Check if a file has a valid (non-expired) cache entry.
   * Note: This does not check the content hash.
   *
   * @param filePath - Path to check
   * @returns True if a non-expired entry exists
   */
  has(filePath: string): boolean {
    const entry = this.cache.get(filePath);
    if (!entry) return false;
    return Date.now() - entry.timestamp <= this.maxAge;
  }

  /**
   * Get cache statistics for debugging/monitoring.
   *
   * @returns Cache statistics object
   */
  getStats(): CacheStats {
    let totalTodos = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      totalTodos += entry.todos.length;
      if (now - entry.timestamp > this.maxAge) {
        expiredCount++;
      }
    }

    return {
      fileCount: this.cache.size,
      totalTodos,
      expiredCount,
      maxAge: this.maxAge,
    };
  }
}

/**
 * Cache statistics for monitoring.
 */
export interface CacheStats {
  /** Number of files in cache */
  fileCount: number;
  /** Total number of todos cached */
  totalTodos: number;
  /** Number of expired entries (not yet cleaned) */
  expiredCount: number;
  /** Maximum cache age in milliseconds */
  maxAge: number;
}

/**
 * Compute a simple hash of string content.
 *
 * Uses a fast djb2-style hash algorithm. Not cryptographic,
 * but sufficient for cache invalidation.
 *
 * @param content - String content to hash
 * @returns Hash as a base-36 string
 */
export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    // djb2 hash: hash * 33 + char
    hash = ((hash << 5) - hash) + content.charCodeAt(i);
    // Convert to 32-bit integer
    hash = hash & hash;
  }
  // Return as base-36 for compact representation
  return hash.toString(36);
}

/**
 * Create a new TodoCache instance with default settings.
 *
 * @param maxAgeMs - Optional maximum cache age in milliseconds
 * @returns New TodoCache instance
 */
export function createTodoCache(maxAgeMs?: number): TodoCache {
  return new TodoCache(maxAgeMs);
}
