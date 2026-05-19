/**
 * DocumentService - Inbound port for programmatic document access
 *
 * Provides a headless API for reading and writing document content using
 * markdown strings. Designed for AI tools that need to create/read/update
 * notes without going through the interactive ProseMirror editor.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core';
import type { DocumentMeta } from '$lib/domain/values/DocumentMeta';
import type { OperationSource } from '$lib/pipeline/types';
import type { LineageRecordOptions } from './LineageService';

/**
 * Inbound port - programmatic document access for AI tools.
 *
 * Accepts markdown strings (what the AI generates and what's stored on disk)
 * and bypasses EditorService entirely (no ProseMirror dependency).
 */
export interface DocumentService {
  /**
   * Read document content as markdown.
   * @param path - Relative path to the document
   * @returns Result containing markdown string or an error
   */
  readContent(path: string): Promise<Result<string, Error>>;

  /**
   * Write markdown content to a document, preserving metadata.
   * @param path - Relative path to the document
   * @param markdown - Markdown content to write
   * @returns Result indicating success or failure
   */
  writeContent(
    path: string,
    markdown: string,
    lineage?: LineageRecordOptions
  ): Promise<Result<void, Error>>;

  /**
   * Atomically read, transform, and write markdown content for a document.
   * Use this for append/merge flows where the new content depends on the
   * latest saved file contents.
   * @param path - Relative path to the document
   * @param transform - Function that receives current markdown and returns next markdown
   * @returns Result containing the markdown that was saved, or an error
   */
  transformContent(
    path: string,
    transform: (currentMarkdown: string) => string | Promise<string>,
    lineage?: LineageRecordOptions
  ): Promise<Result<string, Error>>;

  /**
   * Read document metadata.
   * @param path - Relative path to the document
   * @returns Result containing document metadata or an error
   */
  readMeta(path: string): Promise<Result<DocumentMeta, Error>>;

  /**
   * Update document metadata (partial update, preserves unspecified fields).
   * @param path - Relative path to the document
   * @param updates - Partial metadata to merge
   * @returns Result indicating success or failure
   */
  updateMeta(path: string, updates: Partial<DocumentMeta>): Promise<Result<void, Error>>;

  /**
   * Create a new document with optional markdown content.
   * @param folder - Folder path to create in (empty for root)
   * @param title - Document title
   * @param markdown - Optional initial markdown content
   * @param source - Who initiated this operation (controls side effects like auto-focus)
   * @returns Result containing the new document's path and title, or an error
   */
  createWithContent(
    folder: string,
    title: string,
    markdown?: string,
    source?: OperationSource,
    lineage?: LineageRecordOptions
  ): Promise<Result<{ path: string; title: string }, Error>>;
}
