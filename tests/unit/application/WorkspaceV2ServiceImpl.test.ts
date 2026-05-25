import { describe, expect, it } from 'vitest';
import { WorkspaceV2ServiceImpl } from '$lib/application/services';
import { MemorySettingsAdapter, MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import { SettingsServiceImpl } from '$lib/application/services/SettingsServiceImpl';
import { WORKSPACE_V2_MANIFEST_PATH } from '$lib/domain/values';

describe('WorkspaceV2ServiceImpl', () => {
  it('migrates the active workspace by writing a V2 manifest', async () => {
    const settings = new SettingsServiceImpl(new MemorySettingsAdapter());
    await settings.load();
    await settings.set('notesPath', '/notes');
    const storage = new MemoryVoidStorageAdapter();
    const service = new WorkspaceV2ServiceImpl(settings, storage, '/notes');

    const before = await service.getStatus();
    expect(before.ok && before.value.manifest).toBeNull();

    const migrated = await service.migrateActiveWorkspace();
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(2);
    expect(migrated.value.capabilities.hiddenInternalGit).toBe(true);

    const stored = await storage.readJson('/notes', WORKSPACE_V2_MANIFEST_PATH);
    expect(stored.ok && stored.value).toMatchObject({ schemaVersion: 2 });
  });
});
