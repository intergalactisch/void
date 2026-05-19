/**
 * DocumentServiceImpl - Headless document content API
 *
 * Provides programmatic read/write access to documents using markdown strings.
 * Bypasses EditorService entirely — no ProseMirror UI dependency.
 *
 * Used by AI tools to create, read, and update note content.
 */

import { ok, err, type Result } from '$lib/core';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import type { LineageRecordOptions, LineageService } from '$lib/ports/inbound/LineageService';
import type { DocumentPort } from '$lib/ports/outbound/DocumentPort';
import type { MarkdownSerializerPort } from '$lib/ports/outbound/MarkdownSerializerPort';
import type { NotesService } from '$lib/ports/inbound/NotesService';
import type { TodoService } from '$lib/ports/inbound/TodoService';
import type { Document } from '$lib/domain';
import type { DocumentMeta } from '$lib/domain/values/DocumentMeta';
import { normalizeNoteTags } from '$lib/domain/values/NoteTags';
import type { OperationSource } from '$lib/pipeline/types';
import { AI_SOURCE } from '$lib/pipeline/types';
import { events, type ResourceLockOwner } from '$lib/events';
import { resourceLock } from '$lib/events/queue/ResourceLock';
import { getLogger } from '$lib/logging';

const log = getLogger('DocumentService');

export class DocumentServiceImpl implements DocumentService {
  constructor(
    private readonly documentPort: DocumentPort,
    private readonly notesService: NotesService,
    private readonly markdown: MarkdownSerializerPort,
    private readonly todoService?: TodoService,
    private readonly lineageService?: LineageService,
  ) {}

  async readContent(path: string): Promise<Result<string, Error>> {
    log.debug('readContent', { path });

    const loadResult = await this.documentPort.load(path);
    if (!loadResult.ok) {
      log.error('readContent failed', { path, error: loadResult.error.message });
      return err(loadResult.error);
    }

    const doc = loadResult.value;
    const markdown = this.markdown.serializeBlocks(doc.blocks);

    log.debug('readContent success', { path, length: markdown.length });
    return ok(markdown);
  }

  async writeContent(
    path: string,
    markdown: string,
    lineage?: LineageRecordOptions
  ): Promise<Result<void, Error>> {
    const result = await resourceLock.withLock(
      this.noteLockKey(path),
      () => this.persistMarkdownUnlocked(path, markdown, lineage),
      lockOwnerFromLineage(lineage, 'Document write'),
    );
    if (!result.ok) return err(result.error);

    await this.afterDocumentSaved(path);
    return ok(undefined);
  }

  async transformContent(
    path: string,
    transform: (currentMarkdown: string) => string | Promise<string>,
    lineage?: LineageRecordOptions
  ): Promise<Result<string, Error>> {
    try {
      const result = await resourceLock.withLock(this.noteLockKey(path), async () => {
        const current = await this.loadDocumentMarkdownUnlocked(path);
        if (!current.ok) return current;

        const nextMarkdown = await transform(current.value.markdown);
        return this.persistLoadedMarkdownUnlocked(path, current.value.document, nextMarkdown, lineage);
      }, lockOwnerFromLineage(lineage, 'Document transform'));
      if (!result.ok) return err(result.error);

      await this.afterDocumentSaved(path);
      return ok(result.value);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async loadDocumentMarkdownUnlocked(
    path: string,
  ): Promise<Result<{ document: Document; markdown: string }, Error>> {
    const loadResult = await this.documentPort.load(path);
    if (!loadResult.ok) {
      log.error('readContent failed', { path, error: loadResult.error.message });
      return err(loadResult.error);
    }

    const doc = loadResult.value;
    return ok({
      document: doc,
      markdown: this.markdown.serializeBlocks(doc.blocks),
    });
  }

  private async persistMarkdownUnlocked(
    path: string,
    markdown: string,
    lineage?: LineageRecordOptions
  ): Promise<Result<string, Error>> {
    log.debug('writeContent', { path, length: markdown.length });

    // Load existing document to preserve metadata
    const loadResult = await this.documentPort.load(path);
    if (!loadResult.ok) {
      log.error('writeContent: failed to load document', { path, error: loadResult.error.message });
      return err(loadResult.error);
    }

    return this.persistLoadedMarkdownUnlocked(path, loadResult.value, markdown, lineage);
  }

  private async persistLoadedMarkdownUnlocked(
    path: string,
    document: Document,
    markdown: string,
    lineage?: LineageRecordOptions
  ): Promise<Result<string, Error>> {
    // Parse markdown into domain blocks via the serializer port
    document.blocks = this.markdown.parseToBlocks(markdown);

    // Save
    const saveResult = await this.documentPort.save(document);
    if (!saveResult.ok) {
      log.error('writeContent: failed to save', { path, error: saveResult.error.message });
      return err(saveResult.error);
    }

    const lineageResult = await this.lineageService?.enqueueMarkdownChange(path, markdown, lineage);
    if (lineageResult && !lineageResult.ok) {
      log.warn('writeContent: failed to queue lineage', { path, error: lineageResult.error.message });
    }

    // Emit while still holding the note lane so saved notifications stay in
    // the same order as the disk writes they describe.
    events.emit('document:saved', { path });
    log.info('writeContent success', { path });

    return ok(markdown);
  }

  private async afterDocumentSaved(path: string): Promise<void> {
    const todoSyncResult = await this.todoService?.syncSavedFile(path);
    if (todoSyncResult && !todoSyncResult.ok) {
      log.warn('writeContent: failed to sync todos', { path, error: todoSyncResult.error.message });
    }
    await this.notesService.refresh();
  }

  async readMeta(path: string): Promise<Result<DocumentMeta, Error>> {
    log.debug('readMeta', { path });

    const loadResult = await this.documentPort.load(path);
    if (!loadResult.ok) {
      return err(loadResult.error);
    }

    return ok(loadResult.value.meta);
  }

  async updateMeta(path: string, updates: Partial<DocumentMeta>): Promise<Result<void, Error>> {
    const result = await resourceLock.withLock(this.noteLockKey(path), async () => {
      return this.updateMetaUnlocked(path, updates);
    }, {
      id: `document:update-meta:${path}`,
      kind: 'service',
      label: 'Document metadata update',
    });
    if (!result.ok) return result;

    await this.notesService.refresh();
    return ok(undefined);
  }

  private async updateMetaUnlocked(path: string, updates: Partial<DocumentMeta>): Promise<Result<void, Error>> {
    log.debug('updateMeta', { path, updates: Object.keys(updates) });

    const loadResult = await this.documentPort.load(path);
    if (!loadResult.ok) {
      return err(loadResult.error);
    }

    const document = loadResult.value;
    document.meta = {
      ...document.meta,
      ...updates,
      tags: updates.tags !== undefined
        ? normalizeNoteTags(updates.tags)
        : document.meta.tags,
    };

    const saveResult = await this.documentPort.save(document);
    if (!saveResult.ok) {
      return err(saveResult.error);
    }

    events.emit('document:saved', { path });
    log.info('updateMeta success', { path });
    return ok(undefined);
  }

  async createWithContent(
    folder: string,
    title: string,
    markdown?: string,
    source: OperationSource = AI_SOURCE,
    lineage?: LineageRecordOptions,
  ): Promise<Result<{ path: string; title: string }, Error>> {
    const createLineage = lineage ?? lineageFromOperationSource(source);
    return resourceLock.withLock(this.noteCreateLockKey(folder, title), async () => {
      log.debug('createWithContent', { folder, title, hasContent: !!markdown });

      // Create WITHOUT focus — we control timing to prevent the race condition
      // where the editor loads an empty note before content is written.
      const createResult = await this.notesService.createNote(folder, title, { ...source, autoFocus: false });
      if (!createResult.ok) {
        log.error('createWithContent: failed to create note', { error: createResult.error.message });
        return err(createResult.error);
      }

      const path = createResult.value.path;

      // Write content BEFORE any selection.
      if (markdown) {
        const writeResult = await this.writeContent(path, markdown, createLineage);
        if (!writeResult.ok) {
          log.error('createWithContent: failed to write content', { path, error: writeResult.error.message });
          return err(writeResult.error);
        }
      }

      // NOW select if requested — editor loads the COMPLETE note.
      if (source.autoFocus) {
        this.notesService.selectNote(path);
      }

      log.info('createWithContent success', { path, title });
      return ok({ path, title });
    }, lockOwnerFromLineage(createLineage, 'Document create'));
  }

  private noteLockKey(path: string): string {
    return `note:${path.replace(/\\/g, '/')}`;
  }

  private noteCreateLockKey(folder: string, title: string): string {
    const normalizedFolder = folder.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    const normalizedTitle = title.trim().replace(/\s+/g, ' ').toLowerCase();
    return `note:create:${normalizedFolder}:${normalizedTitle}`;
  }
}

function lineageFromOperationSource(source: OperationSource): LineageRecordOptions {
  const actorKind = source.type === 'ai'
    ? 'ai-agent'
    : source.type === 'system'
      ? 'system'
      : 'user';

  return {
    actor: { kind: actorKind },
    intentKind: source.type === 'ai' ? 'rewrite' : 'import',
    operationId: source.operationId ?? null,
    summary: source.type === 'ai'
      ? 'AI-created markdown content'
      : 'Created markdown content',
    source: {
      type: source.type === 'ai' ? 'tool' : 'keyboard',
    },
  };
}

function lockOwnerFromLineage(
  lineage: LineageRecordOptions | undefined,
  fallbackLabel: string,
): ResourceLockOwner {
  const id = lineage?.receiptId ??
    lineage?.operationId ??
    lineage?.agentRunId ??
    lineage?.commandId ??
    fallbackLabel;
  const kind: ResourceLockOwner['kind'] =
    lineage?.agentRunId || lineage?.actor?.kind === 'ai-agent'
      ? 'agent'
      : lineage?.commandId
        ? 'command'
        : lineage?.actor?.kind === 'system'
          ? 'system'
          : 'service';

  const owner: ResourceLockOwner = {
    id,
    kind,
    label: lineage?.summary ?? lineage?.commandId ?? fallbackLabel,
  };
  if (lineage?.agentRunId) owner.runId = lineage.agentRunId;
  if (lineage?.commandId && lineage.source?.type === 'tool') owner.toolId = lineage.commandId;
  if (lineage?.receiptId) owner.messageId = lineage.receiptId;
  return owner;
}
