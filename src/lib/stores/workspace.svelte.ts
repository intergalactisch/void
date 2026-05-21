/**
 * Workspace Store - primary adapter for active Void workspace UI.
 */

import type {
  WorkspaceService,
  WorkspaceSwitchBlocker,
} from '$lib/ports/inbound';
import type { Workspace } from '$lib/domain';
import { events } from '$lib/events';
import { settingsStore } from './settings.svelte';
import { toastStore } from './toast.svelte';

class WorkspaceStore {
  #service: WorkspaceService | null = null;
  workspaces = $state<Workspace[]>([]);
  activeWorkspace = $state<Workspace | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);
  switchBlockers = $state<WorkspaceSwitchBlocker[]>([]);

  init(service: WorkspaceService): void {
    this.#service = service;
    this.refreshLocal();
  }

  refreshLocal(): void {
    if (!this.#service) return;
    this.workspaces = this.#service.list();
    this.activeWorkspace = this.#service.active();
  }

  async create(name: string, notesPath?: string | null): Promise<Workspace | null> {
    if (!this.#service) return null;
    return this.run(async () => this.#service!.create(
      notesPath === undefined ? { name } : { name, notesPath }
    ));
  }

  async createAndSwitch(
    name: string,
    notesPath?: string | null,
    migrateLegacyDefault = false,
  ): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    this.error = null;
    this.switchBlockers = [];
    try {
      const params = notesPath === undefined
        ? { name, migrateLegacyDefault }
        : { name, notesPath, migrateLegacyDefault };
      const created = await this.#service.createAndSwitch(params);
      if (!created.ok) {
        this.error = created.error;
        toastStore.error(created.error.message);
        return false;
      }
      await settingsStore.load();
      this.refreshLocal();
      toastStore.success(`Created ${created.value.workspace.name}`);
      if (created.value.requiresReload && typeof window !== 'undefined') {
        window.location.reload();
      }
      return true;
    } finally {
      this.loading = false;
    }
  }

  async rename(workspaceId: string, name: string): Promise<Workspace | null> {
    if (!this.#service) return null;
    return this.run(async () => this.#service!.rename(workspaceId, name));
  }

  async updateNotesPath(workspaceId: string, notesPath: string): Promise<Workspace | null> {
    if (!this.#service) return null;
    return this.run(async () => this.#service!.updateNotesPath(workspaceId, notesPath));
  }

  async moveFolder(workspaceId: string, destinationPath: string): Promise<Workspace | null> {
    if (!this.#service) return null;
    return this.run(async () => this.#service!.moveFolder(workspaceId, destinationPath));
  }

  async remove(workspaceId: string): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.remove(workspaceId));
    return result !== null;
  }

  async trash(workspaceId: string): Promise<boolean> {
    if (!this.#service) return false;
    const result = await this.run(async () => this.#service!.trash(workspaceId));
    return result !== null;
  }

  async switchTo(workspaceId: string): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    this.error = null;
    this.switchBlockers = [];
    try {
      const blockers = await this.#service.canSwitch(workspaceId);
      if (!blockers.ok) {
        this.error = blockers.error;
        toastStore.error(blockers.error.message);
        return false;
      }
      if (blockers.value.length > 0) {
        this.switchBlockers = blockers.value;
        toastStore.warning(blockers.value[0]?.message ?? 'Workspace switch is blocked');
        return false;
      }
      const switched = await this.#service.switchTo(workspaceId);
      if (!switched.ok) {
        this.error = switched.error;
        toastStore.error(switched.error.message);
        return false;
      }
      await settingsStore.load();
      this.refreshLocal();
      toastStore.success(`Switched to ${switched.value.workspace.name}`);
      if (switched.value.requiresReload && typeof window !== 'undefined') {
        window.location.reload();
      }
      return true;
    } finally {
      this.loading = false;
    }
  }

  private async run<T>(operation: () => Promise<{ ok: true; value: T } | { ok: false; error: Error }>): Promise<T | null> {
    this.loading = true;
    this.error = null;
    try {
      const result = await operation();
      if (!result.ok) {
        this.error = result.error;
        events.emit('error:user-facing', { source: 'Workspace', error: result.error });
        return null;
      }
      await settingsStore.load();
      this.refreshLocal();
      return result.value;
    } finally {
      this.loading = false;
    }
  }
}

export const workspaceStore = new WorkspaceStore();
