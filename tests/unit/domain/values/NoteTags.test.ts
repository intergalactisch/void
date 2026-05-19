import { describe, expect, it } from 'vitest';
import { formatNoteTag, normalizeNoteTag, normalizeNoteTags } from '$lib/domain/values/NoteTags';

describe('NoteTags', () => {
  it('normalizes single tags for frontmatter storage', () => {
    expect(normalizeNoteTag('#Work')).toBe('work');
    expect(normalizeNoteTag('Project Plan')).toBe('project-plan');
    expect(normalizeNoteTag('research/client')).toBe('research-client');
  });

  it('removes empty tags and de-dupes while preserving order', () => {
    expect(normalizeNoteTags(['#Work', 'work', '  ', 'Ideas'])).toEqual(['work', 'ideas']);
  });

  it('formats normalized tags for display', () => {
    expect(formatNoteTag('Work')).toBe('#work');
  });
});
