import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { NoteAIActivityServiceImpl } from '$lib/application/services';
import {
  completeInlineAITurn,
  createInlineAIAnchor,
  createInlineAIProposal,
  createInlineAIThread,
  markInlineAIProposal,
  withInlineAIThreadLinks,
} from '$lib/domain/entities/InlineAIThread';
import type {
  AIAssistantService,
  InlineAIThreadService,
  LineageService,
  ProvenanceService,
} from '$lib/ports/inbound';

describe('NoteAIActivityServiceImpl', () => {
  it('joins inline threads to conversations, provenance, and lineage entries', async () => {
    const anchor = createInlineAIAnchor({
      notePath: 'demo.md',
      selectedText: 'rough',
      range: { from: 1, to: 6 },
      blockIds: ['block-a'],
    });
    const proposal = createInlineAIProposal([
      { kind: 'replace-range', from: 1, to: 6, markdown: 'better', originalText: 'rough' },
    ], anchor.baseHash);
    const thread = withInlineAIThreadLinks({
      ...completeInlineAITurn(createInlineAIThread({
        notePath: 'demo.md',
        conversationId: 'conv_1',
        anchor,
        prompt: 'Improve this',
      }), {
        response: 'I drafted a better sentence.',
        toolCalls: [],
        conversationId: 'conv_1',
        proposal,
      }),
      status: 'applied',
      proposal: markInlineAIProposal(proposal, 'accepted'),
    }, {
      provenanceEventIds: ['evt_1'],
      lineageClusterIds: ['cluster_1'],
    });

    const inlineAI = {
      loadForDocument: vi.fn(async () => ok([thread])),
    } as unknown as InlineAIThreadService;
    const aiAssistant = {
      loadDocumentConversations: vi.fn(async () => [{
        id: 'conv_1',
        title: 'Improve this',
        messages: [],
        status: 'active',
        initialContext: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        totalTokens: { input: 0, output: 0 },
        tags: [],
        documentPath: 'demo.md',
      }]),
    } as unknown as AIAssistantService;
    const provenance = {
      getHistory: vi.fn(async () => ok([{
        id: 'evt_1',
        type: 'ai_rewrite',
        ts: new Date().toISOString(),
        blocks: ['block-a'],
        prompt: 'Improve this',
        accepted: true,
        action: 'inline_ai.accept',
        result: 'Accepted',
        inlineThreadId: thread.id,
        conversationId: 'conv_1',
      }])),
    } as unknown as ProvenanceService;
    const lineage = {
      getTimeline: vi.fn(async () => ok({
        notePath: 'demo.md',
        currentMarkdownHash: null,
        queue: { pendingJobs: 0, activeJobs: 0, lastError: null },
        entries: [{
          id: 'entry_1',
          notePath: 'demo.md',
          patchId: 'patch_1',
          intentId: 'intent_1',
          intent: {
            id: 'intent_1',
            kind: 'rewrite',
            actor: { kind: 'ai-agent' },
            createdAt: new Date().toISOString(),
            summary: 'Accept inline AI proposal',
            receiptId: thread.id,
          },
          createdAt: new Date().toISOString(),
          clusterId: 'cluster_1',
          captureReason: 'tool',
          kind: 'rewrite',
          changeTypes: ['unit.updated'],
          changedUnitIds: ['unit_1'],
          lineRange: { start: 1, end: 1 },
          versions: [],
          deletedLines: [],
          warningIds: [],
          diffHunks: [{
            id: 'hunk_1',
            unitId: 'unit_1',
            line: 1,
            changeType: 'unit.updated',
            before: 'rough',
            after: 'better',
            tokens: [],
          }],
          summary: 'Accept inline AI proposal',
          receiptId: thread.id,
        }],
        deletedLines: [],
        warnings: [],
        pendingEntry: null,
        summary: '1 lineage line.',
      })),
    } as unknown as LineageService;

    const service = new NoteAIActivityServiceImpl(inlineAI, aiAssistant, provenance, lineage);
    const result = await service.loadForNote('demo.md');

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]?.conversationId).toBe('conv_1');
    expect(result.value.items[0]?.provenanceEvents).toHaveLength(1);
    expect(result.value.items[0]?.lineageEntries).toHaveLength(1);
    expect(result.value.items[0]?.accepted).toBe(true);
    expect(result.value.items[0]?.selectedText).toBe('rough');
    expect(result.value.items[0]?.contextBefore).toBe(anchor.beforeText);
    expect(result.value.items[0]?.contextAfter).toBe(anchor.afterText);
  });
});
