/**
 * Generic external file drop helpers.
 *
 * Tauri reports Finder/Explorer drops at the window level. These helpers keep
 * file kind classification outside markdown import so each accepted kind can be
 * routed to its own workflow.
 */

export const SUPPORTED_EXTERNAL_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'] as const;

const SUPPORTED_IMAGE_EXTENSION_SET = new Set<string>(SUPPORTED_EXTERNAL_IMAGE_EXTENSIONS);

export type ExternalFileDropState = 'markdown' | 'image' | 'mixed' | 'invalid';

export interface ExternalFileDropSummary {
  paths: string[];
  totalCount: number;
  markdownPaths: string[];
  imagePaths: string[];
  unsupportedPaths: string[];
  markdownCount: number;
  imageCount: number;
  unsupportedCount: number;
  state: ExternalFileDropState;
}

export function summarizeExternalFileDropPaths(paths: string[]): ExternalFileDropSummary {
  const markdownPaths: string[] = [];
  const imagePaths: string[] = [];
  const unsupportedPaths: string[] = [];

  for (const path of paths) {
    if (isExternalMarkdownPath(path)) {
      markdownPaths.push(path);
    } else if (isExternalImagePath(path)) {
      imagePaths.push(path);
    } else {
      unsupportedPaths.push(path);
    }
  }

  const validKindCount = Number(markdownPaths.length > 0) + Number(imagePaths.length > 0);
  const state: ExternalFileDropState =
    markdownPaths.length === 0 && imagePaths.length === 0
      ? 'invalid'
      : unsupportedPaths.length > 0 || validKindCount > 1
        ? 'mixed'
        : markdownPaths.length > 0
          ? 'markdown'
          : 'image';

  return {
    paths,
    totalCount: paths.length,
    markdownPaths,
    imagePaths,
    unsupportedPaths,
    markdownCount: markdownPaths.length,
    imageCount: imagePaths.length,
    unsupportedCount: unsupportedPaths.length,
    state,
  };
}

export function isExternalMarkdownPath(path: string): boolean {
  return extensionForExternalPath(path) === 'md';
}

export function isExternalImagePath(path: string): boolean {
  return SUPPORTED_IMAGE_EXTENSION_SET.has(extensionForExternalPath(path));
}

export function formatExternalDropMarkdownLabel(summary: ExternalFileDropSummary): string {
  if (summary.markdownPaths.length === 1) {
    return basenameForDisplay(summary.markdownPaths[0] ?? '');
  }
  return `${summary.markdownPaths.length} Markdown files`;
}

export function formatExternalDropImageLabel(summary: ExternalFileDropSummary): string {
  if (summary.imagePaths.length === 1) {
    return basenameForDisplay(summary.imagePaths[0] ?? '');
  }
  return `${summary.imagePaths.length} images`;
}

export function formatExternalDropSkippedLabel(summary: ExternalFileDropSummary): string {
  if (summary.unsupportedPaths.length === 1) {
    return `${basenameForDisplay(summary.unsupportedPaths[0] ?? '')} skipped`;
  }
  return `${summary.unsupportedPaths.length} skipped`;
}

export function basenameForDisplay(path: string): string {
  const normalized = normalizeExternalFilePath(path);
  return normalized.split('/').pop() || normalized || 'file';
}

export function normalizeExternalFilePath(path: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, '');
  if (!trimmed.startsWith('file://')) return trimmed.replace(/\\/g, '/');

  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/\\/g, '/');
  } catch {
    return trimmed.slice('file://'.length).replace(/\\/g, '/');
  }
}

function extensionForExternalPath(path: string): string {
  const normalized = normalizeExternalFilePath(path).split(/[?#]/, 1)[0] ?? '';
  const basename = normalized.split('/').pop() ?? '';
  const lastDot = basename.lastIndexOf('.');
  if (lastDot < 0 || lastDot === basename.length - 1) return '';
  return basename.slice(lastDot + 1).toLowerCase();
}
