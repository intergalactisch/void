import { describe, expect, it } from 'vitest';
import { mergeText3 } from '$lib/domain/values';

describe('mergeText3', () => {
  it('keeps identical files clean', () => {
    const result = mergeText3('a\nb\n', 'a\nb\n', 'a\nb\n');

    expect(result.clean).toBe(true);
    expect(result.mergedText).toBe('a\nb\n');
    expect(result.hunks).toHaveLength(0);
  });

  it('accepts local-only edits', () => {
    const result = mergeText3('a\nb\n', 'a\nlocal\n', 'a\nb\n');

    expect(result.clean).toBe(true);
    expect(result.mergedText).toBe('a\nlocal\n');
  });

  it('accepts remote-only edits', () => {
    const result = mergeText3('a\nb\n', 'a\nb\n', 'a\nremote\n');

    expect(result.clean).toBe(true);
    expect(result.mergedText).toBe('a\nremote\n');
  });

  it('merges non-overlapping edits', () => {
    const base = 'title\none\ntwo\nthree\n';
    const local = 'title\nONE\ntwo\nthree\n';
    const remote = 'title\none\ntwo\nTHREE\n';

    const result = mergeText3(base, local, remote);

    expect(result.clean).toBe(true);
    expect(result.mergedText).toBe('title\nONE\ntwo\nTHREE\n');
  });

  it('returns unresolved hunks for overlapping edits', () => {
    const result = mergeText3('a\nb\nc\n', 'a\nlocal\nc\n', 'a\nremote\nc\n');

    expect(result.clean).toBe(false);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]?.base).toBe('b\n');
    expect(result.hunks[0]?.local).toBe('local\n');
    expect(result.hunks[0]?.remote).toBe('remote\n');
    expect(result.mergedText).toContain('<<<<<<< local');
  });

  it('handles insert/delete conflicts', () => {
    const result = mergeText3('a\nb\nc\n', 'a\nc\n', 'a\nremote\nb\nc\n');

    expect(result.clean).toBe(false);
    expect(result.hunks[0]?.local).toBe('');
    expect(result.hunks[0]?.remote).toBe('remote\nb\n');
  });

  it('merges frontmatter and body changes when they do not overlap', () => {
    const base = '---\ntitle: Old\n---\nBody\n';
    const local = '---\ntitle: New\n---\nBody\n';
    const remote = '---\ntitle: Old\n---\nBody\nMore\n';

    const result = mergeText3(base, local, remote);

    expect(result.clean).toBe(true);
    expect(result.mergedText).toBe('---\ntitle: New\n---\nBody\nMore\n');
  });
});
