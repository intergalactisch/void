/**
 * Core utilities - framework-agnostic, no external dependencies.
 *
 * This module provides foundational utilities used throughout the application:
 * - Result type for error handling without exceptions
 * - DI Container for dependency injection
 * - Shared types used across layers
 */

// Result type and helpers
export {
  type Result,
  ok,
  err,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  tryCatch,
  toError,
  collect,
  isOk,
  isErr,
} from './result';

// DI Container
export { Container, TOKENS, type TokenKey, type Disposable } from './container';

// Shared types
export type {
  FileEntry,
  FileMetadata,
  ThemeMode,
  AiProvider,
  Id,
  ISOTimestamp,
  Nullable,
} from './types';

export {
  extractFrontmatterTags,
  serializeMetadataFrontmatter,
  combineMarkdownWithFrontmatter,
} from './markdownFrontmatter';
