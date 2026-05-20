import { describe, expect, it } from 'vitest';
import { validateSettings } from '$lib/domain';

describe('workspace settings migration', () => {
  it('migrates legacy notesPath and sync into an active workspace', () => {
    const settings = validateSettings({
      notesPath: '/notes',
      sync: {
        enabled: true,
        autoSync: false,
        authMode: 'token',
        repository: null,
        artifactPolicy: {
          includeMarkdown: true,
          includeVoidHistory: true,
          includePatterns: ['*.md'],
          excludePatterns: ['.void/sync/**'],
        },
        lastSyncAt: null,
        paused: true,
      },
    });

    expect(settings.workspaces).toHaveLength(1);
    expect(settings.activeWorkspaceId).toBe(settings.workspaces[0]?.id);
    expect(settings.workspaces[0]?.notesPath).toBe('/notes');
    expect(settings.workspaces[0]?.sync.enabled).toBe(true);
    expect(settings.sync.paused).toBe(true);
  });

  it('mirrors top-level sync changes into the active workspace', () => {
    const initial = validateSettings({ notesPath: '/notes' });
    const settings = validateSettings({
      ...initial,
      sync: {
        ...initial.sync,
        enabled: true,
        paused: true,
      },
    });

    expect(settings.sync.enabled).toBe(true);
    expect(settings.workspaces[0]?.sync.enabled).toBe(true);
    expect(settings.workspaces[0]?.sync.paused).toBe(true);
  });
});
