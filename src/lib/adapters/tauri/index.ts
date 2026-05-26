/**
 * Tauri Adapters - Secondary adapters implementing outbound ports via Tauri
 *
 * This module exports all Tauri-specific adapters that bridge the application's
 * ports to Tauri's infrastructure. These adapters translate between the domain's
 * interface contracts and Tauri's IPC commands.
 *
 * Structure:
 * - commands.ts: Raw type-safe Tauri invoke wrappers
 * - TauriFileSystemAdapter: File system operations
 * - TauriSettingsAdapter: Settings persistence
 * - TauriCredentialAdapter: Secure credential storage (keychain)
 *
 * Usage:
 * Import adapters in bootstrap.ts (the composition root) only.
 * Application code should depend on ports, never on adapters directly.
 */

// Adapters
export { TauriFileSystemAdapter } from './TauriFileSystemAdapter';
export { TauriAssetStorageAdapter } from './TauriAssetStorageAdapter';
export { TauriFolderAccessAdapter } from './TauriFolderAccessAdapter';
export { FolderAccessFileSystemAdapter } from './FolderAccessFileSystemAdapter';
export { FolderAccessVoidStorageAdapter } from './FolderAccessVoidStorageAdapter';
export { TauriSettingsAdapter } from './TauriSettingsAdapter';
export { TauriCredentialAdapter } from './TauriCredentialAdapter';
export { TauriCryptoAdapter } from './TauriCryptoAdapter';
export { TauriKeyCustodyAdapter } from './TauriKeyCustodyAdapter';
export { TauriGitRepositoryAdapter } from './TauriGitRepositoryAdapter';
export { TauriGitHubAdapter } from './TauriGitHubAdapter';
export { TauriUpdaterAdapter } from './TauriUpdaterAdapter';
export { TauriConversationAdapter, createTauriConversationAdapter } from './TauriConversationAdapter';
export { TauriLoggerAdapter } from './TauriLoggerAdapter';
export { TauriOperationStorageAdapter, createTauriOperationStorageAdapter } from './TauriOperationStorageAdapter';
export { TauriVoidStorageAdapter } from './TauriVoidStorageAdapter';
export { TauriExternalNavigationAdapter } from './TauriExternalNavigationAdapter';
export { TauriWebFetchAdapter } from './TauriWebFetchAdapter';
export {
  TauriClipboardWatcher,
  TauriClipboardWriter,
  MemoryClipboardWatcher,
  MemoryClipboardWriter,
} from './TauriClipboardAdapter';

// Commands (for direct Tauri access when needed)
export {
  commands,
  fileCommands,
  assetCommands,
  settingsCommands,
  updaterCommands,
  credentialCommands,
  folderAccessCommands,
  protectionCommands,
  gitCommands,
  githubCommands,
} from './commands';
