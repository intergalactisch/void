/**
 * MemoryAgentRunStorageAdapter - in-memory agent run persistence for tests/dev.
 *
 * Mirrors the per-worker JSONL split that VoidAgentRunStorageAdapter uses:
 * worker messages are stored separately from the run snapshot and merged
 * back in on read.
 */

import { ok, type Result } from '$lib/core';
import {
  isActiveAgentRunStatus,
  normalizeAgentRun,
  type AgentRun,
  type AgentRunEvent,
  type AgentWorkerMessage,
} from '$lib/domain/entities/AgentRun';
import type {
  AgentRunStoragePort,
  AgentRunSummary,
  AgentRunSummaryQuery,
} from '$lib/ports/outbound/AgentRunStoragePort';
import {
  clampPageLimit,
  coerceDate,
  cursorToOffset,
  nextOffsetCursor,
  type PagedResult,
} from '$lib/ports/outbound/PagedQuery';

export class MemoryAgentRunStorageAdapter implements AgentRunStoragePort {
  private readonly runs = new Map<string, AgentRun>();
  private readonly events = new Map<string, AgentRunEvent[]>();
  private readonly workerMessages = new Map<string, AgentWorkerMessage[]>();

  async save(run: AgentRun): Promise<Result<void, Error>> {
    const snapshot = structuredClone(normalizeAgentRun({ ...run, workerMessages: [] }));
    this.runs.set(run.id, snapshot);
    if (!this.events.has(run.id)) {
      this.events.set(run.id, structuredClone(run.events ?? []));
    }
    if (!this.workerMessages.has(run.id) && (run.workerMessages?.length ?? 0) > 0) {
      this.workerMessages.set(run.id, structuredClone(run.workerMessages));
    }
    return ok(undefined);
  }

  async get(runId: string): Promise<Result<AgentRun | null, Error>> {
    const run = this.runs.get(runId);
    if (!run) return ok(null);
    const copy = normalizeAgentRun(structuredClone(run));
    copy.events = structuredClone(this.events.get(runId) ?? copy.events ?? []);
    copy.workerMessages = structuredClone(this.workerMessages.get(runId) ?? []);
    return ok(copy);
  }

  async list(): Promise<Result<AgentRun[], Error>> {
    const runs = [...this.runs.values()]
      .map((run) => {
        const copy = normalizeAgentRun(structuredClone(run));
        copy.workerMessages = structuredClone(this.workerMessages.get(run.id) ?? []);
        copy.events = structuredClone(this.events.get(run.id) ?? copy.events ?? []);
        return copy;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return ok(runs);
  }

  async listSummaries(query: AgentRunSummaryQuery = {}): Promise<Result<PagedResult<AgentRunSummary>, Error>> {
    const limit = clampPageLimit(query.limit);
    const offset = cursorToOffset(query.cursor);
    const dateFrom = coerceDate(query.dateFrom);
    const dateTo = coerceDate(query.dateTo);
    const needle = query.query?.trim().toLocaleLowerCase() ?? '';
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const summaries = [...this.runs.values()]
      .map((run) => this.toSummary(normalizeAgentRun(structuredClone(run))))
      .filter((summary) => this.matchesSummary(summary, query, needle, dateFrom, dateTo))
      .sort((a, b) => {
        const aValue = sortBy === 'createdAt' ? a.createdAt : a.updatedAt;
        const bValue = sortBy === 'createdAt' ? b.createdAt : b.updatedAt;
        return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      });

    return ok({
      items: summaries.slice(offset, offset + limit),
      nextCursor: nextOffsetCursor(offset, limit, summaries.length),
      total: summaries.length,
    });
  }

  async appendEvent(runId: string, event: AgentRunEvent): Promise<Result<void, Error>> {
    const events = this.events.get(runId) ?? [];
    if (events.some((existing) => existing.id === event.id)) return ok(undefined);
    events.push(structuredClone(event));
    this.events.set(runId, events);

    const run = this.runs.get(runId);
    if (run) {
      run.events = structuredClone(events);
      run.updatedAt = event.createdAt;
      this.runs.set(runId, run);
    }

    return ok(undefined);
  }

  async listEvents(runId: string, fromEventId?: string): Promise<Result<AgentRunEvent[], Error>> {
    const events = structuredClone(this.events.get(runId) ?? []);
    if (!fromEventId) return ok(events);

    const index = events.findIndex((event) => event.id === fromEventId);
    return ok(index >= 0 ? events.slice(index + 1) : events);
  }

  async appendWorkerMessage(runId: string, message: AgentWorkerMessage): Promise<Result<void, Error>> {
    const messages = this.workerMessages.get(runId) ?? [];
    if (messages.some((existing) => existing.id === message.id)) return ok(undefined);
    messages.push(structuredClone(message));
    this.workerMessages.set(runId, messages);
    return ok(undefined);
  }

  async listWorkerMessages(runId: string): Promise<Result<AgentWorkerMessage[], Error>> {
    const messages = structuredClone(this.workerMessages.get(runId) ?? []);
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return ok(messages);
  }

  async delete(runId: string): Promise<Result<void, Error>> {
    this.runs.delete(runId);
    this.events.delete(runId);
    this.workerMessages.delete(runId);
    return ok(undefined);
  }

  private toSummary(run: AgentRun): AgentRunSummary {
    const artifactTypes = Array.from(new Set(run.artifacts.map((artifact) => artifact.type)));
    const lastEvent = (this.events.get(run.id) ?? run.events ?? []).at(-1);
    return {
      id: run.id,
      prompt: run.prompt,
      status: run.status,
      orchestrationMode: run.orchestrationMode,
      conversationId: run.conversationId,
      sourceMessageId: run.sourceMessageId ?? null,
      workerCount: run.workers.length,
      runningWorkerCount: run.workers.filter((worker) => worker.status === 'running').length,
      completedWorkerCount: run.workers.filter((worker) => worker.status === 'completed').length,
      taskCount: run.tasks.length,
      completedTaskCount: run.tasks.filter((task) => task.status === 'completed').length,
      artifactCount: run.artifacts.length,
      artifactTypes,
      lastEventPreview: lastEvent?.message ?? null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
    };
  }

  private matchesSummary(
    summary: AgentRunSummary,
    query: AgentRunSummaryQuery,
    needle: string,
    dateFrom: Date | null,
    dateTo: Date | null,
  ): boolean {
    if (query.status && query.status !== 'all') {
      if (query.status === 'active' && !isActiveAgentRunStatus(summary.status)) return false;
      if (query.status === 'terminal' && isActiveAgentRunStatus(summary.status)) return false;
      if (query.status !== 'active' && query.status !== 'terminal' && summary.status !== query.status) return false;
    }
    if (query.orchestrationMode && query.orchestrationMode !== 'all' && summary.orchestrationMode !== query.orchestrationMode) {
      return false;
    }
    if (query.conversationId !== undefined && summary.conversationId !== query.conversationId) {
      return false;
    }
    const updatedAt = new Date(summary.updatedAt);
    if (dateFrom && updatedAt < dateFrom) return false;
    if (dateTo && updatedAt > dateTo) return false;
    if (!needle) return true;
    return [
      summary.id,
      summary.prompt,
      summary.conversationId ?? '',
      summary.lastEventPreview ?? '',
      summary.status,
      summary.orchestrationMode,
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  }
}
