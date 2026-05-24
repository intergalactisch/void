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
  folderAccess?: WorkspaceFolderAccess;
}

export interface WorkspaceFolderAccess {
  path: string;
  bookmarkData: string;
  grantedAt: string;
  stale?: boolean;
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
export const MANAGED_WORKSPACE_ROOT = '~/Documents/Void';
export const MANAGED_DEFAULT_WORKSPACE_NAME = 'Default';
export const MANAGED_DEFAULT_WORKSPACE_PATH = `${MANAGED_WORKSPACE_ROOT}/${MANAGED_DEFAULT_WORKSPACE_NAME}`;

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
  const folderAccess = normalizeWorkspaceFolderAccess(value.folderAccess);
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
    ...(folderAccess ? { folderAccess } : {}),
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
    ...(workspace.folderAccess ? { folderAccess: { ...workspace.folderAccess } } : {}),
  };
}

function normalizeWorkspaceFolderAccess(value: unknown): WorkspaceFolderAccess | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<WorkspaceFolderAccess>;
  if (
    typeof candidate.path !== 'string' ||
    !candidate.path.trim() ||
    typeof candidate.bookmarkData !== 'string'
  ) {
    return undefined;
  }
  return {
    path: candidate.path.trim(),
    bookmarkData: candidate.bookmarkData,
    grantedAt: typeof candidate.grantedAt === 'string' && candidate.grantedAt
      ? candidate.grantedAt
      : new Date(0).toISOString(),
    stale: candidate.stale === true,
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

export function sanitizeWorkspaceFolderName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[<>:"|?*\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
  return normalized || 'Workspace';
}

export function isAbsoluteOrTildePath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.startsWith('~/')
    || trimmed.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(trimmed);
}

export function generateManagedWorkspacePath(name: string, existingPaths: string[] = []): string {
  const folderName = sanitizeWorkspaceFolderName(name);
  const taken = new Set(existingPaths.map(managedPathKey).filter(Boolean));
  let candidate = folderName;
  let suffix = 2;
  while (taken.has(managedPathKey(`${MANAGED_WORKSPACE_ROOT}/${candidate}`))) {
    candidate = `${folderName} ${suffix}`;
    suffix += 1;
  }
  return `${MANAGED_WORKSPACE_ROOT}/${candidate}`;
}

export function isLegacyDefaultWorkspacePath(path: string): boolean {
  const normalized = comparablePath(path);
  return normalized === '~/documents/void'
    || normalized.endsWith('/documents/void');
}

export function isManagedDefaultWorkspacePath(path: string): boolean {
  const normalized = comparablePath(path);
  return normalized === '~/documents/void/default'
    || normalized.endsWith('/documents/void/default');
}

export function workspacePathEquals(a: string, b: string): boolean {
  return comparablePath(a) === comparablePath(b)
    || managedPathKey(a) === managedPathKey(b);
}

export function needsManagedDefaultWorkspaceMigration(workspaces: Workspace[], activeWorkspaceId: string | null): boolean {
  const active = activeWorkspaceFrom(workspaces, activeWorkspaceId);
  return isLegacyDefaultWorkspacePath(active.notesPath)
    && !isManagedDefaultWorkspacePath(active.notesPath);
}

function normalizeWorkspaceName(value: unknown, notesPath: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const parts = notesPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) || DEFAULT_WORKSPACE_NAME;
}

function managedPathKey(path: string): string {
  const normalized = comparablePath(path);
  const tildePrefix = '~/documents/void/';
  if (normalized.startsWith(tildePrefix)) {
    return normalized.slice(tildePrefix.length);
  }
  const absoluteMarker = '/documents/void/';
  const absoluteIndex = normalized.lastIndexOf(absoluteMarker);
  if (absoluteIndex >= 0) {
    return normalized.slice(absoluteIndex + absoluteMarker.length);
  }
  return normalized;
}

function comparablePath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
  return normalized.toLowerCase();
}
