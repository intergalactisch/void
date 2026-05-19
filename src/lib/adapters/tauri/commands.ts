/**
 * Tauri Commands - Raw type-safe invoke wrappers
 *
 * This file provides a centralized, type-safe layer over Tauri's invoke API.
 * All Tauri command invocations should go through this module to ensure
 * consistent typing and easier maintenance.
 *
 * These commands map directly to Rust commands defined in src-tauri/src/commands/
 */

import { invoke } from '@tauri-apps/api/core';
import type { FileEntry } from '$lib/core';
import type { Settings } from '$lib/domain';

/**
 * Raw file entry from Tauri (Rust uses camelCase via serde)
 */
interface RawFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  modified?: number;
}

/**
 * Transform raw Tauri FileEntry to our domain FileEntry
 */
function transformFileEntry(raw: RawFileEntry): FileEntry {
  const entry: FileEntry = {
    name: raw.name,
    path: raw.path,
    isDirectory: raw.isDirectory,
    isFile: raw.isFile,
  };

  // Only include optional properties if they have values
  // (required for exactOptionalPropertyTypes)
  if (raw.size !== undefined) {
    entry.size = raw.size;
  }
  if (raw.modified !== undefined) {
    entry.modifiedAt = new Date(raw.modified * 1000);
  }

  return entry;
}

/**
 * File system commands
 */
export const fileCommands = {
  /**
   * Read file content as string
   */
  readFile: (path: string): Promise<string> => invoke<string>('read_file', { path }),

  /**
   * Write content to file
   */
  writeFile: (path: string, content: string): Promise<void> =>
    invoke<void>('write_file', { path, content }),

  /**
   * Delete a file
   */
  deleteFile: (path: string): Promise<void> => invoke<void>('delete_file', { path }),

  /**
   * List directory contents
   */
  listDirectory: async (path: string): Promise<FileEntry[]> => {
    const entries = await invoke<RawFileEntry[]>('list_directory', { path });
    return entries.map(transformFileEntry);
  },

  /**
   * Check if path exists
   */
  exists: (path: string): Promise<boolean> => invoke<boolean>('file_exists', { path }),

  /**
   * Create directory (including parents)
   */
  createDirectory: (path: string): Promise<void> => invoke<void>('create_directory', { path }),

  /**
   * Recursively remove a directory and all of its contents
   */
  removeDirectory: (path: string): Promise<void> => invoke<void>('remove_directory', { path }),

  /**
   * Rename or move a file/directory
   */
  renamePath: (from: string, to: string): Promise<void> =>
    invoke<void>('rename_path', { from, to }),
};

/**
 * Settings commands
 */
export const settingsCommands = {
  /**
   * Get settings from storage
   */
  getSettings: (): Promise<Settings> => invoke<Settings>('get_settings'),

  /**
   * Save settings to storage
   */
  saveSettings: (settings: Settings): Promise<void> =>
    invoke<void>('save_settings', { settings }),

  /**
   * Get path to settings file
   */
  getSettingsPath: (): Promise<string> => invoke<string>('get_settings_path'),
};

/**
 * Credential commands (uses system keychain)
 */
export const credentialCommands = {
  /**
   * Store a credential in the system keychain
   */
  storeCredential: (service: string, credential: string): Promise<void> =>
    invoke<void>('store_credential', { key: service, value: credential }),

  /**
   * Get a credential from the system keychain
   * Returns null if not found
   */
  getCredential: (service: string): Promise<string | null> =>
    invoke<string | null>('get_credential', { key: service }),

  /**
   * Delete a credential from the system keychain
   */
  deleteCredential: (service: string): Promise<void> =>
    invoke<void>('delete_credential', { key: service }),

  /**
   * Check if a credential exists in the system keychain
   */
  hasCredential: (service: string): Promise<boolean> =>
    invoke<boolean>('has_credential', { key: service }),
};

/**
 * All commands grouped for convenience
 */
export const commands = {
  files: fileCommands,
  settings: settingsCommands,
  credentials: credentialCommands,
};
