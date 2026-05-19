/**
 * MemoryLineageStorageAdapter - in-memory lineage sidecar storage.
 *
 * Useful for unit tests and browser-only development. It implements the
 * lineage port directly instead of routing through VoidStoragePort.
 */

import { ok, type Result } from '$lib/core';
import type { LineageJournalEntry, LineageSnapshot } from '$lib/domain/entities/Lineage';
import type { LineageStoragePort } from '$lib/ports/outbound/LineageStoragePort';

export class MemoryLineageStorageAdapter implements LineageStoragePort {
  private readonly journals = new Map<string, LineageJournalEntry[]>();
  private readonly snapshots = new Map<string, LineageSnapshot>();

  async appendEntries(notePath: string, entries: LineageJournalEntry[]): Promise<Result<void, Error>> {
    const existing = this.journals.get(notePath) ?? [];
    this.journals.set(notePath, [...existing, ...clone(entries)]);
    return ok(undefined);
  }

  async readJournal(notePath: string): Promise<Result<LineageJournalEntry[], Error>> {
    return ok(clone(this.journals.get(notePath) ?? []));
  }

  async readSnapshot(notePath: string): Promise<Result<LineageSnapshot | null, Error>> {
    const snapshot = this.snapshots.get(notePath);
    return ok(snapshot ? clone(snapshot) : null);
  }

  async writeSnapshot(notePath: string, snapshot: LineageSnapshot): Promise<Result<void, Error>> {
    this.snapshots.set(notePath, clone(snapshot));
    return ok(undefined);
  }

  clear(): void {
    this.journals.clear();
    this.snapshots.clear();
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
