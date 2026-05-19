/**
 * MemoryVoidStorageAdapter - In-memory implementation of VoidStoragePort
 *
 * For testing without Tauri. Stores everything in Maps.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import { ok, type Result } from '$lib/core/result';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import type { OperationDigest } from '$lib/domain/values/OperationDigest';

export class MemoryVoidStorageAdapter implements VoidStoragePort {
  private provenance = new Map<string, ProvenanceEvent[]>();
  private jsonFiles = new Map<string, unknown>();
  private jsonlFiles = new Map<string, unknown[]>();
  private directories = new Map<string, string[]>();
  private digestEntries: OperationDigest[] = [];
  private structureCreated = false;

  async ensureStructure(_notesDir: string): Promise<Result<void, Error>> {
    this.structureCreated = true;
    return ok(undefined);
  }

  async appendProvenance(
    _notesDir: string,
    noteName: string,
    event: ProvenanceEvent
  ): Promise<Result<void, Error>> {
    const existing = this.provenance.get(noteName) ?? [];
    existing.push(event);
    this.provenance.set(noteName, existing);
    return ok(undefined);
  }

  async readProvenance(
    _notesDir: string,
    noteName: string
  ): Promise<Result<ProvenanceEvent[], Error>> {
    return ok(this.provenance.get(noteName) ?? []);
  }

  async writeJson(
    _notesDir: string,
    relativePath: string,
    data: unknown
  ): Promise<Result<void, Error>> {
    this.jsonFiles.set(relativePath, data);
    const lastSlash = relativePath.lastIndexOf('/');
    if (lastSlash >= 0) {
      const dir = relativePath.slice(0, lastSlash);
      const file = relativePath.slice(lastSlash + 1);
      const files = this.directories.get(dir) ?? [];
      if (!files.includes(file)) {
        this.directories.set(dir, [...files, file]);
      }
    }
    return ok(undefined);
  }

  async readJson<T>(
    _notesDir: string,
    relativePath: string
  ): Promise<Result<T | null, Error>> {
    const data = this.jsonFiles.get(relativePath);
    if (data === undefined) return ok(null);
    return ok(data as T);
  }

  async appendJsonl(
    _notesDir: string,
    relativePath: string,
    entry: unknown
  ): Promise<Result<void, Error>> {
    const existing = this.jsonlFiles.get(relativePath) ?? [];
    this.jsonlFiles.set(relativePath, [...existing, entry]);
    this.trackDirectoryFile(relativePath);
    return ok(undefined);
  }

  async readJsonl<T>(
    _notesDir: string,
    relativePath: string
  ): Promise<Result<T[], Error>> {
    return ok([...(this.jsonlFiles.get(relativePath) ?? [])] as T[]);
  }

  async listDir(
    _notesDir: string,
    relativePath: string
  ): Promise<Result<string[], Error>> {
    return ok(this.directories.get(relativePath) ?? []);
  }

  async appendDigest(
    _notesDir: string,
    entry: OperationDigest
  ): Promise<Result<void, Error>> {
    this.digestEntries.push(entry);
    return ok(undefined);
  }

  // Test helpers

  isStructureCreated(): boolean {
    return this.structureCreated;
  }

  getProvenanceCount(noteName: string): number {
    return this.provenance.get(noteName)?.length ?? 0;
  }

  seedDirectory(relativePath: string, files: string[]): void {
    this.directories.set(relativePath, files);
  }

  getDigestEntries(): OperationDigest[] {
    return [...this.digestEntries];
  }

  clear(): void {
    this.provenance.clear();
    this.jsonFiles.clear();
    this.jsonlFiles.clear();
    this.directories.clear();
    this.digestEntries = [];
    this.structureCreated = false;
  }

  private trackDirectoryFile(relativePath: string): void {
    const lastSlash = relativePath.lastIndexOf('/');
    if (lastSlash < 0) return;
    const dir = relativePath.slice(0, lastSlash);
    const file = relativePath.slice(lastSlash + 1);
    const files = this.directories.get(dir) ?? [];
    if (!files.includes(file)) {
      this.directories.set(dir, [...files, file]);
    }
  }
}
