import type { Result } from '$lib/core';
import type { WorkspaceV2Manifest, WorkspaceV2MigrationState } from '$lib/domain/values';

export interface WorkspaceV2Status {
  manifest: WorkspaceV2Manifest | null;
  migration: WorkspaceV2MigrationState;
}

export interface WorkspaceV2Service {
  getStatus(): Promise<Result<WorkspaceV2Status, Error>>;
  migrateActiveWorkspace(): Promise<Result<WorkspaceV2Manifest, Error>>;
}
