/**
 * NoteCollaborationService - AI/user co-editing orchestration.
 *
 * Tools and AI workflows use this service for note mutations so an open,
 * dirty editor is never overwritten by a headless disk write. The service
 * applies active-note edits through block-aware editor commands and falls
 * back to DocumentService for inactive notes.
 */

import type { Result } from '$lib/core';
import type { Block } from '$lib/domain';
import type { LineageRecordOptions } from './LineageService';

export interface UpdateNoteParams {
  noteId: string;
  title?: string;
  content?: string;
  tags?: string[];
  label?: string;
  lineage?: LineageRecordOptions;
}

export interface CreateCollaborativeNoteParams {
  title?: string;
  content?: string;
  tags?: string[];
  folder?: string;
  autoFocus?: boolean;
  lineage?: LineageRecordOptions;
}

export interface BlockMutationParams {
  blockId: string;
  markdown?: string;
  label?: string;
  lineage?: LineageRecordOptions;
}

export interface NoteCollaborationService {
  /**
   * Update a note while respecting the active editor. Active note content is
   * applied through block-level editor mutations; inactive notes are written
   * headlessly.
   */
  updateNote(params: UpdateNoteParams): Promise<Result<void, Error>>;

  /**
   * Create a note through the normal document service. This still centralizes
   * AI-created notes so the UI/tool path does not bypass collaboration policy.
   */
  createNote(params: CreateCollaborativeNoteParams): Promise<Result<{ path: string; title: string }, Error>>;

  /** Apply complete markdown content to the active editor or inactive note. */
  applyNoteContent(
    noteId: string,
    markdown: string,
    label?: string,
    lineage?: LineageRecordOptions
  ): Promise<Result<void, Error>>;

  /**
   * Append markdown to a note while respecting the active editor. Active notes
   * append to the current visible blocks; inactive notes use an atomic document
   * transform.
   */
  appendNoteContent(
    noteId: string,
    markdown: string,
    label?: string,
    lineage?: LineageRecordOptions
  ): Promise<Result<void, Error>>;

  /** Replace a single visible editor block by id. */
  replaceBlock(params: Required<Pick<BlockMutationParams, 'blockId' | 'markdown'>> & Pick<BlockMutationParams, 'label' | 'lineage'>): Promise<Result<void, Error>>;

  /** Insert markdown blocks after a visible editor block by id. */
  insertBlocksAfter(params: Required<Pick<BlockMutationParams, 'blockId' | 'markdown'>> & Pick<BlockMutationParams, 'label' | 'lineage'>): Promise<Result<void, Error>>;

  /** Delete a visible editor block by id. */
  deleteBlock(params: Required<Pick<BlockMutationParams, 'blockId'>> & Pick<BlockMutationParams, 'label' | 'lineage'>): Promise<Result<void, Error>>;

  /** Insert markdown at the current editor location. */
  insertAtCursor(markdown: string, label?: string): Promise<Result<void, Error>>;

  /** Whether a note path resolves to the currently open editor document. */
  isActiveNote(noteId: string): boolean;

  /** Current active document blocks, used by tests and tool summaries. */
  getActiveBlocks(): Block[];
}
