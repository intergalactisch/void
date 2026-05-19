/**
 * VoidStoragePort - Outbound port for .void/ sidecar storage
 *
 * Defines the interface for reading/writing files in the .void/
 * directory alongside the user's notes. Used by ProvenanceService,
 * IndexService, BranchService, and PulseService.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import type { OperationDigest } from '$lib/domain/values/OperationDigest';

export interface VoidStoragePort {
  /**
   * Ensure the .void/ directory structure exists.
   * Creates all subdirectories (provenance, conversations, branches, index, insights).
   */
  ensureStructure(notesDir: string): Promise<Result<void, Error>>;

  /**
   * Append a provenance event to a note's history file.
   * Creates the file if it doesn't exist.
   */
  appendProvenance(
    notesDir: string,
    noteName: string,
    event: ProvenanceEvent
  ): Promise<Result<void, Error>>;

  /**
   * Read all provenance events for a note.
   * Returns empty array if no history exists.
   */
  readProvenance(
    notesDir: string,
    noteName: string
  ): Promise<Result<ProvenanceEvent[], Error>>;

  /**
   * Write JSON data to a .void/ path.
   * Creates parent directories if needed.
   * @param relativePath - Path relative to .void/ (e.g., "index/graph.json")
   */
  writeJson(
    notesDir: string,
    relativePath: string,
    data: unknown
  ): Promise<Result<void, Error>>;

  /**
   * Read JSON data from a .void/ path.
   * Returns null if file doesn't exist.
   * @param relativePath - Path relative to .void/ (e.g., "index/graph.json")
   */
  readJson<T>(
    notesDir: string,
    relativePath: string
  ): Promise<Result<T | null, Error>>;

  /**
   * Append one JSON-serializable entry to a .void/ JSONL path.
   * Creates parent directories and the file if needed.
   * @param relativePath - Path relative to .void/ (e.g., "lineage/note.journal.jsonl")
   */
  appendJsonl(
    notesDir: string,
    relativePath: string,
    entry: unknown
  ): Promise<Result<void, Error>>;

  /**
   * Read all valid JSONL entries from a .void/ path.
   * Returns empty array if file doesn't exist.
   * @param relativePath - Path relative to .void/ (e.g., "lineage/note.journal.jsonl")
   */
  readJsonl<T>(
    notesDir: string,
    relativePath: string
  ): Promise<Result<T[], Error>>;

  /**
   * List files in a .void/ subdirectory.
   * Returns file names (not full paths).
   * Returns empty array if directory doesn't exist.
   */
  listDir(
    notesDir: string,
    relativePath: string
  ): Promise<Result<string[], Error>>;

  /**
   * Append an operation digest entry to .void/operations/digest.jsonl.
   * Creates the file if it doesn't exist.
   */
  appendDigest(
    notesDir: string,
    entry: OperationDigest
  ): Promise<Result<void, Error>>;
}
