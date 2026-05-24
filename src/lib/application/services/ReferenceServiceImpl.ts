import { err, ok, type Result } from '$lib/core';
import type { AgentRunStoragePort } from '$lib/ports/outbound/AgentRunStoragePort';
import type { ConversationStoragePort } from '$lib/ports/outbound/ConversationStoragePort';
import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type { OperationStoragePort } from '$lib/ports/outbound/OperationStoragePort';
import type { DocumentService, NotesListItem, NotesService, ProtectionService, ReferenceService, TodoService } from '$lib/ports/inbound';
import type { ResolvedPromptReference } from '$lib/domain/values/PromptContext';
import type { RefId, RefIdKind, ParsedRefId } from '$lib/domain/values/RefId';
import { buildRefId, extractRefIds, parseRefId } from '$lib/domain/values/RefId';
import { findBlock } from '$lib/domain/entities/Document';
import { isProtectedNoteMeta } from '$lib/domain/values/Protection';
import type { TodoId } from '$lib/domain/values/TodoId';
import type { OperationId } from '$lib/domain/values/OperationId';

const NOTE_CONTENT_LIMIT = 3600;
const OBJECT_CONTENT_LIMIT = 1400;
const LIST_LIMIT = 20;

export class ReferenceServiceImpl implements ReferenceService {
  constructor(
    private readonly notes: NotesService,
    private readonly documents: DocumentService,
    private readonly todos: TodoService,
    private readonly contextProvider: ContextProviderPort,
    private readonly conversations: ConversationStoragePort,
    private readonly agentRuns: AgentRunStoragePort,
    private readonly operations: OperationStoragePort,
    private readonly protection: ProtectionService,
  ) {}

  async resolve(refId: string): Promise<Result<ResolvedPromptReference, Error>> {
    const parsed = parseRefId(refId);
    if (!parsed) {
      return err(new Error(`Invalid RefId: ${refId}`));
    }

    try {
      switch (parsed.kind) {
        case 'note':
          return ok(await this.resolveNote(parsed));
        case 'folder':
          return ok(this.resolveFolder(parsed));
        case 'tag':
          return ok(this.resolveTag(parsed));
        case 'todo':
          return ok(await this.resolveTodo(parsed));
        case 'block':
          return ok(await this.resolveBlock(parsed));
        case 'conversation':
          return ok(await this.resolveConversation(parsed));
        case 'run':
          return ok(await this.resolveRun(parsed));
        case 'worker':
          return ok(await this.resolveWorker(parsed));
        case 'operation':
          return ok(await this.resolveOperation(parsed));
      }
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async resolveMany(refIds: string[]): Promise<Result<ResolvedPromptReference[], Error>> {
    const resolved: ResolvedPromptReference[] = [];
    for (const refId of refIds) {
      const result = await this.resolve(refId);
      if (result.ok) {
        resolved.push(result.value);
      }
    }
    return ok(resolved);
  }

  async resolvePrompt(prompt: string): Promise<Result<ResolvedPromptReference[], Error>> {
    return this.resolveMany(extractRefIds(prompt));
  }

  private async resolveNote(ref: Extract<ParsedRefId, { kind: 'note' }>): Promise<ResolvedPromptReference> {
    const meta = await this.documents.readMeta(ref.notePath);
    if (!meta.ok) {
      return unresolved(ref.raw, 'note', ref.notePath, 'Note was not found or could not be read');
    }
    if (!this.canReadProtectedMeta(meta.value.protection)) {
      return {
        refId: ref.raw,
        kind: 'note',
        status: 'resolved',
        label: meta.value.title || ref.notePath,
        summary: `Protected note at ${ref.notePath}`,
        metadata: {
          path: ref.notePath,
          title: meta.value.title,
          protected: true,
          lockState: meta.value.protection?.lockState ?? 'locked',
        },
      };
    }

    const content = await this.documents.readContent(ref.notePath);
    if (!content.ok) {
      return unresolved(ref.raw, 'note', ref.notePath, 'Note was not found or could not be read');
    }

    return {
      refId: ref.raw,
      kind: 'note',
      status: 'resolved',
      label: meta.value.title || ref.notePath,
      summary: `Note at ${ref.notePath}`,
      content: clip(content.value, NOTE_CONTENT_LIMIT),
      metadata: {
        path: ref.notePath,
        title: meta.value.title,
        tags: meta.value.tags ?? [],
        intent: meta.value.intent ?? null,
        status: meta.value.status ?? null,
      },
    };
  }

  private resolveFolder(ref: Extract<ParsedRefId, { kind: 'folder' }>): ResolvedPromptReference {
    const notes = flattenNotes(this.notes.getState().items).filter((item) => !item.isFolder);
    const folderPath = ref.folderPath;
    const prefix = folderPath ? `${folderPath}/` : '';
    const members = notes.filter((note) => folderPath === '' ? true : note.path.startsWith(prefix));

    if (folderPath && !flattenNotes(this.notes.getState().items).some((item) => item.isFolder && item.path === folderPath)) {
      return unresolved(ref.raw, 'folder', folderPath, 'Folder was not found in the current notes tree');
    }

    return {
      refId: ref.raw,
      kind: 'folder',
      status: 'resolved',
      label: folderPath || 'Workspace',
      summary: `${members.length} note${members.length === 1 ? '' : 's'} in folder`,
      content: members.slice(0, LIST_LIMIT).map((note) => `- ${note.title} (${note.path})`).join('\n'),
      metadata: {
        path: folderPath,
        noteCount: members.length,
      },
    };
  }

  private resolveTag(ref: Extract<ParsedRefId, { kind: 'tag' }>): ResolvedPromptReference {
    const group = this.notes.getState().tagGroups.find((item) => item.tag === ref.tag);
    if (!group) {
      return unresolved(ref.raw, 'tag', `#${ref.tag}`, 'Tag group was not found in the current notes tree');
    }

    return {
      refId: ref.raw,
      kind: 'tag',
      status: 'resolved',
      label: `#${ref.tag}`,
      summary: `${group.count} tagged note${group.count === 1 ? '' : 's'}`,
      content: group.notes.slice(0, LIST_LIMIT).map((note) => `- ${note.title} (${note.path})`).join('\n'),
      metadata: {
        tag: ref.tag,
        noteCount: group.count,
      },
    };
  }

  private async resolveTodo(ref: Extract<ParsedRefId, { kind: 'todo' }>): Promise<ResolvedPromptReference> {
    const result = await this.todos.getById(ref.todoId as TodoId);
    if (!result.ok || !result.value) {
      return unresolved(ref.raw, 'todo', ref.todoId, 'Todo was not found');
    }

    const todo = result.value;
    return {
      refId: ref.raw,
      kind: 'todo',
      status: 'resolved',
      label: todo.content,
      summary: `${todo.isCompleted ? 'Completed' : 'Open'} todo in ${todo.sourceFile}:${todo.lineNumber + 1}`,
      content: todo.rawLine,
      metadata: {
        todoId: todo.id,
        sourceFile: todo.sourceFile,
        lineNumber: todo.lineNumber,
        isCompleted: todo.isCompleted,
        dueDate: serializeDateMeta(todo.dates.dueDate),
        scheduledDate: serializeDateMeta(todo.dates.scheduledDate),
        createdAt: serializeDateMeta(todo.dates.createdAt),
        completedAt: serializeDateMeta(todo.dates.completedAt),
        recurrence: todo.dates.recurrence ?? null,
        priority: todo.priority ?? null,
        tags: todo.tags,
      },
    };
  }

  private async resolveBlock(ref: Extract<ParsedRefId, { kind: 'block' }>): Promise<ResolvedPromptReference> {
    const current = await this.contextProvider.getCurrentDocument();
    if (current?.path === ref.notePath) {
      const block = findBlock(current, ref.blockId);
      if (block) {
        const canRead = this.canReadProtectedMeta(current.meta.protection);
        return {
          refId: ref.raw,
          kind: 'block',
          status: 'resolved',
          label: `${current.meta.title} / ${block.type}`,
          summary: `Block ${ref.blockId} in ${ref.notePath}`,
          ...(canRead ? { content: clip(block.content, OBJECT_CONTENT_LIMIT) } : {}),
          metadata: {
            notePath: ref.notePath,
            blockId: ref.blockId,
            blockType: block.type,
            protected: !canRead,
          },
        };
      }
    }

    const noteMeta = await this.documents.readMeta(ref.notePath);
    if (!noteMeta.ok) {
      return unresolved(ref.raw, 'block', ref.blockId, 'Block note was not found');
    }

    return {
      refId: ref.raw,
      kind: 'block',
      status: 'stale',
      label: `${noteMeta.value.title || ref.notePath} / ${ref.blockId}`,
      summary: `Block ${ref.blockId} belongs to ${ref.notePath}, but that note is not the active editor document or the block anchor cache is stale.`,
      metadata: {
        notePath: ref.notePath,
        blockId: ref.blockId,
      },
      reason: 'Open the note or refresh the block reference before asking for block-exact edits.',
    };
  }

  private async resolveConversation(ref: Extract<ParsedRefId, { kind: 'conversation' }>): Promise<ResolvedPromptReference> {
    const result = await this.conversations.load(ref.conversationId);
    if (!result.ok || !result.value) {
      return unresolved(ref.raw, 'conversation', ref.conversationId, 'Conversation was not found');
    }

    const conversation = result.value;
    const visibleMessages = conversation.messages.filter((message) => message.visibility !== 'internal');
    return {
      refId: ref.raw,
      kind: 'conversation',
      status: 'resolved',
      label: conversation.title,
      summary: `${visibleMessages.length} visible message${visibleMessages.length === 1 ? '' : 's'}`,
      content: visibleMessages.slice(-6).map((message) => `${message.role}: ${clip(message.text, 240)}`).join('\n'),
      metadata: {
        conversationId: conversation.id,
        status: conversation.status,
        documentPath: conversation.documentPath,
      },
    };
  }

  private async resolveRun(ref: Extract<ParsedRefId, { kind: 'run' }>): Promise<ResolvedPromptReference> {
    const result = await this.agentRuns.get(ref.runId);
    if (!result.ok || !result.value) {
      return unresolved(ref.raw, 'run', ref.runId, 'Agent run was not found');
    }

    const run = result.value;
    return {
      refId: ref.raw,
      kind: 'run',
      status: 'resolved',
      label: run.prompt,
      summary: `Agent run is ${run.status}; ${run.tasks.length} task(s), ${run.workers.length} worker(s), ${run.artifacts.length} artifact(s)`,
      content: [
        run.finalSummary ? `Final summary: ${clip(run.finalSummary, 600)}` : '',
        ...run.tasks.slice(0, LIST_LIMIT).map((task) => `- ${task.status}: ${task.title}${task.detail ? ` (${task.detail})` : ''}`),
      ].filter(Boolean).join('\n'),
      metadata: {
        runId: run.id,
        status: run.status,
        orchestrationMode: run.orchestrationMode,
        conversationId: run.conversationId,
      },
    };
  }

  private async resolveWorker(ref: Extract<ParsedRefId, { kind: 'worker' }>): Promise<ResolvedPromptReference> {
    const result = await this.agentRuns.get(ref.runId);
    if (!result.ok || !result.value) {
      return unresolved(ref.raw, 'worker', ref.workerId, 'Agent run was not found');
    }

    const worker = result.value.workers.find((item) => item.id === ref.workerId);
    if (!worker) {
      return unresolved(ref.raw, 'worker', ref.workerId, 'Worker was not found in the referenced run');
    }

    return {
      refId: ref.raw,
      kind: 'worker',
      status: 'resolved',
      label: worker.spec.title,
      summary: `${worker.status} worker: ${worker.spec.objective}`,
      content: [
        worker.result?.summary ? `Result: ${clip(worker.result.summary, 600)}` : '',
        ...((worker.result?.findings ?? []).slice(0, 8).map((finding) => `- ${finding}`)),
      ].filter(Boolean).join('\n'),
      metadata: {
        runId: ref.runId,
        workerId: worker.id,
        status: worker.status,
        role: worker.spec.role,
      },
    };
  }

  private async resolveOperation(ref: Extract<ParsedRefId, { kind: 'operation' }>): Promise<ResolvedPromptReference> {
    const result = await this.operations.load(ref.operationId as OperationId);
    if (!result.ok || !result.value) {
      return unresolved(ref.raw, 'operation', ref.operationId, 'Operation was not found');
    }

    const operation = result.value;
    return {
      refId: ref.raw,
      kind: 'operation',
      status: 'resolved',
      label: operation.label,
      summary: `${operation.status} ${operation.type} operation`,
      content: clip(operation.result?.rawResponse ?? operation.prompt, OBJECT_CONTENT_LIMIT),
      metadata: {
        operationId: operation.id,
        type: operation.type,
        status: operation.status,
        targetNotes: operation.targetNotes,
      },
    };
  }

  private canReadProtectedMeta(meta: unknown): boolean {
    if (!isProtectedNoteMeta(meta)) return true;
    if (meta.lockState === 'locked') return false;
    const policy = this.protection.currentPolicy();
    if (!policy.requireAIApprovalForProtectedReads) return true;
    return this.protection.hasAIContextAuthorization(meta.noteId, 'note.read');
  }
}

export function promptReferencesSection(references: ResolvedPromptReference[]): string {
  if (references.length === 0) return '';
  return [
    '## Resolved Void RefIds',
    'The user explicitly referenced these app objects. Treat resolved references as concrete targets.',
    ...references.map((reference) => [
      `- ${reference.refId} [${reference.status}] ${reference.label}: ${reference.summary}`,
      reference.content ? `  Content: ${reference.content}` : '',
      reference.reason ? `  Reason: ${reference.reason}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

function unresolved(refId: RefId, kind: RefIdKind, label: string, reason: string): ResolvedPromptReference {
  return {
    refId,
    kind,
    status: 'unresolved',
    label,
    summary: reason,
    reason,
  };
}

function flattenNotes(items: NotesListItem[]): NotesListItem[] {
  const result: NotesListItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) result.push(...flattenNotes(item.children));
  }
  return result;
}

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function serializeDateMeta(value: Date | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export { buildRefId, extractRefIds };
