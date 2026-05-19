/**
 * Shared types used across the application.
 * These are framework-agnostic and used by domain, ports, and adapters.
 */

/**
 * Represents a file or directory entry from the file system
 */
export interface FileEntry {
  /** File or directory name (without path) */
  name: string;
  /** Full absolute path */
  path: string;
  /** True if this entry is a directory */
  isDirectory: boolean;
  /** True if this entry is a file */
  isFile: boolean;
  /** File size in bytes (undefined for directories) */
  size?: number;
  /** Last modification timestamp */
  modifiedAt?: Date;
}

/**
 * Metadata about a file without its content
 */
export interface FileMetadata {
  path: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  isReadOnly: boolean;
}

/**
 * Supported theme modes
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Supported AI providers
 */
export type AiProvider = 'claude' | 'openai' | 'local';

/**
 * Generic ID type (can be extended for specific domains)
 */
export type Id = string;

/**
 * Timestamp in ISO 8601 format
 */
export type ISOTimestamp = string;

/**
 * Nullable type helper
 */
export type Nullable<T> = T | null;
