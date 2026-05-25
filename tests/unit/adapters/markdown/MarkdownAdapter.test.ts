/**
 * Unit tests for MarkdownAdapter
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory';
import { MarkdownAdapter } from '$lib/adapters/markdown/MarkdownAdapter';

describe('MarkdownAdapter', () => {
  let fs: MemoryFileSystemAdapter;
  let adapter: MarkdownAdapter;

  beforeEach(() => {
    fs = new MemoryFileSystemAdapter();
    adapter = new MarkdownAdapter(fs, { basePath: '/notes' });
  });

  describe('list()', () => {
    it('lists markdown files in the base directory', async () => {
      fs.seed({
        '/notes/note1.md': '---\ntitle: Note 1\n---\n# Note 1',
        '/notes/note2.md': '---\ntitle: Note 2\n---\n# Note 2',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('note1.md');
        expect(paths).toContain('note2.md');
      }
    });

    it('finds markdown files in subdirectories', async () => {
      fs.seed({
        '/notes/root-note.md': '---\ntitle: Root Note\n---\n# Root',
        '/notes/subfolder/nested-note.md': '---\ntitle: Nested Note\n---\n# Nested',
        '/notes/deep/folder/deep-note.md': '---\ntitle: Deep Note\n---\n# Deep',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('root-note.md');
        expect(paths).toContain('subfolder/nested-note.md');
        expect(paths).toContain('deep/folder/deep-note.md');
      }
    });

    it('ignores non-markdown files', async () => {
      fs.seed({
        '/notes/note.md': '---\ntitle: Note\n---\n# Note',
        '/notes/readme.txt': 'Not a markdown file',
        '/notes/data.json': '{}',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].path).toBe('note.md');
      }
    });

    it('returns empty array for empty directory', async () => {
      await fs.createDirectory('/notes');

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('sorts by updatedAt with most recent first', async () => {
      // Use explicit timestamps in frontmatter for reliable sorting
      fs.seed({
        '/notes/old.md': '---\ntitle: Old\nupdatedAt: 2020-01-01T00:00:00Z\n---\n# Old',
        '/notes/middle.md': '---\ntitle: Middle\nupdatedAt: 2022-01-01T00:00:00Z\n---\n# Middle',
        '/notes/new.md': '---\ntitle: New\nupdatedAt: 2024-01-01T00:00:00Z\n---\n# New',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(3);
        // Most recent should be first
        expect(result.value[0].path).toBe('new.md');
        expect(result.value[1].path).toBe('middle.md');
        expect(result.value[2].path).toBe('old.md');
      }
    });

    it('normalizes frontmatter tags when listing notes', async () => {
      fs.seed({
        '/notes/tagged.md': '---\ntitle: Tagged\ntags:\n  - "#Work"\n  - Project Plan\n  - work\n---\n# Tagged',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].meta.tags).toEqual(['work', 'project-plan']);
      }
    });

    it('handles files with missing frontmatter gracefully', async () => {
      fs.seed({
        '/notes/no-frontmatter.md': '# Just a heading\n\nSome content',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].path).toBe('no-frontmatter.md');
        // Should extract title from heading or use filename
        expect(result.value[0].meta.title).toBeDefined();
      }
    });

    it('handles deeply nested folder structures', async () => {
      fs.seed({
        '/notes/a/b/c/d/e/deep.md': '---\ntitle: Very Deep\n---\n# Deep',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].path).toBe('a/b/c/d/e/deep.md');
      }
    });

    it('returns app-relative paths when a tilde base path is backed by memory storage', async () => {
      const tildeAdapter = new MarkdownAdapter(fs, { basePath: '~/Documents/void' });
      fs.seed({
        '/~/Documents/void/Research/Mock Swarm/overview.md': '---\ntitle: Overview\n---\n# Overview',
      });

      const result = await tildeAdapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].path).toBe('Research/Mock Swarm/overview.md');
      }
    });

    it('handles multiple subdirectories at the same level', async () => {
      fs.seed({
        '/notes/work/project1.md': '---\ntitle: Project 1\n---\n# P1',
        '/notes/work/project2.md': '---\ntitle: Project 2\n---\n# P2',
        '/notes/personal/diary.md': '---\ntitle: Diary\n---\n# Diary',
        '/notes/personal/ideas.md': '---\ntitle: Ideas\n---\n# Ideas',
      });

      const result = await adapter.list();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(4);
        const paths = result.value.map((item) => item.path);
        expect(paths).toContain('work/project1.md');
        expect(paths).toContain('work/project2.md');
        expect(paths).toContain('personal/diary.md');
        expect(paths).toContain('personal/ideas.md');
      }
    });
  });

  describe('Trash', () => {
    it('moves a note out of active listing and into recoverable Trash', async () => {
      fs.seed({
        '/notes/to-delete.md': '---\ntitle: To Delete\n---\n# To Delete',
      });

      const trashed = await adapter.trash('to-delete.md');
      expect(trashed.ok).toBe(true);
      if (!trashed.ok) return;

      const active = await adapter.list();
      expect(active.ok).toBe(true);
      if (active.ok) expect(active.value.map((item) => item.path)).not.toContain('to-delete.md');

      const trash = await adapter.listTrash();
      expect(trash.ok).toBe(true);
      if (!trash.ok) return;
      expect(trash.value).toHaveLength(1);
      expect(trash.value[0]).toMatchObject({
        id: trashed.value.id,
        originalPath: 'to-delete.md',
        title: 'To Delete',
      });
    });

    it('restores a trashed note to its original path', async () => {
      fs.seed({
        '/notes/to-restore.md': '---\ntitle: To Restore\n---\n# To Restore',
      });
      const trashed = await adapter.trash('to-restore.md');
      expect(trashed.ok).toBe(true);
      if (!trashed.ok) return;

      const restored = await adapter.restoreFromTrash(trashed.value.id);

      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      expect(restored.value.path).toBe('to-restore.md');
      expect(restored.value.meta.title).toBe('To Restore');
      const trash = await adapter.listTrash();
      expect(trash.ok).toBe(true);
      if (trash.ok) expect(trash.value).toHaveLength(0);
    });

    it('restores to a unique sibling path when the original path is occupied', async () => {
      fs.seed({
        '/notes/collision.md': '---\ntitle: Original\n---\n# Original',
      });
      const trashed = await adapter.trash('collision.md');
      expect(trashed.ok).toBe(true);
      if (!trashed.ok) return;
      fs.seed({
        '/notes/collision.md': '---\ntitle: Replacement\n---\n# Replacement',
      });

      const restored = await adapter.restoreFromTrash(trashed.value.id);

      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      expect(restored.value.path).toBe('collision (restored).md');
      const active = await adapter.list();
      expect(active.ok).toBe(true);
      if (active.ok) {
        expect(active.value.map((item) => item.path)).toEqual(
          expect.arrayContaining(['collision.md', 'collision (restored).md'])
        );
      }
    });

    it('permanently deletes a trash entry', async () => {
      fs.seed({
        '/notes/doomed.md': '---\ntitle: Doomed\n---\n# Doomed',
      });
      const trashed = await adapter.trash('doomed.md');
      expect(trashed.ok).toBe(true);
      if (!trashed.ok) return;

      const deleted = await adapter.deleteFromTrash(trashed.value.id);

      expect(deleted.ok).toBe(true);
      const trash = await adapter.listTrash();
      expect(trash.ok).toBe(true);
      if (trash.ok) expect(trash.value).toHaveLength(0);
      expect(fs.getPaths().some((path) => path.includes(trashed.value.id))).toBe(false);
    });
  });

  describe('listFolders()', () => {
    it('returns empty folders and nested folders as app-relative paths', async () => {
      await fs.createDirectory('/notes/Test');
      await fs.createDirectory('/notes/Research/Agents');
      fs.seed({
        '/notes/Research/Agents/brief.md': '---\ntitle: Brief\n---\n# Brief',
      });

      const result = await adapter.listFolders();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((folder) => folder.path)).toEqual([
        'Research',
        'Research/Agents',
        'Test',
      ]);
    });

    it('excludes .void and hidden/system folders', async () => {
      await fs.createDirectory('/notes/.void/agents');
      await fs.createDirectory('/notes/.hidden');
      await fs.createDirectory('/notes/__MACOSX');
      await fs.createDirectory('/notes/Visible');

      const result = await adapter.listFolders();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((folder) => folder.path)).toEqual(['Visible']);
    });
  });

  describe('markdown round-trip fidelity', () => {
    it('preserves mixed inline marks instead of widening marks to the whole block', async () => {
      fs.seed({
        '/notes/rich.md': '---\ntitle: Rich\n---\nPlain **bold** and *italic* text',
      });

      const loadResult = await adapter.load('rich.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/rich.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('Plain **bold** and *italic* text');
      expect(fileResult.value).not.toContain('**Plain bold and italic text**');
    });

    it('preserves wiki-style page links through load and save', async () => {
      fs.seed({
        '/notes/wiki.md': '---\ntitle: Wiki\n---\nSee [[projects/plan.md|Project Plan]] next.',
      });

      const loadResult = await adapter.load('wiki.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/wiki.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('[[projects/plan.md|Project Plan]]');
    });

    it('accepts legacy display-first wikilinks and normalizes to target-first aliases', async () => {
      fs.seed({
        '/notes/legacy-wiki.md': '---\ntitle: Legacy Wiki\n---\nSee [[Project Plan|projects/plan.md]] next.',
      });

      const loadResult = await adapter.load('legacy-wiki.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/legacy-wiki.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('[[projects/plan.md|Project Plan]]');
    });

    it('loads and saves standalone markdown images as image blocks', async () => {
      fs.seed({
        '/notes/image.md': '---\ntitle: Image\n---\n![Alt text](assets/image.png "Caption")',
      });

      const loadResult = await adapter.load('image.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      expect(loadResult.value.blocks[0]?.type).toBe('image');

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/image.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('![Alt text](assets/image.png "Caption")');
    });

    it('preserves highlight marks including colored mark metadata', async () => {
      fs.seed({
        '/notes/highlight.md': '---\ntitle: Highlight\n---\nDefault <mark>yellow</mark> and <mark data-color="blue">blue</mark>.',
      });

      const loadResult = await adapter.load('highlight.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/highlight.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('<mark>yellow</mark>');
      expect(fileResult.value).toContain('<mark data-color="blue">blue</mark>');
    });

    it('round-trips toggle blocks as details/summary HTML without losing children', async () => {
      fs.seed({
        '/notes/toggle.md': '---\ntitle: Toggle\n---\n<details open>\n<summary>Decision **log**</summary>\n\nKeep the context.\n\n</details>',
      });

      const loadResult = await adapter.load('toggle.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      expect(loadResult.value.blocks[0]?.type).toBe('toggle');
      expect(loadResult.value.blocks[0]?.content).toBe('Decision log');
      expect(loadResult.value.blocks[0]?.children[0]?.content).toBe('Keep the context.');

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/toggle.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('<details open>');
      expect(fileResult.value).toContain('<summary>Decision **log**</summary>');
      expect(fileResult.value).toContain('Keep the context.');
    });

    it('round-trips code fence language, metadata, and longer fences safely', async () => {
      fs.seed({
        '/notes/code.md': [
          '---',
          'title: Code',
          '---',
          '```ts title="api.ts" lineNumbers {2}',
          'const fence = "```";',
          'console.log(fence);',
          '```',
        ].join('\n'),
      });

      const loadResult = await adapter.load('code.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      const block = loadResult.value.blocks[0];
      expect(block?.type).toBe('codeBlock');
      expect(block?.attrs).toMatchObject({
        type: 'codeBlock',
        language: 'ts',
        meta: 'title="api.ts" lineNumbers {2}',
      });

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/code.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('````ts title="api.ts" lineNumbers {2}');
      expect(fileResult.value).toContain('const fence = "```";');
      expect(fileResult.value).toContain('\n````');
    });

    it('round-trips GitHub pipe tables as structured table blocks', async () => {
      fs.seed({
        '/notes/table.md': '---\ntitle: Table\n---\n| Name | Status |\n| --- | --- |\n| Void | Ready |\n',
      });

      const loadResult = await adapter.load('table.md');
      expect(loadResult.ok).toBe(true);
      if (!loadResult.ok) return;

      expect(loadResult.value.blocks[0]?.type).toBe('table');
      expect(loadResult.value.blocks[0]?.attrs.type).toBe('table');
      if (loadResult.value.blocks[0]?.attrs.type === 'table') {
        expect(loadResult.value.blocks[0].attrs.rows[1]?.cells[1]?.content).toBe('Ready');
      }

      const saveResult = await adapter.save(loadResult.value);
      expect(saveResult.ok).toBe(true);

      const fileResult = await fs.readFile('/notes/table.md');
      expect(fileResult.ok).toBe(true);
      if (!fileResult.ok) return;

      expect(fileResult.value).toContain('| Name | Status |');
      expect(fileResult.value).toContain('| Void | Ready |');
    });
  });
});
