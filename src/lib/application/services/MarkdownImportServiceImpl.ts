/**
 * MarkdownImportServiceImpl - copy external .md files into the notes workspace.
 */

import { createDocumentMeta } from '$lib/domain/values/DocumentMeta';
import type { Document } from '$lib/domain/entities/Document';
import type {
  LineageService,
  MarkdownImportService,
  MarkdownImportSkippedItem,
  MarkdownImportSummary,
  MarkdownImportOptions,
} from '$lib/ports/inbound';
import type { AssetStoragePort, DocumentPort, FileSystemPort, MarkdownSerializerPort } from '$lib/ports/outbound';
import { err, ok, type Result } from '$lib/core';

const MAX_SUFFIX_ATTEMPTS = 99;

export function isStrictMarkdownPath(path: string): boolean {
  return normalizeExternalPath(path).toLowerCase().endsWith('.md');
}

export class MarkdownImportServiceImpl implements MarkdownImportService {
  constructor(
    private readonly files: FileSystemPort,
    private readonly documents: DocumentPort,
    private readonly markdown: MarkdownSerializerPort,
    private readonly lineage?: LineageService,
    private readonly assets?: AssetStoragePort,
    private readonly notesDir?: string,
  ) {}

  async importFiles(
    paths: string[],
    options: MarkdownImportOptions = {},
  ): Promise<Result<MarkdownImportSummary, Error>> {
    try {
      const targetFolder = normalizeTargetFolder(options.targetFolder ?? '');
      const summary: MarkdownImportSummary = { imported: [], skipped: [] };
      const reservedPaths = new Set<string>();

      for (const rawPath of paths) {
        const sourcePath = normalizeExternalPath(rawPath);
        const directoryProbe = await this.files.listDirectory(sourcePath);
        if (directoryProbe.ok) {
          summary.skipped.push(skipped(rawPath, 'unsupported-directory', 'Folder imports are not supported yet.'));
          continue;
        }

        if (!isStrictMarkdownPath(sourcePath)) {
          summary.skipped.push(skipped(rawPath, 'not-markdown', 'Only .md files can be opened.'));
          continue;
        }

        const read = await this.files.readFile(sourcePath);
        if (!read.ok) {
          summary.skipped.push(skipped(rawPath, 'read-failed', read.error.message));
          continue;
        }

        const targetPath = await this.uniqueTargetPath(targetFolder, sourcePath, reservedPaths);
        if (!targetPath.ok) {
          summary.skipped.push(skipped(rawPath, 'write-failed', targetPath.error.message));
          continue;
        }
        reservedPaths.add(targetPath.value);

        const importedMarkdown = await this.rewriteImageReferences(read.value, sourcePath, targetPath.value);
        const parsed = this.markdown.parseDocument(importedMarkdown);
        const title = parsed.meta.title ?? titleFromFilename(targetPath.value);
        const document: Document = {
          path: targetPath.value,
          blocks: parsed.blocks,
          isDirty: false,
          meta: createDocumentMeta({
            ...parsed.meta,
            id: createImportedDocumentId(),
            title,
          }),
        };

        const save = await this.documents.save(document);
        if (!save.ok) {
          summary.skipped.push(skipped(rawPath, 'write-failed', save.error.message));
          reservedPaths.delete(targetPath.value);
          continue;
        }

        const contentMarkdown = parsed.content.trim();
        const lineageResult = await this.lineage?.enqueueMarkdownChange(
          targetPath.value,
          contentMarkdown,
          {
            actor: { kind: 'importer', name: 'Void' },
            intentKind: 'import',
            summary: 'Imported external markdown file',
            captureReason: 'import',
            source: { type: 'file-import' },
          },
        );
        if (lineageResult && !lineageResult.ok) {
          // Import should not fail after the markdown copy succeeded.
          console.warn('Failed to queue import lineage:', lineageResult.error);
        }

        summary.imported.push({ path: targetPath.value, title });
      }

      return ok(summary);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async uniqueTargetPath(
    targetFolder: string,
    sourcePath: string,
    reservedPaths: Set<string>,
  ): Promise<Result<string, Error>> {
    const basename = markdownBasename(sourcePath);
    const stem = basename.replace(/\.md$/i, '') || 'Imported';
    const candidate = (filename: string) => targetFolder ? `${targetFolder}/${filename}` : filename;
    const first = candidate(`${stem}.md`);
    const firstExists = await this.existsOrReserved(first, reservedPaths);
    if (!firstExists.ok) return firstExists;
    if (!firstExists.value) return ok(first);

    for (let suffix = 1; suffix <= MAX_SUFFIX_ATTEMPTS; suffix++) {
      const path = candidate(`${stem}-${suffix}.md`);
      const exists = await this.existsOrReserved(path, reservedPaths);
      if (!exists.ok) return exists;
      if (!exists.value) return ok(path);
    }

    return ok(candidate(`${stem}-${Date.now()}.md`));
  }

  private async existsOrReserved(path: string, reservedPaths: Set<string>): Promise<Result<boolean, Error>> {
    if (reservedPaths.has(path)) return ok(true);
    return this.documents.exists(path);
  }

  private async rewriteImageReferences(
    markdown: string,
    sourcePath: string,
    targetNotePath: string,
  ): Promise<string> {
    if (!this.assets || !this.notesDir) return markdown;

    const sourceDir = sourcePath.split('/').slice(0, -1).join('/');
    const imagePattern = /!\[([^\]]*)]\((?:<([^>]+)>|([^\s)]+))(\s+["'][^"']*["'])?\)/g;
    let output = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = imagePattern.exec(markdown)) !== null) {
      output += markdown.slice(lastIndex, match.index);
      lastIndex = imagePattern.lastIndex;

      const alt = match[1] ?? '';
      const rawPath = (match[2] ?? match[3] ?? '').trim();
      const title = match[4] ?? '';
      const importedPath = await this.importReferencedImage(rawPath, sourceDir, targetNotePath);
      output += importedPath
        ? `![${alt}](${encodeMarkdownPath(importedPath)}${title})`
        : match[0];
    }

    return output + markdown.slice(lastIndex);
  }

  private async importReferencedImage(
    imagePath: string,
    sourceDir: string,
    targetNotePath: string,
  ): Promise<string | null> {
    if (!this.assets || !this.notesDir) return null;
    const cleanPath = decodeURIComponent(imagePath);
    const imported = /^https:\/\//i.test(cleanPath)
      ? await this.assets.downloadImage(this.notesDir, targetNotePath, cleanPath)
      : isRelativeSupportedImagePath(cleanPath)
        ? await this.assets.importFile(this.notesDir, targetNotePath, joinExternalPath(sourceDir, cleanPath))
        : null;

    if (!imported?.ok) return null;
    return pathFromNoteToAsset(targetNotePath, imported.value.relativePath);
  }
}

function normalizeExternalPath(path: string): string {
  const trimmed = path.trim().replace(/^["']|["']$/g, '');
  if (!trimmed.startsWith('file://')) return trimmed.replace(/\\/g, '/');

  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/\\/g, '/');
  } catch {
    return trimmed.slice('file://'.length).replace(/\\/g, '/');
  }
}

function normalizeTargetFolder(folder: string): string {
  const normalized = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Import target folder cannot escape the notes directory: ${folder}`);
  }
  return segments.join('/');
}

function markdownBasename(path: string): string {
  const normalized = normalizeExternalPath(path);
  const basename = normalized.split('/').pop() ?? 'Imported.md';
  const withoutControl = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!withoutControl || withoutControl === '.' || withoutControl === '..') return 'Imported.md';
  return withoutControl.replace(/\.md$/i, '.md');
}

function titleFromFilename(path: string): string {
  const basename = path.split('/').pop() ?? 'Imported.md';
  return basename
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Imported';
}

function createImportedDocumentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isRelativeSupportedImagePath(path: string): boolean {
  if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || path.startsWith('/')) {
    return false;
  }
  const ext = path.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase() ?? '';
  return ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext);
}

function joinExternalPath(baseDir: string, relativePath: string): string {
  const parts = baseDir.split('/').filter(Boolean);
  for (const part of relativePath.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function pathFromNoteToAsset(notePath: string, assetPath: string): string {
  const noteParts = notePath.replace(/\\/g, '/').split('/').filter(Boolean);
  noteParts.pop();
  if (noteParts.length === 0) return assetPath;
  return `${noteParts.map(() => '..').join('/')}/${assetPath}`;
}

function encodeMarkdownPath(path: string): string {
  return /[\s()]/.test(path) ? `<${path.replace(/>/g, '%3E')}>` : path;
}

function skipped(
  path: string,
  reason: MarkdownImportSkippedItem['reason'],
  message: string,
): MarkdownImportSkippedItem {
  return { path, reason, message };
}
