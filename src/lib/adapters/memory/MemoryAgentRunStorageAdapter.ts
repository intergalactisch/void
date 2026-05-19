/**
 * MemoryAgentRunStorageAdapter - in-memory agent run persistence for tests/dev.
 *
 * Mirrors the per-worker JSONL split that VoidAgentRunStorageAdapter uses:
 * worker messages are stored separately from the run snapshot and merged
 * back in on read.
 */

import { ok, type Result } from '$lib/core';
import {
  normalizeAgentRun,
  type AgentRun,
  type AgentRunEvent,
  type AgentWorkerMessage,
} from '$lib/domain/entities/AgentRun';
import type { AgentRunStoragePort } from '$lib/ports/outbound/AgentRunStoragePort';

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
}
