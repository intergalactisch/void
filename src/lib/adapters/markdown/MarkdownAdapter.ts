/**
 * MarkdownAdapter - Secondary adapter implementing DocumentPort
 *
 * Handles document persistence using markdown files with YAML frontmatter.
 * Uses FileSystemPort for actual file operations, keeping this adapter
 * focused on markdown parsing/serialization.
 *
 * Part of the Hexagonal Architecture - this adapter translates between
 * the domain's DocumentPort interface and the markdown file format.
 */

import { ok, err, type Result } from '$lib/core';
import type { FileSystemPort } from '$lib/ports/outbound/FileSystemPort';
import type { DocumentPort, DocumentListItem, DocumentFolderItem } from '$lib/ports/outbound/DocumentPort';
import type { Document } from '$lib/domain/entities/Document';
import type { DocumentMeta } from '$lib/domain/values/DocumentMeta';
import { createDocument } from '$lib/domain/entities/Document';
import { createDocumentMeta } from '$lib/domain/values/DocumentMeta';
import { normalizeNoteTags } from '$lib/domain/values/NoteTags';
import {
  isProtectedDocumentMeta,
  protectionMetaFromCustom,
} from '$lib/domain/values/Protection';
import type { ProtectionCodecPort } from '$lib/ports/outbound/ProtectionCodecPort';
import { parseMarkdown } from './parser';
import { serializeToMarkdown } from './serializer';
import {
  blockToPmNode as convertDomainBlockToPmNode,
  pmNodeToBlock as convertPmNodeToDomainBlock,
} from '$lib/adapters/prosemirror/DocumentConverter';
import {
  parseMarkdownWithFrontmatter,
  serializeFrontmatter,
} from './frontmatter';
import { voidSchema } from '$lib/adapters/prosemirror/schema';
import { events } from '$lib/events';

/**
 * Configuration for MarkdownAdapter
 */
export interface MarkdownAdapterConfig {
  /** Base directory for documents (absolute path) */
  basePath: string;
  /** File extension for markdown files (default: '.md') */
  extension?: string;
  /** Optional note-protection boundary handler. */
  protection?: ProtectionCodecPort;
}

/**
 * MarkdownAdapter implements DocumentPort using markdown files.
 *
 * Documents are stored as markdown files with YAML frontmatter:
 * - Frontmatter contains document metadata (title, tags, dates, etc.)
 * - Body contains the document content as markdown
 *
 * The adapter uses FileSystemPort for file I/O, making it testable
 * with MemoryFileSystemAdapter.
 */
export class MarkdownAdapter implements DocumentPort {
  private readonly fileSystem: FileSystemPort;
  private readonly basePath: string;
  private readonly extension: string;
  private readonly protection: ProtectionCodecPort | null;
  private readonly watchers: Map<string, Set<(doc: Document) => void>> = new Map();

  constructor(fileSystem: FileSystemPort, config: MarkdownAdapterConfig) {
    this.fileSystem = fileSystem;
    this.basePath = config.basePath;
    this.extension = config.extension ?? '.md';
    this.protection = config.protection ?? null;
  }

  /**
   * Resolve a relative document path to an absolute file path inside basePath.
   *
   * Rejects absolute paths and any segment that would escape the base directory
   * — the document store is a sandbox, not a generic file API.
   */
  private resolvePath(path: string): string {
    if (path.startsWith('/') || path.startsWith('\\')) {
      throw new Error(`Document paths must be relative to the notes directory: ${path}`);
    }

    const segments = path.split(/[\/]+/).filter((seg) => seg.length > 0);
    if (segments.some((seg) => seg === '..' || seg === '.')) {
      throw new Error(`Document path traversal is not allowed: ${path}`);
    }

    const relative = segments.join('/');
    const withExt = relative.endsWith(this.extension)
      ? relative
      : `${relative}${this.extension}`;

    return `${this.basePath}/${withExt}`;
  }

  /**
   * Convert absolute file path to relative document path
   */
  private toRelativePath(absolutePath: string): string {
    const bases = this.basePath.startsWith('/')
      ? [this.basePath]
      : [this.basePath, `/${this.basePath}`];

    for (const base of bases) {
      if (absolutePath === base) return '';
      if (absolutePath.startsWith(`${base}/`)) {
        return absolutePath.substring(base.length + 1);
      }
    }

    return absolutePath;
  }

  /**
   * Load a document from a markdown file
   */
  async load(path: string): Promise<Result<Document, Error>> {
    let absolutePath: string;
    try {
      absolutePath = this.resolvePath(path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }

    // Read the file content
    const readResult = await this.fileSystem.readFile(absolutePath);
    if (!readResult.ok) {
      return err(new Error(`Failed to load document: ${readResult.error.message}`));
    }

    const markdown = readResult.value;

    try {
      // Parse frontmatter first. Protected notes keep the markdown body as an
      // encrypted envelope until the protection codec says the workspace is unlocked.
      const { content: storedContent, meta: parsedMeta } = parseMarkdownWithFrontmatter(markdown);
      const now = new Date();
      const docId = parsedMeta.id ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      let meta = this.createMetaFromParsed(parsedMeta, [], now, docId);
      meta = this.protection?.metaForLoad(meta) ?? meta;

      let content = storedContent;
      if (isProtectedDocumentMeta(meta)) {
        if (meta.protection?.lockState === 'locked') {
          return ok({
            meta,
            path: this.toRelativePath(absolutePath),
            blocks: this.protection?.createLockedDocumentBlocks() ?? [],
            isDirty: false,
          });
        }

        const decrypted = await this.protection?.decryptDocument(
          this.toRelativePath(absolutePath),
          meta,
          storedContent,
        );
        if (!decrypted?.ok) {
          return err(decrypted?.error ?? new Error('Protected note is locked'));
        }
        content = decrypted.value;
      }

      // Parse markdown content to ProseMirror document
      const prosemirrorDoc = parseMarkdown(content, voidSchema);

      // Convert ProseMirror nodes to domain blocks
      const blocks = prosemirrorDocToBlocks(prosemirrorDoc);

      meta = this.createMetaFromParsed(parsedMeta, blocks, now, docId);
      meta = this.protection?.metaForLoad(meta) ?? meta;

      const document: Document = {
        meta,
        path: this.toRelativePath(absolutePath),
        blocks,
        isDirty: false,
      };

      return ok(document);
    } catch (error) {
      return err(
        error instanceof Error
          ? error
          : new Error(`Failed to parse document: ${String(error)}`)
      );
    }
  }

  /**
   * Save a document to a markdown file
   */
  async save(document: Document): Promise<Result<void, Error>> {
    let absolutePath: string;
    try {
      absolutePath = this.resolvePath(document.path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }

    try {
      // Convert domain blocks to ProseMirror document
      const prosemirrorDoc = blocksToProsemirrorDoc(document.blocks);

      // Serialize to markdown
      const markdownContent = serializeToMarkdown(prosemirrorDoc);

      // Update the updatedAt timestamp
      const updatedMeta: DocumentMeta = {
        ...document.meta,
        tags: normalizeNoteTags(document.meta.tags),
        updatedAt: new Date(),
      };

      let metaForWrite = updatedMeta;
      let contentForWrite = markdownContent;
      if (isProtectedDocumentMeta(updatedMeta)) {
        if (!this.protection) {
          return err(new Error('Protected note support is not available'));
        }
        const protectedWrite = await this.protection.encryptDocument(
          document.path,
          updatedMeta,
          markdownContent,
        );
        if (!protectedWrite.ok) {
          return err(protectedWrite.error);
        }
        metaForWrite = protectedWrite.value.meta;
        contentForWrite = protectedWrite.value.envelopeMarkdown;
      }

      // Combine frontmatter with content
      const frontmatter = serializeFrontmatter(metaForWrite);
      const fullContent = frontmatter + contentForWrite;

      // Notify any open editor session that this is OUR write — see
      // 'editor:self-write' contract in lib/events/types.ts.
      events.emit('editor:self-write', { path: absolutePath });

      // Write to file
      const writeResult = await this.fileSystem.writeFile(absolutePath, fullContent);
      if (!writeResult.ok) {
        return err(new Error(`Failed to save document: ${writeResult.error.message}`));
      }

      return ok(undefined);
    } catch (error) {
      return err(
        error instanceof Error
          ? error
          : new Error(`Failed to save document: ${String(error)}`)
      );
    }
  }

  /**
   * Delete a document
   */
  async delete(path: string): Promise<Result<void, Error>> {
    let absolutePath: string;
    try {
      absolutePath = this.resolvePath(path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }

    // Notify any open editor session that this is OUR delete — see
    // 'editor:self-write' contract in lib/events/types.ts.
    events.emit('editor:self-write', { path: absolutePath });

    const deleteResult = await this.fileSystem.deleteFile(absolutePath);
    if (!deleteResult.ok) {
      return err(new Error(`Failed to delete document: ${deleteResult.error.message}`));
    }

    // Clean up any watchers
    this.watchers.delete(path);

    return ok(undefined);
  }

  /**
   * List all documents in the base directory (recursively)
   */
  async list(): Promise<Result<DocumentListItem[], Error>> {
    const items: DocumentListItem[] = [];
    const collectResult = await this.collectMarkdownFiles(this.basePath, items);

    if (!collectResult.ok) {
      return collectResult;
    }

    // Sort by updatedAt (most recent first)
    items.sort((a, b) => b.meta.updatedAt.getTime() - a.meta.updatedAt.getTime());

    return ok(items);
  }

  /**
   * List all user-visible folders in the base directory (recursively).
   */
  async listFolders(): Promise<Result<DocumentFolderItem[], Error>> {
    const folders: DocumentFolderItem[] = [];
    const collectResult = await this.collectFolders(this.basePath, folders);

    if (!collectResult.ok) {
      return collectResult;
    }

    folders.sort((a, b) => a.path.localeCompare(b.path));
    return ok(folders);
  }

  /**
   * Recursively collect markdown files from a directory
   */
  private async collectMarkdownFiles(
    dirPath: string,
    items: DocumentListItem[]
  ): Promise<Result<void, Error>> {
    const listResult = await this.fileSystem.listDirectory(dirPath);
    if (!listResult.ok) {
      return err(new Error(`Failed to list documents: ${listResult.error.message}`));
    }

    for (const entry of listResult.value) {
      if (entry.isFile && entry.name.endsWith(this.extension)) {
        // Process markdown file
        const relativePath = this.toRelativePath(entry.path);
        const loadResult = await this.load(relativePath);

        if (loadResult.ok) {
          items.push({
            path: relativePath,
            meta: loadResult.value.meta,
          });
        } else {
          items.push({
            path: relativePath,
            meta: createDocumentMeta({
              id: `doc-${Date.now()}`,
              title: entry.name.replace(this.extension, ''),
            }),
          });
        }
      } else if (entry.isDirectory) {
        if (this.shouldSkipDirectory(entry.name)) continue;
        // Recurse into subdirectory
        await this.collectMarkdownFiles(entry.path, items);
      }
    }

    return ok(undefined);
  }

  /**
   * Recursively collect folders from a directory.
   */
  private async collectFolders(
    dirPath: string,
    folders: DocumentFolderItem[]
  ): Promise<Result<void, Error>> {
    const listResult = await this.fileSystem.listDirectory(dirPath);
    if (!listResult.ok) {
      return err(new Error(`Failed to list folders: ${listResult.error.message}`));
    }

    for (const entry of listResult.value) {
      if (!entry.isDirectory) continue;
      if (this.shouldSkipDirectory(entry.name)) continue;

      const relativePath = this.toRelativePath(entry.path);
      if (relativePath) {
        folders.push({
          path: relativePath,
          name: entry.name,
          modifiedAt: entry.modifiedAt ?? new Date(),
        });
      }

      const nested = await this.collectFolders(entry.path, folders);
      if (!nested.ok) return nested;
    }

    return ok(undefined);
  }

  private shouldSkipDirectory(name: string): boolean {
    return name.startsWith('.') || name === '__MACOSX';
  }

  private createMetaFromParsed(
    parsedMeta: Partial<DocumentMeta>,
    blocks: import('$lib/domain/entities/Block').Block[],
    now: Date,
    docId: string,
  ): DocumentMeta {
    const protection = parsedMeta.protection
      ?? protectionMetaFromCustom(parsedMeta.custom)
      ?? null;
    return createDocumentMeta({
      id: docId,
      title: parsedMeta.title ?? extractTitleFromBlocks(blocks) ?? 'Untitled',
      tags: parsedMeta.tags ?? [],
      category: parsedMeta.category ?? null,
      color: parsedMeta.color ?? null,
      createdAt: parsedMeta.createdAt ?? now,
      updatedAt: parsedMeta.updatedAt ?? now,
      pinned: parsedMeta.pinned ?? false,
      status: parsedMeta.status ?? 'draft',
      intent: parsedMeta.intent ?? 'general',
      aiTouches: parsedMeta.aiTouches ?? 0,
      protection,
      custom: parsedMeta.custom ?? {},
    });
  }

  /**
   * Check if a document exists
   */
  async exists(path: string): Promise<Result<boolean, Error>> {
    let absolutePath: string;
    try {
      absolutePath = this.resolvePath(path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
    return this.fileSystem.exists(absolutePath);
  }

  /**
   * Create a new document
   */
  async createFolder(path: string): Promise<Result<void, Error>> {
    let absolutePath: string;
    try {
      absolutePath = this.resolveFolderPath(path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
    return this.fileSystem.createDirectory(absolutePath);
  }

  async deleteFolder(path: string): Promise<Result<void, Error>> {
    let absolutePath: string;
    try {
      absolutePath = this.resolveFolderPath(path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
    return this.fileSystem.deleteDirectory(absolutePath);
  }

  async renameFolder(path: string, newName: string): Promise<Result<string, Error>> {
    const trimmed = newName.trim();
    if (!trimmed) return err(new Error('Folder name cannot be empty'));
    if (/[\\/]/.test(trimmed)) return err(new Error('Folder name cannot contain slashes'));
    if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
      return err(new Error('Folder name cannot start with a dot'));
    }

    let absoluteFrom: string;
    try {
      absoluteFrom = this.resolveFolderPath(path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }

    const segments = path.split(/[\/]+/).filter(Boolean);
    segments.pop();
    const newRelative = segments.length ? `${segments.join('/')}/${trimmed}` : trimmed;
    if (newRelative === path) return ok(path);

    let absoluteTo: string;
    try {
      absoluteTo = this.resolveFolderPath(newRelative);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }

    const existsResult = await this.fileSystem.exists(absoluteTo);
    if (!existsResult.ok) return err(existsResult.error);
    if (existsResult.value) {
      return err(new Error(`A folder named "${trimmed}" already exists at that location`));
    }

    const renamed = await this.fileSystem.renamePath(absoluteFrom, absoluteTo);
    if (!renamed.ok) return err(renamed.error);
    return ok(newRelative);
  }

  /**
   * Like resolvePath, but does NOT auto-append the markdown extension.
   * Folders aren't files — appending `.md` would produce `myfolder.md` on disk.
   */
  private resolveFolderPath(path: string): string {
    if (path.startsWith('/') || path.startsWith('\\')) {
      throw new Error(`Folder paths must be relative to the notes directory: ${path}`);
    }
    const segments = path.split(/[\/]+/).filter((seg) => seg.length > 0);
    if (segments.length === 0) {
      throw new Error('Folder path cannot be empty');
    }
    if (segments.some((seg) => seg === '..' || seg === '.')) {
      throw new Error(`Folder path traversal is not allowed: ${path}`);
    }
    return `${this.basePath}/${segments.join('/')}`;
  }

  async create(path: string, title?: string): Promise<Result<Document, Error>> {
    let absolutePath: string;
    try {
      absolutePath = this.resolvePath(path);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }

    // Check if document already exists
    const existsResult = await this.exists(path);
    if (!existsResult.ok) return err(existsResult.error);
    if (existsResult.value) {
      return err(new Error(`Document already exists: ${path}`));
    }

    // Ensure parent directory exists
    const parentDir = absolutePath.substring(0, absolutePath.lastIndexOf('/'));
    if (parentDir !== this.basePath) {
      const mkdirResult = await this.fileSystem.createDirectory(parentDir);
      if (!mkdirResult.ok) {
        // Directory might already exist, which is fine
        console.warn('Could not create directory:', mkdirResult.error);
      }
    }

    // Create a new empty document
    const document = createDocument(this.toRelativePath(absolutePath), title);

    // Save the document
    const saveResult = await this.save(document);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    return ok(document);
  }

  /**
   * Watch for external changes to a document
   *
   * Note: This is a simplified implementation that doesn't use actual file watching.
   * In a real Tauri app, you would use Tauri's fs watch APIs.
   */
  watch(path: string, callback: (document: Document) => void): () => void {
    // Get or create the set of watchers for this path
    if (!this.watchers.has(path)) {
      this.watchers.set(path, new Set());
    }

    const pathWatchers = this.watchers.get(path)!;
    pathWatchers.add(callback);

    // Return unsubscribe function
    return () => {
      pathWatchers.delete(callback);
      if (pathWatchers.size === 0) {
        this.watchers.delete(path);
      }
    };
  }

  /**
   * Notify watchers of a document change
   * Called externally when a file change is detected
   */
  async notifyWatchers(path: string): Promise<void> {
    const watchers = this.watchers.get(path);
    if (!watchers || watchers.size === 0) {
      return;
    }

    // Reload the document
    const loadResult = await this.load(path);
    if (loadResult.ok) {
      for (const callback of watchers) {
        callback(loadResult.value);
      }
    }
  }
}

// =============================================================================
// Domain ↔ ProseMirror conversion (delegates to DocumentConverter)
// =============================================================================
//
// All real conversion logic lives in $lib/adapters/prosemirror/DocumentConverter.
// These wrappers exist so MarkdownSerializerAdapter and MarkdownAdapter.{load,
// save} can stay shape-compatible with their callers — Block[] in / out,
// without needing a Document wrapper.
//
// Schema-validation errors are NOT swallowed: a malformed domain block now
// surfaces as a thrown Error from nodeSpec.create, which MarkdownAdapter.save
// turns into a Result.err(BlockSerializationError) for the UI.

import type { Block } from '$lib/domain/entities/Block';
import { generateBlockId } from '$lib/domain/entities/Block';
import { BlockSerializationError } from '$lib/domain/errors';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

export function prosemirrorDocToBlocks(doc: ProseMirrorNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node) => {
    const block = convertPmNodeToDomainBlock(node);
    if (block) blocks.push(block);
  });
  return blocks;
}

export function blocksToProsemirrorDoc(blocks: Block[]): ProseMirrorNode {
  const docType = voidSchema.nodes['doc'];
  if (!docType) throw new Error('Schema must have a doc node type');

  const nodes: ProseMirrorNode[] = [];
  for (const block of blocks) {
    let pmNode: ProseMirrorNode | null;
    try {
      pmNode = convertDomainBlockToPmNode(block);
    } catch (cause) {
      throw new BlockSerializationError({
        blockId: block.id,
        blockType: String(block.type),
        cause,
      });
    }
    if (pmNode) nodes.push(pmNode);
  }

  if (nodes.length === 0) {
    const paragraphType = voidSchema.nodes['paragraph'];
    if (paragraphType) nodes.push(paragraphType.create({ id: generateBlockId() }));
  }

  return docType.create(null, nodes);
}

/**
 * Extract title from the first heading in blocks
 */
function extractTitleFromBlocks(blocks: Block[]): string | null {
  for (const block of blocks) {
    if (block.type.startsWith('heading') && block.content) {
      return block.content;
    }
  }
  return null;
}
