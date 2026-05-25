import type { WorkspaceV2Manifest, WorkspaceV2MigrationState } from '$lib/domain/values';
import type { WorkspaceV2Service } from '$lib/ports/inbound';
import { events } from '$lib/events';

const REQUIRED_MIGRATION: WorkspaceV2MigrationState = {
  status: 'required',
  startedAt: null,
  completedAt: null,
  backupAttempted: false,
  backupCreated: false,
  backupRef: null,
  message: null,
};

class WorkspaceV2Store {
  #service: WorkspaceV2Service | null = null;
  manifest = $state<WorkspaceV2Manifest | null>(null);
  migration = $state<WorkspaceV2MigrationState>(REQUIRED_MIGRATION);
  loading = $state(false);
  error = $state<Error | null>(null);

  init(service: WorkspaceV2Service): void {
    this.#service = service;
    void this.refresh();
  }

  async refresh(): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    this.error = null;
    try {
      const result = await this.#service.getStatus();
      if (!result.ok) {
        this.error = result.error;
        return false;
      }
      this.manifest = result.value.manifest;
      this.migration = result.value.migration;
      return true;
    } finally {
      this.loading = false;
    }
  }

  async migrate(): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    this.error = null;
    try {
      const result = await this.#service.migrateActiveWorkspace();
      if (!result.ok) {
        this.error = result.error;
        events.emit('error:user-facing', { source: 'Workspace V2 migration', error: result.error });
        return false;
      }
      this.manifest = result.value;
      this.migration = result.value.migration;
      return true;
    } finally {
      this.loading = false;
    }
  }
}

export const workspaceV2Store = new WorkspaceV2Store();
