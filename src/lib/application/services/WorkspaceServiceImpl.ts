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
import {
  activeWorkspaceFrom,
  cloneWorkspace,
  createWorkspace,
  validateSettings,
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
  ) {}

  list(): Workspace[] {
    return this.settings.current().workspaces.map(cloneWorkspace);
  }

  active(): Workspace {
    const settings = this.settings.current();
    return cloneWorkspace(activeWorkspaceFrom(settings.workspaces, settings.activeWorkspaceId));
  }

  async create(params: CreateWorkspaceParams): Promise<Result<Workspace, Error>> {
    const notesPath = params.notesPath.trim();
    if (!notesPath) return err(new Error('Workspace notes path is required'));
    const workspace = createWorkspace({ name: params.name, notesPath });
    const current = this.settings.current();
    const next = withWorkspace(current, workspace);
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    events.emit('workspace:changed', { workspaceId: current.activeWorkspaceId, activeWorkspaceId: next.activeWorkspaceId });
    return ok(cloneWorkspace(workspace));
  }

  async rename(workspaceId: string, name: string): Promise<Result<Workspace, Error>> {
    const trimmed = name.trim();
    if (!trimmed) return err(new Error('Workspace name is required'));
    return this.updateWorkspace(workspaceId, (workspace) => ({ ...workspace, name: trimmed }));
  }

  async updateNotesPath(workspaceId: string, notesPath: string): Promise<Result<Workspace, Error>> {
    const trimmed = notesPath.trim();
    if (!trimmed) return err(new Error('Workspace notes path is required'));
    return this.updateWorkspace(workspaceId, (workspace) => ({ ...workspace, notesPath: trimmed }));
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
