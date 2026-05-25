/**
 * Notes Loading Tests
 *
 * Tests for notes loading behavior, specifically around loading existing notes
 * from the file system and handling error cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotesServiceImpl } from '$lib/application/services/NotesServiceImpl';
import type { DocumentPort, DocumentListItem } from '$lib/ports/outbound';
import { ok, err } from '$lib/core';

function createMockDocumentPort(items: DocumentListItem[] = []): DocumentPort {
  return {
    load: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    trash: vi.fn(),
    listTrash: vi.fn().mockResolvedValue(ok([])),
    restoreFromTrash: vi.fn(),
    deleteFromTrash: vi.fn(),
    list: vi.fn().mockResolvedValue(ok(items)),
    listFolders: vi.fn().mockResolvedValue(ok([])),
    exists: vi.fn().mockResolvedValue(ok(false)),
    create: vi.fn(),
    watch: vi.fn().mockReturnValue(() => {}),
  };
}

describe('Notes Loading', () => {
  it('loads existing notes on startup', async () => {
    const mockItems: DocumentListItem[] = [
      { path: 'note1.md', meta: { id: '1', title: 'Note 1', createdAt: new Date(), updatedAt: new Date(), tags: [], category: null, color: null, pinned: false, status: 'draft', intent: 'general', aiTouches: 0, custom: {} } },
      { path: 'note2.md', meta: { id: '2', title: 'Note 2', createdAt: new Date(), updatedAt: new Date(), tags: [], category: null, color: null, pinned: false, status: 'draft', intent: 'general', aiTouches: 0, custom: {} } },
    ];
    const mockPort = createMockDocumentPort(mockItems);
    const service = new NotesServiceImpl(mockPort);

    const result = await service.loadFolderTree();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2);
    }
  });

  it('handles empty notes folder gracefully', async () => {
    const mockPort = createMockDocumentPort([]);
    const service = new NotesServiceImpl(mockPort);

    const result = await service.loadFolderTree();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(0);
    }
  });

  it('handles list error gracefully', async () => {
    const mockPort = createMockDocumentPort();
    (mockPort.list as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error('Directory not found')));
    const service = new NotesServiceImpl(mockPort);

    const result = await service.loadFolderTree();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Directory not found');
    }
  });

  it('updates loading state during load', async () => {
    const mockPort = createMockDocumentPort([]);
    const service = new NotesServiceImpl(mockPort);

    // Track loading states
    const loadingStates: boolean[] = [];
    service.subscribe((state) => {
      loadingStates.push(state.isLoading);
    });

    await service.loadFolderTree();

    // Should have gone from false (initial) -> true (loading) -> false (done)
    expect(loadingStates).toContain(true);
    expect(loadingStates[loadingStates.length - 1]).toBe(false);
  });

  it('builds folder tree from nested paths', async () => {
    const mockItems: DocumentListItem[] = [
      { path: 'projects/note1.md', meta: { id: '1', title: 'Project Note', createdAt: new Date(), updatedAt: new Date(), tags: [], category: null, color: null, pinned: false, status: 'draft', intent: 'general', aiTouches: 0, custom: {} } },
      { path: 'projects/work/note2.md', meta: { id: '2', title: 'Work Note', createdAt: new Date(), updatedAt: new Date(), tags: [], category: null, color: null, pinned: false, status: 'draft', intent: 'general', aiTouches: 0, custom: {} } },
      { path: 'personal.md', meta: { id: '3', title: 'Personal', createdAt: new Date(), updatedAt: new Date(), tags: [], category: null, color: null, pinned: false, status: 'draft', intent: 'general', aiTouches: 0, custom: {} } },
    ];
    const mockPort = createMockDocumentPort(mockItems);
    const service = new NotesServiceImpl(mockPort);

    const result = await service.loadFolderTree();

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should have projects folder and personal.md at root
      expect(result.value.length).toBe(2);

      const projectsFolder = result.value.find((item) => item.path === 'projects');
      expect(projectsFolder).toBeDefined();
      expect(projectsFolder?.isFolder).toBe(true);
      expect(projectsFolder?.children?.length).toBe(2); // note1.md and work folder

      const personalNote = result.value.find((item) => item.path === 'personal.md');
      expect(personalNote).toBeDefined();
      expect(personalNote?.isFolder).toBe(false);
    }
  });
});
