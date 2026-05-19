/**
 * RelationsService - Inbound port for note backlinks and outgoing links.
 *
 * Parses note markdown for [[wikilinks]] and [text](path.md) links to build
 * a directed link graph. Backlinks (incoming) and outgoing links are both
 * exposed so the UI can render a relations panel next to the active note.
 *
 * Builds on existing NotesService (note tree) and DocumentService
 * (content reading); caches results in memory and invalidates on note:saved.
 */

import type { Result } from '$lib/core';

export interface NoteLink {
  /** Path of the linked note (resolved against the notes root). */
  path: string;
  /** Display title resolved from the notes index. */
  title: string;
  /** The text inside the link (`[text]` or `[[anchor]]`). May be empty. */
  linkText: string;
  /** Surrounding paragraph for hover preview. */
  context: string;
  /** Line number where the link occurs (1-indexed). */
  line: number;
}

export interface RelationsService {
  /**
   * Notes that link TO `notePath`. Streamed by file order.
   */
  getBacklinks(notePath: string): Promise<Result<NoteLink[], Error>>;

  /**
   * Notes that `notePath` links FROM (outgoing references).
   */
  getOutgoingLinks(notePath: string): Promise<Result<NoteLink[], Error>>;

  /**
   * Force re-scan of the link graph. Normally invoked automatically on
   * note:saved events, but tests and the UI may trigger manually.
   */
  refresh(): Promise<Result<void, Error>>;

  /**
   * Subscribe to graph changes. Returns unsubscribe.
   */
  subscribe(callback: () => void): () => void;
}
