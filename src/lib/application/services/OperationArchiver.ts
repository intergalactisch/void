/**
 * OperationArchiver — sidecar persistence for completed operations.
 *
 * Extracted from OperationServiceImpl so the operation queue/dispatch
 * loop stays focused on running and tracking work. The archiver handles
 * the three artifact-system concerns that fire when an operation
 * finishes:
 *
 *   1. **Undo frames** — snapshots of every target note's contents
 *      *before* the operation ran, written to `.void/undo/{id}.json`.
 *      Used by `/replay` and the operations UI.
 *   2. **Digest** — append a one-line summary to `.void/digest.jsonl`
 *      so users can scan their AI history.
 *   3. **Retention** — prune older undo frames so the directory doesn't
 *      grow unbounded.
 *
 * Failures are logged at warn level and swallowed — these are best-effort
 * sidecars, not essential to the user-facing operation flow.
 */

import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { Operation } from '$lib/domain/entities/Operation';
import {
  createUndoFrame,
  type UndoFrameEntry,
} from '$lib/domain/values/UndoFrame';
import { createDigestEntry } from '$lib/domain/values/OperationDigest';
import { getLogger } from '$lib/logging';

const log = getLogger('OperationArchiver');

/** Maximum number of undo frames to retain in `.void/undo/`. */
const UNDO_RETENTION_LIMIT = 20;

export interface OperationArchiverDeps {
  documentService: DocumentService;
  voidStorage: VoidStoragePort;
  notesPath: string;
}

export class OperationArchiver {
  private readonly documentService: DocumentService;
  private readonly voidStorage: VoidStoragePort;
  private readonly notesPath: string;

  constructor(deps: OperationArchiverDeps) {
    this.documentService = deps.documentService;
    this.voidStorage = deps.voidStorage;
    this.notesPath = deps.notesPath;
  }

  /**
   * Snapshot every target note's contents *before* the operation runs
   * and persist them as an undo frame. No-op when the operation has no
   * target notes (read-only operations).
   */
  async createUndoFrame(operation: Operation): Promise<void> {
    if (operation.targetNotes.length === 0) return;

    try {
      const entries: UndoFrameEntry[] = [];
      for (const notePath of operation.targetNotes) {
        const result = await this.documentService.readContent(notePath);
        if (result.ok) {
          entries.push({ notePath, contentBefore: result.value });
        }
      }

      if (entries.length > 0) {
        const frame = createUndoFrame(operation.id, entries);
        await this.voidStorage.writeJson(
          this.notesPath,
          `undo/${operation.id}.json`,
          frame
        );
      }
    } catch (e) {
      log.warn('Failed to create undo frame', {
        operationId: operation.id,
        error: String(e),
      });
    }
  }

  /**
   * Append a one-line digest entry recording how an operation finished.
   * Called for every terminal status (completed/cancelled/failed).
   */
  async writeDigest(operation: Operation): Promise<void> {
    try {
      const status =
        operation.status === 'completed'
          ? ('completed' as const)
          : operation.status === 'cancelled'
            ? ('cancelled' as const)
            : ('failed' as const);

      const durationMs =
        operation.startedAt && operation.completedAt
          ? operation.completedAt.getTime() - operation.startedAt.getTime()
          : 0;

      const entry = createDigestEntry({
        operationId: operation.id,
        label: operation.label,
        prompt: operation.prompt,
        status,
        notesAffected: operation.targetNotes,
        durationMs,
      });

      await this.voidStorage.appendDigest(this.notesPath, entry);
    } catch (e) {
      log.warn('Failed to write operation digest', {
        operationId: operation.id,
        error: String(e),
      });
    }
  }

  /**
   * Prune the oldest undo frames so `.void/undo/` stays bounded.
   * Keeps the most recent `UNDO_RETENTION_LIMIT` frames; the rest are
   * cleared by writing `null` (the void-storage adapter treats this as
   * a deletion shim — the file remains on disk as an empty marker but
   * the JSON is replaced with a tombstone).
   */
  async pruneUndoFrames(): Promise<void> {
    try {
      const listResult = await this.voidStorage.listDir(this.notesPath, 'undo');
      if (!listResult.ok) return;

      const files = listResult.value.filter((f) => f.endsWith('.json')).sort();
      if (files.length <= UNDO_RETENTION_LIMIT) return;

      const toDelete = files.slice(0, files.length - UNDO_RETENTION_LIMIT);
      for (const file of toDelete) {
        await this.voidStorage.writeJson(this.notesPath, `undo/${file}`, null);
      }
    } catch {
      // Best-effort cleanup
    }
  }
}
