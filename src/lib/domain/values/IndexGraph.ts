/**
 * IndexGraph - Types for the semantic note index
 *
 * Represents concept extraction and note relationships.
 * Stored in .void/index/graph.json.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export interface NoteIndex {
  /** Extracted concepts/topics */
  concepts: string[];
  /** Last modified ISO timestamp */
  modified: string;
  /** Word count */
  wordCount: number;
}

export interface Relationship {
  /** Source note filename */
  from: string;
  /** Target note filename */
  to: string;
  /** Relationship type */
  type: 'shared-concept' | 'reference' | 'continuation';
  /** The concept that connects them */
  concept: string;
  /** Connection strength 0-1 */
  strength: number;
}

export interface IndexGraph {
  /** Map of note filename -> index data */
  notes: Record<string, NoteIndex>;
  /** Relationships between notes */
  relationships: Relationship[];
}

export interface RelatedNote {
  /** Note path */
  path: string;
  /** Note title */
  title: string;
  /** Shared concepts */
  concepts: string[];
  /** Overall relationship strength */
  strength: number;
}

export interface NoteMatch {
  /** Note path */
  path: string;
  /** Note title */
  title: string;
  /** The concept that matched */
  matchedConcept: string;
  /** Relevance score 0-1 */
  relevance: number;
}

export function createEmptyGraph(): IndexGraph {
  return { notes: {}, relationships: [] };
}
