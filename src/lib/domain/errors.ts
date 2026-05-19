/**
 * Domain error types - typed errors for fallible domain operations
 *
 * Pure domain types with ZERO external dependencies. UI and services can
 * pattern-match on these to produce actionable error messages instead of
 * showing a generic "something went wrong".
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Thrown/wrapped when a domain Block cannot be converted into a ProseMirror
 * node — typically because the block's shape violates the schema (e.g., a
 * paragraph block with block-level children, an unknown block type, etc.).
 *
 * Carries the offending block's id and type so the user-facing toast can
 * point at the problem block, and the original error as `cause` for logs.
 */
export class BlockSerializationError extends Error {
  readonly blockId: string;
  readonly blockType: string;

  constructor(args: { blockId: string; blockType: string; cause?: unknown }) {
    const reason = args.cause instanceof Error ? args.cause.message : String(args.cause ?? 'unknown reason');
    super(
      `Failed to serialize block ${args.blockId} (type=${args.blockType}): ${reason}`,
    );
    this.name = 'BlockSerializationError';
    this.blockId = args.blockId;
    this.blockType = args.blockType;
    if (args.cause !== undefined) {
      (this as { cause?: unknown }).cause = args.cause;
    }
  }
}

/**
 * Thrown/wrapped when an editor save would overwrite a file that has been
 * modified externally (file mtime/hash changed since the last load). The
 * caller is expected to surface a conflict-resolution UI rather than save.
 */
export class ConflictError extends Error {
  readonly path: string;

  constructor(path: string, message?: string) {
    super(message ?? `Conflict detected: ${path} was modified externally`);
    this.name = 'ConflictError';
    this.path = path;
  }
}
