import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownAdapter, MarkdownSerializerAdapter } from '$lib/adapters/markdown';
import { MemoryFileSystemAdapter } from '$lib/adapters/memory';
import { MarkdownImportServiceImpl, isStrictMarkdownPath } from '$lib/application/services';
import { ok } from '$lib/core';
import type { LineageService } from '$lib/ports/inbound';
import type { DocumentPort } from '$lib/ports/outbound';

class CountingFileSystemAdapter extends MemoryFileSystemAdapter {
  readPaths: string[] = [];

  override async readFile(path: string) {
    this.readPaths.push(path);
    return super.readFile(path);
  }
}

describe('MarkdownImportServiceImpl', () => {
  let fs: CountingFileSystemAdapter;
  let documents: DocumentPort;
  let lineage: LineageService;
  let service: MarkdownImportServiceImpl;

  beforeEach(() => {
    fs = new CountingFileSystemAdapter();
    documents = new MarkdownAdapter(fs, { basePath: '/notes' });
    lineage = {
      enqueueMarkdownChange: vi.fn().mockResolvedValue(ok({
        jobId: 'job-1',
        notePath: 'imported.md',
        queuedAt: new Date().toISOString(),
      })),
    } as unknown as LineageService;
    service = new MarkdownImportServiceImpl(
      fs,
      documents,
      new MarkdownSerializerAdapter(),
      lineage,
    );
  });

  it('accepts only exact .md paths case-insensitively', async () => {
    expect(isStrictMarkdownPath('/external/NOTE.MD')).toBe(true);
    expect(isStrictMarkdownPath('/external/note.md')).toBe(true);
    expect(isStrictMarkdownPath('/external/note.markdown')).toBe(false);
    expect(isStrictMarkdownPath('/external/note.txt')).toBe(false);
    expect(isStrictMarkdownPath('/external/note')).toBe(false);

    await fs.createDirectory('/external/folder');
    await fs.createDirectory('/external/folder.md');
    const result = await service.importFiles([
      '/external/note.markdown',
      '/external/note.txt',
      '/external/folder',
      '/external/note',
      '/external/folder.md',
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toHaveLength(0);
    expect(result.value.skipped.map((item) => item.reason)).toEqual([
      'not-markdown',
      'not-markdown',
      'unsupported-directory',
      'not-markdown',
      'unsupported-directory',
    ]);
    expect(fs.readPaths).toEqual([]);
  });

  it('copies markdown into the target folder without modifying the external source', async () => {
    fs.seed({
      '/external/Meeting.md': '# External\n\nOriginal body\n',
      '/notes/projects/Meeting.md': '# Existing\n',
    });

    const result = await service.importFiles([
      '/external/Meeting.md',
      '/external/Meeting.md',
    ], { targetFolder: 'projects' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported.map((item) => item.path)).toEqual([
      'projects/Meeting-1.md',
      'projects/Meeting-2.md',
    ]);

    await expect(fs.readFile('/external/Meeting.md')).resolves.toMatchObject({
      ok: true,
      value: '# External\n\nOriginal body\n',
    });
    await expect(fs.readFile('/notes/projects/Meeting-1.md')).resolves.toMatchObject({
      ok: true,
    });
    await expect(documents.exists('projects/Meeting-2.md')).resolves.toMatchObject({
      ok: true,
      value: true,
    });
  });

  it('preserves supported frontmatter and strips YAML from editor body blocks', async () => {
    fs.seed({
      '/external/research.md': [
        '---',
        'title: Research Brief',
        'tags: [ai, notes]',
        'status: review',
        'intent: research',
        '---',
        '',
        '# Body Heading',
        '',
        'Visible body text',
      ].join('\n'),
    });

    const result = await service.importFiles(['/external/research.md']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loaded = await documents.load('research.md');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.meta.title).toBe('Research Brief');
    expect(loaded.value.meta.tags).toEqual(['ai', 'notes']);
    expect(loaded.value.meta.status).toBe('review');
    expect(loaded.value.meta.intent).toBe('research');

    const body = loaded.value.blocks.map((block) => block.content).join('\n');
    expect(body).toContain('Body Heading');
    expect(body).toContain('Visible body text');
    expect(body).not.toContain('title: Research Brief');
    expect(body).not.toContain('status: review');
  });

  it('records import lineage without persisting the source absolute path', async () => {
    fs.seed({ '/private/source/ideas.md': '# Ideas\n' });

    const result = await service.importFiles(['/private/source/ideas.md']);
    expect(result.ok).toBe(true);
    expect(lineage.enqueueMarkdownChange).toHaveBeenCalledWith(
      'ideas.md',
      '# Ideas',
      expect.objectContaining({
        summary: 'Imported external markdown file',
        source: { type: 'file-import' },
      }),
    );

    const serializedCall = JSON.stringify(vi.mocked(lineage.enqueueMarkdownChange).mock.calls[0]);
    expect(serializedCall).not.toContain('/private/source/ideas.md');
  });
});
