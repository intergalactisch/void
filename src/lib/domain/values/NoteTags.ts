/**
 * Note tag helpers.
 *
 * Tags are flat, markdown-frontmatter-friendly identifiers. UI inputs may use
 * a leading '#', but storage keeps the normalized name without it.
 */

export function normalizeNoteTag(input: string): string | null {
  const normalized = input
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[#[\],\n\r\t]/g, '-')
    .replace(/\/+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized.length > 0 ? normalized : null;
}

export function normalizeNoteTags(tags: readonly string[] | undefined | null): string[] {
  if (!tags) return [];

  const normalized = new Set<string>();
  for (const tag of tags) {
    const value = normalizeNoteTag(tag);
    if (value) normalized.add(value);
  }
  return [...normalized];
}

export function formatNoteTag(tag: string): string {
  const normalized = normalizeNoteTag(tag);
  return normalized ? `#${normalized}` : '#';
}
