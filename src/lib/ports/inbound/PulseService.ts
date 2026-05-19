/**
 * PulseService - Inbound port for proactive intelligence
 *
 * The Pulse system runs background analysis on notes to surface
 * contradictions, stale content, overdue items, and new connections.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { Insight } from '$lib/domain/entities/Insight';

export interface PulseService {
  /**
   * Run a full analysis pass on all notes.
   * Called on app startup (debounced) and after note saves.
   */
  analyze(): Promise<Result<Insight[], Error>>;

  /**
   * Run analysis on a single note (after save).
   */
  analyzeNote(noteName: string): Promise<Result<Insight[], Error>>;

  /**
   * Get all pending (non-dismissed) insights.
   */
  getInsights(): Promise<Result<Insight[], Error>>;

  /**
   * Get insight count (for badge display).
   */
  getInsightCount(): Promise<Result<number, Error>>;

  /**
   * Dismiss an insight (user acknowledged it).
   */
  dismiss(insightId: string): Promise<Result<void, Error>>;

  /**
   * Dismiss all insights.
   */
  dismissAll(): Promise<Result<void, Error>>;
}
