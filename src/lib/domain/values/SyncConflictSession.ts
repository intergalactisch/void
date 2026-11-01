import type { SyncConflict, SyncConflictSession } from './Sync';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isConflict(value: unknown): value is SyncConflict {
  if (!record(value)) return false;
  if (typeof value.id !== 'string' || typeof value.message !== 'string') return false;
  if (typeof value.kind !== 'string') return false;
  if (!['history-diverged', 'merge-conflict', 'dirty-open-note', 'remote-note', 'sidecar',
    'auth', 'protected-branch', 'large-file', 'unknown'].includes(value.kind)) return false;
  if (!['path', 'localRef', 'remoteRef', 'baseRef'].every((key) => nullableString(value[key]))) return false;
  if (value.supported !== undefined && typeof value.supported !== 'boolean') return false;
  if (value.mergeStatus !== undefined && (typeof value.mergeStatus !== 'string' || !['pending', 'auto-merged', 'resolved', 'manual', 'unsupported'].includes(value.mergeStatus))) return false;
  if (value.resolution !== undefined && value.resolution !== null && (typeof value.resolution !== 'string' || !['keep-local', 'take-remote', 'manual', 'duplicate-local', 'use-merged'].includes(value.resolution))) return false;
  if (!['baseMarkdown', 'localMarkdown', 'remoteMarkdown', 'mergedMarkdown'].every(
    (key) => value[key] === undefined || nullableString(value[key]),
  )) return false;
  return value.hunks === undefined || (Array.isArray(value.hunks) && value.hunks.every(
    (hunk: unknown) => record(hunk) && ['id', 'base', 'local', 'remote', 'merged'].every((key) => typeof hunk[key] === 'string'),
  ));
}

/** Sidecars are external data; a generic readJson<T> does not validate them. */
export function isSyncConflictSession(value: unknown): value is SyncConflictSession {
  if (!record(value)) return false;
  return ['id', 'createdAt', 'updatedAt', 'branch', 'remoteBranch', 'recoveryBranch'].every(
    (key) => typeof value[key] === 'string',
  ) && ['baseRef', 'localRef', 'remoteRef'].every((key) => nullableString(value[key]))
    && typeof value.mergeInProgress === 'boolean'
    && typeof value.status === 'string'
    && ['merging', 'conflicted', 'resolved', 'aborted'].includes(value.status)
    && Array.isArray(value.conflicts)
    && value.conflicts.every(isConflict);
}
