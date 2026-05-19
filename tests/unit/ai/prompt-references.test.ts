import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '$lib/adapters/ai/prompts/system';
import { buildRefId } from '$lib/domain/values/RefId';
import { createEmptyContext } from '$lib/domain/values/PromptContext';

describe('AI prompt references', () => {
  it('serializes resolved refs into the system prompt context', () => {
    const refId = buildRefId({ kind: 'note', notePath: 'Projects/Roadmap.md' });
    const context = {
      ...createEmptyContext(),
      references: [{
        refId,
        kind: 'note' as const,
        status: 'resolved' as const,
        label: 'Roadmap',
        summary: 'Note at Projects/Roadmap.md',
        content: '# Roadmap',
      }],
    };

    const prompt = buildSystemPrompt([], context);

    expect(prompt).toContain('Explicit RefIds');
    expect(prompt).toContain(refId);
    expect(prompt).toContain('# Roadmap');
  });
});
