/**
 * NoteCollaborationServiceImpl - active-editor-aware note mutation.
 *
 * This service is intentionally application-layer orchestration. It depends on
 * inbound ports plus the markdown serializer port, never concrete editor or
 * storage adapters.
 */

import { err, ok, type Result } from '$lib/core';
import type {
  CreateCollaborativeNoteParams,
  DocumentService,
  EditorService,
  LineageRecordOptions,
  NoteCollaborationService,
  NotesService,
  UpdateNoteParams,
} from '$lib/ports/inbound';
import type { MarkdownSerializerPort } from '$lib/ports/outbound/MarkdownSerializerPort';
import type { Block } from '$lib/domain';
import { AI_SOURCE } from '$lib/pipeline/types';
import { normalizeNoteTags } from '$lib/domain/values';
import { resourceLock, type ResourceLockOwner } from '$lib/events/queue/ResourceLock';

export class NoteCollaborationServiceImpl implements NoteCollaborationService {
  constructor(
    private readonly editor: EditorService,
    private readonly documents: DocumentService,
    private readonly notes: NotesService,
    private readonly markdown: MarkdownSerializerPort,
  ) {}

  async updateNote(params: UpdateNoteParams): Promise<Result<void, Error>> {
    try {
      if (params.content !== undefined) {
        const contentResult = await this.applyNoteContent(
          params.noteId,
          params.content,
          params.label ?? 'AI update',
          params.lineage,
        );
        if (!contentResult.ok) return contentResult;
      }

      if (params.tags !== undefined) {
        const tags = normalizeNoteTags(params.tags);
        if (this.isActiveNote(params.noteId)) {
          const metaResult = this.editor.updateDocumentMeta({ tags });
          if (!metaResult.ok) return err(metaResult.error);
        } else {
          const metaResult = await this.documents.updateMeta(params.noteId, { tags });
          if (!metaResult.ok) return metaResult;
        }
      }

      if (params.title !== undefined && params.title.trim()) {
        const renameResult = await this.notes.renameNote(params.noteId, params.title);
        if (!renameResult.ok) return err(renameResult.error);
      }

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async createNote(
    params: CreateCollaborativeNoteParams
  ): Promise<Result<{ path: string; title: string }, Error>> {
    try {
      const title = params.title ?? 'Untitled';
      const folder = params.folder ?? '';
      const source = { ...AI_SOURCE, autoFocus: params.autoFocus ?? true };
      const createResult = await this.documents.createWithContent(
        folder,
        title,
        params.content,
        source,
        params.lineage,
      );
      if (!createResult.ok) return createResult;

      const tags = normalizeNoteTags(params.tags ?? []);
      if (tags.length > 0) {
        const metaResult = await this.documents.updateMeta(createResult.value.path, { tags });
        if (!metaResult.ok) return err(metaResult.error);
      }

      return createResult;
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async applyNoteContent(
    noteId: string,
    markdown: string,
    label = 'AI update',
    lineage?: LineageRecordOptions,
  ): Promise<Result<void, Error>> {
    try {
      const lineageOptions = lineage ?? {
        actor: { kind: 'ai-agent' as const },
        intentKind: 'rewrite' as const,
        summary: label,
        source: { type: 'tool' as const },
      };

      if (!this.isActiveNote(noteId)) {
        return this.documents.writeContent(noteId, markdown, lineageOptions);
      }

      const active = this.editor.getState().document;
      if (!active) return err(new Error('No active editor document'));

      return await resourceLock.withLock(this.noteLockKey(active.path), async () => {
        const lockedActive = this.editor.getState().document;
        if (!lockedActive) return err(new Error('No active editor document'));

        const desiredBlocks = this.markdown.parseToBlocks(markdown);
        await this.applyBlocksToActiveEditor(lockedActive.blocks, desiredBlocks, label);

        const saveResult = await this.saveActiveNote(lockedActive.path, lineageOptions);
        if (!saveResult.ok) return err(saveResult.error);

        return ok(undefined);
      }, lockOwnerFromLineage(lineageOptions, label));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async appendNoteContent(
    noteId: string,
    markdown: string,
    label = 'AI append',
    lineage?: LineageRecordOptions,
  ): Promise<Result<void, Error>> {
    try {
      const appendMarkdown = markdown.trim();
      if (!appendMarkdown) return ok(undefined);

      const lineageOptions = lineage ?? defaultBlockLineage('extract', label);

      if (!this.isActiveNote(noteId)) {
        const result = await this.documents.transformContent(
          noteId,
          (currentMarkdown) => appendToMarkdown(currentMarkdown, appendMarkdown),
          lineageOptions,
        );
        return result.ok ? ok(undefined) : err(result.error);
      }

      const active = this.editor.getState().document;
      if (!active) return err(new Error('No active editor document'));

      return await resourceLock.withLock(this.noteLockKey(active.path), async () => {
        const lockedActive = this.editor.getState().document;
        if (!lockedActive) return err(new Error('No active editor document'));
        if (!this.pathsMatch(noteId, lockedActive.path)) {
          return err(new Error(`Active note changed before appending AI edit for ${noteId}`));
        }

        const currentMarkdown = this.markdown.serializeBlocks(lockedActive.blocks);
        const nextMarkdown = appendToMarkdown(currentMarkdown, appendMarkdown);
        const desiredBlocks = this.markdown.parseToBlocks(nextMarkdown);
        await this.applyBlocksToActiveEditor(lockedActive.blocks, desiredBlocks, label);

        const saveResult = await this.saveActiveNote(lockedActive.path, lineageOptions);
        if (!saveResult.ok) return err(saveResult.error);

        return ok(undefined);
      }, lockOwnerFromLineage(lineageOptions, label));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async replaceBlock(params: {
    blockId: string;
    markdown: string;
    label?: string;
    lineage?: LineageRecordOptions;
  }): Promise<Result<void, Error>> {
    const label = params.label ?? 'AI rewrite';
    const lineage = params.lineage ?? defaultBlockLineage('rewrite', label);
    return this.withActiveBlockLock(params.blockId, async (activePath) => {
      try {
        this.editor.startAIBlockOperation(params.blockId, label, params.markdown);
        this.editor.scrollBlockIntoView(params.blockId, 'smart');
        this.editor.streamAIBlock(params.blockId, params.markdown);
        this.editor.finishAIBlockOperation(params.blockId, params.markdown);
        const save = await this.saveActiveNote(activePath, lineage);
        if (!save.ok) return err(save.error);
        return ok(undefined);
      } catch (error) {
        this.editor.failAIBlockOperation(
          params.blockId,
          error instanceof Error ? error.message : 'AI block update failed',
        );
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    }, lockOwnerFromLineage(lineage, label));
  }

  async insertBlocksAfter(params: {
    blockId: string;
    markdown: string;
    label?: string;
    lineage?: LineageRecordOptions;
  }): Promise<Result<void, Error>> {
    const label = params.label ?? 'AI insert';
    const lineage = params.lineage ?? defaultBlockLineage('extract', label);
    return this.withActiveBlockLock(params.blockId, async (activePath) => {
      try {
        this.editor.startAIBlockOperation(params.blockId, label, params.markdown);
        this.editor.scrollBlockIntoView(params.blockId, 'smart');
        this.editor.streamAIBlock(params.blockId, params.markdown);
        this.editor.insertContentAfterBlock(params.blockId, params.markdown);
        this.editor.unlockBlockFromAI(params.blockId);
        const save = await this.saveActiveNote(activePath, lineage);
        if (!save.ok) return err(save.error);
        return ok(undefined);
      } catch (error) {
        this.editor.failAIBlockOperation(
          params.blockId,
          error instanceof Error ? error.message : 'AI insert failed',
        );
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    }, lockOwnerFromLineage(lineage, label));
  }

  async deleteBlock(params: { blockId: string; label?: string; lineage?: LineageRecordOptions }): Promise<Result<void, Error>> {
    const label = params.label ?? 'AI delete';
    const lineage = params.lineage ?? defaultBlockLineage('delete', label);
    return this.withActiveBlockLock(params.blockId, async (activePath) => {
      try {
        this.editor.scrollBlockIntoView(params.blockId, 'smart');
        this.editor.deleteBlock(params.blockId);
        const save = await this.saveActiveNote(activePath, lineage);
        if (!save.ok) return err(save.error);
        return ok(undefined);
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    }, lockOwnerFromLineage(lineage, label));
  }

  async insertAtCursor(markdown: string, label = 'AI insert'): Promise<Result<void, Error>> {
    try {
      const state = this.editor.getState();
      const selectedBlockId = state.selection.anchorBlockId ?? state.selection.headBlockId;
      if (selectedBlockId) {
        return this.insertBlocksAfter({ blockId: selectedBlockId, markdown, label });
      }
      const lineage = defaultBlockLineage('extract', label);
      return await this.withActiveNoteLock(async () => {
        this.editor.insertContent(markdown);
        const activePath = this.editor.getState().document?.path;
        const save = await this.saveActiveNote(activePath, lineage);
        if (!save.ok) return err(save.error);
        return ok(undefined);
      }, lockOwnerFromLineage(lineage, label));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  isActiveNote(noteId: string): boolean {
    const activePath = this.editor.getState().document?.path;
    if (!activePath) return false;
    return this.pathsMatch(noteId, activePath);
  }

  getActiveBlocks(): Block[] {
    return this.editor.getState().document?.blocks ?? [];
  }

  private async applyBlocksToActiveEditor(
    currentBlocks: Block[],
    desiredBlocks: Block[],
    label: string,
  ): Promise<void> {
    const sharedCount = Math.min(currentBlocks.length, desiredBlocks.length);

    for (let i = 0; i < sharedCount; i++) {
      const current = currentBlocks[i]!;
      const desired = desiredBlocks[i]!;
      if (this.blockEquivalent(current, desired)) continue;

      const desiredMarkdown = this.markdown.serializeBlocks([desired]);
      this.editor.startAIBlockOperation(current.id, label, desiredMarkdown);
      this.editor.scrollBlockIntoView(current.id, 'smart');
      this.editor.streamAIBlock(current.id, desiredMarkdown);

      if (current.type !== desired.type) {
        this.editor.convertBlock(current.id, desired.type);
      }

      this.editor.finishAIBlockOperation(current.id, desiredMarkdown);
    }

    if (desiredBlocks.length > currentBlocks.length) {
      const trailingMarkdown = this.markdown.serializeBlocks(desiredBlocks.slice(currentBlocks.length));
      const anchor = currentBlocks[currentBlocks.length - 1];
      if (anchor) {
        this.editor.insertContentAfterBlock(anchor.id, trailingMarkdown);
      } else {
        this.editor.insertContent(trailingMarkdown);
      }
    }

    if (currentBlocks.length > desiredBlocks.length) {
      const extraBlocks = currentBlocks.slice(desiredBlocks.length).reverse();
      for (const block of extraBlocks) {
        this.editor.deleteBlock(block.id);
      }
    }
  }

  private blockEquivalent(a: Block, b: Block): boolean {
    return (
      a.type === b.type &&
      a.content === b.content &&
      JSON.stringify(a.attrs) === JSON.stringify(b.attrs) &&
      this.markdown.serializeBlocks([a]).trim() === this.markdown.serializeBlocks([b]).trim()
    );
  }

  private pathsMatch(candidate: string, activePath: string): boolean {
    const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/^\/+/, '');
    const normalizedActive = activePath.replace(/\\/g, '/').replace(/^\/+/, '');
    return (
      normalizedCandidate === normalizedActive ||
      normalizedCandidate.endsWith('/' + normalizedActive) ||
      normalizedActive.endsWith('/' + normalizedCandidate)
    );
  }

  private async withActiveNoteLock<T>(fn: () => Promise<T>, owner?: ResourceLockOwner): Promise<T> {
    const activePath = this.editor.getState().document?.path;
    if (!activePath) return fn();
    return resourceLock.withLock(this.noteLockKey(activePath), fn, owner);
  }

  private async withActiveBlockLock<T>(
    blockId: string,
    fn: (activePath: string | undefined) => Promise<T>,
    owner?: ResourceLockOwner,
  ): Promise<T> {
    const activePath = this.editor.getState().document?.path;
    if (!activePath) return fn(undefined);
    return resourceLock.withLock(this.blockLockKey(activePath, blockId), () => fn(activePath), owner);
  }

  private async saveActiveNote(
    expectedPath: string | undefined,
    lineage: LineageRecordOptions,
  ): Promise<Result<void, Error>> {
    if (!expectedPath) {
      return this.editor.saveDocument(lineage);
    }

    return resourceLock.withLock(this.noteSaveLockKey(expectedPath), async () => {
      const activePath = this.editor.getState().document?.path;
      if (!activePath || !this.pathsMatch(expectedPath, activePath)) {
        return err(new Error(`Active note changed before saving AI edit for ${expectedPath}`));
      }
      return this.editor.saveDocument(lineage);
    }, lockOwnerFromLineage(lineage, 'Save active note'));
  }

  private noteLockKey(path: string): string {
    return `note:${path.replace(/\\/g, '/')}`;
  }

  private noteSaveLockKey(path: string): string {
    return `note:save:${path.replace(/\\/g, '/')}`;
  }

  private blockLockKey(path: string, blockId: string): string {
    return `block:${path.replace(/\\/g, '/')}:${blockId}`;
  }
}

function defaultBlockLineage(
  intentKind: NonNullable<LineageRecordOptions['intentKind']>,
  summary: string,
): LineageRecordOptions {
  return {
    actor: { kind: 'ai-agent' },
    intentKind,
    summary,
    source: { type: 'tool' },
  };
}

function appendToMarkdown(currentMarkdown: string, appendMarkdown: string): string {
  const current = currentMarkdown.trimEnd();
  const addition = appendMarkdown.trim();
  if (!current) return addition;
  if (!addition) return current;
  return `${current}\n\n${addition}`;
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
