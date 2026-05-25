import type { WorkspaceStorageMode } from './PlatformCapabilities';

export const WORKSPACE_V2_SCHEMA_VERSION = 2;
export const WORKSPACE_V2_MANIFEST_PATH = 'workspace.json';

export type WorkspaceV2MigrationStatus =
  | 'not-required'
  | 'required'
  | 'running'
  | 'completed'
  | 'failed';

export interface WorkspaceV2Transport {
  id: string;
  provider: 'github' | 'peer';
  enabled: boolean;
  label: string;
  configuredAt: string;
}

export interface WorkspaceV2MigrationState {
  status: WorkspaceV2MigrationStatus;
  startedAt: string | null;
  completedAt: string | null;
  backupAttempted: boolean;
  backupCreated: boolean;
  backupRef: string | null;
  message: string | null;
}

export interface WorkspaceV2Manifest {
  app: 'void';
  kind: 'workspace';
  schemaVersion: 2;
  workspaceId: string;
  name: string;
  storage: WorkspaceStorageMode;
  createdAt: string;
  upgradedAt: string;
  capabilities: {
    hiddenInternalGit: true;
    peerSync: true;
    selectiveEncryption: true;
    desktopRelayAI: true;
  };
  sync: {
    defaultBranch: string;
    transports: WorkspaceV2Transport[];
  };
  migration: WorkspaceV2MigrationState;
}

export interface WorkspaceV2Validation {
  ok: boolean;
  manifest: WorkspaceV2Manifest | null;
  reason: string | null;
}

export function createWorkspaceV2Manifest(input: {
  workspaceId: string;
  name: string;
  storage?: WorkspaceStorageMode;
  createdAt?: string;
  upgradedAt?: string;
  backupRef?: string | null;
  backupAttempted?: boolean;
  backupCreated?: boolean;
  message?: string | null;
}): WorkspaceV2Manifest {
  const now = input.upgradedAt ?? new Date().toISOString();
  return {
    app: 'void',
    kind: 'workspace',
    schemaVersion: WORKSPACE_V2_SCHEMA_VERSION,
    workspaceId: input.workspaceId.trim(),
    name: input.name.trim() || 'Void',
    storage: input.storage ?? 'managed',
    createdAt: input.createdAt ?? now,
    upgradedAt: now,
    capabilities: {
      hiddenInternalGit: true,
      peerSync: true,
      selectiveEncryption: true,
      desktopRelayAI: true,
    },
    sync: {
      defaultBranch: 'main',
      transports: [],
    },
    migration: {
      status: 'completed',
      startedAt: now,
      completedAt: now,
      backupAttempted: input.backupAttempted === true,
      backupCreated: input.backupCreated === true,
      backupRef: input.backupRef ?? null,
      message: input.message ?? null,
    },
  };
}

export function validateWorkspaceV2Manifest(input: unknown): WorkspaceV2Validation {
  if (!input || typeof input !== 'object') {
    return { ok: false, manifest: null, reason: 'Missing Workspace V2 manifest' };
  }
  const value = input as Partial<WorkspaceV2Manifest>;
  if (value.app !== 'void') return { ok: false, manifest: null, reason: 'Manifest app must be "void"' };
  if (value.kind !== 'workspace') return { ok: false, manifest: null, reason: 'Manifest kind must be "workspace"' };
  if (value.schemaVersion !== WORKSPACE_V2_SCHEMA_VERSION) {
    return { ok: false, manifest: null, reason: `Unsupported workspace schema version: ${String(value.schemaVersion)}` };
  }
  if (typeof value.workspaceId !== 'string' || !value.workspaceId.trim()) {
    return { ok: false, manifest: null, reason: 'Manifest workspaceId is required' };
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    return { ok: false, manifest: null, reason: 'Manifest name is required' };
  }
  if (value.storage !== 'managed' && value.storage !== 'external') {
    return { ok: false, manifest: null, reason: 'Manifest storage must be managed or external' };
  }
  const migration = value.migration;
  if (!migration || typeof migration !== 'object') {
    return { ok: false, manifest: null, reason: 'Manifest migration state is required' };
  }
  return { ok: true, manifest: value as WorkspaceV2Manifest, reason: null };
}
