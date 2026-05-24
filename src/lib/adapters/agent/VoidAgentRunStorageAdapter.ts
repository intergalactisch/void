/**
 * VoidAgentRunStorageAdapter - persists agent runs in .void/agents/.
 *
 * Layout:
 *   agents/{runId}.json                         - run shell (workers, tasks, plan, merge, ...)
 *   agents/{runId}.events.json                  - run-level event stream
 *   agents/{runId}/{workerId}.jsonl             - per-worker append-only message log
 *   agents/{runId}/_orchestrator.jsonl          - run-level messages without a workerId
 *
 * Worker messages used to live inline in {runId}.json. That array grows
 * unboundedly with every follow-up turn, so we stripped it and moved the
 * authoritative log to per-worker JSONL files. Legacy runs without a
 * subdirectory still load: their inline workerMessages array is merged in
 * on read.
 */

import { ok, err, type Result } from '$lib/core';
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
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';

const ORCHESTRATOR_LOG = '_orchestrator';
const COMMAND_CENTER_INDEX_DIR = 'index/command-center';
const RUN_INDEX_FILE = `${COMMAND_CENTER_INDEX_DIR}/runs.json`;

interface AgentRunSummaryIndex {
  version: 1;
  summaries: AgentRunSummary[];
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isAgentWorkerMessage(value: unknown): value is AgentWorkerMessage {
  return !!value && typeof value === 'object'
    && typeof (value as AgentWorkerMessage).id === 'string'
    && typeof (value as AgentWorkerMessage).runId === 'string'
    && typeof (value as AgentWorkerMessage).type === 'string'
    && typeof (value as AgentWorkerMessage).createdAt === 'string';
}

export class VoidAgentRunStorageAdapter implements AgentRunStoragePort {
  private readonly eventWriteQueues = new Map<string, Promise<Result<void, Error>>>();
  private readonly messageWriteQueues = new Map<string, Promise<Result<void, Error>>>();

  constructor(
    private readonly voidStorage: VoidStoragePort,
    private readonly notesPath: string
  ) {}

  async save(run: AgentRun): Promise<Result<void, Error>> {
    const events = run.events ?? [];
    const workerMessages = run.workerMessages ?? [];

    // Snapshot without workerMessages — JSONL is authoritative going forward.
    const snapshot: AgentRun = normalizeAgentRun({ ...run, events, workerMessages: [] });
    const saved = await this.voidStorage.writeJson(this.notesPath, this.pathFor(run.id), snapshot);
    if (!saved.ok) return saved;

    // First-save bulk seed for events.
    const existingEvents = await this.listEvents(run.id);
    if (existingEvents.ok && existingEvents.value.length === 0 && events.length > 0) {
      const writtenEvents = await this.voidStorage.writeJson(this.notesPath, this.eventsPathFor(run.id), events);
      if (!writtenEvents.ok) return writtenEvents;
    }

    // First-save bulk seed for worker messages (no JSONL files yet).
    const existingMessages = await this.listWorkerMessages(run.id);
    if (existingMessages.ok && existingMessages.value.length === 0 && workerMessages.length > 0) {
      for (const message of workerMessages) {
        const appended = await this.appendWorkerMessage(run.id, message);
        if (!appended.ok) return appended;
      }
    }

    await this.upsertIndexedSummary(normalizeAgentRun({ ...snapshot, events }));
    return ok(undefined);
  }

  async get(runId: string): Promise<Result<AgentRun | null, Error>> {
    const run = await this.voidStorage.readJson<AgentRun>(this.notesPath, this.pathFor(runId));
    if (!run.ok || !run.value) return run;

    const events = await this.listEvents(runId);
    if (!events.ok) return err(events.error);

    const messages = await this.mergedWorkerMessages(runId, run.value.workerMessages ?? []);
    if (!messages.ok) return err(messages.error);

    return ok(normalizeAgentRun({
      ...run.value,
      events: events.value,
      workerMessages: messages.value,
    }));
  }

  async list(): Promise<Result<AgentRun[], Error>> {
    const entries = await this.voidStorage.listDir(this.notesPath, 'agents');
    if (!entries.ok) return entries;

    const runs: AgentRun[] = [];
    for (const entry of entries.value) {
      if (!entry.endsWith('.json')) continue;
      if (entry.endsWith('.events.json')) continue;
      const read = await this.voidStorage.readJson<AgentRun>(this.notesPath, `agents/${entry}`);
      if (!read.ok) return err(read.error);
      if (!read.value) continue;

      const events = await this.listEvents(read.value.id);
      const messages = await this.mergedWorkerMessages(read.value.id, read.value.workerMessages ?? []);
      if (!messages.ok) return err(messages.error);

      runs.push(normalizeAgentRun({
        ...read.value,
        events: events.ok ? events.value : (read.value.events ?? []),
        workerMessages: messages.value,
      }));
    }

    runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

    const index = await this.readSummaryIndex();
    if (!index.ok) return err(index.error);
    const summaries = index.value.filter((summary) =>
      this.matchesSummary(summary, query, needle, dateFrom, dateTo)
    );

    summaries.sort((a, b) => {
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
    const previous = this.eventWriteQueues.get(runId) ?? Promise.resolve(ok(undefined));
    const next = previous.then(async () => {
      const events = await this.listEvents(runId);
      if (!events.ok) return err(events.error);
      if (events.value.some((existing) => existing.id === event.id)) {
        return ok(undefined);
      }
      const appended = await this.voidStorage.appendJsonl(this.notesPath, this.eventsJsonlPathFor(runId), event);
      if (appended.ok) {
        await this.touchIndexedSummaryEvent(runId, event);
      }
      return appended;
    });
    this.eventWriteQueues.set(runId, next);
    const result = await next;
    if (this.eventWriteQueues.get(runId) === next) {
      this.eventWriteQueues.delete(runId);
    }
    return result;
  }

  async listEvents(runId: string, fromEventId?: string): Promise<Result<AgentRunEvent[], Error>> {
    const legacy = await this.voidStorage.readJson<AgentRunEvent[]>(this.notesPath, this.eventsPathFor(runId));
    if (!legacy.ok) return err(legacy.error);
    const appended = await this.voidStorage.readJsonl<AgentRunEvent>(this.notesPath, this.eventsJsonlPathFor(runId));
    if (!appended.ok) return err(appended.error);

    const seen = new Set<string>();
    const events: AgentRunEvent[] = [];
    for (const event of [...(Array.isArray(legacy.value) ? legacy.value : []), ...appended.value]) {
      if (!event?.id || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
    events.sort((a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt));
    if (!fromEventId) return ok(events);

    const index = events.findIndex((event) => event.id === fromEventId);
    return ok(index >= 0 ? events.slice(index + 1) : events);
  }

  async appendWorkerMessage(runId: string, message: AgentWorkerMessage): Promise<Result<void, Error>> {
    const queueKey = runId;
    const previous = this.messageWriteQueues.get(queueKey) ?? Promise.resolve(ok(undefined));
    const next = previous.then(async () =>
      this.voidStorage.appendJsonl(
        this.notesPath,
        this.workerLogPathFor(runId, message.workerId),
        message,
      )
    );
    this.messageWriteQueues.set(queueKey, next);
    const result = await next;
    if (this.messageWriteQueues.get(queueKey) === next) {
      this.messageWriteQueues.delete(queueKey);
    }
    return result;
  }

  async listWorkerMessages(runId: string): Promise<Result<AgentWorkerMessage[], Error>> {
    const dir = await this.voidStorage.listDir(this.notesPath, `agents/${safeId(runId)}`);
    if (!dir.ok) return err(dir.error);

    const messages: AgentWorkerMessage[] = [];
    for (const entry of dir.value) {
      if (!entry.endsWith('.jsonl')) continue;
      const read = await this.voidStorage.readJsonl<AgentWorkerMessage>(
        this.notesPath,
        `agents/${safeId(runId)}/${entry}`,
      );
      if (!read.ok) return err(read.error);
      for (const item of read.value) {
        if (isAgentWorkerMessage(item)) messages.push(item);
      }
    }

    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return ok(messages);
  }

  async delete(_runId: string): Promise<Result<void, Error>> {
    return err(new Error('Deleting agent runs is not supported yet'));
  }

  private async mergedWorkerMessages(
    runId: string,
    legacy: AgentWorkerMessage[],
  ): Promise<Result<AgentWorkerMessage[], Error>> {
    const fromJsonl = await this.listWorkerMessages(runId);
    if (!fromJsonl.ok) return err(fromJsonl.error);

    const seen = new Set<string>();
    const merged: AgentWorkerMessage[] = [];
    for (const message of [...fromJsonl.value, ...legacy]) {
      if (!message?.id || seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
    merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return ok(merged);
  }

  private pathFor(runId: string): string {
    return `agents/${safeId(runId)}.json`;
  }

  private eventsPathFor(runId: string): string {
    return `agents/${safeId(runId)}.events.json`;
  }

  private eventsJsonlPathFor(runId: string): string {
    return `agents/${safeId(runId)}.events.jsonl`;
  }

  private workerLogPathFor(runId: string, workerId: string | undefined): string {
    const worker = workerId ? safeId(workerId) : ORCHESTRATOR_LOG;
    return `agents/${safeId(runId)}/${worker}.jsonl`;
  }

  private async readSummaryIndex(): Promise<Result<AgentRunSummary[], Error>> {
    const read = await this.voidStorage.readJson<AgentRunSummaryIndex>(this.notesPath, RUN_INDEX_FILE);
    if (read.ok && read.value?.version === 1 && Array.isArray(read.value.summaries)) {
      return ok(read.value.summaries);
    }
    if (!read.ok) return err(read.error);
    return this.rebuildSummaryIndex();
  }

  private async writeSummaryIndex(summaries: AgentRunSummary[]): Promise<Result<void, Error>> {
    return this.voidStorage.writeJson(this.notesPath, RUN_INDEX_FILE, { version: 1, summaries });
  }

  private async rebuildSummaryIndex(): Promise<Result<AgentRunSummary[], Error>> {
    const entries = await this.voidStorage.listDir(this.notesPath, 'agents');
    if (!entries.ok) return err(entries.error);

    const summaries: AgentRunSummary[] = [];
    for (const entry of entries.value) {
      if (!entry.endsWith('.json')) continue;
      if (entry.endsWith('.events.json')) continue;
      const read = await this.voidStorage.readJson<AgentRun>(this.notesPath, `agents/${entry}`);
      if (!read.ok) return err(read.error);
      if (!read.value) continue;
      summaries.push(this.toSummary(normalizeAgentRun(read.value)));
    }

    const written = await this.writeSummaryIndex(summaries);
    if (!written.ok) return err(written.error);
    return ok(summaries);
  }

  private async upsertIndexedSummary(run: AgentRun): Promise<void> {
    const index = await this.readSummaryIndex();
    if (!index.ok) return;
    const next = index.value.filter((summary) => summary.id !== run.id);
    next.push(this.toSummary(run));
    await this.writeSummaryIndex(next);
  }

  private async touchIndexedSummaryEvent(runId: string, event: AgentRunEvent): Promise<void> {
    const index = await this.readSummaryIndex();
    if (!index.ok) return;
    const next = index.value.map((summary) => {
      if (summary.id !== runId) return summary;
      return {
        ...summary,
        lastEventPreview: event.message ?? summary.lastEventPreview,
        updatedAt: event.createdAt > summary.updatedAt ? event.createdAt : summary.updatedAt,
      };
    });
    await this.writeSummaryIndex(next);
  }

  private toSummary(run: AgentRun): AgentRunSummary {
    const artifactTypes = Array.from(new Set(run.artifacts.map((artifact) => artifact.type)));
    const lastEvent = run.events.at(-1);
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
      lastEventPreview: lastEvent?.message ?? run.finalSummary,
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
