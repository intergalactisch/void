/**
 * WorkspaceServiceImpl - orchestrates active Void workspace selection.
 */

import type {
  EditorService,
  SettingsService,
  SyncService,
  WorkspaceService,
  WorkspaceSwitchBlocker,
  WorkspaceSwitchResult,
  CreateWorkspaceParams,
} from '$lib/ports/inbound';
import type { FileSystemPort, VoidStoragePort } from '$lib/ports/outbound';
import {
  MANAGED_DEFAULT_WORKSPACE_NAME,
  MANAGED_DEFAULT_WORKSPACE_PATH,
  activeWorkspaceFrom,
  cloneWorkspace,
  createWorkspace,
  generateManagedWorkspacePath,
  isAbsoluteOrTildePath,
  isLegacyDefaultWorkspacePath,
  needsManagedDefaultWorkspaceMigration,
  validateSettings,
  workspacePathEquals,
  type Settings,
  type Workspace,
} from '$lib/domain';
import { err, ok, type Result } from '$lib/core';
import { events } from '$lib/events';

export class WorkspaceServiceImpl implements WorkspaceService {
  constructor(
    private readonly settings: SettingsService,
    private readonly editor?: EditorService,
    private readonly sync?: SyncService,
    private readonly fileSystem?: FileSystemPort,
    private readonly voidStorage?: VoidStoragePort,
  ) {}

  list(): Workspace[] {
    return this.settings.current().workspaces.map(cloneWorkspace);
  }

  active(): Workspace {
    const settings = this.settings.current();
    return cloneWorkspace(activeWorkspaceFrom(settings.workspaces, settings.activeWorkspaceId));
  }

  async create(params: CreateWorkspaceParams): Promise<Result<Workspace, Error>> {
    const current = this.settings.current();
    const prepared = this.prepareWorkspace(params, current);
    if (!prepared.ok) return err(prepared.error);
    const workspace = prepared.value;
    const ensured = await this.ensureWorkspaceStorage(workspace.notesPath);
    if (!ensured.ok) return err(ensured.error);
    const next = withWorkspace(current, workspace);
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    events.emit('workspace:changed', { workspaceId: current.activeWorkspaceId, activeWorkspaceId: next.activeWorkspaceId });
    return ok(cloneWorkspace(workspace));
  }

  async createAndSwitch(params: CreateWorkspaceParams): Promise<Result<WorkspaceSwitchResult, Error>> {
    const blockers = await this.collectSwitchBlockers();
    if (!blockers.ok) return err(blockers.error);
    if (blockers.value.length > 0) {
      return err(new Error(blockers.value[0]?.message ?? 'Workspace switch is blocked'));
    }

    const beforeMigration = this.settings.current();
    if (
      params.migrateLegacyDefault
      && needsManagedDefaultWorkspaceMigration(beforeMigration.workspaces, beforeMigration.activeWorkspaceId)
    ) {
      const migrated = await this.migrateLegacyDefaultWorkspace();
      if (!migrated.ok) return err(migrated.error);
    }

    const current = this.settings.current();
    const prepared = this.prepareWorkspace(params, current);
    if (!prepared.ok) return err(prepared.error);
    const workspace = {
      ...prepared.value,
      lastOpenedAt: new Date().toISOString(),
    };
    const ensured = await this.ensureWorkspaceStorage(workspace.notesPath);
    if (!ensured.ok) return err(ensured.error);

    const next = validateSettings({
      ...current,
      notesPath: workspace.notesPath,
      sync: workspace.sync,
      workspaces: [...current.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    });
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    events.emit('workspace:changed', { workspaceId: current.activeWorkspaceId, activeWorkspaceId: workspace.id });
    return ok({ workspace: cloneWorkspace(workspace), requiresReload: true });
  }

  async migrateLegacyDefaultWorkspace(): Promise<Result<Workspace, Error>> {
    const current = this.settings.current();
    const active = activeWorkspaceFrom(current.workspaces, current.activeWorkspaceId);
    if (!isLegacyDefaultWorkspacePath(active.notesPath)) {
      return ok(cloneWorkspace(active));
    }
    if (!this.fileSystem) {
      return err(new Error('Workspace migration requires filesystem access'));
    }

    const destinationExists = await this.fileSystem.exists(MANAGED_DEFAULT_WORKSPACE_PATH);
    if (!destinationExists.ok) return err(destinationExists.error);
    if (destinationExists.value) {
      return err(new Error(`Cannot move the default workflow because ${MANAGED_DEFAULT_WORKSPACE_PATH} already exists`));
    }

    const sourceExists = await this.fileSystem.exists(active.notesPath);
    if (!sourceExists.ok) return err(sourceExists.error);
    if (!sourceExists.value) {
      return err(new Error(`Cannot move the default workflow because ${active.notesPath} does not exist`));
    }

    const created = await this.fileSystem.createDirectory(MANAGED_DEFAULT_WORKSPACE_PATH);
    if (!created.ok) return err(created.error);

    const listed = await this.fileSystem.listDirectory(active.notesPath);
    if (!listed.ok) return err(listed.error);

    for (const entry of listed.value) {
      if (entry.name.toLowerCase() === MANAGED_DEFAULT_WORKSPACE_NAME.toLowerCase()) continue;
      const moved = await this.fileSystem.renamePath(entry.path, `${MANAGED_DEFAULT_WORKSPACE_PATH}/${entry.name}`);
      if (!moved.ok) {
        return err(new Error(`Failed to move ${entry.name} into the default workflow: ${moved.error.message}`));
      }
    }

    const ensured = await this.ensureWorkspaceStorage(MANAGED_DEFAULT_WORKSPACE_PATH);
    if (!ensured.ok) return err(ensured.error);

    const migrated: Workspace = {
      ...active,
      name: MANAGED_DEFAULT_WORKSPACE_NAME,
      notesPath: MANAGED_DEFAULT_WORKSPACE_PATH,
    };
    const nextWorkspaces = current.workspaces.map((workspace) =>
      workspace.id === active.id ? migrated : workspace
    );
    const next = validateSettings({
      ...current,
      notesPath: migrated.notesPath,
      sync: migrated.sync,
      workspaces: nextWorkspaces,
      activeWorkspaceId: migrated.id,
    });
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    events.emit('workspace:changed', { workspaceId: active.id, activeWorkspaceId: migrated.id });
    return ok(cloneWorkspace(migrated));
  }

  async rename(workspaceId: string, name: string): Promise<Result<Workspace, Error>> {
    const trimmed = name.trim();
    if (!trimmed) return err(new Error('Workspace name is required'));
    return this.updateWorkspace(workspaceId, (workspace) => ({ ...workspace, name: trimmed }));
  }

  async updateNotesPath(workspaceId: string, notesPath: string): Promise<Result<Workspace, Error>> {
    const trimmed = notesPath.trim();
    if (!trimmed) return err(new Error('Workspace notes path is required'));
    if (!isAbsoluteOrTildePath(trimmed)) {
      return err(new Error('Choose an absolute folder path, or use the managed workflow creation flow'));
    }
    const current = this.settings.current();
    if (current.workspaces.some((workspace) => workspace.id !== workspaceId && workspacePathEquals(workspace.notesPath, trimmed))) {
      return err(new Error('Another workspace already uses that notes folder'));
    }
    const ensured = await this.ensureWorkspaceStorage(trimmed);
    if (!ensured.ok) return err(ensured.error);
    return this.updateWorkspace(workspaceId, (workspace) => ({ ...workspace, notesPath: trimmed }));
  }

  async moveFolder(workspaceId: string, destinationPath: string): Promise<Result<Workspace, Error>> {
    const current = this.settings.current();
    const movable = this.findInactiveMutableWorkspace(current, workspaceId, 'move');
    if (!movable.ok) return err(movable.error);
    if (!this.fileSystem) return err(new Error('Moving a workspace requires filesystem access'));

    const destination = destinationPath.trim();
    if (!destination) return err(new Error('Destination folder is required'));
    if (!isAbsoluteOrTildePath(destination)) {
      return err(new Error('Choose an absolute destination folder path'));
    }
    const workspace = movable.value;
    if (workspacePathEquals(workspace.notesPath, destination)) {
      return ok(cloneWorkspace(workspace));
    }
    if (current.workspaces.some((item) => item.id !== workspaceId && workspacePathEquals(item.notesPath, destination))) {
      return err(new Error('Another workspace already uses that notes folder'));
    }

    const sourceExists = await this.fileSystem.exists(workspace.notesPath);
    if (!sourceExists.ok) return err(sourceExists.error);
    if (!sourceExists.value) {
      return err(new Error(`Workspace folder does not exist: ${workspace.notesPath}`));
    }
    const destinationExists = await this.fileSystem.exists(destination);
    if (!destinationExists.ok) return err(destinationExists.error);
    if (destinationExists.value) {
      return err(new Error(`Destination folder already exists: ${destination}`));
    }

    const moved = await this.fileSystem.renamePath(workspace.notesPath, destination);
    if (!moved.ok) return err(moved.error);

    const updated: Workspace = { ...workspace, notesPath: destination };
    const nextWorkspaces = current.workspaces.map((item) =>
      item.id === workspaceId ? updated : item
    );
    const next = validateSettings({
      ...current,
      workspaces: nextWorkspaces,
      notesPath: activeWorkspaceFrom(nextWorkspaces, current.activeWorkspaceId).notesPath,
      sync: activeWorkspaceFrom(nextWorkspaces, current.activeWorkspaceId).sync,
    });
    const saved = await this.settings.save(next);
    if (!saved.ok) {
      const rollback = await this.fileSystem.renamePath(destination, workspace.notesPath);
      if (!rollback.ok) {
        return err(new Error(`Failed to save moved workspace and could not roll back the folder move: ${saved.error.message}; rollback failed: ${rollback.error.message}`));
      }
      return err(saved.error);
    }

    events.emit('workspace:changed', { workspaceId, activeWorkspaceId: next.activeWorkspaceId });
    return ok(cloneWorkspace(updated));
  }

  async remove(workspaceId: string): Promise<Result<Workspace[], Error>> {
    const current = this.settings.current();
    if (current.workspaces.length <= 1) {
      return err(new Error('At least one workspace is required'));
    }
    if (workspaceId === current.activeWorkspaceId) {
      return err(new Error('Switch to another workspace before removing this one'));
    }
    const nextWorkspaces = current.workspaces.filter((workspace) => workspace.id !== workspaceId);
    if (nextWorkspaces.length === current.workspaces.length) {
      return err(new Error('Workspace was not found'));
    }
    const active = activeWorkspaceFrom(nextWorkspaces, current.activeWorkspaceId);
    const next = validateSettings({
      ...current,
      notesPath: active.notesPath,
      sync: active.sync,
      workspaces: nextWorkspaces,
      activeWorkspaceId: active.id,
    });
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    events.emit('workspace:changed', { workspaceId, activeWorkspaceId: next.activeWorkspaceId });
    return ok(next.workspaces.map(cloneWorkspace));
  }

  async trash(workspaceId: string): Promise<Result<Workspace[], Error>> {
    const current = this.settings.current();
    const trashable = this.findInactiveMutableWorkspace(current, workspaceId, 'trash');
    if (!trashable.ok) return err(trashable.error);
    if (!this.fileSystem) return err(new Error('Moving a workspace to Trash requires filesystem access'));

    const workspace = trashable.value;
    const shouldTrashFolder = isAbsoluteOrTildePath(workspace.notesPath);
    let folderExists = false;
    if (shouldTrashFolder) {
      const exists = await this.fileSystem.exists(workspace.notesPath);
      if (!exists.ok) return err(exists.error);
      folderExists = exists.value;
    }

    const nextWorkspaces = current.workspaces.filter((item) => item.id !== workspaceId);
    const active = activeWorkspaceFrom(nextWorkspaces, current.activeWorkspaceId);
    const next = validateSettings({
      ...current,
      notesPath: active.notesPath,
      sync: active.sync,
      workspaces: nextWorkspaces,
      activeWorkspaceId: active.id,
    });
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);

    if (shouldTrashFolder && folderExists) {
      const trashed = await this.fileSystem.moveToTrash(workspace.notesPath);
      if (!trashed.ok) {
        if (isMissingPathError(trashed.error)) {
          events.emit('workspace:changed', { workspaceId, activeWorkspaceId: next.activeWorkspaceId });
          return ok(next.workspaces.map(cloneWorkspace));
        }
        const restored = await this.settings.save(current);
        if (!restored.ok) {
          return err(new Error(`Failed to move workspace folder to Trash and could not restore settings: ${trashed.error.message}; restore failed: ${restored.error.message}`));
        }
        return err(trashed.error);
      }
    }

    events.emit('workspace:changed', { workspaceId, activeWorkspaceId: next.activeWorkspaceId });
    return ok(next.workspaces.map(cloneWorkspace));
  }

  async canSwitch(workspaceId: string): Promise<Result<WorkspaceSwitchBlocker[], Error>> {
    const current = this.settings.current();
    const target = current.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) {
      return ok([{
        kind: 'missing-workspace',
        message: 'Workspace was not found',
        paths: [],
      }]);
    }
    if (workspaceId === current.activeWorkspaceId) return ok([]);

    return this.collectSwitchBlockers();
  }

  private async collectSwitchBlockers(): Promise<Result<WorkspaceSwitchBlocker[], Error>> {
    const blockers: WorkspaceSwitchBlocker[] = [];
    const editorState = this.editor?.getState();
    if (editorState) {
      const dirty = editorState.tabs.filter((tab) => tab.isDirty || tab.isSaving);
      if (dirty.length > 0) {
        blockers.push({
          kind: 'dirty-editor',
          message: 'Save or close dirty editor tabs before switching workspaces',
          paths: dirty.map((tab) => tab.path),
        });
      }
      const conflicted = editorState.tabs.filter((tab) => tab.conflictState !== 'clean');
      if (conflicted.length > 0) {
        blockers.push({
          kind: 'editor-conflict',
          message: 'Resolve open editor file conflicts before switching workspaces',
          paths: conflicted.map((tab) => tab.path),
        });
      }
    }

    const sync = this.sync;
    const syncStatus = sync?.getStatus();
    if (sync && syncStatus) {
      if (syncStatus.operation !== 'idle' || syncStatus.kind === 'syncing') {
        blockers.push({
          kind: 'syncing',
          message: 'Wait for GitHub sync to finish before switching workspaces',
          paths: [],
        });
      }
      if (syncStatus.kind === 'conflicted' || syncStatus.conflicts.length > 0) {
        blockers.push({
          kind: 'sync-conflict',
          message: 'Resolve GitHub sync conflicts before switching workspaces',
          paths: syncStatus.conflicts.map((conflict) => conflict.path).filter((path): path is string => !!path),
        });
      }
      const session = await sync.loadConflictSession();
      if (!session.ok) return err(session.error);
      if (session.value && (session.value.status === 'merging' || session.value.status === 'conflicted')) {
        blockers.push({
          kind: 'sync-conflict',
          message: 'Resolve the active Git merge before switching workspaces',
          paths: session.value.conflicts.map((conflict) => conflict.path).filter((path): path is string => !!path),
        });
      }
    }

    return ok(blockers);
  }

  async switchTo(workspaceId: string): Promise<Result<WorkspaceSwitchResult, Error>> {
    const blockers = await this.canSwitch(workspaceId);
    if (!blockers.ok) return err(blockers.error);
    if (blockers.value.length > 0) {
      return err(new Error(blockers.value[0]?.message ?? 'Workspace switch is blocked'));
    }

    const current = this.settings.current();
    const target = current.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) return err(new Error('Workspace was not found'));
    const updatedTarget: Workspace = {
      ...target,
      lastOpenedAt: new Date().toISOString(),
    };
    const nextWorkspaces = current.workspaces.map((workspace) =>
      workspace.id === workspaceId ? updatedTarget : workspace
    );
    const next = validateSettings({
      ...current,
      notesPath: updatedTarget.notesPath,
      sync: updatedTarget.sync,
      workspaces: nextWorkspaces,
      activeWorkspaceId: updatedTarget.id,
    });
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    events.emit('workspace:changed', { workspaceId: current.activeWorkspaceId, activeWorkspaceId: updatedTarget.id });
    return ok({ workspace: cloneWorkspace(updatedTarget), requiresReload: true });
  }

  private async updateWorkspace(
    workspaceId: string,
    update: (workspace: Workspace) => Workspace,
  ): Promise<Result<Workspace, Error>> {
    const current = this.settings.current();
    const found = current.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!found) return err(new Error('Workspace was not found'));
    const updated = update(cloneWorkspace(found));
    const nextWorkspaces = current.workspaces.map((workspace) =>
      workspace.id === workspaceId ? updated : workspace
    );
    const active = activeWorkspaceFrom(nextWorkspaces, current.activeWorkspaceId);
    const next = validateSettings({
      ...current,
      notesPath: active.notesPath,
      sync: active.sync,
      workspaces: nextWorkspaces,
      activeWorkspaceId: active.id,
    });
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    events.emit('workspace:changed', { workspaceId, activeWorkspaceId: next.activeWorkspaceId });
    return ok(cloneWorkspace(updated));
  }

  private findInactiveMutableWorkspace(
    settings: Settings,
    workspaceId: string,
    operation: 'move' | 'trash',
  ): Result<Workspace, Error> {
    if (settings.workspaces.length <= 1) {
      return err(new Error('At least one workspace is required'));
    }
    const workspace = settings.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return err(new Error('Workspace was not found'));
    if (workspaceId === settings.activeWorkspaceId) {
      return err(new Error(`Switch to another workspace before ${operation === 'move' ? 'moving' : 'trashing'} this one`));
    }
    return ok(cloneWorkspace(workspace));
  }

  private prepareWorkspace(
    params: CreateWorkspaceParams,
    settings: Settings,
  ): Result<Workspace, Error> {
    const name = params.name.trim();
    const customPath = params.notesPath?.trim() ?? '';
    if (
      !customPath
      && !params.migrateLegacyDefault
      && needsManagedDefaultWorkspaceMigration(settings.workspaces, settings.activeWorkspaceId)
    ) {
      return err(new Error(`Move the default workflow to ${MANAGED_DEFAULT_WORKSPACE_PATH} before creating managed workflows`));
    }
    const notesPath = customPath
      || generateManagedWorkspacePath(name, settings.workspaces.map((workspace) => workspace.notesPath));
    if (!name) return err(new Error('Workspace name is required'));
    if (!isAbsoluteOrTildePath(notesPath)) {
      return err(new Error('Choose an absolute folder path, or leave the folder blank for a managed workflow'));
    }
    if (settings.workspaces.some((workspace) => workspacePathEquals(workspace.notesPath, notesPath))) {
      return err(new Error('Another workspace already uses that notes folder'));
    }
    return ok(createWorkspace({ name, notesPath }));
  }

  private async ensureWorkspaceStorage(notesPath: string): Promise<Result<void, Error>> {
    if (this.fileSystem) {
      const directory = await this.fileSystem.createDirectory(notesPath);
      if (!directory.ok) return err(directory.error);
    }
    if (this.voidStorage) {
      const structure = await this.voidStorage.ensureStructure(notesPath);
      if (!structure.ok) return err(structure.error);
    }
    return ok(undefined);
  }
}

function withWorkspace(settings: Settings, workspace: Workspace): Settings {
  return validateSettings({
    ...settings,
    workspaces: [...settings.workspaces, workspace],
    activeWorkspaceId: settings.activeWorkspaceId,
    notesPath: settings.notesPath,
    sync: settings.sync,
  });
}

function isMissingPathError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('not found')
    || message.includes('no such file')
    || message.includes("doesn't exist")
    || message.includes('doesn’t exist');
}
