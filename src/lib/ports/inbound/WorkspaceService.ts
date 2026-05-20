/**
 * WorkspaceService - inbound port for multi-workspace management.
 */

import type { Result } from '$lib/core';
import type { Workspace } from '$lib/domain';

export interface WorkspaceSwitchBlocker {
  kind: 'dirty-editor' | 'editor-conflict' | 'syncing' | 'sync-conflict' | 'missing-workspace';
  message: string;
  paths: string[];
}

export interface WorkspaceSwitchResult {
  workspace: Workspace;
  requiresReload: boolean;
}

export interface CreateWorkspaceParams {
  name: string;
  notesPath: string;
}

export interface WorkspaceService {
  list(): Workspace[];
  active(): Workspace;
  create(params: CreateWorkspaceParams): Promise<Result<Workspace, Error>>;
  rename(workspaceId: string, name: string): Promise<Result<Workspace, Error>>;
  updateNotesPath(workspaceId: string, notesPath: string): Promise<Result<Workspace, Error>>;
  remove(workspaceId: string): Promise<Result<Workspace[], Error>>;
  canSwitch(workspaceId: string): Promise<Result<WorkspaceSwitchBlocker[], Error>>;
  switchTo(workspaceId: string): Promise<Result<WorkspaceSwitchResult, Error>>;
}
