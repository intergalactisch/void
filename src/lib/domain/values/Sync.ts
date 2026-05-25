/**
 * Sync domain values.
 *
 * Pure data contracts for local-first Git/GitHub sync. No adapters,
 * no browser APIs, no Tauri imports.
 */

export type SyncProvider = 'github' | 'peer';
export type SyncRepositoryProvider = Extract<SyncProvider, 'github'>;
export type SyncAuthMode = 'github-app' | 'token' | 'system-git';
export type SyncAuthProbe = 'passive' | 'keychain';
export type SyncMode = 'manual' | 'background';
export type SyncTransportState =
  | 'unconfigured'
  | 'offline'
  | 'available'
  | 'syncing'
  | 'conflicted'
  | 'auth-required'
  | 'error';
export type SyncOperation =
  | 'idle'
  | 'detecting'
  | 'authenticating'
  | 'creating-repo'
  | 'attaching'
  | 'committing'
  | 'fetching'
  | 'pulling'
  | 'pushing'
  | 'resolving'
  | 'detaching';

export type SyncAuthState =
  | 'unknown'
  | 'signed-out'
  | 'signed-in'
  | 'expired'
  | 'missing-permission';

export type SyncStatusKind =
  | 'disabled'
  | 'ready'
  | 'syncing'
  | 'pending'
  | 'conflicted'
  | 'paused'
  | 'auth-required'
  | 'error';

export type SyncRepoKind =
  | 'none'
  | 'managed'
  | 'nested'
  | 'bare'
  | 'invalid';

export type SyncConflictKind =
  | 'history-diverged'
  | 'merge-conflict'
  | 'dirty-open-note'
  | 'remote-note'
  | 'sidecar'
  | 'auth'
  | 'protected-branch'
  | 'large-file'
  | 'unknown';

export type SyncConflictResolution =
  | 'keep-local'
  | 'take-remote'
  | 'manual'
  | 'duplicate-local'
  | 'use-merged';

export type SyncConflictMergeStatus =
  | 'pending'
  | 'auto-merged'
  | 'resolved'
  | 'manual'
  | 'unsupported';

export type SyncConflictSessionStatus =
  | 'merging'
  | 'conflicted'
  | 'resolved'
  | 'aborted';

export interface SyncRepositoryRef {
  provider: SyncRepositoryProvider;
  owner: string;
  name: string;
  fullName: string;
  remoteUrl: string;
  branch: string;
  htmlUrl?: string;
}

export interface SyncTransportStatus {
  provider: SyncProvider;
  state: SyncTransportState;
  label: string;
  remoteId: string | null;
  lastSyncAt: string | null;
  pendingChanges: number;
  message: string | null;
}

export interface SyncArtifactPolicy {
  includeMarkdown: boolean;
  includeVoidHistory: boolean;
  includePatterns: string[];
  excludePatterns: string[];
}

export interface SyncSettings {
  enabled: boolean;
  autoSync: boolean;
  authMode: SyncAuthMode;
  repository: SyncRepositoryRef | null;
  artifactPolicy: SyncArtifactPolicy;
  lastSyncAt: string | null;
  paused: boolean;
}

export type SyncConfig = SyncSettings;

export interface SyncConflict {
  id: string;
  kind: SyncConflictKind;
  source?: SyncProvider;
  path: string | null;
  message: string;
  localRef: string | null;
  remoteRef: string | null;
  baseRef: string | null;
  supported?: boolean;
  mergeStatus?: SyncConflictMergeStatus;
  resolution?: SyncConflictResolution | null;
  baseMarkdown?: string | null;
  localMarkdown?: string | null;
  remoteMarkdown?: string | null;
  mergedMarkdown?: string | null;
  hunks?: SyncConflictHunk[];
}

export interface SyncConflictHunk {
  id: string;
  base: string;
  local: string;
  remote: string;
  merged: string;
}

export interface SyncConflictPreview {
  conflictId: string;
  path: string;
  baseMarkdown: string | null;
  localMarkdown: string | null;
  remoteMarkdown: string | null;
  mergedMarkdown: string;
  hunks: SyncConflictHunk[];
  mergeClean: boolean;
  supported: boolean;
}

export interface SyncConflictSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  branch: string;
  remoteBranch: string;
  recoveryBranch: string;
  baseRef: string | null;
  localRef: string | null;
  remoteRef: string | null;
  mergeInProgress: boolean;
  status: SyncConflictSessionStatus;
  conflicts: SyncConflict[];
}

export interface SyncStatus {
  kind: SyncStatusKind;
  operation: SyncOperation;
  auth: SyncAuthState;
  repoKind: SyncRepoKind;
  branch: string | null;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
  changedFiles: number;
  conflicts: SyncConflict[];
  lastSyncAt: string | null;
  message: string | null;
}

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
  conflicted: boolean;
}

export interface GitRepositoryState {
  repoKind: SyncRepoKind;
  root: string | null;
  branch: string | null;
  remoteUrl: string | null;
  upstream: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  changedFiles: GitFileChange[];
  conflicts: SyncConflict[];
  lastCommit: string | null;
  message: string | null;
}

export interface GitHubUser {
  login: string;
  name: string | null;
}

export interface GitHubCreatedRepository {
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
}

export interface GitHubDeviceAuthRequest {
  clientId: string;
  scope: string;
}

export interface GitHubDeviceAuthStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
  lastCommit: string | null;
  lastCommitSubject: string | null;
}

export interface GitHubRepoSummary {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  cloneUrl: string;
  sshUrl: string;
  htmlUrl: string;
  pushedAt: string | null;
  permissionsPush: boolean;
  voidReady?: boolean;
  voidReadyReason?: string | null;
  voidManifest?: VoidRepoManifest | null;
}

export interface GitHubBranchSummary {
  name: string;
  isDefault: boolean;
  protected: boolean;
  lastCommit: string | null;
}

export interface GitHubNameAvailability {
  available: boolean;
  reason: string | null;
}

export interface VoidRepoManifest {
  app: 'void';
  kind: 'void-workspace';
  schemaVersion: 1;
  workspaceId: string;
  createdAt: string;
  artifactPolicyVersion: 1;
}

export interface GitHubVoidReadyProbe {
  ready: boolean;
  manifest: VoidRepoManifest | null;
  reason: string | null;
}

/**
 * GitHub OAuth scope Void requests during device flow + PAT validation.
 *
 * `repo` is the minimum public+private repo permission. We do NOT request
 * organisation scopes — sync is per-repository, owned by the signed-in user.
 */
export const VOID_GITHUB_SCOPE = 'repo';
export const VOID_REPO_MANIFEST_PATH = '.void/repo.json';
export const VOID_WORKSPACE_MANIFEST_PATH = '.void/workspace.json';
export const VOID_REPO_SCHEMA_VERSION = 1;
export const VOID_REPO_ARTIFACT_POLICY_VERSION = 1;

export const DEFAULT_SYNC_ARTIFACT_POLICY: SyncArtifactPolicy = {
  includeMarkdown: true,
  includeVoidHistory: true,
  includePatterns: [
    '*.md',
    '**/*.md',
    '.trash/**',
    '.void/provenance/**',
    '.void/lineage/**',
    '.void/conversations/**',
    '.void/branches/**',
    '.void/sessions/**',
    '.void/agents/**',
    '.void/devices/**',
    '.void/relay/**',
    VOID_REPO_MANIFEST_PATH,
    VOID_WORKSPACE_MANIFEST_PATH,
  ],
  excludePatterns: [
    '.void/index/**',
    '.void/insights/pending.json',
    '.void/sync/**',
    '.DS_Store',
  ],
};

export function createVoidRepoManifest(params: {
  workspaceId: string;
  createdAt?: string;
}): VoidRepoManifest {
  return {
    app: 'void',
    kind: 'void-workspace',
    schemaVersion: VOID_REPO_SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    createdAt: params.createdAt ?? new Date().toISOString(),
    artifactPolicyVersion: VOID_REPO_ARTIFACT_POLICY_VERSION,
  };
}

export function validateVoidRepoManifest(input: unknown): GitHubVoidReadyProbe {
  if (!input || typeof input !== 'object') {
    return { ready: false, manifest: null, reason: 'Missing Void repo manifest' };
  }
  const value = input as Partial<VoidRepoManifest>;
  if (value.app !== 'void') {
    return { ready: false, manifest: null, reason: 'Manifest app must be "void"' };
  }
  if (value.kind !== 'void-workspace') {
    return { ready: false, manifest: null, reason: 'Manifest kind must be "void-workspace"' };
  }
  if (value.schemaVersion !== VOID_REPO_SCHEMA_VERSION) {
    return { ready: false, manifest: null, reason: `Unsupported Void repo schema version: ${String(value.schemaVersion)}` };
  }
  if (value.artifactPolicyVersion !== VOID_REPO_ARTIFACT_POLICY_VERSION) {
    return { ready: false, manifest: null, reason: `Unsupported artifact policy version: ${String(value.artifactPolicyVersion)}` };
  }
  if (typeof value.workspaceId !== 'string' || !value.workspaceId.trim()) {
    return { ready: false, manifest: null, reason: 'Manifest workspaceId is required' };
  }
  if (typeof value.createdAt !== 'string' || !value.createdAt.trim()) {
    return { ready: false, manifest: null, reason: 'Manifest createdAt is required' };
  }
  return {
    ready: true,
    manifest: {
      app: 'void',
      kind: 'void-workspace',
      schemaVersion: VOID_REPO_SCHEMA_VERSION,
      workspaceId: value.workspaceId.trim(),
      createdAt: value.createdAt,
      artifactPolicyVersion: VOID_REPO_ARTIFACT_POLICY_VERSION,
    },
    reason: null,
  };
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  autoSync: true,
  authMode: 'github-app',
  repository: null,
  artifactPolicy: DEFAULT_SYNC_ARTIFACT_POLICY,
  lastSyncAt: null,
  paused: false,
};

export const EMPTY_SYNC_STATUS: SyncStatus = {
  kind: 'disabled',
  operation: 'idle',
  auth: 'unknown',
  repoKind: 'none',
  branch: null,
  remoteUrl: null,
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  conflicts: [],
  lastSyncAt: null,
  message: null,
};

export function validateSyncSettings(input: unknown): SyncSettings {
  if (!input || typeof input !== 'object') {
    return cloneDefaultSyncSettings();
  }

  const value = input as Partial<SyncSettings>;
  return {
    enabled: value.enabled === true,
    autoSync: value.autoSync !== false,
    authMode: isSyncAuthMode(value.authMode) ? value.authMode : DEFAULT_SYNC_SETTINGS.authMode,
    repository: normalizeRepositoryRef(value.repository),
    artifactPolicy: normalizeArtifactPolicy(value.artifactPolicy),
    lastSyncAt: typeof value.lastSyncAt === 'string' ? value.lastSyncAt : null,
    paused: value.paused === true,
  };
}

export function cloneDefaultSyncSettings(): SyncSettings {
  return {
    ...DEFAULT_SYNC_SETTINGS,
    artifactPolicy: {
      ...DEFAULT_SYNC_ARTIFACT_POLICY,
      includePatterns: [...DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns],
      excludePatterns: [...DEFAULT_SYNC_ARTIFACT_POLICY.excludePatterns],
    },
  };
}

export function parseGitHubRemote(remoteUrl: string, branch = 'main'): SyncRepositoryRef | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  let owner = '';
  let name = '';

  if (/^https:\/\/github\.com\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.toLowerCase() !== 'github.com') return null;
      if (url.search || url.hash || url.username || url.password) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 2) return null;
      owner = parts[0] ?? '';
      name = parts[1] ?? '';
    } catch {
      return null;
    }
  } else {
    const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/i);
    if (!ssh) return null;
    owner = ssh[1] ?? '';
    name = ssh[2] ?? '';
  }

  if (name.endsWith('.git')) {
    name = name.slice(0, -4);
  }
  if (!owner || !name) return null;
  if (owner.includes('/') || name.includes('/') || owner === '.' || name === '.') return null;

  return {
    provider: 'github',
    owner,
    name,
    fullName: `${owner}/${name}`,
    remoteUrl: trimmed,
    branch,
    htmlUrl: `https://github.com/${owner}/${name}`,
  };
}

export function syncStatusFromRepo(params: {
  settings: SyncSettings;
  repo: GitRepositoryState;
  auth: SyncAuthState;
  operation?: SyncOperation;
  message?: string | null;
}): SyncStatus {
  const { settings, repo, auth } = params;
  const operation = params.operation ?? 'idle';
  const hasConflicts = repo.conflicts.length > 0;
  const changedFiles = repo.changedFiles.length;

  let kind: SyncStatusKind = 'ready';
  if (!settings.enabled) kind = 'disabled';
  else if (operation !== 'idle') kind = 'syncing';
  else if (auth === 'signed-out' || auth === 'expired' || auth === 'missing-permission') kind = 'auth-required';
  else if (settings.paused) kind = 'paused';
  else if (hasConflicts) kind = 'conflicted';
  else if (repo.repoKind !== 'managed') kind = repo.repoKind === 'none' ? 'disabled' : 'error';
  else if (repo.ahead > 0 || repo.behind > 0 || changedFiles > 0) kind = 'pending';

  return {
    kind,
    operation,
    auth,
    repoKind: repo.repoKind,
    branch: repo.branch,
    remoteUrl: repo.remoteUrl,
    ahead: repo.ahead,
    behind: repo.behind,
    changedFiles,
    conflicts: [...repo.conflicts],
    lastSyncAt: settings.lastSyncAt,
    message: params.message ?? repo.message,
  };
}

function normalizeRepositoryRef(value: unknown): SyncRepositoryRef | null {
  if (!value || typeof value !== 'object') return null;
  const repo = value as Partial<SyncRepositoryRef>;
  if (
    repo.provider !== 'github' ||
    typeof repo.owner !== 'string' ||
    typeof repo.name !== 'string' ||
    typeof repo.remoteUrl !== 'string'
  ) {
    return null;
  }

  const fullName = typeof repo.fullName === 'string' && repo.fullName
    ? repo.fullName
    : `${repo.owner}/${repo.name}`;

  return {
    provider: 'github',
    owner: repo.owner,
    name: repo.name,
    fullName,
    remoteUrl: repo.remoteUrl,
    branch: typeof repo.branch === 'string' && repo.branch ? repo.branch : 'main',
    ...(typeof repo.htmlUrl === 'string' && repo.htmlUrl ? { htmlUrl: repo.htmlUrl } : {}),
  };
}

function normalizeArtifactPolicy(value: unknown): SyncArtifactPolicy {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_SYNC_ARTIFACT_POLICY,
      includePatterns: [...DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns],
      excludePatterns: [...DEFAULT_SYNC_ARTIFACT_POLICY.excludePatterns],
    };
  }

  const policy = value as Partial<SyncArtifactPolicy>;
  return {
    includeMarkdown: policy.includeMarkdown !== false,
    includeVoidHistory: policy.includeVoidHistory !== false,
    includePatterns: normalizeStringArray(policy.includePatterns, DEFAULT_SYNC_ARTIFACT_POLICY.includePatterns),
    excludePatterns: normalizeStringArray(policy.excludePatterns, DEFAULT_SYNC_ARTIFACT_POLICY.excludePatterns),
  };
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return out.length > 0 ? out : [...fallback];
}

function isSyncAuthMode(value: unknown): value is SyncAuthMode {
  return value === 'github-app' || value === 'token' || value === 'system-git';
}
