/**
 * VoidLineageStorageAdapter - stores lineage sidecars via VoidStoragePort.
 *
 * Journals are now append-only JSONL. Older JSON-array journals are still read
 * so existing sidecars keep working after the migration.
 */

import { ok, err, type Result } from '$lib/core/result';
import type { LineageJournalEntry, LineageSnapshot } from '$lib/domain/entities/Lineage';
import type { LineageStoragePort } from '$lib/ports/outbound/LineageStoragePort';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';

export class VoidLineageStorageAdapter implements LineageStoragePort {
  constructor(
    private readonly voidStorage: VoidStoragePort,
    private readonly notesDir: string
  ) {}

  async appendEntries(notePath: string, entries: LineageJournalEntry[]): Promise<Result<void, Error>> {
    if (entries.length === 0) return ok(undefined);

    for (const entry of entries) {
      const append = await this.voidStorage.appendJsonl(
        this.notesDir,
        journalJsonlPath(notePath),
        entry
      );
      if (!append.ok) return append;
    }
    return ok(undefined);
  }

  async readJournal(notePath: string): Promise<Result<LineageJournalEntry[], Error>> {
    const legacy = await this.voidStorage.readJson<LineageJournalEntry[]>(
      this.notesDir,
      legacyJournalPath(notePath)
    );
    if (!legacy.ok) return legacy;

    const jsonl = await this.voidStorage.readJsonl<LineageJournalEntry>(
      this.notesDir,
      journalJsonlPath(notePath)
    );
    if (!jsonl.ok) return jsonl;

    return ok([...(legacy.value ?? []), ...jsonl.value]);
  }

  async readSnapshot(notePath: string): Promise<Result<LineageSnapshot | null, Error>> {
    return this.voidStorage.readJson<LineageSnapshot>(
      this.notesDir,
      snapshotPath(notePath)
    );
  }

  async writeSnapshot(notePath: string, snapshot: LineageSnapshot): Promise<Result<void, Error>> {
    const result = await this.voidStorage.writeJson(
      this.notesDir,
      snapshotPath(notePath),
      snapshot
    );
    if (!result.ok) return err(result.error);
    return ok(undefined);
  }
}

function safeNotePath(notePath: string): string {
  return encodeURIComponent(notePath).replace(/\./g, '%2E');
}

function legacyJournalPath(notePath: string): string {
  return `lineage/${safeNotePath(notePath)}.journal.json`;
}

function journalJsonlPath(notePath: string): string {
  return `lineage/${safeNotePath(notePath)}.journal.jsonl`;
}

function snapshotPath(notePath: string): string {
  return `lineage/${safeNotePath(notePath)}.snapshot.json`;
}
