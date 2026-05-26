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
