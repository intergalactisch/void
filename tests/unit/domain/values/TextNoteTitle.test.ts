import { describe, expect, it } from 'vitest';
import { deriveTextNoteTitle } from '$lib/domain/values/TextNoteTitle';

describe('deriveTextNoteTitle', () => {
  const now = new Date(2026, 4, 23, 14, 7);

  it('uses the first non-empty line', () => {
    expect(deriveTextNoteTitle('\n\n  Meeting notes  \nSecond line', { now })).toBe('Meeting notes');
  });

  it('sanitizes path-hostile characters', () => {
    expect(deriveTextNoteTitle('Project: alpha/beta?* notes', { now })).toBe('Project- alpha-beta- notes');
  });

  it('truncates long titles', () => {
    const title = deriveTextNoteTitle('A'.repeat(80), { now });
    expect(title).toHaveLength(60);
    expect(title).toBe('A'.repeat(60));
  });

  it('falls back to a timestamp title when content has no usable title line', () => {
    expect(deriveTextNoteTitle('///\n\t', { now, fallbackPrefix: 'Paste' })).toBe('Paste 2026-05-23 1407');
  });

  it('uses multiline clipboard text without including later lines in the title', () => {
    expect(deriveTextNoteTitle('Clipboard title\n\nBody content', { now })).toBe('Clipboard title');
  });
});
