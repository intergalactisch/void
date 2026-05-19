/**
 * TauriVoidStorageAdapter - Tauri implementation of VoidStoragePort
 *
 * Delegates to Rust commands for .void/ directory operations.
 * All paths are resolved by the Rust backend.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import { invoke } from '@tauri-apps/api/core';
import { ok, err, type Result } from '$lib/core/result';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import { parseProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import type { OperationDigest } from '$lib/domain/values/OperationDigest';

export class TauriVoidStorageAdapter implements VoidStoragePort {
  async ensureStructure(notesDir: string): Promise<Result<void, Error>> {
    try {
      await invoke('void_ensure_dir', { notesDir });
      return ok(undefined);
    } catch (e) {
      return err(new Error(`Failed to ensure .void/ structure: ${e}`));
    }
  }

  async appendProvenance(
    notesDir: string,
    noteName: string,
    event: ProvenanceEvent
  ): Promise<Result<void, Error>> {
    try {
      const eventJson = JSON.stringify(event);
      await invoke('void_append_provenance', { notesDir, noteName, event: eventJson });
      return ok(undefined);
    } catch (e) {
      return err(new Error(`Failed to append provenance: ${e}`));
    }
  }

  async readProvenance(
    notesDir: string,
    noteName: string
  ): Promise<Result<ProvenanceEvent[], Error>> {
    try {
      const lines = await invoke<string[]>('void_read_provenance', { notesDir, noteName });
      const events: ProvenanceEvent[] = [];
      for (const line of lines) {
        const event = parseProvenanceEvent(line);
        if (event) events.push(event);
      }
      return ok(events);
    } catch (e) {
      return err(new Error(`Failed to read provenance: ${e}`));
    }
  }

  async writeJson(
    notesDir: string,
    relativePath: string,
    data: unknown
  ): Promise<Result<void, Error>> {
    try {
      const content = JSON.stringify(data, null, 2);
      await invoke('void_write_json', { notesDir, relativePath, content });
      return ok(undefined);
    } catch (e) {
      return err(new Error(`Failed to write .void/ JSON: ${e}`));
    }
  }

  async readJson<T>(
    notesDir: string,
    relativePath: string
  ): Promise<Result<T | null, Error>> {
    try {
      const content = await invoke<string>('void_read_json', { notesDir, relativePath });
      if (!content) return ok(null);
      return ok(JSON.parse(content) as T);
    } catch (e) {
      return err(new Error(`Failed to read .void/ JSON: ${e}`));
    }
  }

  async appendJsonl(
    notesDir: string,
    relativePath: string,
    entry: unknown
  ): Promise<Result<void, Error>> {
    try {
      const line = JSON.stringify(entry);
      await invoke('void_append_jsonl', { notesDir, relativePath, line });
      return ok(undefined);
    } catch (e) {
      return err(new Error(`Failed to append .void/ JSONL: ${e}`));
    }
  }

  async readJsonl<T>(
    notesDir: string,
    relativePath: string
  ): Promise<Result<T[], Error>> {
    try {
      const lines = await invoke<string[]>('void_read_jsonl', { notesDir, relativePath });
      const entries: T[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as T);
        } catch {
          // Keep journals readable if one historical line was corrupted.
        }
      }
      return ok(entries);
    } catch (e) {
      return err(new Error(`Failed to read .void/ JSONL: ${e}`));
    }
  }

  async listDir(
    notesDir: string,
    relativePath: string
  ): Promise<Result<string[], Error>> {
    try {
      const entries = await invoke<string[]>('void_list_dir', { notesDir, relativePath });
      return ok(entries);
    } catch (e) {
      return err(new Error(`Failed to list .void/ directory: ${e}`));
    }
  }

  async appendDigest(
    notesDir: string,
    entry: OperationDigest
  ): Promise<Result<void, Error>> {
    try {
      const line = JSON.stringify(entry);
      await invoke('void_append_provenance', {
        notesDir,
        noteName: '../operations/digest',
        event: line,
      });
      return ok(undefined);
    } catch (e) {
      return err(new Error(`Failed to append operation digest: ${e}`));
    }
  }
}
