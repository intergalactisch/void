/**
 * Domain layer barrel export
 *
 * The domain layer contains pure business logic with ZERO external dependencies.
 * No imports from adapters, Tauri, or external libraries are allowed here.
 *
 * Structure:
 * - entities/ - Core domain objects (Settings, Note, Folder, etc.)
 * - values/ - Value objects (BlockType, Mark, Selection, DocumentMeta, Command)
 */

export * from './entities';
export * from './values';
export * from './errors';
