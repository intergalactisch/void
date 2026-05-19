/**
 * FrecencyService - Inbound port for tracking recency × frequency.
 *
 * Tracks how often and how recently the user has interacted with commands
 * and notes. Surfaces "Recent commands" and "Recently visited notes" in
 * the palette default mode and biases ranking toward recently-used items.
 *
 * Persisted to .void/index/frecency.json via VoidStoragePort. Command writes
 * are throttled (≤1/10s) to avoid hammering disk on every keystroke; note
 * writes persist immediately so the sidebar's Recent section survives restarts.
 */

import type { Result } from '$lib/core';

export type FrecencyKind = 'command' | 'note';

export interface FrecencyEntry {
  /** ID being scored (command id, note path). */
  id: string;
  /** Kind so commands and notes don't collide. */
  kind: FrecencyKind;
  /** Number of times invoked. */
  count: number;
  /** Last access timestamp (ms since epoch). */
  lastAt: number;
}

export interface FrecencyService {
  /** Load persisted state from disk. Idempotent. */
  load(): Promise<Result<void, Error>>;

  /** Record a single interaction. Updates count + lastAt and queues persistence. */
  record(kind: FrecencyKind, id: string): void;

  /** Compute the frecency score for an id. Higher = more relevant. */
  score(kind: FrecencyKind, id: string): number;

  /** Top `limit` ids of `kind` sorted by score (descending). */
  topRecent(kind: FrecencyKind, limit: number): string[];

  /** Last-accessed entries of `kind` sorted newest first. */
  lastAccessed(kind: FrecencyKind, limit: number): FrecencyEntry[];

  /** Compare two ids for sorting; positive ⇒ `a` more relevant. */
  compare(kind: FrecencyKind, a: string, b: string): number;

  /** Remove a single id from persisted tracking. */
  forget(kind: FrecencyKind, id: string): void;

  /** Move one tracked id to a new id while preserving its score data. */
  move(kind: FrecencyKind, oldId: string, newId: string): void;

  /** Clear all tracked entries for one kind. */
  clear(kind: FrecencyKind): void;
}
