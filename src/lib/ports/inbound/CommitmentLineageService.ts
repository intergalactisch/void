/**
 * CommitmentLineageService - connects markdown todos to line versions.
 */

import type { Result } from '$lib/core';
import type { Todo } from '$lib/domain/entities/Todo';
import type { IntentFrame, LineVersion } from '$lib/domain/entities/Lineage';
import type { TodoId } from '$lib/domain/values/TodoId';

export type CommitmentSourceStatus = 'current' | 'stale' | 'orphaned' | 'unknown';

export interface CommitmentSourceInfo {
  todo: Todo;
  notePath: string;
  lineIndex: number;
  unitId: string;
  currentVersion: LineVersion;
  sourceVersions: LineVersion[];
  intent: IntentFrame | null;
  status: CommitmentSourceStatus;
  reasons: string[];
}

export interface CommitmentStaleCheck {
  todo: Todo;
  notePath: string;
  lineIndex: number;
  status: CommitmentSourceStatus;
  reasons: string[];
  sourceVersionIds: string[];
  currentVersionId: string | null;
}

export interface CommitmentLineageService {
  getSourceForTodo(todoId: TodoId): Promise<Result<CommitmentSourceInfo | null, Error>>;

  getSourceForLine(notePath: string, lineIndex: number): Promise<Result<CommitmentSourceInfo | null, Error>>;

  checkStaleSources(notePath?: string): Promise<Result<CommitmentStaleCheck[], Error>>;
}
