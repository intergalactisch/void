import { describe, expect, it } from 'vitest';
import {
  createWorkspaceV2Manifest,
  validateWorkspaceV2Manifest,
  WORKSPACE_V2_SCHEMA_VERSION,
} from '$lib/domain/values';

describe('Workspace V2 domain values', () => {
  it('creates a future-ready V2 manifest with hidden internal Git and peer sync capabilities', () => {
    const manifest = createWorkspaceV2Manifest({
      workspaceId: 'workspace-a',
      name: 'Research',
      storage: 'managed',
      createdAt: '2026-05-25T00:00:00.000Z',
      upgradedAt: '2026-05-25T10:00:00.000Z',
      backupAttempted: true,
      backupCreated: false,
      message: 'Backup skipped in test',
    });

    expect(manifest.schemaVersion).toBe(WORKSPACE_V2_SCHEMA_VERSION);
    expect(manifest.capabilities.hiddenInternalGit).toBe(true);
    expect(manifest.capabilities.peerSync).toBe(true);
    expect(manifest.capabilities.desktopRelayAI).toBe(true);
    expect(manifest.sync.defaultBranch).toBe('main');
    expect(manifest.migration.status).toBe('completed');
    expect(manifest.migration.backupAttempted).toBe(true);
  });

  it('validates malformed manifests without throwing', () => {
    expect(validateWorkspaceV2Manifest(null)).toMatchObject({
      ok: false,
      manifest: null,
    });
    expect(validateWorkspaceV2Manifest({ app: 'void', kind: 'workspace', schemaVersion: 1 })).toMatchObject({
      ok: false,
      reason: 'Unsupported workspace schema version: 1',
    });
  });
});
