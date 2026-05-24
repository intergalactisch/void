import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import {
  InlineAIThreadServiceImpl,
  buildInlineSelectionPrompt,
  detectLikelyLanguage,
  parseInlineAIProposalFromToolCalls,
} from '$lib/application/services/InlineAIThreadServiceImpl';
import { createInlineAIAnchor } from '$lib/domain/entities/InlineAIThread';
import type {
  AIAssistantService,
  DocumentService,
  EditorService,
  NoteCollaborationService,
  ProtectionService,
} from '$lib/ports/inbound';

describe('parseInlineAIProposalFromToolCalls', () => {
  const editor = {
    getTextBetween: (from: number, to: number) => `text:${from}-${to}`,
    getBlockInfo: (blockId: string) => ({
      id: blockId,
      type: 'paragraph',
      pos: 1,
      size: 10,
      isAILocked: false,
      content: 'block text',
    }),
    getMarkdown: () => ok('current markdown'),
    getState: () => ({
      document: null,
    }),
  } as Pick<EditorService, 'getBlockInfo' | 'getMarkdown' | 'getTextBetween' | 'getState'>;

  it('parses targetText replacements into absolute staged ranges', () => {
    const anchor = createInlineAIAnchor({
      notePath: 'demo.md',
      selectedText: 'one fish two fish',
      range: { from: 10, to: 27 },
    });
    const proposal = parseInlineAIProposalFromToolCalls({
      toolCalls: [{
        id: 'tc_1',
        toolId: 'editor:replace',
        args: { targetText: 'fish', occurrence: 2, text: 'bird' },
      }],
      notePath: 'demo.md',
      anchor,
      editor: {
        ...editor,
        getTextBetween: () => 'one fish two fish',
      },
    });

    expect(proposal?.changes[0]).toMatchObject({
      kind: 'replace-range',
      from: 23,
      to: 27,
      markdown: 'bird',
    });
  });

  it('preserves zero-length insert-style ranges as staged proposals', () => {
    const anchor = createInlineAIAnchor({
      notePath: 'demo.md',
      selectedText: '',
      range: { from: 12, to: 12 },
    });
    const proposal = parseInlineAIProposalFromToolCalls({
      toolCalls: [{
        id: 'tc_1',
        toolId: 'editor:replace',
        args: { from: 12, to: 12, text: 'inserted text' },
      }],
      notePath: 'demo.md',
      anchor,
      editor,
    });

    expect(proposal?.changes[0]).toMatchObject({
      kind: 'replace-range',
      from: 12,
      to: 12,
      markdown: 'inserted text',
      originalText: 'text:12-12',
    });
  });

  it('maps insert-code-block tool calls to staged block insertions', () => {
    const anchor = createInlineAIAnchor({
      notePath: 'demo.md',
      selectedText: '',
      range: { from: 12, to: 12 },
      blockIds: ['p1'],
    });
    const proposal = parseInlineAIProposalFromToolCalls({
      toolCalls: [{
        id: 'tc_1',
        toolId: 'editor:insert-code-block',
        args: {
          afterBlockId: 'p1',
          code: 'const x = 1;',
          language: 'ts',
          title: 'api.ts',
        },
      }],
      notePath: 'demo.md',
      anchor,
      editor,
    });

    expect(proposal?.changes[0]).toMatchObject({
      kind: 'insert-blocks',
      afterBlockId: 'p1',
      markdown: '```ts title="api.ts"\nconst x = 1;\n```',
    });
  });

  it('maps update-code-block tool calls to staged block replacements', () => {
    const anchor = createInlineAIAnchor({
      notePath: 'demo.md',
      selectedText: '',
      blockIds: ['code-1'],
    });
    const proposal = parseInlineAIProposalFromToolCalls({
      toolCalls: [{
        id: 'tc_1',
        toolId: 'editor:update-code-block',
        args: {
          blockId: 'code-1',
          lineNumbers: true,
          highlightLines: '1',
        },
      }],
      notePath: 'demo.md',
      anchor,
      editor: {
        ...editor,
        getState: () => ({
          document: {
            path: 'demo.md',
            blocks: [{
              id: 'code-1',
              type: 'codeBlock',
              content: 'const x = 1;',
              marks: [],
              children: [],
              attrs: { type: 'codeBlock', language: 'ts', meta: 'title="api.ts"' },
            }],
          },
        }),
      },
    });

    expect(proposal?.changes[0]).toMatchObject({
      kind: 'replace-block',
      blockId: 'code-1',
      markdown: '```ts title="api.ts" lineNumbers {1}\nconst x = 1;\n```',
      originalText: 'const x = 1;',
    });
  });
});

describe('buildInlineSelectionPrompt', () => {
  it('includes readable local context, block content, and language hints', () => {
    const prompt = buildInlineSelectionPrompt({
      prompt: 'verander deze zin',
      selectedText: 'asdadaad',
      noteTitle: 'Demo',
      notePath: 'demo.md',
      from: 320,
      to: 328,
      blockIds: ['block-a'],
      beforeText: 'Dit is een aangepaste formulering.\n\nasdsadsadas',
      afterText: 'asdsadsadsadas\n\nDit is een betere formulering.',
      blockContext: 'block-a (paragraph): asdadaad',
      likelyLanguage: 'Dutch',
    });

    expect(prompt).toContain('Likely note language: Dutch');
    expect(prompt).toContain('Visible block content:');
    expect(prompt).toContain('block-a (paragraph): asdadaad');
    expect(prompt).toContain('Local context before selection:');
    expect(prompt).toContain('Dit is een aangepaste formulering.\n\nasdsadsadas');
    expect(prompt).toContain('Local context after selection:');
    expect(prompt).toContain('Dit is een betere formulering.');
    expect(prompt).toContain('Do not use generic stock replacements');
  });

  it('detects Dutch from surrounding note context', () => {
    expect(detectLikelyLanguage('Dit is een aangepaste formulering van de belangrijkste punten.')).toBe('Dutch');
  });
});

describe('InlineAIThreadServiceImpl', () => {
  function protectedDocuments(lockState: 'locked' | 'unlocked' = 'unlocked'): DocumentService {
    return {
      readMeta: vi.fn(async () => ok({
        title: 'Secrets',
        protection: {
          level: 'protected',
          noteId: 'pnote_1',
          keyId: 'pkey_1',
          algorithm: 'AES-256-GCM',
          envelopeVersion: 2,
          protectedAt: '2026-05-23T00:00:00.000Z',
          titleVisible: true,
          lockState,
        },
      })),
    } as unknown as DocumentService;
  }

  function protectionService(
    hasAIContextAuthorization: ProtectionService['hasAIContextAuthorization'],
  ): ProtectionService {
    return {
      currentPolicy: () => ({
        idleLockMinutes: 15,
        lockOnAppClose: true,
        lockOnSleep: false,
        hideProtectedPreviews: true,
        requireAIApprovalForProtectedReads: true,
        requireAIApprovalForProtectedWrites: true,
      }),
      hasAIContextAuthorization,
    } as unknown as ProtectionService;
  }

  function inlineEditor(): EditorService {
    return {
      getTextContent: () => 'a secret note',
      getTextBetween: (from: number, to: number) => {
        if (from === 2 && to === 8) return 'secret';
        if (to === 2) return 'before ';
        if (from === 8) return ' after';
        return '';
      },
      getMarkdown: () => ok('a secret note'),
      getBlockInfo: () => null,
      getState: () => ({
        document: { path: 'secret.md', meta: { title: 'Secrets' } },
      }),
    } as unknown as EditorService;
  }

  it('blocks protected inline ASK before creating conversations, threads, or prompts', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const aiAssistant = {
      createNewConversation: vi.fn(async () => ({ id: 'conv_1' })),
      prompt: vi.fn(),
    } as unknown as AIAssistantService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      {} as unknown as NoteCollaborationService,
      inlineEditor(),
      null,
      protectedDocuments(),
      protectionService(vi.fn(() => false)),
    );

    const created = await service.submitSelectionPrompt({
      prompt: 'Improve this',
      selectionText: 'secret',
      notePath: 'secret.md',
      from: 2,
      to: 8,
      blockIds: ['block-a'],
    });

    expect(created.ok).toBe(false);
    if (created.ok) throw new Error('Expected protected inline AI denial');
    expect(created.error.message).toContain('Grant AI access to this highlighted text');
    expect(aiAssistant.createNewConversation).not.toHaveBeenCalled();
    expect(aiAssistant.prompt).not.toHaveBeenCalled();
    expect(service.getThreads('secret.md')).toHaveLength(0);
  });

  it('allows protected inline ASK after selection-scoped read and write approval', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const aiAssistant = {
      createNewConversation: vi.fn(async () => ({ id: 'conv_1' })),
      loadDocumentConversations: vi.fn(async () => []),
      prompt: vi.fn(async () => ok({
        chat: 'Answer only.',
        toolCalls: [],
        meta: { provider: 'test', model: 'test', latencyMs: 1 },
        truncated: false,
        stopReason: 'stop',
      })),
    } as unknown as AIAssistantService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      {} as unknown as NoteCollaborationService,
      inlineEditor(),
      null,
      protectedDocuments(),
      protectionService(vi.fn((_noteId, _scope, resource) => String(resource ?? '').startsWith('selection:secret.md#2-8:'))),
    );

    const created = await service.submitSelectionPrompt({
      prompt: 'Explain this',
      selectionText: 'secret',
      notePath: 'secret.md',
      from: 2,
      to: 8,
      blockIds: ['block-a'],
    });

    expect(created.ok).toBe(true);
    await waitFor(() => service.getThreads('secret.md')[0]?.status === 'answer');
    expect(aiAssistant.createNewConversation).toHaveBeenCalledTimes(1);
    expect(aiAssistant.prompt).toHaveBeenCalledTimes(1);
  });

  it('requires write approval again before accepting a protected inline proposal', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const replaceRange = vi.fn(async () => ok(undefined));
    let writeAllowed = true;
    const aiAssistant = {
      createNewConversation: vi.fn(async () => ({ id: 'conv_1' })),
      loadDocumentConversations: vi.fn(async () => []),
      prompt: vi.fn(async () => ok({
        chat: 'I drafted the replacement.',
        toolCalls: [{
          id: 'tc_1',
          toolId: 'editor:replace',
          args: { from: 2, to: 8, text: 'safer' },
        }],
        meta: { provider: 'test', model: 'test', latencyMs: 1 },
        truncated: false,
        stopReason: 'tool_use',
      })),
    } as unknown as AIAssistantService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      { replaceRange } as unknown as NoteCollaborationService,
      inlineEditor(),
      null,
      protectedDocuments(),
      protectionService(vi.fn((_noteId, scope, resource) =>
        String(resource ?? '').startsWith('selection:secret.md#2-8:') &&
        (scope === 'selection.read' || (scope === 'note.write' && writeAllowed))
      )),
    );

    const created = await service.submitSelectionPrompt({
      prompt: 'Improve this',
      selectionText: 'secret',
      notePath: 'secret.md',
      from: 2,
      to: 8,
      blockIds: ['block-a'],
    });
    if (!created.ok) throw created.error;
    await waitFor(() => service.getThreads('secret.md')[0]?.proposal?.status === 'pending');

    writeAllowed = false;
    const accepted = await service.acceptProposal(created.value.id);

    expect(accepted.ok).toBe(false);
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it('stages selection edits and applies them only after accept', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const replaceRange = vi.fn(async () => ok(undefined));
    const collaboration = {
      replaceRange,
    } as unknown as NoteCollaborationService;
    const aiAssistant = {
      isAvailable: vi.fn(async () => true),
      createNewConversation: vi.fn(async () => ({ id: 'conv_1' })),
      loadDocumentConversations: vi.fn(async () => []),
      prompt: vi.fn(async () => ok({
        chat: 'I drafted the replacement.',
        toolCalls: [{
          id: 'tc_1',
          toolId: 'editor:replace',
          args: { from: 2, to: 6, text: 'better' },
        }],
        meta: { provider: 'test', model: 'test', latencyMs: 1 },
        truncated: false,
        stopReason: 'tool_use',
      })),
    } as unknown as AIAssistantService;
    const editor = {
      getTextContent: () => 'a rough note',
      getTextBetween: (from: number, to: number) => {
        if (from === 2 && to === 6) return 'text:2-6';
        if (to === 2) return 'intro context\n';
        if (from === 6) return '\noutro context';
        return '';
      },
      getMarkdown: () => ok('a rough note'),
      getBlockInfo: () => null,
      getState: () => ({
        document: { path: 'demo.md', meta: { title: 'Demo' } },
      }),
    } as unknown as EditorService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      collaboration,
      editor,
    );

    const created = await service.submitSelectionPrompt({
      prompt: 'Improve this',
      selectionText: 'text:2-6',
      notePath: 'demo.md',
      from: 2,
      to: 6,
      blockIds: ['block-a'],
    });

    expect(created.ok).toBe(true);
    expect(replaceRange).not.toHaveBeenCalled();
    if (!created.ok) throw created.error;
    expect(created.value.status).toBe('generating');

    await waitFor(() => service.getThreads('demo.md')[0]?.proposal?.status === 'pending');
    const proposed = service.getThreads('demo.md')[0];
    if (!proposed) throw new Error('Expected proposed thread');
    const internalPrompt = (aiAssistant.prompt as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(internalPrompt).toContain('Local context before selection:');
    expect(internalPrompt).toContain('intro context');
    expect(internalPrompt).toContain('Local context after selection:');
    expect(internalPrompt).toContain('outro context');
    expect(proposed.anchor.beforeText).toBe('intro context\n');
    expect(proposed.anchor.afterText).toBe('\noutro context');

    const accepted = await service.acceptProposal(proposed.id);

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    expect(accepted.value.status).toBe('applied');
    expect(accepted.value.anchor.selectedText).toBe('better');
    expect(accepted.value.anchor.range).toEqual({ from: 2, to: 8 });
    expect(replaceRange).toHaveBeenCalledWith(expect.objectContaining({
      from: 2,
      to: 6,
      markdown: 'better',
    }));
  });

  it('marks proposals stale when the base range no longer matches', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const collaboration = {
      replaceRange: vi.fn(async () => ok(undefined)),
    } as unknown as NoteCollaborationService;
    const aiAssistant = {
      createNewConversation: vi.fn(async () => ({ id: 'conv_1' })),
      loadDocumentConversations: vi.fn(async () => []),
      prompt: vi.fn(async () => ok({
        chat: 'I drafted the replacement.',
        toolCalls: [{
          id: 'tc_1',
          toolId: 'editor:replace',
          args: { from: 2, to: 6, text: 'better' },
        }],
        meta: { provider: 'test', model: 'test', latencyMs: 1 },
        truncated: false,
        stopReason: 'tool_use',
      })),
    } as unknown as AIAssistantService;
    let currentText = 'text:2-6';
    const editor = {
      getTextContent: () => 'a rough note',
      getTextBetween: () => currentText,
      getMarkdown: () => ok('a rough note'),
      getBlockInfo: () => null,
      getState: () => ({
        document: { path: 'demo.md', meta: { title: 'Demo' } },
      }),
    } as unknown as EditorService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      collaboration,
      editor,
    );
    const created = await service.submitSelectionPrompt({
      prompt: 'Improve this',
      selectionText: 'text:2-6',
      notePath: 'demo.md',
      from: 2,
      to: 6,
      blockIds: ['block-a'],
    });
    if (!created.ok) throw created.error;
    await waitFor(() => service.getThreads('demo.md')[0]?.proposal?.status === 'pending');

    currentText = 'changed underneath';
    const accepted = await service.acceptProposal(created.value.id);

    expect(accepted.ok).toBe(false);
    expect(service.getThreads('demo.md')[0]?.status).toBe('stale');
    expect(collaboration.replaceRange).not.toHaveBeenCalled();
  });

  it('rebases pending replace-range proposals when earlier accepts shift their stored positions', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    let currentText = 'alpha beta gamma';
    const replaceRange = vi.fn(async (change: { from: number; to: number; markdown: string }) => {
      currentText = `${currentText.slice(0, change.from)}${change.markdown}${currentText.slice(change.to)}`;
      return ok(undefined);
    });
    const collaboration = {
      replaceRange,
    } as unknown as NoteCollaborationService;
    const aiAssistant = {
      createNewConversation: vi
        .fn()
        .mockResolvedValueOnce({ id: 'conv_1' })
        .mockResolvedValueOnce({ id: 'conv_2' }),
      loadDocumentConversations: vi.fn(async () => []),
      prompt: vi
        .fn()
        .mockResolvedValueOnce(ok({
          chat: 'I drafted the first replacement.',
          toolCalls: [{
            id: 'tc_1',
            toolId: 'editor:replace',
            args: { from: 0, to: 5, text: 'long alpha' },
          }],
          meta: { provider: 'test', model: 'test', latencyMs: 1 },
          truncated: false,
          stopReason: 'tool_use',
        }))
        .mockResolvedValueOnce(ok({
          chat: 'I drafted the second replacement.',
          toolCalls: [{
            id: 'tc_2',
            toolId: 'editor:replace',
            args: { from: 11, to: 16, text: 'new gamma' },
          }],
          meta: { provider: 'test', model: 'test', latencyMs: 1 },
          truncated: false,
          stopReason: 'tool_use',
        })),
    } as unknown as AIAssistantService;
    const resolveInlineAIRangeAnchor = vi.fn((input: {
      preferredRange: { from: number; to: number } | null;
      originalText: string;
    }) => {
      const preferred = input.preferredRange;
      if (preferred && currentText.slice(preferred.from, preferred.to) === input.originalText) {
        return preferred;
      }
      const firstIndex = currentText.indexOf(input.originalText);
      if (firstIndex < 0) return null;
      if (currentText.indexOf(input.originalText, firstIndex + input.originalText.length) >= 0) {
        return null;
      }
      return { from: firstIndex, to: firstIndex + input.originalText.length };
    });
    const editor = {
      getTextContent: () => currentText,
      getTextBetween: (from: number, to: number) => currentText.slice(from, to),
      getMarkdown: () => ok(currentText),
      getBlockInfo: () => null,
      getState: () => ({
        document: { path: 'demo.md', meta: { title: 'Demo' } },
      }),
      resolveInlineAIRangeAnchor,
    } as unknown as EditorService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      collaboration,
      editor,
    );

    const first = await service.submitSelectionPrompt({
      prompt: 'Improve this',
      selectionText: 'alpha',
      notePath: 'demo.md',
      from: 0,
      to: 5,
      blockIds: ['block-a'],
    });
    const second = await service.submitSelectionPrompt({
      prompt: 'Improve this too',
      selectionText: 'gamma',
      notePath: 'demo.md',
      from: 11,
      to: 16,
      blockIds: ['block-b'],
    });
    if (!first.ok) throw first.error;
    if (!second.ok) throw second.error;
    await waitFor(() => service.getThreads('demo.md').every((thread) => thread.proposal?.status === 'pending'));

    const acceptedFirst = await service.acceptProposal(first.value.id);
    const acceptedSecond = await service.acceptProposal(second.value.id);

    expect(acceptedFirst.ok).toBe(true);
    expect(acceptedSecond.ok).toBe(true);
    expect(currentText).toBe('long alpha beta new gamma');
    expect(replaceRange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      from: 0,
      to: 5,
      markdown: 'long alpha',
    }));
    expect(replaceRange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      from: 16,
      to: 21,
      markdown: 'new gamma',
    }));
    expect(resolveInlineAIRangeAnchor).toHaveBeenCalledWith(expect.objectContaining({
      preferredRange: { from: 11, to: 16 },
      originalText: 'gamma',
    }));
  });

  it('keeps proposals stale when the original text can no longer be resolved unambiguously', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const replaceRange = vi.fn(async () => ok(undefined));
    const collaboration = {
      replaceRange,
    } as unknown as NoteCollaborationService;
    const aiAssistant = {
      createNewConversation: vi.fn(async () => ({ id: 'conv_1' })),
      loadDocumentConversations: vi.fn(async () => []),
      prompt: vi.fn(async () => ok({
        chat: 'I drafted the replacement.',
        toolCalls: [{
          id: 'tc_1',
          toolId: 'editor:replace',
          args: { from: 5, to: 9, text: 'better' },
        }],
        meta: { provider: 'test', model: 'test', latencyMs: 1 },
        truncated: false,
        stopReason: 'tool_use',
      })),
    } as unknown as AIAssistantService;
    let currentText = 'xxxx same and same';
    const editor = {
      getTextContent: () => currentText,
      getTextBetween: (from: number, to: number) => currentText.slice(from, to),
      getMarkdown: () => ok(currentText),
      getBlockInfo: () => null,
      getState: () => ({
        document: { path: 'demo.md', meta: { title: 'Demo' } },
      }),
      resolveInlineAIRangeAnchor: () => null,
    } as unknown as EditorService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      collaboration,
      editor,
    );

    const created = await service.submitSelectionPrompt({
      prompt: 'Improve this',
      selectionText: 'same',
      notePath: 'demo.md',
      from: 5,
      to: 9,
      blockIds: [],
    });
    if (!created.ok) throw created.error;
    await waitFor(() => service.getThreads('demo.md')[0]?.proposal?.status === 'pending');

    currentText = 'same and same';
    const accepted = await service.acceptProposal(created.value.id);

    expect(accepted.ok).toBe(false);
    expect(replaceRange).not.toHaveBeenCalled();
    expect(service.getThreads('demo.md')[0]?.status).toBe('stale');
  });

  it('starts multiple inline prompts without waiting for the first generation', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const collaboration = {} as unknown as NoteCollaborationService;
    const promptResolvers: Array<(value: unknown) => void> = [];
    const aiAssistant = {
      createNewConversation: vi
        .fn()
        .mockResolvedValueOnce({ id: 'conv_1' })
        .mockResolvedValueOnce({ id: 'conv_2' }),
      loadDocumentConversations: vi.fn(async () => []),
      prompt: vi.fn(() => new Promise((resolve) => {
        promptResolvers.push(resolve);
      })),
    } as unknown as AIAssistantService;
    const editor = {
      getTextContent: () => 'first second',
      getTextBetween: (from: number, to: number) => `text:${from}-${to}`,
      getMarkdown: () => ok('first second'),
      getBlockInfo: () => null,
      getState: () => ({
        document: { path: 'demo.md', meta: { title: 'Demo' } },
      }),
    } as unknown as EditorService;
    const service = new InlineAIThreadServiceImpl(
      voidStorage,
      '/notes',
      aiAssistant,
      collaboration,
      editor,
    );

    const first = await service.submitSelectionPrompt({
      prompt: 'Improve first',
      selectionText: 'first',
      notePath: 'demo.md',
      from: 0,
      to: 5,
      blockIds: ['block-a'],
    });
    const second = await service.submitSelectionPrompt({
      prompt: 'Improve second',
      selectionText: 'second',
      notePath: 'demo.md',
      from: 6,
      to: 12,
      blockIds: ['block-b'],
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(service.getThreads('demo.md')).toHaveLength(2);
    await waitFor(() => (aiAssistant.prompt as ReturnType<typeof vi.fn>).mock.calls.length === 2);
    expect(aiAssistant.prompt).toHaveBeenCalledTimes(2);
    const internalPrompts = (aiAssistant.prompt as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(internalPrompts[0]).not.toEqual(internalPrompts[1]);
    expect(internalPrompts[0]).toContain('Selected text:\n---\nfirst');
    expect(internalPrompts[1]).toContain('Selected text:\n---\nsecond');
    expect(internalPrompts[0]).toContain('Local context before selection:');
    expect(internalPrompts[1]).toContain('Local context before selection:');
    expect(service.getThreads('demo.md').map((thread) => thread.conversationId)).toEqual(['conv_1', 'conv_2']);
    for (const resolve of promptResolvers) {
      resolve(ok({
        chat: 'Done.',
        toolCalls: [],
        meta: { provider: 'test', model: 'test', latencyMs: 1 },
        truncated: false,
        stopReason: 'stop',
      }));
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for inline AI test condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
