/**
 * Small route helpers for external markdown imports.
 *
 * The import service owns validation/copying. These helpers keep UI orchestration
 * testable without mounting the whole Svelte route.
 */

import type { MarkdownImportSummary } from '$lib/ports/inbound';

export interface MarkdownImportLocationState {
  activeFolderPath: string | null;
  selectedPath: string | null;
}

export interface ImportedMarkdownOpenHandlers {
  refreshNotes: () => Promise<void>;
  openDocument: (path: string) => Promise<unknown>;
  selectNote: (path: string) => void;
}

export interface MarkdownDropPreview {
  paths: string[];
  totalCount: number;
  markdownCount: number;
  unsupportedCount: number;
  state: 'valid' | 'mixed' | 'invalid';
}

export function resolveMarkdownImportTargetFolder(state: MarkdownImportLocationState): string {
  if (state.activeFolderPath) return state.activeFolderPath;
  if (!state.selectedPath) return '';

  const lastSlash = state.selectedPath.lastIndexOf('/');
  return lastSlash > 0 ? state.selectedPath.slice(0, lastSlash) : '';
}

export function formatMarkdownImportTargetFolder(folder: string): string {
  if (!folder) return 'Workspace root';
  return folder.split('/').filter(Boolean).join(' / ');
}

export function formatMarkdownDropAcceptedLabel(preview: MarkdownDropPreview): string {
  const markdownPaths = preview.paths.filter(isMarkdownPath);
  if (markdownPaths.length === 1) {
    return basenameForDisplay(markdownPaths[0] ?? '');
  }
  return `${markdownPaths.length} Markdown files`;
}

export function formatMarkdownDropSkippedLabel(preview: MarkdownDropPreview): string {
  const skippedPaths = preview.paths.filter((path) => !isMarkdownPath(path));
  if (skippedPaths.length === 1) {
    return `${basenameForDisplay(skippedPaths[0] ?? '')} skipped`;
  }
  return `${skippedPaths.length} skipped`;
}

export function summarizeMarkdownDropPaths(paths: string[]): MarkdownDropPreview {
  const markdownCount = paths.filter(isMarkdownPath).length;
  const totalCount = paths.length;
  const unsupportedCount = totalCount - markdownCount;
  const state = markdownCount === 0
    ? 'invalid'
    : unsupportedCount > 0
      ? 'mixed'
      : 'valid';

  return {
    paths,
    totalCount,
    markdownCount,
    unsupportedCount,
    state,
  };
}

function isMarkdownPath(path: string): boolean {
  return path.trim().toLowerCase().endsWith('.md');
}

function basenameForDisplay(path: string): string {
  const normalized = normalizePathForDisplay(path);
  return normalized.split('/').pop() || normalized || 'Markdown file';
}

function normalizePathForDisplay(path: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, '');
  if (!trimmed.startsWith('file://')) return trimmed.replace(/\\/g, '/');

  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/\\/g, '/');
  } catch {
    return trimmed.slice('file://'.length).replace(/\\/g, '/');
  }
}

export async function openImportedMarkdownSummary(
  summary: MarkdownImportSummary,
  handlers: ImportedMarkdownOpenHandlers,
): Promise<void> {
  if (summary.imported.length === 0) return;

  await handlers.refreshNotes();
  for (const item of summary.imported) {
    await handlers.openDocument(item.path);
  }

  const last = summary.imported.at(-1);
  if (last) {
    handlers.selectNote(last.path);
  }
}
