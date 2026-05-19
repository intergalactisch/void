import { describe, expect, it } from 'vitest';
import { MemoryAgentRunStorageAdapter } from '$lib/adapters/memory/MemoryAgentRunStorageAdapter';
import { LocalAgentEventStreamAdapter } from '$lib/adapters/agent/LocalAgentEventStreamAdapter';
import { VoidAgentRunStorageAdapter } from '$lib/adapters/agent/VoidAgentRunStorageAdapter';
import { createAgentRun, createAgentRunEvent } from '$lib/domain/entities/AgentRun';
import { AgentRunEngine } from '$lib/application/services/AgentRunEngine';
import { formatAgentSseEvent } from '$lib/ports/outbound/AgentEventStreamPort';
import { ok, type Result } from '$lib/core';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';

class FakeVoidStorage implements VoidStoragePort {
  files = new Map<string, unknown>();

  async ensureStructure(): Promise<Result<void, Error>> { return ok(undefined); }
  async appendProvenance(): Promise<Result<void, Error>> { return ok(undefined); }
  async readProvenance(): Promise<Result<[], Error>> { return ok([]); }
  async writeJson(_notesDir: string, relativePath: string, data: unknown): Promise<Result<void, Error>> {
    this.files.set(relativePath, structuredClone(data));
    return ok(undefined);
  }
  async readJson<T>(_notesDir: string, relativePath: string): Promise<Result<T | null, Error>> {
    return ok((this.files.get(relativePath) as T | undefined) ?? null);
  }
  async listDir(_notesDir: string, relativePath: string): Promise<Result<string[], Error>> {
    const prefix = `${relativePath}/`;
    return ok([...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length)));
  }
  async appendDigest(): Promise<Result<void, Error>> { return ok(undefined); }
}

describe('Agent run event journal and stream', () => {
  it('replays ordered events after Last-Event-ID and formats SSE messages', async () => {
    const storage = new MemoryAgentRunStorageAdapter();
    const stream = new LocalAgentEventStreamAdapter(storage);
    const run = createAgentRun({
      id: 'run-test',
      prompt: 'Research AI topics',
      approvalRequired: false,
    });
    await storage.save(run);

    const first = createAgentRunEvent({
      id: 'evt-1',
      runId: run.id,
      type: 'run.started',
      sequence: 1,
      message: 'Started',
    });
    const second = createAgentRunEvent({
      id: 'evt-2',
      runId: run.id,
      type: 'task.created',
      sequence: 2,
      message: 'Created task',
    });
    await storage.appendEvent(run.id, first);
    await storage.appendEvent(run.id, second);

    const subscription = await stream.subscribe(run.id, 'evt-1');
    expect(subscription.ok).toBe(true);
    if (!subscription.ok) return;

    const iterator = subscription.value.events[Symbol.asyncIterator]();
    const replayed = await iterator.next();
    expect(replayed.value.id).toBe('evt-2');
    subscription.value.close();

    expect(formatAgentSseEvent(second)).toContain('event: task.created');
    expect(formatAgentSseEvent(second)).toContain('id: evt-2');
  });

  it('replays persisted events through the production storage adapter shape', async () => {
    const voidStorage = new FakeVoidStorage();
    const firstAdapter = new VoidAgentRunStorageAdapter(voidStorage, '/notes');
    const run = createAgentRun({
      id: 'run-persisted',
      prompt: 'Research Anthropic',
      approvalRequired: false,
    });
    await firstAdapter.save(run);
    await firstAdapter.appendEvent(run.id, createAgentRunEvent({
      id: 'evt-a',
      runId: run.id,
      type: 'run.started',
      sequence: 1,
    }));
    await firstAdapter.appendEvent(run.id, createAgentRunEvent({
      id: 'evt-b',
      runId: run.id,
      type: 'task.created',
      sequence: 2,
    }));

    const secondAdapter = new VoidAgentRunStorageAdapter(voidStorage, '/notes');
    const loaded = await secondAdapter.get(run.id);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.value) return;
    expect(loaded.value.events.map((event) => event.id)).toEqual(['evt-a', 'evt-b']);
  });

  it('only emits source.verified for verified source artifacts', async () => {
    const storage = new MemoryAgentRunStorageAdapter();
    const engine = new AgentRunEngine(storage, null);
    let run = createAgentRun({
      id: 'run-sources',
      prompt: 'Research sources',
      approvalRequired: false,
    });
    await storage.save(run);

    const verified = await engine.addArtifact(run, {
      id: 'source-verified',
      type: 'source',
      title: 'Verified',
      url: 'https://example.com/verified',
      citation: {
        title: 'Verified',
        url: 'https://example.com/verified',
        fetchedAt: new Date().toISOString(),
        status: 'verified',
      },
      createdAt: new Date().toISOString(),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    run = verified.value;

    const unverified = await engine.addArtifact(run, {
      id: 'source-unverified',
      type: 'source',
      title: 'Unverified',
      url: 'https://example.com/unverified',
      citation: {
        title: 'Unverified',
        url: 'https://example.com/unverified',
        fetchedAt: new Date().toISOString(),
        status: 'unverified',
      },
      createdAt: new Date().toISOString(),
    });
    expect(unverified.ok).toBe(true);
    if (!unverified.ok) return;
    run = unverified.value;

    const failed = await engine.addArtifact(run, {
      id: 'source-failed',
      type: 'source',
      title: 'Failed',
      url: 'https://example.com/failed',
      citation: {
        title: 'Failed',
        url: 'https://example.com/failed',
        fetchedAt: new Date().toISOString(),
        status: 'failed',
      },
      createdAt: new Date().toISOString(),
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;

    expect(failed.value.events.map((event) => event.type)).toContain('source.verified');
    expect(failed.value.events.map((event) => event.type)).toContain('source.failed');
    expect(failed.value.events.filter((event) => event.type === 'source.verified')).toHaveLength(1);
    expect(failed.value.events.find((event) => event.artifactId === 'source-unverified')?.type).toBe('artifact.created');
  });
});
