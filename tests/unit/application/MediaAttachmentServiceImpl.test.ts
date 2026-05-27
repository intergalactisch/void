import { describe, expect, it, vi } from 'vitest';
import { MediaAttachmentServiceImpl } from '$lib/application/services';
import { err, ok } from '$lib/core';
import type {
  DocumentService,
  NoteCollaborationService,
  NotesListItem,
  NotesService,
  ProvenanceService,
} from '$lib/ports/inbound';
import type { AssetMetadata, AssetStoragePort } from '$lib/ports/outbound';

describe('MediaAttachmentServiceImpl', () => {
  it('attaches local images in order with one cursor insertion', async () => {
    const { service, collaboration, provenance } = createService();

    const result = await service.attachLocalImages('research/note.md', [
      '/tmp/first-chart.png',
      '/tmp/second-photo.webp',
    ], { placement: 'cursor' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inserted).toBe(true);
    expect(result.value.failed).toEqual([]);
    expect(result.value.attached.map((item) => item.asset.originalName)).toEqual([
      'first-chart.png',
      'second-photo.webp',
    ]);
    expect(collaboration.insertAtCursor).toHaveBeenCalledTimes(1);
    expect(collaboration.insertAtCursor).toHaveBeenCalledWith(
      '![first chart](../assets/note/hash-1-first-chart.png)\n\n![second photo](../assets/note/hash-2-second-photo.webp)',
      'Attach images',
    );
    expect(provenance.record).toHaveBeenCalledTimes(2);
  });

  it('reports partial import failures while inserting successful images', async () => {
    const { service, collaboration } = createService({ failImports: new Set(['/tmp/bad.gif']) });

    const result = await service.attachLocalImages('note.md', [
      '/tmp/good.png',
      '/tmp/bad.gif',
    ], { placement: 'cursor' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inserted).toBe(true);
    expect(result.value.attached).toHaveLength(1);
    expect(result.value.failed).toEqual([
      { sourcePath: '/tmp/bad.gif', message: 'Import failed for bad.gif' },
    ]);
    expect(collaboration.insertAtCursor).toHaveBeenCalledWith(
      '![good](assets/note/hash-1-good.png)',
      'Attach image',
    );
  });

  it('returns insertion errors without deleting imported assets implicitly', async () => {
    const { service, collaboration, provenance } = createService({ insertError: new Error('Editor is not writable') });

    const result = await service.attachLocalImages('note.md', ['/tmp/good.png'], { placement: 'cursor' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inserted).toBe(false);
    expect(result.value.insertionError).toBe('Editor is not writable');
    expect(result.value.attached).toHaveLength(1);
    expect(collaboration.insertAtCursor).toHaveBeenCalledTimes(1);
    expect(provenance.record).not.toHaveBeenCalled();
  });

  it('finds the note whose markdown references an asset', async () => {
    const { service } = createService({
      noteItems: [
        { path: 'research/note.md', title: 'Note', isFolder: false, children: [] },
        { path: 'other.md', title: 'Other', isFolder: false, children: [] },
      ] as unknown as NotesListItem[],
      noteContents: {
        'research/note.md': 'Body\n\n![chart](../assets/note/hash-1-chart.png)\n',
        'other.md': 'Nothing here',
      },
    });

    const result = await service.findReferencingNotePaths('assets/note/hash-1-chart.png');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(['research/note.md']);
  });

  it('returns no referencing notes when the asset is unused', async () => {
    const { service } = createService({
      noteItems: [
        { path: 'note.md', title: 'Note', isFolder: false, children: [] },
      ] as unknown as NotesListItem[],
      noteContents: { 'note.md': 'No images here' },
    });

    const result = await service.findReferencingNotePaths('assets/note/orphan.png');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

function createService(options: {
  failImports?: Set<string>;
  insertError?: Error;
  noteContents?: Record<string, string>;
  noteItems?: NotesListItem[];
} = {}) {
  let importCount = 0;
  const assets: AssetStoragePort = {
    importFile: vi.fn(async (_notesDir, notePath, sourcePath) => {
      const originalName = sourcePath.split(/[\\/]/).pop() || 'image.png';
      if (options.failImports?.has(sourcePath)) {
        return err(new Error(`Import failed for ${originalName}`));
      }
      importCount += 1;
      const stem = originalName.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
      const ext = originalName.split('.').pop()?.toLowerCase() || 'png';
      const metadata: AssetMetadata = {
        relativePath: `assets/${notePath.replace(/\.md$/i, '').split('/').pop()}/hash-${importCount}-${stem}.${ext}`,
        fileName: `hash-${importCount}-${stem}.${ext}`,
        contentType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`,
        kind: ext === 'jpeg' ? 'jpg' : ext as AssetMetadata['kind'],
        sha256: `hash-${importCount}`,
        size: 8,
        originalName,
      };
      return ok(metadata);
    }),
    importBytes: vi.fn(),
    downloadImage: vi.fn(),
    metadata: vi.fn(),
    list: vi.fn(async () => ok([])),
    saveAs: vi.fn(),
    delete: vi.fn(),
    resolveRenderUrl: vi.fn(async (_notesDir, relativePath) => ok(`asset://${relativePath}`)),
  } as unknown as AssetStoragePort;

  const collaboration = {
    insertAtCursor: vi.fn(async () => options.insertError ? err(options.insertError) : ok(undefined)),
    appendNoteContent: vi.fn(async () => ok(undefined)),
  } as unknown as NoteCollaborationService;

  const documents = {
    readContent: vi.fn(async (notePath: string) => ok(options.noteContents?.[notePath] ?? '')),
  } as unknown as DocumentService;

  const notes = {
    getState: vi.fn(() => ({
      items: options.noteItems ?? [],
      tagGroups: [],
      selectedPath: null,
      isLoading: false,
      searchQuery: '',
      expandedFolders: new Set<string>(),
    })),
  } as unknown as NotesService;

  const provenance = {
    record: vi.fn(async (_noteName, event) => ok({
      ...event,
      id: 'event-1',
      ts: Date.now(),
    })),
  } as unknown as ProvenanceService;

  return {
    service: new MediaAttachmentServiceImpl(
      '/notes',
      assets,
      collaboration,
      documents,
      notes,
      provenance,
    ),
    assets,
    collaboration,
    provenance,
  };
}
