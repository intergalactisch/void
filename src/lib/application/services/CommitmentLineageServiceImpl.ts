/**
 * CommitmentLineageServiceImpl - source/staleness checks for markdown todos.
 */

import { err, ok, type Result } from '$lib/core';
import type {
  CommitmentLineageService,
  CommitmentSourceInfo,
  CommitmentSourceStatus,
  CommitmentStaleCheck,
} from '$lib/ports/inbound/CommitmentLineageService';
import type { LineageService, TodoService } from '$lib/ports/inbound';
import type { Todo } from '$lib/domain/entities/Todo';
import type { TodoId } from '$lib/domain/values/TodoId';
import type { LineageSnapshot, LineVersion } from '$lib/domain/entities/Lineage';

export class CommitmentLineageServiceImpl implements CommitmentLineageService {
  constructor(
    private readonly todos: TodoService,
    private readonly lineage: LineageService,
  ) {}

  async getSourceForTodo(todoId: TodoId): Promise<Result<CommitmentSourceInfo | null, Error>> {
    const todoResult = await this.todos.getById(todoId);
    if (!todoResult.ok) return err(todoResult.error);
    const todo = todoResult.value;
    if (!todo) return ok(null);
    return this.buildSourceInfo(todo);
  }

  async getSourceForLine(notePath: string, lineIndex: number): Promise<Result<CommitmentSourceInfo | null, Error>> {
    const todosResult = await this.todos.getAll({ sourceFile: notePath });
    if (!todosResult.ok) return err(todosResult.error);
    const todo = todosResult.value.find((item) => item.lineNumber === lineIndex);
    if (!todo) return ok(null);
    return this.buildSourceInfo(todo);
  }

  async checkStaleSources(notePath?: string): Promise<Result<CommitmentStaleCheck[], Error>> {
    const todosResult = await this.todos.getAll(notePath ? { sourceFile: notePath } : undefined);
    if (!todosResult.ok) return err(todosResult.error);

    const out: CommitmentStaleCheck[] = [];
    for (const todo of todosResult.value) {
      const source = await this.buildSourceInfo(todo);
      if (!source.ok) return err(source.error);
      if (!source.value) {
        out.push({
          todo,
          notePath: todo.sourceFile,
          lineIndex: todo.lineNumber,
          status: 'unknown',
          reasons: ['No lineage source recorded for this todo'],
          sourceVersionIds: [],
          currentVersionId: null,
        });
        continue;
      }

      out.push({
        todo,
        notePath: source.value.notePath,
        lineIndex: source.value.lineIndex,
        status: source.value.status,
        reasons: source.value.reasons,
        sourceVersionIds: source.value.sourceVersions.map((version) => version.id),
        currentVersionId: source.value.currentVersion.id,
      });
    }

    return ok(out);
  }

  private async buildSourceInfo(todo: Todo): Promise<Result<CommitmentSourceInfo | null, Error>> {
    const notePath = todo.sourceFile;
    const explanation = await this.lineage.explainLine(notePath, todo.lineNumber);
    if (!explanation.ok) return err(explanation.error);
    if (!explanation.value) return ok(null);

    const snapshotResult = await this.lineage.getSnapshot(notePath);
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (!snapshot) return ok(null);

    const currentVersion = explanation.value.currentVersion;
    const sourceVersions = currentVersion.sourceVersionIds
      .map((id) => snapshot.versions[id])
      .filter((version): version is LineVersion => version !== undefined);

    const status = evaluateSourceStatus(snapshot, sourceVersions);

    return ok({
      todo,
      notePath,
      lineIndex: todo.lineNumber,
      unitId: explanation.value.unitId,
      currentVersion,
      sourceVersions,
      intent: explanation.value.intent,
      status: status.status,
      reasons: status.reasons,
    });
  }
}

function evaluateSourceStatus(
  snapshot: LineageSnapshot,
  sourceVersions: LineVersion[],
): { status: CommitmentSourceStatus; reasons: string[] } {
  if (sourceVersions.length === 0) {
    return {
      status: 'unknown',
      reasons: ['Todo line has no explicit source version link'],
    };
  }

  const reasons: string[] = [];
  let stale = false;
  let orphaned = false;

  for (const source of sourceVersions) {
    const unit = snapshot.units[source.unitId];
    if (!unit || unit.status === 'deleted') {
      orphaned = true;
      reasons.push(`Source unit ${source.unitId} was deleted`);
      continue;
    }

    if (unit.currentVersionId !== source.id) {
      stale = true;
      const current = unit.currentVersionId ? snapshot.versions[unit.currentVersionId] : null;
      reasons.push(current
        ? `Source changed from "${source.content}" to "${current.content}"`
        : `Source unit ${source.unitId} no longer has a current version`);
    }
  }

  if (orphaned) return { status: 'orphaned', reasons };
  if (stale) return { status: 'stale', reasons };
  return { status: 'current', reasons: ['Source line version is still current'] };
}
