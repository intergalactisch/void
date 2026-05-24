/**
 * MarkdownImportService - imports external markdown files into the workspace.
 *
 * External files are copied into the active notes workspace. The original
 * source files are never modified and their absolute paths are not persisted.
 */

import type { Result } from '$lib/core';

export interface MarkdownImportOptions {
  /** Folder path relative to the current notes root. Empty/null = root. */
  targetFolder?: string | null;
}

export interface MarkdownImportItem {
  /** Imported note path relative to the current notes root. */
  path: string;
  /** Display title derived from frontmatter or filename. */
  title: string;
}

export interface MarkdownImportSkippedItem {
  /** Source path supplied by the file dialog or drag/drop event. */
  path: string;
  reason: 'not-markdown' | 'unsupported-directory' | 'read-failed' | 'write-failed';
  message: string;
}

export interface MarkdownImportSummary {
  imported: MarkdownImportItem[];
  skipped: MarkdownImportSkippedItem[];
}

export interface MarkdownImportService {
  /**
   * Import all valid external `.md` files into the current workspace.
   * Invalid paths are reported in the summary rather than throwing.
   */
  importFiles(
    paths: string[],
    options?: MarkdownImportOptions,
  ): Promise<Result<MarkdownImportSummary, Error>>;
}
