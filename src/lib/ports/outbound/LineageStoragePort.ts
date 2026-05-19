/**
 * LineageStoragePort - persistence for .void/lineage sidecars.
 *
 * Implementations store the append-only journal and materialized snapshot for
 * each markdown note without changing the markdown file itself.
 */

import type { Result } from '$lib/core/result';
import type { LineageJournalEntry, LineageSnapshot } from '$lib/domain/entities/Lineage';

export interface LineageStoragePort {
  appendEntries(notePath: string, entries: LineageJournalEntry[]): Promise<Result<void, Error>>;
  readJournal(notePath: string): Promise<Result<LineageJournalEntry[], Error>>;
  readSnapshot(notePath: string): Promise<Result<LineageSnapshot | null, Error>>;
  writeSnapshot(notePath: string, snapshot: LineageSnapshot): Promise<Result<void, Error>>;
}
