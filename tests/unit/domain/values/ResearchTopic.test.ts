import { describe, expect, it } from 'vitest';
import { deriveResearchTopic } from '$lib/domain/values/ResearchTopic';

describe('deriveResearchTopic', () => {
  it('preserves meaningful topic connectors after research commands', () => {
    expect(deriveResearchTopic('Research the future of Coding Agents')).toEqual({
      displayTitle: 'Future of Coding Agents',
      slug: 'future-of-coding-agents',
      overviewTitle: 'Future of Coding Agents Research Overview',
      sourcesTitle: 'Future of Coding Agents Sources',
      openQuestionsTitle: 'Future of Coding Agents Open Questions',
    });
  });

  it('removes command wording for normal research prompts', () => {
    expect(deriveResearchTopic('Do research on Bonsai trees').displayTitle).toBe('Bonsai Trees');
    expect(deriveResearchTopic('Doe onderzoek naar AI coding agents').displayTitle).toBe('AI Coding Agents');
  });
});
