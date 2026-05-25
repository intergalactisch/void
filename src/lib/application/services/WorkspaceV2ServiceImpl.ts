import { err, ok, type Result } from '$lib/core';
import {
  WORKSPACE_V2_MANIFEST_PATH,
  createWorkspaceV2Manifest,
  validateWorkspaceV2Manifest,
  type WorkspaceV2Manifest,
  type WorkspaceV2MigrationState,
} from '$lib/domain/values';
import type { SettingsService, WorkspaceV2Service, WorkspaceV2Status } from '$lib/ports/inbound';
import type { GitRepositoryPort, VoidStoragePort } from '$lib/ports/outbound';

function requiredMigrationState(message: string | null = null): WorkspaceV2MigrationState {
  return {
    status: 'required',
    startedAt: null,
    completedAt: null,
    backupAttempted: false,
    backupCreated: false,
    backupRef: null,
    message,
  };
}

function recoveryBranchName(): string {
  return `void-v1-before-v2-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

export class WorkspaceV2ServiceImpl implements WorkspaceV2Service {
  constructor(
    private readonly settings: SettingsService,
    private readonly voidStorage: VoidStoragePort,
    private readonly notesPath: string,
    private readonly git?: GitRepositoryPort,
  ) {}

  async getStatus(): Promise<Result<WorkspaceV2Status, Error>> {
    const manifest = await this.voidStorage.readJson<WorkspaceV2Manifest>(
      this.notesPath,
      WORKSPACE_V2_MANIFEST_PATH,
    );
    if (!manifest.ok) return err(manifest.error);
    if (!manifest.value) {
      return ok({
        manifest: null,
        migration: requiredMigrationState('Workspace V2 migration has not run yet'),
      });
    }

    const validation = validateWorkspaceV2Manifest(manifest.value);
    if (!validation.ok) {
      return ok({
        manifest: null,
        migration: requiredMigrationState(validation.reason),
      });
    }
    if (!validation.manifest) {
      return ok({
        manifest: null,
        migration: requiredMigrationState('Workspace V2 manifest could not be read'),
      });
    }

    return ok({
      manifest: validation.manifest,
      migration: validation.manifest.migration,
    });
  }

  async migrateActiveWorkspace(): Promise<Result<WorkspaceV2Manifest, Error>> {
    const current = await this.getStatus();
    if (!current.ok) return err(current.error);
    if (current.value.manifest) return ok(current.value.manifest);

    const active = this.settings.current().workspaces.find(
      (workspace) => workspace.id === this.settings.current().activeWorkspaceId,
    ) ?? this.settings.current().workspaces[0];
    if (!active) return err(new Error('No active workspace is available for Workspace V2 migration'));

    let backupAttempted = false;
    let backupCreated = false;
    let backupRef: string | null = null;
    let message: string | null = null;

    if (this.git) {
      backupAttempted = true;
      const backup = await this.git.createRecoveryBranch(this.notesPath, recoveryBranchName());
      if (backup.ok) {
        backupCreated = true;
        backupRef = backup.value;
      } else {
        message = `Workspace V2 migration continued without a recovery branch: ${backup.error.message}`;
      }
    }

    const manifest = createWorkspaceV2Manifest({
      workspaceId: active.id,
      name: active.name,
      storage: active.notesPath.startsWith('~/Documents/Void') ? 'managed' : 'external',
      createdAt: active.createdAt,
      backupAttempted,
      backupCreated,
      backupRef,
      message,
    });

    const written = await this.voidStorage.writeJson(
      this.notesPath,
      WORKSPACE_V2_MANIFEST_PATH,
      manifest,
    );
    if (!written.ok) return err(written.error);
    return ok(manifest);
  }
}
