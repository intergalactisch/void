import { describe, expect, it } from 'vitest';
import {
  completeInlineAITurn,
  createInlineAIAnchor,
  createInlineAIProposal,
  createInlineAIThread,
  dismissInlineAIThread,
  hashInlineAIText,
  isInlineAIThreadUnread,
  markInlineAIThreadSeen,
} from '$lib/domain/entities/InlineAIThread';

describe('InlineAIThread domain entity', () => {
  it('preserves explicit local context on anchors', () => {
    const anchor = createInlineAIAnchor({
      notePath: 'notes/demo.md',
      selectedText: 'rough sentence',
      range: { from: 4, to: 18 },
      blockIds: ['block-a'],
      beforeText: 'Previous paragraph.\n',
      afterText: '\nNext paragraph.',
      surroundingText: 'A repeated rough sentence elsewhere',
    });

    expect(anchor.beforeText).toBe('Previous paragraph.\n');
    expect(anchor.afterText).toBe('\nNext paragraph.');
  });

  it('serializes completed multi-turn response state without markdown mutations', () => {
    const anchor = createInlineAIAnchor({
      notePath: 'notes/demo.md',
      selectedText: 'rough sentence',
      range: { from: 4, to: 18 },
      blockIds: ['block-a'],
      surroundingText: 'A rough sentence in a note',
    });
    const thread = createInlineAIThread({
      notePath: 'notes/demo.md',
      anchor,
      prompt: 'Make this cleaner',
    });
    const proposal = createInlineAIProposal([
      {
        kind: 'replace-range',
        from: 4,
        to: 18,
        markdown: 'clear sentence',
        originalText: 'rough sentence',
      },
    ], anchor.baseHash);

    const completed = completeInlineAITurn(thread, {
      response: 'I drafted a cleaner version.',
      toolCalls: [],
      conversationId: 'conv_1',
      proposal,
    });
    const restored = JSON.parse(JSON.stringify(completed));

    expect(restored.status).toBe('proposed');
    expect(restored.proposal.status).toBe('pending');
    expect(restored.turns).toHaveLength(1);
    expect(restored.turns[0].proposalId).toBe(proposal.id);
    expect(restored.anchor.selectedText).toBe('rough sentence');
    expect(restored.invocation.source).toBe('inline-note-ask');
    expect(restored.events[0].type).toBe('created');
    expect(restored.links.provenanceEventIds).toEqual([]);
  });

  it('tracks unread, seen, and dismissed state', () => {
    const anchor = createInlineAIAnchor({
      notePath: 'demo.md',
      selectedText: 'hello',
      range: { from: 1, to: 6 },
    });
    const completed = completeInlineAITurn(createInlineAIThread({
      notePath: 'demo.md',
      anchor,
      prompt: 'Explain',
    }), {
      response: 'Answer',
      toolCalls: [],
      conversationId: null,
    });

    expect(isInlineAIThreadUnread(completed)).toBe(true);
    expect(isInlineAIThreadUnread(markInlineAIThreadSeen(completed))).toBe(false);
    expect(dismissInlineAIThread(completed).dismissedAt).toBeTruthy();
  });

  it('hashes proposal bases deterministically', () => {
    expect(hashInlineAIText('same text')).toBe(hashInlineAIText('same text'));
    expect(hashInlineAIText('same text')).not.toBe(hashInlineAIText('different text'));
  });
});
