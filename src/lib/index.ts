/**
 * Main entry point for the void library.
 *
 * This module exports the public API of the application:
 * - Bootstrap function and utilities
 * - Domain types (Settings, etc.)
 * - Port interfaces (SettingsService, FileService, CredentialService)
 * - Stores (settingsStore)
 * - Core utilities (Result, Container, TOKENS)
 * - Events
 *
 * Note: Adapters are NOT exported here. They should only be used
 * in bootstrap.ts (the composition root).
 */

// Bootstrap (composition root)
export {
  bootstrap,
  isBootstrapped,
  getAppContext,
  resetBootstrap,
  reinitializeAI,
  type AppContext,
  type BootstrapOptions,
} from './bootstrap';

// Domain (pure business logic)
export type { Settings } from './domain';
export { DEFAULT_SETTINGS } from './domain';

// Ports (interfaces)
export type {
  SettingsService,
  FileService,
  CredentialService,
} from './ports/inbound';
export { CREDENTIAL_KEYS, type CredentialKey } from './ports/inbound';
export type {
  FileSystemPort,
  SettingsStoragePort,
  CredentialPort,
} from './ports/outbound';

// Core utilities
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
  isOk,
  isErr,
} from './core';
export { Container, TOKENS, type TokenKey } from './core';
export type { FileEntry, FileMetadata, ThemeMode, AiProvider } from './core';

// Events
export { events } from './events';
export type { EventMap } from './events';

// Logging
export { getLogger } from './logging';

// Stores (UI primary adapters)
export { settingsStore, editorStore, commandsStore } from './stores';
