import { err, ok, type Result } from '$lib/core';
import type {
  DocumentService,
  MediaAttachmentBatchResult,
  MediaAttachmentOptions,
  MediaAttachmentResult,
  MediaAttachmentService,
  MediaOrphanReport,
  NoteCollaborationService,
  NotesListItem,
  NotesService,
  ProvenanceService,
} from '$lib/ports/inbound';
import type { AssetMetadata, AssetStoragePort } from '$lib/ports/outbound';

export class MediaAttachmentServiceImpl implements MediaAttachmentService {
  constructor(
    private readonly notesDir: string,
    private readonly assets: AssetStoragePort,
    private readonly collaboration: NoteCollaborationService,
    private readonly documents: DocumentService,
    private readonly notes: NotesService,
    private readonly provenance: ProvenanceService,
  ) {}

  async importLocalImage(
    notePath: string,
    sourcePath: string,
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const result = await this.assets.importFile(this.notesDir, notePath, sourcePath);
    if (!result.ok) return result;
    return ok(await this.withRenderUrl(this.buildImageMarkdown(notePath, result.value, options)));
  }

  async importImageBytes(
    notePath: string,
    originalName: string,
    bytes: Uint8Array | ArrayBuffer | number[],
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const result = await this.assets.importBytes(this.notesDir, notePath, originalName, bytes);
    if (!result.ok) return result;
    return ok(await this.withRenderUrl(this.buildImageMarkdown(notePath, result.value, options)));
  }

  async downloadImage(
    notePath: string,
    url: string,
    options?: MediaAttachmentOptions & { originalName?: string },
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const result = await this.assets.downloadImage(this.notesDir, notePath, url, options?.originalName);
    if (!result.ok) return result;
    const asset: AssetMetadata = {
      ...result.value,
      reviewStatus: 'trusted',
    };
    if (options?.creator !== undefined) asset.creator = options.creator;
    else if (result.value.creator !== undefined) asset.creator = result.value.creator;
    if (options?.license !== undefined) asset.license = options.license;
    else if (result.value.license !== undefined) asset.license = result.value.license;
    return ok(await this.withRenderUrl(this.buildImageMarkdown(notePath, asset, options)));
  }

  async insertExistingAsset(
    notePath: string,
    relativePath: string,
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const result = await this.assets.metadata(this.notesDir, relativePath);
    if (!result.ok) return result;
    return ok(await this.withRenderUrl(this.buildImageMarkdown(notePath, result.value, options)));
  }

  async attachLocalImage(
    notePath: string,
    sourcePath: string,
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const result = await this.importLocalImage(notePath, sourcePath, options);
    if (!result.ok) return result;
    return this.attachPrepared(result.value, options);
  }

  async attachLocalImages(
    notePath: string,
    sourcePaths: string[],
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentBatchResult, Error>> {
    const attached: MediaAttachmentResult[] = [];
    const failed: MediaAttachmentBatchResult['failed'] = [];

    for (const sourcePath of sourcePaths) {
      const perImageOptions = {
        ...options,
        alt: options?.alt && sourcePaths.length === 1
          ? options.alt
          : altFromPath(sourcePath),
      };
      const result = await this.importLocalImage(notePath, sourcePath, perImageOptions);
      if (result.ok) {
        attached.push(result.value);
      } else {
        failed.push({ sourcePath, message: result.error.message });
      }
    }

    const markdown = attached.map((item) => item.markdown).join('\n\n');
    if (!markdown) {
      return ok({
        notePath,
        attached,
        failed,
        markdown,
        inserted: false,
      });
    }

    const placement = options?.placement ?? 'append';
    const insertMarkdown = placement === 'media-section'
      ? await this.mediaSectionMarkdown(notePath, markdown)
      : markdown;
    const label = attached.length === 1 ? 'Attach image' : 'Attach images';
    const insert = placement === 'cursor'
      ? await this.collaboration.insertAtCursor(insertMarkdown, label)
      : await this.collaboration.appendNoteContent(notePath, insertMarkdown, label);

    if (!insert.ok) {
      return ok({
        notePath,
        attached,
        failed,
        markdown,
        inserted: false,
        insertionError: insert.error.message,
      });
    }

    for (const result of attached) {
      await this.recordProvenance(result);
    }

    return ok({
      notePath,
      attached,
      failed,
      markdown,
      inserted: true,
    });
  }

  async attachImageBytes(
    notePath: string,
    originalName: string,
    bytes: Uint8Array | ArrayBuffer | number[],
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const result = await this.importImageBytes(notePath, originalName, bytes, options);
    if (!result.ok) return result;
    return this.attachPrepared(result.value, options);
  }

  async attachRemoteImage(
    notePath: string,
    url: string,
    options?: MediaAttachmentOptions & { originalName?: string },
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const result = await this.downloadImage(notePath, url, options);
    if (!result.ok) return result;
    return this.attachPrepared(result.value, options);
  }

  async listAssets(): Promise<Result<AssetMetadata[], Error>> {
    return this.assets.list(this.notesDir);
  }

  async findReferencingNotePaths(relativePath: string): Promise<Result<string[], Error>> {
    const target = normalizeAssetReference(relativePath);
    for (const note of flattenNotes(this.notes.getState().items)) {
      const refs = await this.referencedAssetsForNote(note.path);
      if (refs.includes(target)) {
        // The first referencing note is enough to open the asset's source.
        return ok([note.path]);
      }
    }
    return ok([]);
  }

  /** Workspace-relative `assets/...` references contained in a note's markdown. */
  private async referencedAssetsForNote(notePath: string): Promise<string[]> {
    const content = await this.documents.readContent(notePath);
    if (!content.ok) return [];
    return extractImageReferences(content.value, notePath).map(normalizeAssetReference);
  }

  async cleanupOrphans(options?: { dryRun?: boolean }): Promise<Result<MediaOrphanReport, Error>> {
    const assets = await this.assets.list(this.notesDir);
    if (!assets.ok) return assets;

    const referenced = new Set<string>();
    for (const note of flattenNotes(this.notes.getState().items)) {
      for (const ref of await this.referencedAssetsForNote(note.path)) {
        referenced.add(ref);
      }
    }

    const orphaned = assets.value.filter((asset) => !referenced.has(normalizeAssetReference(asset.relativePath)));
    const deleted: string[] = [];
    if (!options?.dryRun) {
      for (const asset of orphaned) {
        const result = await this.assets.delete(this.notesDir, asset.relativePath);
        if (result.ok) deleted.push(asset.relativePath);
      }
    }

    return ok({
      referenced: Array.from(referenced).sort(),
      assets: assets.value,
      orphaned,
      deleted,
    });
  }

  async saveAssetAs(relativePath: string, destinationPath: string): Promise<Result<AssetMetadata, Error>> {
    return this.assets.saveAs(this.notesDir, relativePath, destinationPath);
  }

  async deleteAsset(relativePath: string): Promise<Result<void, Error>> {
    return this.assets.delete(this.notesDir, relativePath);
  }

  async resolveRenderUrl(relativePath: string): Promise<Result<string, Error>> {
    return this.assets.resolveRenderUrl(this.notesDir, relativePath);
  }

  buildImageMarkdown(
    notePath: string,
    asset: AssetMetadata,
    options?: MediaAttachmentOptions,
  ): MediaAttachmentResult {
    const alt = options?.alt ?? asset.originalName ?? asset.fileName.replace(/\.[^.]+$/, '');
    const title = options?.title ?? undefined;
    const markdownPath = pathFromNoteToAsset(notePath, asset.relativePath);
    const markdown = `![${escapeAlt(alt)}](${encodeMarkdownPath(markdownPath)}${title ? ` "${escapeTitle(title)}"` : ''})`;
    return {
      notePath,
      asset,
      markdownPath,
      markdown,
    };
  }

  private async attachPrepared(
    prepared: MediaAttachmentResult,
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>> {
    const placement = options?.placement ?? 'append';
    const markdown = placement === 'media-section'
      ? await this.mediaSectionMarkdown(prepared.notePath, prepared.markdown)
      : prepared.markdown;
    const result = placement === 'cursor'
      ? await this.collaboration.insertAtCursor(markdown, 'Attach image')
      : await this.collaboration.appendNoteContent(prepared.notePath, markdown, 'Attach image');

    if (!result.ok) return err(result.error);
    await this.recordProvenance(prepared);
    return ok(prepared);
  }

  private async mediaSectionMarkdown(notePath: string, markdown: string): Promise<string> {
    const current = await this.documents.readContent(notePath);
    if (current.ok && /^##\s+Media\s*$/im.test(current.value)) {
      return markdown;
    }
    return `## Media\n\n${markdown}`;
  }

  private async withRenderUrl(result: MediaAttachmentResult): Promise<MediaAttachmentResult> {
    const render = await this.resolveRenderUrl(result.asset.relativePath);
    return render.ok ? { ...result, renderUrl: render.value } : result;
  }

  private async recordProvenance(result: MediaAttachmentResult): Promise<void> {
    await this.provenance.record(result.notePath, {
      type: 'ai_action',
      blocks: [],
      action: 'media:attach-image',
      result: JSON.stringify({
        assetPath: result.asset.relativePath,
        originalUrl: result.asset.sourceUrl,
        finalUrl: result.asset.finalUrl,
        contentType: result.asset.contentType,
        hash: result.asset.sha256,
        dimensions: dimensionsOf(result.asset),
        creator: result.asset.creator ?? null,
        license: result.asset.license ?? null,
        fetchedAt: result.asset.fetchedAt ?? null,
        reviewStatus: result.asset.reviewStatus ?? 'trusted',
      }),
      accepted: true,
    });
  }
}

function pathFromNoteToAsset(notePath: string, assetPath: string): string {
  const parts = normalizeSlashes(notePath).split('/').filter(Boolean);
  parts.pop();
  if (parts.length === 0) return assetPath;
  return `${parts.map(() => '..').join('/')}/${assetPath}`;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeAssetReference(path: string): string {
  const normalized = normalizeSlashes(path);
  const assetIndex = normalized.indexOf('assets/');
  return assetIndex >= 0 ? normalized.slice(assetIndex) : normalized;
}

function escapeAlt(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

function escapeTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function encodeMarkdownPath(path: string): string {
  return /[\s()]/.test(path) ? `<${path.replace(/>/g, '%3E')}>` : path;
}

function altFromPath(path: string): string {
  const basename = path.split(/[\\/]/).pop() || 'image';
  return basename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'image';
}

function extractImageReferences(markdown: string, notePath: string): string[] {
  const refs: string[] = [];
  const imagePattern = /!\[[^\]]*]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(markdown)) !== null) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    if (!raw || /^https?:\/\//i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    refs.push(resolveNoteRelativeAsset(notePath, raw));
  }
  return refs;
}

function resolveNoteRelativeAsset(notePath: string, imagePath: string): string {
  if (imagePath.startsWith('assets/')) return imagePath;
  const noteParts = normalizeSlashes(notePath).split('/').filter(Boolean);
  noteParts.pop();
  const combined: string[] = [...noteParts];
  for (const part of normalizeSlashes(imagePath).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') combined.pop();
    else combined.push(part);
  }
  return combined.join('/');
}

function flattenNotes(items: NotesListItem[]): NotesListItem[] {
  const out: NotesListItem[] = [];
  for (const item of items) {
    if (item.isFolder) {
      out.push(...flattenNotes(item.children ?? []));
    } else {
      out.push(item);
    }
  }
  return out;
}

function dimensionsOf(asset: AssetMetadata): { width: number | null; height: number | null } | null {
  if (!asset.width && !asset.height) return null;
  return {
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}
