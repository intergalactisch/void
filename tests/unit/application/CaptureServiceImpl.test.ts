/**
 * CaptureServiceImpl tests.
 *
 * Stubs out DocumentService entirely so we can verify the capture orchestration
 * (path derivation, frontmatter / hashtag emission, append behaviour) in
 * isolation from any storage adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptureServiceImpl } from '$lib/application/services/CaptureServiceImpl';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import { ok, err } from '$lib/core';

vi.mock('$lib/logging', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const FIXED_NOW = new Date(2026, 4 /* may */, 8, 14, 30); // 2026-05-08 14:30 local time

function createMockDocumentService(): {
  service: DocumentService;
  files: Map<string, string>;
  createCalls: Array<{ folder: string; title: string; markdown?: string }>;
} {
  const files = new Map<string, string>();
  const createCalls: Array<{ folder: string; title: string; markdown?: string }> = [];

  const service: DocumentService = {
    async readContent(path: string) {
      if (files.has(path)) return ok(files.get(path)!);
      return err(new Error(`Document not found: ${path}`));
    },
    async writeContent(path: string, markdown: string) {
      if (!files.has(path)) {
        return err(new Error(`Document not found: ${path}`));
      }
      files.set(path, markdown);
      return ok(undefined);
    },
    async transformContent(path: string, transform) {
      if (!files.has(path)) {
        return err(new Error(`Document not found: ${path}`));
      }
      const markdown = await transform(files.get(path)!);
      files.set(path, markdown);
      return ok(markdown);
    },
    async readMeta() {
      return err(new Error('not implemented'));
    },
    async updateMeta() {
      return err(new Error('not implemented'));
    },
    async createWithContent(folder, title, markdown) {
      createCalls.push({ folder, title, markdown });
      // Mimic NotesService unique-path behaviour: lowercase + hyphen.
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const path = folder ? `${folder}/${slug}.md` : `${slug}.md`;
      files.set(path, markdown ?? '');
      return ok({ path, title });
    },
  };

  return { service, files, createCalls };
}

describe('CaptureServiceImpl', () => {
  let mock: ReturnType<typeof createMockDocumentService>;
  let service: CaptureServiceImpl;

  beforeEach(() => {
    mock = createMockDocumentService();
    service = new CaptureServiceImpl(mock.service, () => FIXED_NOW);
  });

  describe('inbox target', () => {
    it('saves a new note in Inbox/ and uses the first line as the title', async () => {
      const result = await service.quickCapture({
        text: 'Quick thought\nMore detail here',
        target: 'inbox',
        tags: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.target).toBe('inbox');
      expect(result.value.path).toBe('Inbox/quick-thought.md');
      expect(result.value.created).toBe(true);

      expect(mock.createCalls).toHaveLength(1);
      expect(mock.createCalls[0].folder).toBe('Inbox');
      expect(mock.createCalls[0].title).toBe('Quick thought');
      expect(mock.createCalls[0].markdown).toContain('Quick thought');
      expect(mock.createCalls[0].markdown).toContain('More detail here');
    });

    it('falls back to a timestamped title when first line has no usable characters', async () => {
      // Slashes/colons sanitize to empty after stripping.
      const result = await service.quickCapture({
        text: '/// :::',
        target: 'inbox',
        tags: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mock.createCalls[0].title).toMatch(/^Capture 2026-05-08 1430$/);
    });

    it('truncates long titles to 60 chars', async () => {
      const longTitle = 'a'.repeat(120);
      const result = await service.quickCapture({
        text: longTitle,
        target: 'inbox',
        tags: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mock.createCalls[0].title.length).toBeLessThanOrEqual(60);
    });

    it('emits tags as YAML frontmatter when provided', async () => {
      const result = await service.quickCapture({
        text: 'Idea',
        target: 'inbox',
        tags: ['research', '#robotics', 'research'], // duplicate + leading hash
      });

      expect(result.ok).toBe(true);
      const md = mock.createCalls[0].markdown ?? '';
      expect(md.startsWith('---\n')).toBe(true);
      expect(md).toContain('tags: ["research", "robotics"]');
      expect(md).toContain('Idea');
    });

    it('omits frontmatter when no tags', async () => {
      const result = await service.quickCapture({
        text: 'no tags',
        target: 'inbox',
        tags: [],
      });

      expect(result.ok).toBe(true);
      const md = mock.createCalls[0].markdown ?? '';
      expect(md.startsWith('---')).toBe(false);
      expect(md.trim()).toBe('no tags');
    });

    it('replaces path-hostile characters in the title', async () => {
      const result = await service.quickCapture({
        text: 'foo/bar:baz "quoted"',
        target: 'inbox',
        tags: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mock.createCalls[0].title).not.toMatch(/[/\\:"<>|*?]/);
    });
  });

  describe('daily target', () => {
    it('creates today\'s daily note when missing and appends the snippet', async () => {
      const result = await service.quickCapture({
        text: 'morning thought',
        target: 'daily',
        tags: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.target).toBe('daily');
      expect(result.value.path).toBe('daily/2026-05-08.md');
      expect(result.value.created).toBe(true);

      const content = mock.files.get('daily/2026-05-08.md') ?? '';
      expect(content).toContain('# 2026-05-08');
      expect(content).toContain('## 14:30');
      expect(content).toContain('morning thought');
    });

    it('appends to an existing daily note', async () => {
      // Pre-seed today's daily note.
      mock.files.set('daily/2026-05-08.md', '# 2026-05-08\n\n## 09:00\n\nfirst entry\n');

      const result = await service.quickCapture({
        text: 'second entry',
        target: 'daily',
        tags: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.created).toBe(false);

      const content = mock.files.get('daily/2026-05-08.md') ?? '';
      expect(content).toContain('first entry');
      expect(content).toContain('## 14:30');
      expect(content).toContain('second entry');
      // First entry must come before the new append.
      expect(content.indexOf('first entry')).toBeLessThan(content.indexOf('second entry'));
    });

    it('emits tags as hashtags after the body', async () => {
      const result = await service.quickCapture({
        text: 'note with tags',
        target: 'daily',
        tags: ['idea', 'research'],
      });

      expect(result.ok).toBe(true);
      const content = mock.files.get('daily/2026-05-08.md') ?? '';
      expect(content).toContain('#idea #research');
    });

    it('does not duplicate trailing newlines on existing content', async () => {
      mock.files.set('daily/2026-05-08.md', '# 2026-05-08\n');

      await service.quickCapture({
        text: 'thought',
        target: 'daily',
        tags: [],
      });

      const content = mock.files.get('daily/2026-05-08.md') ?? '';
      // Must not contain triple newlines.
      expect(content).not.toMatch(/\n{4,}/);
    });
  });

  describe('validation', () => {
    it('rejects empty text', async () => {
      const result = await service.quickCapture({ text: '   \n  ', target: 'inbox', tags: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/empty/i);
      expect(mock.createCalls).toHaveLength(0);
    });

    it('propagates document service errors (inbox)', async () => {
      mock.service.createWithContent = vi.fn().mockResolvedValue(err(new Error('disk full')));
      const result = await service.quickCapture({ text: 'x', target: 'inbox', tags: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('disk full');
    });

    it('propagates document service errors (daily write)', async () => {
      mock.files.set('daily/2026-05-08.md', '# 2026-05-08\n\n');
      mock.service.writeContent = vi.fn().mockResolvedValue(err(new Error('locked')));
      const result = await service.quickCapture({ text: 'x', target: 'daily', tags: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('locked');
    });
  });
});
