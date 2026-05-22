/**
 * ProvenanceService - Inbound port for interaction history
 *
 * Records and queries the history of human-AI interactions
 * on individual documents. Each note has its own provenance log.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { ProvenanceEvent, ProvenanceEventType } from '$lib/domain/values/ProvenanceEvent';

export interface ProvenanceService {
  /**
   * Record a new provenance event for a note.
   * Automatically generates ID and timestamp.
   */
  record(
    noteName: string,
    event: Omit<ProvenanceEvent, 'id' | 'ts'>
  ): Promise<Result<ProvenanceEvent, Error>>;

  /**
   * Get the full interaction history for a note.
   * Returns events in chronological order.
   */
  getHistory(noteName: string): Promise<Result<ProvenanceEvent[], Error>>;

  /**
   * Get the count of AI-originated interactions for a note.
   * Used for the ai_touches frontmatter field.
   */
  getAITouchCount(noteName: string): Promise<Result<number, Error>>;

  /**
   * Get recent events of a specific type.
   */
  getRecentByType(
    noteName: string,
    type: ProvenanceEventType,
    limit?: number
  ): Promise<Result<ProvenanceEvent[], Error>>;
}
