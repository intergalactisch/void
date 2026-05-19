/**
 * IndexService - Inbound port for semantic note indexing
 *
 * Manages concept extraction, note relationships, and cross-note search.
 * Index data is stored in .void/index/graph.json via VoidStoragePort.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { IndexGraph, RelatedNote, NoteMatch } from '$lib/domain/values/IndexGraph';

/** Context excerpt for a related note, ready for system prompt injection */
export interface RelatedContext {
  path: string;
  title: string;
  concepts: string[];
  excerpt: string;
  strength: number;
}

export interface IndexService {
  /**
   * Extract concepts from a note and update the index.
   */
  indexNote(noteName: string, content: string): Promise<Result<void, Error>>;

  /**
   * Re-index all notes.
   */
  indexAll(): Promise<Result<void, Error>>;

  /**
   * Find notes related to a given note.
   */
  findRelated(noteName: string, limit?: number): Promise<Result<RelatedNote[], Error>>;

  /**
   * Get related notes with content excerpts for AI context injection.
   * Returns up to `limit` notes with truncated content.
   */
  getRelatedContext(noteName: string, limit?: number): Promise<Result<RelatedContext[], Error>>;

  /**
   * Search for notes by concept.
   */
  searchConcept(concept: string): Promise<Result<NoteMatch[], Error>>;

  /**
   * Get the full index graph.
   */
  getGraph(): Promise<Result<IndexGraph, Error>>;
}
