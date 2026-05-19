/**
 * Insight - Proactive intelligence entity from the Pulse system
 *
 * An insight represents something the app noticed automatically —
 * contradictions, stale notes, overdue items, new connections.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { InsightType } from '../values/InsightType';

export interface Insight {
  /** Unique insight ID */
  id: string;

  /** Type of insight */
  type: InsightType;

  /** When the insight was created */
  created: string;

  /** Short title */
  title: string;

  /** Detailed message */
  message: string;

  /** The source note that triggered this insight */
  sourceNote: string;

  /** Related note (for contradictions, connections) */
  relatedNote: string | null;

  /** Whether the user dismissed this insight */
  dismissed: boolean;
}

/**
 * Create a new insight.
 */
export function createInsight(params: {
  type: InsightType;
  title: string;
  message: string;
  sourceNote: string;
  relatedNote?: string | null;
}): Insight {
  return {
    id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: params.type,
    created: new Date().toISOString(),
    title: params.title,
    message: params.message,
    sourceNote: params.sourceNote,
    relatedNote: params.relatedNote ?? null,
    dismissed: false,
  };
}

/**
 * Dismiss an insight.
 */
export function dismissInsight(insight: Insight): Insight {
  return { ...insight, dismissed: true };
}
