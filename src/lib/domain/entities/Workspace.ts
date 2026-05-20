/**
 * Workspace entity - A local Void notes root plus its sync configuration.
 *
 * Pure domain data; infrastructure decides how paths and credentials are used.
 */

import {
  cloneDefaultSyncSettings,
  validateSyncSettings,
  type SyncSettings,
} from '../values/Sync';

export interface Workspace {
  id: string;
  name: string;
  notesPath: string;
  createdAt: string;
  lastOpenedAt: string;
  sync: SyncSettings;
}

export interface GitHubAccountRef {
  provider: 'github';
  login: string;
  name: string | null;
  lastAuthenticatedAt: string | null;
}

export interface CreateWorkspaceInput {
  name: string;
  notesPath: string;
  now?: Date;
}

export const DEFAULT_WORKSPACE_NAME = 'Void';

export function createWorkspace(input: CreateWorkspaceInput): Workspace {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: createWorkspaceId(input.name, input.notesPath, now),
    name: normalizeWorkspaceName(input.name, input.notesPath),
    notesPath: input.notesPath.trim() || '~/Documents/void',
    createdAt: now,
    lastOpenedAt: now,
    sync: cloneDefaultSyncSettings(),
  };
}

export function validateWorkspace(input: unknown, fallback: Workspace): Workspace {
  if (!input || typeof input !== 'object') return cloneWorkspace(fallback);
  const value = input as Partial<Workspace>;
  const notesPath = typeof value.notesPath === 'string' && value.notesPath.trim()
    ? value.notesPath
    : fallback.notesPath;
  return {
    id: typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : fallback.id,
    name: normalizeWorkspaceName(value.name, notesPath),
    notesPath,
    createdAt: typeof value.createdAt === 'string' && value.createdAt
      ? value.createdAt
      : fallback.createdAt,
    lastOpenedAt: typeof value.lastOpenedAt === 'string' && value.lastOpenedAt
      ? value.lastOpenedAt
      : fallback.lastOpenedAt,
    sync: validateSyncSettings(value.sync ?? fallback.sync),
  };
}

export function cloneWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    sync: {
      ...workspace.sync,
      repository: workspace.sync.repository ? { ...workspace.sync.repository } : null,
      artifactPolicy: {
        ...workspace.sync.artifactPolicy,
        includePatterns: [...workspace.sync.artifactPolicy.includePatterns],
        excludePatterns: [...workspace.sync.artifactPolicy.excludePatterns],
      },
    },
  };
}

export function activeWorkspaceFrom(workspaces: Workspace[], activeWorkspaceId: string | null): Workspace {
  return workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    ?? workspaces[0]
    ?? createWorkspace({ name: DEFAULT_WORKSPACE_NAME, notesPath: '~/Documents/void' });
}

export function createWorkspaceId(name: string, notesPath: string, seed = ''): string {
  const source = `${name.trim()}|${notesPath.trim()}|${seed}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = Math.abs(hash >>> 0).toString(36);
  return `workspace-${suffix}`;
}

function normalizeWorkspaceName(value: unknown, notesPath: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const parts = notesPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) || DEFAULT_WORKSPACE_NAME;
}
