import { describe, expect, it } from 'vitest';
import {
  buildCodeBlockMarkdown,
  buildCodeFence,
  buildUpdatedCodeBlockMarkdown,
  normalizeCodeLanguageForHighlighter,
  parseCodeBlockDisplayOptions,
  parseCodeFenceInfo,
} from '$lib/core/codeFence';
import type { Block } from '$lib/domain/entities/Block';

describe('code fence helpers', () => {
  it('splits language from raw fence metadata', () => {
    expect(parseCodeFenceInfo('ts title="api.ts" lineNumbers {2,5-7}')).toEqual({
      language: 'ts',
      meta: 'title="api.ts" lineNumbers {2,5-7}',
    });
    expect(parseCodeFenceInfo('{1,3} wrap')).toEqual({
      language: null,
      meta: '{1,3} wrap',
    });
  });

  it('normalizes highlighter language aliases without changing stored fence language', () => {
    expect(normalizeCodeLanguageForHighlighter('ts')).toBe('typescript');
    expect(normalizeCodeLanguageForHighlighter('sh')).toBe('bash');
    expect(buildCodeBlockMarkdown({ code: 'const x = 1;', language: 'ts' })).toContain('```ts\n');
  });

  it('serializes longer fences when code contains triple backticks', () => {
    const markdown = buildCodeFence({
      language: 'md',
      meta: 'title="example.md"',
      code: 'Before\n```ts\nconst x = 1\n```\nAfter',
    });

    expect(markdown.startsWith('````md title="example.md"\n')).toBe(true);
    expect(markdown.endsWith('\n````')).toBe(true);
  });

  it('preserves unspecified code block fields when updating metadata', () => {
    const current: Block = {
      id: 'code-1',
      type: 'codeBlock',
      content: 'const answer = 42;',
      marks: [],
      children: [],
      attrs: {
        type: 'codeBlock',
        language: 'ts',
        meta: 'title="answer.ts" wrap',
      },
    };

    const markdown = buildUpdatedCodeBlockMarkdown(current, {
      lineNumbers: true,
      highlightLines: '1',
    });

    expect(markdown).toBe('```ts title="answer.ts" wrap lineNumbers {1}\nconst answer = 42;\n```');
  });

  it('parses display options from metadata and code annotations', () => {
    const options = parseCodeBlockDisplayOptions(
      'title="api.ts" lineNumbers wrap {2,4-5} focus={7}',
      'a\nb // [!code highlight]\nc'
    );

    expect(options.title).toBe('api.ts');
    expect(options.lineNumbers).toBe(true);
    expect(options.wrap).toBe(true);
    expect([...options.highlightLines].sort((a, b) => a - b)).toEqual([2, 4, 5]);
    expect([...options.focusLines]).toEqual([7]);
  });
});
