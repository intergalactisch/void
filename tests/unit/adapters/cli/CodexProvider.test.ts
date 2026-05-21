import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider, CodexProvider } from '$lib/adapters/cli';

describe('CodexProvider', () => {
  it('builds codex exec args with default reasoning effort', () => {
    const provider = new CodexProvider();

    expect(provider.buildArgs({ prompt: 'Summarize this note' })).toEqual([
      'exec',
      '-c',
      'model_reasoning_effort="medium"',
      '--skip-git-repo-check',
      'Summarize this note',
    ]);
  });

  it('uses configured reasoning effort', () => {
    const provider = new CodexProvider({ reasoningEffort: 'xhigh' });

    expect(provider.buildArgs({ prompt: 'Think deeply' })).toEqual([
      'exec',
      '-c',
      'model_reasoning_effort="xhigh"',
      '--skip-git-repo-check',
      'Think deeply',
    ]);
  });

  it('allows per-call reasoning effort overrides', () => {
    const provider = new CodexProvider({ reasoningEffort: 'low' });

    expect(provider.buildArgs({
      prompt: 'Quick pass',
      reasoningEffort: 'minimal',
    })).toEqual([
      'exec',
      '-c',
      'model_reasoning_effort="minimal"',
      '--skip-git-repo-check',
      'Quick pass',
    ]);
  });

  it('prepends system prompt text', () => {
    const provider = new CodexProvider();

    expect(provider.buildArgs({
      prompt: 'Draft',
      systemPrompt: 'Be concise',
    })).toEqual([
      'exec',
      '-c',
      'model_reasoning_effort="medium"',
      '--skip-git-repo-check',
      'Be concise\n\n---\n\nDraft',
    ]);
  });

  it('places native web search before exec when requested', () => {
    const provider = new CodexProvider();

    expect(provider.buildArgs({
      prompt: 'Find the latest OpenAI news',
      webAccess: 'native',
    })).toEqual([
      '--search',
      'exec',
      '-c',
      'model_reasoning_effort="medium"',
      '--skip-git-repo-check',
      'Find the latest OpenAI news',
    ]);
  });

  it('builds quiet prompt args for supported legacy codex', () => {
    const provider = new CodexProvider({ flavor: 'legacy' });

    expect(provider.supportsNativeWebSearch).toBe(false);
    expect(provider.buildArgs({
      prompt: 'Rewrite this',
      systemPrompt: 'Return only text',
      webAccess: 'native',
    })).toEqual([
      '-q',
      'Return only text\n\n---\n\nRewrite this',
    ]);
  });

  it('fails before spawning api-key-only codex', () => {
    const provider = new CodexProvider({ flavor: 'api-key-only' });

    expect(() => provider.buildArgs({ prompt: 'Rewrite this' })).toThrow(
      /requires API-key authentication/
    );
  });

  it('can target a resolved Codex binary path', () => {
    const provider = new CodexProvider({
      flavor: 'exec',
      binaryPath: '/custom/bin/codex',
    });

    expect(provider.binary).toBe('/custom/bin/codex');
  });
});

describe('ClaudeCodeProvider', () => {
  it('keeps normal note operations on the provided allowed tool set', () => {
    const provider = new ClaudeCodeProvider();

    expect(provider.buildArgs({
      prompt: 'Update note',
      allowedTools: ['Read', 'Write'],
    })).toContain('--allowedTools');
    expect(provider.buildArgs({
      prompt: 'Update note',
      allowedTools: ['Read', 'Write'],
    })).toContain('Read,Write');
  });

  it('adds WebSearch and WebFetch for native web research', () => {
    const provider = new ClaudeCodeProvider();

    expect(provider.buildArgs({
      prompt: 'Research the latest AI tools',
      allowedTools: ['Read', 'Write'],
      webAccess: 'native',
    })).toContain('Read,Write,WebSearch,WebFetch');
  });
});
