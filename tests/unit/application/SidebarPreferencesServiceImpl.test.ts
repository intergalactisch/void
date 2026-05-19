import { describe, expect, it } from 'vitest';
import { SidebarPreferencesServiceImpl } from '$lib/application/services/SidebarPreferencesServiceImpl';
import { MemoryVoidStorageAdapter } from '$lib/adapters/memory';

function createService(storage = new MemoryVoidStorageAdapter()) {
  return {
    storage,
    service: new SidebarPreferencesServiceImpl(storage, '/notes'),
  };
}

describe('SidebarPreferencesServiceImpl', () => {
  it('loads defaults when no sidebar preferences exist', async () => {
    const { service } = createService();

    const result = await service.load();

    expect(result.ok).toBe(true);
    expect(service.getState()).toEqual({
      version: 1,
      favorites: [],
      folderOrder: {},
    });
  });

  it('toggles favorites and persists them for reload', async () => {
    const { service, storage } = createService();
    await service.load();

    await service.toggleFavorite({ kind: 'note', path: 'alpha.md' });
    await service.toggleFavorite({ kind: 'folder', path: 'Projects' });

    const reloaded = new SidebarPreferencesServiceImpl(storage, '/notes');
    await reloaded.load();

    expect(reloaded.getState().favorites).toEqual([
      { kind: 'note', path: 'alpha.md' },
      { kind: 'folder', path: 'Projects' },
    ]);
  });

  it('moves and reorders folders per parent', async () => {
    const { service, storage } = createService();
    await service.load();

    await service.moveFolder('', 'Beta', 'up', ['Alpha', 'Beta', 'Gamma']);
    await service.reorderFolder('Projects', 'Projects/Zeta', 'Projects/Alpha', 'before', [
      'Projects/Alpha',
      'Projects/Zeta',
    ]);

    expect(service.getState().folderOrder).toEqual({
      '': ['Beta', 'Alpha', 'Gamma'],
      Projects: ['Projects/Zeta', 'Projects/Alpha'],
    });

    const reloaded = new SidebarPreferencesServiceImpl(storage, '/notes');
    await reloaded.load();
    expect(reloaded.getState().folderOrder).toEqual({
      '': ['Beta', 'Alpha', 'Gamma'],
      Projects: ['Projects/Zeta', 'Projects/Alpha'],
    });
  });

  it('renames and deletes nested folder references', async () => {
    const { service } = createService();
    await service.load();
    await service.toggleFavorite({ kind: 'folder', path: 'Old' });
    await service.toggleFavorite({ kind: 'note', path: 'Old/note.md' });
    await service.reorderFolder('', 'Old', 'Other', 'after', ['Old', 'Other']);
    await service.reorderFolder('Old', 'Old/B', 'Old/A', 'before', ['Old/A', 'Old/B']);

    await service.renamePath('Old', 'New', 'folder');

    expect(service.getState()).toMatchObject({
      favorites: [
        { kind: 'folder', path: 'New' },
        { kind: 'note', path: 'New/note.md' },
      ],
      folderOrder: {
        '': ['Other', 'New'],
        New: ['New/B', 'New/A'],
      },
    });

    await service.deletePath('New', 'folder');

    expect(service.getState()).toEqual({
      version: 1,
      favorites: [],
      folderOrder: {
        '': ['Other'],
      },
    });
  });
});
