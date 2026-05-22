import { ok, err, type Result } from '$lib/core';
import type {
  AIAssistantService,
  EditorService,
  InlineAISelectionPromptInput,
  InlineAIThreadService,
  NoteCollaborationService,
  ProvenanceService,
} from '$lib/ports/inbound';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { ToolCall } from '$lib/domain/values/AIResponse';
import type { ToolId } from '$lib/domain/values/ToolId';
import { inlineAIPath, noteNameFromPath } from '$lib/domain/values/VoidPath';
import { parseRefId } from '$lib/domain/values/RefId';
import {
  appendInlineAITurn,
  appendInlineAIThreadEvent,
  completeInlineAITurn,
  createInlineAIAnchor,
  createInlineAIProposal,
  createInlineAIThread,
  dismissInlineAIThread,
  failInlineAITurn,
  hashInlineAIText,
  markInlineAIProposal,
  markInlineAIThreadSeen,
  withInlineAIThreadLinks,
  type InlineAIThreadEventType,
  type InlineAIProposal,
  type InlineAIProposedChange,
  type InlineAIThread,
} from '$lib/domain/entities/InlineAIThread';

const INLINE_AI_FILE_VERSION = 2;
const INLINE_AI_CONTEXT_WINDOW = 900;
const INLINE_AI_PROMPT_CONTEXT_LIMIT = 1200;

export const INLINE_SELECTION_TOOL_IDS = [
  'editor:replace',
  'editor:replace-block',
  'editor:insert-blocks',
  'editor:apply-note-patch',
] as ToolId[];

export const INLINE_SELECTION_SYSTEM_PROMPT = `You are Void's inline note editor AI. The user selected text inside a note and asked a visible prompt.

Choose the least invasive correct outcome:
- If the user asks a question, asks what something means, asks for critique, or requests explanation, answer only and do not call tools.
- If the selected range itself should be rewritten, call editor:replace with from and to.
- If only one exact substring inside the selection should change, call editor:replace with targetText and occurrence, or with an explicit subrange if provided.
- If a whole visible block should be rewritten, call editor:replace-block with one of the supplied block IDs.
- If new blocks should be inserted after a visible block, call editor:insert-blocks with afterBlockId.
- If the entire note must change, call editor:apply-note-patch with complete markdown for the note.

Tool calls are staged proposals. They will not be executed until the user explicitly accepts them. Never claim that an edit has already been applied.
Use the supplied note title, likely language, selected text, visible block content, and local before/after context to make the edit specific to this exact invocation.
For vague rewrite prompts such as "change this sentence", infer the best concrete rewrite from the surrounding note. If the selected text is rough placeholder text, still propose a context-fitting replacement instead of blocking.
Do not fall back to stock replacement sentences. Avoid generic templates like "This is a clearer sentence" or "Dit is een duidelijkere zin" unless that exact sentence is uniquely justified by the local note context.
Different selected ranges or local contexts should normally receive different proposed replacements.
Only use editor write tools when the user's request truly asks for an edit. Ask a clarifying question only if an edit is impossible from the selection and context.
Always include a concise user-facing response. When you propose an edit, summarize what will change; do not paste the entire replacement unless that is genuinely useful.`;

interface InlineAIThreadFile {
  version: number;
  notePath: string;
  threads: InlineAIThread[];
}

export class InlineAIThreadServiceImpl implements InlineAIThreadService {
  private readonly threadsByNote = new Map<string, InlineAIThread[]>();
  private readonly loadedNotes = new Set<string>();
  private readonly subscribers = new Set<(threads: InlineAIThread[]) => void>();
  private readonly activeGenerations = new Map<string, Promise<void>>();
  private activeNotePath: string | null = null;

  constructor(
    private readonly voidStorage: VoidStoragePort,
    private readonly notesPath: string,
    private readonly aiAssistant: AIAssistantService,
    private readonly collaboration: NoteCollaborationService,
    private readonly editor: EditorService,
    private readonly provenance: ProvenanceService | null = null,
  ) {}

  async loadForDocument(notePath: string): Promise<Result<InlineAIThread[], Error>> {
    try {
      const normalized = normalizeNotePath(notePath);
      this.activeNotePath = normalized;
      const loaded = await this.ensureLoaded(normalized);
      if (!loaded.ok) return err(loaded.error);
      const threads = this.getThreads(normalized);
      this.notify();
      return ok(threads);
    } catch (error) {
      return err(toError(error));
    }
  }

  getThreads(notePath: string | null = this.activeNotePath): InlineAIThread[] {
    if (!notePath) return [];
    return [...(this.threadsByNote.get(normalizeNotePath(notePath)) ?? [])];
  }

  subscribe(callback: (threads: InlineAIThread[]) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getThreads());
    return () => this.subscribers.delete(callback);
  }

  async submitSelectionPrompt(input: InlineAISelectionPromptInput): Promise<Result<InlineAIThread, Error>> {
    const notePath = normalizeNotePath(input.notePath);
    const loaded = await this.ensureLoaded(notePath);
    if (!loaded.ok) return err(loaded.error);

    const conversation = await this.aiAssistant.createNewConversation({ documentPath: notePath });
    const context = this.createSelectionContext(input);
    const anchor = createInlineAIAnchor({
      notePath,
      selectedText: input.selectionText,
      range: input.from != null && input.to != null ? { from: input.from, to: input.to } : null,
      blockIds: input.blockIds,
      surroundingText: context.surroundingText,
      beforeText: context.beforeText,
      afterText: context.afterText,
    });
    const thread = createInlineAIThread({
      notePath,
      conversationId: conversation.id,
      anchor,
      prompt: input.prompt,
      entryPoint: input.entryPoint ?? 'selection-toolbar',
    });

    const recorded = await this.recordLifecycle(thread, 'created', {
      action: 'inline_ai.created',
      result: 'Inline AI request started',
    });
    await this.upsertThread(recorded);
    this.startGeneration(thread.id, input.prompt);
    return ok(recorded);
  }

  async retryThread(threadId: string): Promise<Result<InlineAIThread, Error>> {
    const found = this.findThread(threadId);
    if (!found) return err(new Error(`Inline AI thread not found: ${threadId}`));
    const prompt = found.thread.turns.at(-1)?.prompt ?? '';
    if (!prompt.trim()) return err(new Error('No prompt available to retry'));
    if (this.activeGenerations.has(threadId)) {
      return err(new Error('This inline AI response is already generating'));
    }
    const updated = await this.recordLifecycle(appendInlineAITurn(found.thread, prompt), 'retried', {
      action: 'inline_ai.retry',
      result: 'Inline AI request retried',
    });
    await this.upsertThread(updated);
    this.startGeneration(threadId, prompt);
    return ok(updated);
  }

  async followUp(threadId: string, prompt: string): Promise<Result<InlineAIThread, Error>> {
    const trimmed = prompt.trim();
    if (!trimmed) return err(new Error('Follow-up prompt is empty'));
    const found = this.findThread(threadId);
    if (!found) return err(new Error(`Inline AI thread not found: ${threadId}`));
    if (this.activeGenerations.has(threadId)) {
      return err(new Error('This inline AI response is already generating'));
    }
    const updated = await this.recordLifecycle(appendInlineAITurn(found.thread, trimmed), 'followed_up', {
      action: 'inline_ai.follow_up',
      result: 'Inline AI follow-up started',
    });
    await this.upsertThread(updated);
    this.startGeneration(threadId, trimmed);
    return ok(updated);
  }

  async acceptProposal(threadId: string): Promise<Result<InlineAIThread, Error>> {
    const found = this.findThread(threadId);
    if (!found) return err(new Error(`Inline AI thread not found: ${threadId}`));
    const { thread } = found;
    if (!thread.proposal || thread.proposal.status !== 'pending') {
      return err(new Error('No pending inline AI proposal to accept'));
    }

    const proposalResult = this.prepareProposalForAccept(thread);
    if (!proposalResult.ok) {
      const stale = await this.recordLifecycle({
        ...thread,
        status: 'stale' as const,
        proposal: markInlineAIProposal(thread.proposal, 'stale', proposalResult.error.message),
        updatedAt: new Date().toISOString(),
      }, 'stale', {
        action: 'inline_ai.stale',
        result: proposalResult.error.message,
      });
      await this.upsertThread(stale);
      return err(proposalResult.error);
    }

    const proposal = proposalResult.value;
    const threadForApply: InlineAIThread = { ...thread, proposal };
    const lineageClusterId = `inline-ai:${thread.id}:${thread.proposal.id}`;
    for (const change of proposal.changes) {
      const result = await this.applyChange(change, threadForApply, lineageClusterId);
      if (!result.ok) return err(result.error);
    }

    const anchor = this.createAppliedAnchor(threadForApply);
    let applied: InlineAIThread = {
      ...thread,
      anchor,
      status: 'applied',
      proposal: markInlineAIProposal(proposal, 'accepted'),
      seenAt: thread.seenAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    applied = withInlineAIThreadLinks(applied, { lineageClusterIds: [lineageClusterId] });
    applied = await this.recordLifecycle(applied, 'accepted', {
      type: 'ai_rewrite',
      action: 'inline_ai.accept',
      result: 'Inline AI proposal accepted',
      accepted: true,
    }, lineageClusterId);
    await this.upsertThread(applied);
    return ok(applied);
  }

  async cancelProposal(threadId: string): Promise<Result<InlineAIThread, Error>> {
    const found = this.findThread(threadId);
    if (!found) return err(new Error(`Inline AI thread not found: ${threadId}`));
    const thread = found.thread;
    const canceled: InlineAIThread = await this.recordLifecycle({
      ...thread,
      status: 'canceled',
      proposal: thread.proposal ? markInlineAIProposal(thread.proposal, 'canceled') : null,
      seenAt: thread.seenAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, 'canceled', {
      action: 'inline_ai.cancel',
      result: 'Inline AI proposal canceled',
      accepted: false,
    });
    await this.upsertThread(canceled);
    return ok(canceled);
  }

  async dismissThread(threadId: string): Promise<Result<InlineAIThread, Error>> {
    const found = this.findThread(threadId);
    if (!found) return err(new Error(`Inline AI thread not found: ${threadId}`));
    const dismissed = await this.recordLifecycle(dismissInlineAIThread(found.thread), 'dismissed', {
      action: 'inline_ai.dismiss',
      result: 'Inline AI response dismissed',
    });
    await this.upsertThread(dismissed);
    return ok(dismissed);
  }

  async markSeen(threadId: string): Promise<Result<InlineAIThread, Error>> {
    const found = this.findThread(threadId);
    if (!found) return err(new Error(`Inline AI thread not found: ${threadId}`));
    const seen = markInlineAIThreadSeen(found.thread);
    await this.upsertThread(seen);
    return ok(seen);
  }

  private createSelectionContext(input: InlineAISelectionPromptInput): {
    beforeText: string;
    afterText: string;
    surroundingText: string;
  } {
    if (input.from != null && input.to != null) {
      const beforeText = limitContextText(this.editor.getTextBetween(
        Math.max(0, input.from - INLINE_AI_CONTEXT_WINDOW),
        input.from,
      ), 'end');
      const afterText = limitContextText(this.editor.getTextBetween(
        input.to,
        input.to + INLINE_AI_CONTEXT_WINDOW,
      ), 'start');
      return {
        beforeText,
        afterText,
        surroundingText: `${beforeText}${input.selectionText}${afterText}`,
      };
    }

    const markdown = this.editor.getMarkdown();
    if (!markdown.ok || !input.selectionText) {
      return { beforeText: '', afterText: '', surroundingText: input.selectionText };
    }

    const noteText = stripFrontmatter(markdown.value);
    const selectedIndex = noteText.indexOf(input.selectionText);
    if (selectedIndex < 0) {
      return { beforeText: '', afterText: '', surroundingText: input.selectionText };
    }

    const beforeText = limitContextText(noteText.slice(0, selectedIndex), 'end');
    const afterText = limitContextText(
      noteText.slice(selectedIndex + input.selectionText.length),
      'start',
    );
    return {
      beforeText,
      afterText,
      surroundingText: `${beforeText}${input.selectionText}${afterText}`,
    };
  }

  private getVisibleBlockContext(blockIds: string[]): string {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const blockId of blockIds) {
      if (seen.has(blockId)) continue;
      seen.add(blockId);
      const block = this.editor.getBlockInfo(blockId);
      if (!block) {
        lines.push(`${blockId}: (block not currently resolved)`);
        continue;
      }
      lines.push(`${block.id} (${block.type}): ${block.content}`);
    }
    return lines.join('\n');
  }

  private startGeneration(threadId: string, prompt: string): void {
    if (this.activeGenerations.has(threadId)) return;
    const job = this.runGeneration(threadId, prompt)
      .then(() => undefined)
      .finally(() => {
        this.activeGenerations.delete(threadId);
      });
    this.activeGenerations.set(threadId, job);
  }

  private async runGeneration(threadId: string, prompt: string): Promise<Result<InlineAIThread, Error>> {
    const found = this.findThread(threadId);
    if (!found) return err(new Error(`Inline AI thread not found: ${threadId}`));

    try {
      let thread = await this.ensureThreadConversation(found.thread);
      if (thread !== found.thread) await this.upsertThread(thread);

      const internalPrompt = buildInlineSelectionPrompt({
        prompt,
        selectedText: thread.anchor.selectedText,
        noteTitle: this.editor.getState().document?.meta.title ?? 'Untitled',
        notePath: thread.notePath,
        from: thread.anchor.range?.from ?? null,
        to: thread.anchor.range?.to ?? null,
        blockIds: thread.anchor.blockIds,
        beforeText: thread.anchor.beforeText,
        afterText: thread.anchor.afterText,
        blockContext: this.getVisibleBlockContext(thread.anchor.blockIds),
        likelyLanguage: detectLikelyLanguage([
          thread.anchor.selectedText,
          thread.anchor.beforeText,
          thread.anchor.afterText,
          this.editor.getState().document?.meta.title ?? '',
        ].join('\n')),
      });

      const promptOptions: Parameters<AIAssistantService['prompt']>[1] = {
        autoExecuteTools: false,
        displayMessage: prompt,
        persistAssistantMessage: true,
        documentPath: thread.notePath,
        allowedToolIds: [...INLINE_SELECTION_TOOL_IDS],
        systemPrompt: INLINE_SELECTION_SYSTEM_PROMPT,
      };
      if (thread.conversationId) promptOptions.conversationId = thread.conversationId;

      const result = await this.aiAssistant.prompt(internalPrompt, promptOptions);
      const conversationId = thread.conversationId;

      if (!result.ok) {
        const failed = await this.recordLifecycle(failInlineAITurn(thread, result.error.message), 'error', {
          action: 'inline_ai.error',
          result: result.error.message,
        });
        await this.upsertThread(failed);
        return err(result.error);
      }

      const response = result.value;
      const proposal = parseInlineAIProposalFromToolCalls({
        toolCalls: response.toolCalls,
        notePath: thread.notePath,
        anchor: thread.anchor,
        editor: this.editor,
      });
      const message = response.chat.trim()
        || (proposal ? 'I drafted a proposed edit.' : 'I do not have an answer for that yet.');
      const completed = completeInlineAITurn(thread, {
        response: message,
        toolCalls: response.toolCalls,
        conversationId,
        proposal,
      });
      let recorded = await this.recordLifecycle(completed, 'response_completed', {
        action: proposal ? 'inline_ai.proposal' : 'inline_ai.answer',
        result: proposal ? 'Inline AI proposed an edit' : 'Inline AI answered',
      });
      if (proposal) {
        const event: Parameters<typeof appendInlineAIThreadEvent>[1] = {
          type: 'proposal_created',
          proposalId: proposal.id,
        };
        const turnId = recorded.turns.at(-1)?.id;
        if (turnId) event.turnId = turnId;
        if (conversationId) event.conversationId = conversationId;
        recorded = appendInlineAIThreadEvent(recorded, event);
      }
      await this.upsertThread(recorded);
      return ok(recorded);
    } catch (error) {
      const failed = this.findThread(threadId);
      if (failed) {
        const recorded = await this.recordLifecycle(
          failInlineAITurn(failed.thread, toError(error).message),
          'error',
          {
            action: 'inline_ai.error',
            result: toError(error).message,
          },
        );
        await this.upsertThread(recorded);
      }
      return err(toError(error));
    }
  }

  private prepareProposalForAccept(thread: InlineAIThread): Result<InlineAIProposal, Error> {
    if (!thread.proposal) return err(new Error('No pending inline AI proposal to accept'));

    let changed = false;
    const changes: InlineAIProposedChange[] = [];
    for (const change of thread.proposal.changes) {
      if (change.kind !== 'replace-range') {
        changes.push(change);
        continue;
      }

      const resolved = this.resolveReplaceRangeForAccept(thread, change);
      if (!resolved.ok) return err(resolved.error);
      changes.push(resolved.value);
      changed = changed || resolved.value.from !== change.from || resolved.value.to !== change.to;
    }

    const proposal = changed
      ? { ...thread.proposal, changes, updatedAt: new Date().toISOString() }
      : thread.proposal;
    const staleReason = this.getProposalStaleReason(proposal);
    return staleReason ? err(new Error(staleReason)) : ok(proposal);
  }

  private resolveReplaceRangeForAccept(
    thread: InlineAIThread,
    change: Extract<InlineAIProposedChange, { kind: 'replace-range' }>,
  ): Result<Extract<InlineAIProposedChange, { kind: 'replace-range' }>, Error> {
    const resolver = (this.editor as Partial<Pick<EditorService, 'resolveInlineAIRangeAnchor'>>)
      .resolveInlineAIRangeAnchor;
    const resolved = resolver?.call(this.editor, {
      preferredRange: { from: change.from, to: change.to },
      originalText: change.originalText,
      blockIds: thread.anchor.blockIds,
      beforeText: thread.anchor.beforeText,
      afterText: thread.anchor.afterText,
    }) ?? null;

    if (resolved) {
      const current = this.editor.getTextBetween(resolved.from, resolved.to);
      if (current === change.originalText) {
        return ok({ ...change, from: resolved.from, to: resolved.to });
      }
    }

    const current = this.editor.getTextBetween(change.from, change.to);
    if (current === change.originalText) return ok(change);
    return err(new Error('The selected text changed since this proposal was created. Retry to rebase it safely.'));
  }

  private getProposalStaleReason(proposal: InlineAIProposal): string | null {
    for (const change of proposal.changes) {
      switch (change.kind) {
        case 'replace-range': {
          const current = this.editor.getTextBetween(change.from, change.to);
          if (current !== change.originalText) {
            return 'The selected text changed since this proposal was created. Retry to rebase it safely.';
          }
          break;
        }
        case 'replace-block': {
          const block = this.editor.getBlockInfo(change.blockId);
          if (!block) return 'The target block no longer exists. Retry to create a fresh proposal.';
          if (change.originalText !== undefined && block.content !== change.originalText) {
            return 'The target block changed since this proposal was created. Retry to rebase it safely.';
          }
          break;
        }
        case 'insert-blocks': {
          if (!this.editor.getBlockInfo(change.afterBlockId)) {
            return 'The insertion anchor no longer exists. Retry to choose a new anchor.';
          }
          break;
        }
        case 'apply-note-patch': {
          const current = this.editor.getMarkdown();
          if (!current.ok) return current.error.message;
          if (hashInlineAIText(current.value) !== change.baseHash) {
            return 'The note changed since this full-note proposal was created. Retry to rebase it safely.';
          }
          break;
        }
      }
    }
    return null;
  }

  private async applyChange(
    change: InlineAIProposedChange,
    thread: InlineAIThread,
    lineageClusterId: string,
  ): Promise<Result<void, Error>> {
    const latest = thread.turns.at(-1);
    const lineage = {
      actor: { kind: 'ai-agent' as const },
      intentKind: 'rewrite' as const,
      summary: 'Accept inline AI proposal',
      commandId: 'inline-ai.accept',
      captureReason: 'tool' as const,
      prompt: latest?.prompt ?? thread.invocation.prompt,
      receiptId: thread.id,
      clusterId: lineageClusterId,
      source: { type: 'tool' as const },
      provenanceType: 'ai_rewrite' as const,
    };

    switch (change.kind) {
      case 'replace-range':
        return this.collaboration.replaceRange({
          from: change.from,
          to: change.to,
          markdown: change.markdown,
          label: 'Accept inline AI edit',
          lineage,
        });
      case 'replace-block':
        return this.collaboration.replaceBlock({
          blockId: change.blockId,
          markdown: change.markdown,
          label: 'Accept inline AI block edit',
          lineage,
        });
      case 'insert-blocks':
        return this.collaboration.insertBlocksAfter({
          blockId: change.afterBlockId,
          markdown: change.markdown,
          label: 'Accept inline AI insertion',
          lineage,
        });
      case 'apply-note-patch':
        return this.collaboration.applyNoteContent(
          change.noteId,
          change.content,
          'Accept inline AI note patch',
          lineage,
        );
    }
  }

  private createAppliedAnchor(thread: InlineAIThread): InlineAIThread['anchor'] {
    const primary = thread.proposal?.changes[0] ?? null;
    if (!primary) return thread.anchor;

    const now = new Date().toISOString();
    switch (primary.kind) {
      case 'replace-range': {
        const appliedText = markdownToAnchorText(primary.markdown);
        return {
          ...thread.anchor,
          selectedText: appliedText,
          range: {
            from: primary.from,
            to: primary.from + appliedText.length,
          },
          baseHash: hashInlineAIText(appliedText),
          createdAt: now,
        };
      }
      case 'replace-block': {
        const block = this.editor.getBlockInfo(primary.blockId);
        const appliedText = block?.content ?? markdownToAnchorText(primary.markdown);
        return {
          ...thread.anchor,
          selectedText: appliedText,
          range: block ? { from: block.pos, to: block.pos + block.size } : null,
          blockIds: [primary.blockId],
          baseHash: hashInlineAIText(appliedText),
          createdAt: now,
        };
      }
      case 'insert-blocks': {
        const insertedText = markdownToAnchorText(primary.markdown);
        return {
          ...thread.anchor,
          selectedText: insertedText,
          range: null,
          blockIds: [primary.afterBlockId],
          baseHash: hashInlineAIText(insertedText),
          createdAt: now,
        };
      }
      case 'apply-note-patch': {
        return {
          ...thread.anchor,
          selectedText: '',
          range: null,
          blockIds: [],
          baseHash: hashInlineAIText(primary.content),
          createdAt: now,
        };
      }
    }
  }

  private async ensureThreadConversation(thread: InlineAIThread): Promise<InlineAIThread> {
    if (thread.conversationId) {
      await this.aiAssistant.loadDocumentConversations(thread.notePath);
      return thread;
    }

    const conversation = await this.aiAssistant.createNewConversation({ documentPath: thread.notePath });
    return {
      ...thread,
      conversationId: conversation.id,
      updatedAt: new Date().toISOString(),
    };
  }

  private async recordLifecycle(
    thread: InlineAIThread,
    type: InlineAIThreadEventType,
    provenance: {
      type?: 'ai_action' | 'ai_rewrite';
      action: string;
      result: string;
      accepted?: boolean;
    },
    lineageClusterId?: string,
  ): Promise<InlineAIThread> {
    const latest = thread.turns.at(-1);
    const lifecycleEvent: Parameters<typeof appendInlineAIThreadEvent>[1] = {
      type,
      message: provenance.result,
    };
    if (latest?.id) lifecycleEvent.turnId = latest.id;
    if (thread.proposal?.id) lifecycleEvent.proposalId = thread.proposal.id;
    if (thread.conversationId) lifecycleEvent.conversationId = thread.conversationId;
    if (lineageClusterId) lifecycleEvent.lineageClusterId = lineageClusterId;
    let next = appendInlineAIThreadEvent(thread, lifecycleEvent);

    if (!this.provenance) return next;

    const eventData: Parameters<ProvenanceService['record']>[1] = {
      type: provenance.type ?? 'ai_action',
      blocks: thread.anchor.blockIds,
      prompt: latest?.prompt ?? thread.invocation.prompt,
      action: provenance.action,
      result: provenance.result,
      inlineThreadId: thread.id,
      receiptId: thread.id,
    };
    if (provenance.accepted !== undefined) eventData.accepted = provenance.accepted;
    if (latest?.id) eventData.inlineTurnId = latest.id;
    if (thread.proposal?.id) eventData.inlineProposalId = thread.proposal.id;
    if (thread.conversationId) eventData.conversationId = thread.conversationId;
    if (lineageClusterId) eventData.lineageClusterId = lineageClusterId;
    const event = await this.provenance.record(noteNameFromPath(thread.notePath), eventData);
    if (event.ok) {
      next = withInlineAIThreadLinks(next, { provenanceEventIds: [event.value.id] });
      const events = next.events.map((candidate, index) =>
        index === next.events.length - 1
          ? { ...candidate, provenanceEventId: event.value.id }
          : candidate
      );
      next = { ...next, events };
    }
    return next;
  }

  private async ensureLoaded(notePath: string): Promise<Result<void, Error>> {
    const normalized = normalizeNotePath(notePath);
    if (this.loadedNotes.has(normalized)) return ok(undefined);

    const path = this.storagePath(normalized);
    const result = await this.voidStorage.readJson<InlineAIThreadFile>(this.notesPath, path);
    if (!result.ok) return err(result.error);

    const threads = (result.value?.threads ?? []).map((thread) => this.normalizeThread(thread, normalized));
    this.threadsByNote.set(normalized, threads);
    this.loadedNotes.add(normalized);
    return ok(undefined);
  }

  private normalizeThread(thread: InlineAIThread, notePath: string): InlineAIThread {
    const firstTurn = thread.turns[0];
    const invocation = thread.invocation ?? {
      source: 'inline-note-ask' as const,
      entryPoint: 'unknown' as const,
      notePath,
      prompt: firstTurn?.prompt ?? 'Inline AI',
      selectedText: thread.anchor.selectedText,
      range: thread.anchor.range,
      blockIds: thread.anchor.blockIds,
      beforeText: thread.anchor.beforeText,
      afterText: thread.anchor.afterText,
      createdAt: thread.createdAt,
    };
    return {
      ...thread,
      notePath,
      invocation,
      events: Array.isArray(thread.events) ? thread.events : [],
      links: {
        provenanceEventIds: thread.links?.provenanceEventIds ?? [],
        lineageClusterIds: thread.links?.lineageClusterIds ?? [],
        lineagePatchIds: thread.links?.lineagePatchIds ?? [],
        lineageIntentIds: thread.links?.lineageIntentIds ?? [],
      },
    };
  }


  private async upsertThread(thread: InlineAIThread): Promise<void> {
    const notePath = normalizeNotePath(thread.notePath);
    const threads = this.threadsByNote.get(notePath) ?? [];
    const next = threads.some((candidate) => candidate.id === thread.id)
      ? threads.map((candidate) => candidate.id === thread.id ? thread : candidate)
      : [...threads, thread];
    this.threadsByNote.set(notePath, next);
    this.loadedNotes.add(notePath);
    await this.persist(notePath);
    this.notify();
  }

  private async persist(notePath: string): Promise<void> {
    const normalized = normalizeNotePath(notePath);
    await this.voidStorage.writeJson(this.notesPath, this.storagePath(normalized), {
      version: INLINE_AI_FILE_VERSION,
      notePath: normalized,
      threads: this.threadsByNote.get(normalized) ?? [],
    } satisfies InlineAIThreadFile);
  }

  private storagePath(notePath: string): string {
    return inlineAIPath(noteNameFromPath(notePath));
  }

  private findThread(threadId: string): { notePath: string; thread: InlineAIThread } | null {
    for (const [notePath, threads] of this.threadsByNote.entries()) {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (thread) return { notePath, thread };
    }
    return null;
  }

  private notify(): void {
    const threads = this.getThreads();
    for (const subscriber of this.subscribers) subscriber(threads);
  }
}

export function parseInlineAIProposalFromToolCalls(input: {
  toolCalls: ToolCall[];
  notePath: string;
  anchor: InlineAIThread['anchor'];
  editor: Pick<EditorService, 'getBlockInfo' | 'getMarkdown' | 'getTextBetween'>;
}): InlineAIProposal | null {
  const changes: InlineAIProposedChange[] = [];

  for (const toolCall of input.toolCalls) {
    const args = toolCall.args ?? {};
    switch (toolCall.toolId) {
      case 'editor:replace': {
        const markdown = asString(args.text);
        if (markdown == null) break;
        const selectedTextAtRange = input.anchor.range
          ? input.editor.getTextBetween(input.anchor.range.from, input.anchor.range.to)
          : input.anchor.selectedText;
        const range = resolveReplaceRange(args, input.anchor, selectedTextAtRange);
        if (!range) break;
        changes.push({
          kind: 'replace-range',
          from: range.from,
          to: range.to,
          markdown,
          originalText: input.editor.getTextBetween(range.from, range.to),
        });
        break;
      }
      case 'editor:replace-block': {
        const rawBlockId = asString(args.blockId);
        const markdown = asString(args.markdown);
        if (!rawBlockId || markdown == null) break;
        const blockId = normalizeBlockId(rawBlockId);
        const change: InlineAIProposedChange = {
          kind: 'replace-block',
          blockId,
          markdown,
        };
        const originalText = input.editor.getBlockInfo(blockId)?.content;
        if (originalText !== undefined) change.originalText = originalText;
        changes.push(change);
        break;
      }
      case 'editor:insert-blocks': {
        const afterBlockId = asString(args.afterBlockId);
        const markdown = asString(args.markdown);
        if (!afterBlockId || markdown == null) break;
        changes.push({
          kind: 'insert-blocks',
          afterBlockId: normalizeBlockId(afterBlockId),
          markdown,
        });
        break;
      }
      case 'editor:apply-note-patch': {
        const content = asString(args.content);
        if (content == null) break;
        const current = input.editor.getMarkdown();
        changes.push({
          kind: 'apply-note-patch',
          noteId: asString(args.noteId) ?? input.notePath,
          content,
          baseHash: hashInlineAIText(current.ok ? current.value : ''),
        });
        break;
      }
    }
  }

  if (changes.length === 0) return null;
  return createInlineAIProposal(changes, input.anchor.baseHash);
}

export function buildInlineSelectionPrompt(input: {
  prompt: string;
  selectedText: string;
  noteTitle: string;
  notePath: string | null;
  from: number | null;
  to: number | null;
  blockIds: string[];
  beforeText?: string;
  afterText?: string;
  blockContext?: string;
  likelyLanguage?: string;
}): string {
  const range = input.from != null && input.to != null
    ? `${input.from}-${input.to}`
    : 'unknown';
  const blockIds = input.blockIds.length > 0 ? input.blockIds.join(', ') : 'none';
  const beforeText = limitContextText(input.beforeText ?? '', 'end');
  const afterText = limitContextText(input.afterText ?? '', 'start');
  const blockContext = (input.blockContext ?? '').trim() || 'No visible block content was resolved.';

  return [
    'Inline note AI request.',
    `Note title: ${input.noteTitle}`,
    `Note path: ${input.notePath ?? 'unknown'}`,
    `Likely note language: ${input.likelyLanguage ?? 'Infer from context'}`,
    `Selected editor range: ${range}`,
    `Visible block IDs in/near selection: ${blockIds}`,
    '',
    'Visible block content:',
    '---',
    blockContext,
    '---',
    '',
    'Local context before selection:',
    '---',
    beforeText || '(start of note or unavailable)',
    '---',
    '',
    'Selected text:',
    '---',
    input.selectedText || '(empty selection)',
    '---',
    '',
    'Local context after selection:',
    '---',
    afterText || '(end of note or unavailable)',
    '---',
    '',
    'User request:',
    input.prompt,
    '',
    'Rewrite guidance:',
    '- Make the replacement specific to the selected range and local context.',
    '- Preserve the note language, tone, and nearby topic unless the user asks otherwise.',
    '- If the selected text is low-signal placeholder text, use the local context to write the best concrete replacement.',
    '- Do not use generic stock replacements such as "Dit is een duidelijkere zin." unless the context uniquely calls for that exact sentence.',
  ].join('\n');
}

function limitContextText(value: string, side: 'start' | 'end'): string {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n');
  if (normalized.length <= INLINE_AI_PROMPT_CONTEXT_LIMIT) return normalized;
  return side === 'start'
    ? normalized.slice(0, INLINE_AI_PROMPT_CONTEXT_LIMIT)
    : normalized.slice(normalized.length - INLINE_AI_PROMPT_CONTEXT_LIMIT);
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

export function detectLikelyLanguage(value: string): string {
  const normalized = value.toLowerCase();
  const dutchMatches = normalized.match(/\b(de|het|een|en|van|voor|zin|deze|dit|dat|niet|wel|met|naar|om|is|zijn|wordt|punten|belangrijkste)\b/g)?.length ?? 0;
  const englishMatches = normalized.match(/\b(the|a|an|and|of|for|sentence|this|that|not|with|to|is|are|will|should|note|points|important)\b/g)?.length ?? 0;
  if (dutchMatches >= 2 && dutchMatches >= englishMatches) return 'Dutch';
  if (englishMatches >= 2 && englishMatches > dutchMatches) return 'English';
  return 'Infer from selected text and surrounding note context';
}

function resolveReplaceRange(
  args: Record<string, unknown>,
  anchor: InlineAIThread['anchor'],
  selectedTextAtRange: string,
): { from: number; to: number } | null {
  const explicitFrom = asFiniteNumber(args.from);
  const explicitTo = asFiniteNumber(args.to);
  if (explicitFrom != null && explicitTo != null && explicitFrom <= explicitTo) {
    return { from: explicitFrom, to: explicitTo };
  }

  const targetText = asString(args.targetText);
  if (targetText && anchor.range) {
    const matches = findOccurrences(selectedTextAtRange, targetText);
    const occurrence = Math.max(1, Math.floor(asFiniteNumber(args.occurrence) ?? 1));
    const matchStart = matches[occurrence - 1];
    if (matchStart != null) {
      return {
        from: anchor.range.from + matchStart,
        to: anchor.range.from + matchStart + targetText.length,
      };
    }
  }

  return anchor.range;
}

function normalizeBlockId(blockId: string): string {
  const ref = parseRefId(blockId.trim());
  return ref?.kind === 'block' ? ref.blockId : blockId.trim();
}

function normalizeNotePath(notePath: string): string {
  return notePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function findOccurrences(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  if (!needle) return indices;
  let start = 0;
  while (start <= haystack.length) {
    const index = haystack.indexOf(needle, start);
    if (index < 0) break;
    indices.push(index);
    start = index + needle.length;
  }
  return indices;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function markdownToAnchorText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[^\n]*\n?|\n?```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
