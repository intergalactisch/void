import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { OperationServiceImpl } from '$lib/application/services/OperationServiceImpl';
import { MemoryOperationStorageAdapter } from '$lib/adapters/memory/MemoryOperationStorageAdapter';
import { MemoryVoidStorageAdapter } from '$lib/adapters/memory/MemoryVoidStorageAdapter';
import { createEmptyOperationContext } from '$lib/domain/values/OperationContext';
import type { Operation } from '$lib/domain/entities/Operation';
import type { CLIProviderPort, CLIBuildParams } from '$lib/ports/outbound/CLIProviderPort';
import type { CLISessionManagerPort, CLISpawnRequest } from '$lib/ports/outbound/CLISessionManagerPort';
import type { ContextBuilderPort } from '$lib/ports/outbound/ContextBuilderPort';
import type { ResultParserPort } from '$lib/ports/outbound/ResultParserPort';
import type { DocumentService, NoteCollaborationService, TodoService } from '$lib/ports/inbound';

function createFixture(options: { supportsSession: boolean }) {
  let capturedBuildParams: CLIBuildParams | null = null;

  const provider: CLIProviderPort = {
    id: options.supportsSession ? 'claude-code' : 'codex',
    binary: options.supportsSession ? 'claude' : 'codex',
    displayName: options.supportsSession ? 'Claude Code' : 'Codex CLI',
    supportsSession: options.supportsSession,
    supportsResume: options.supportsSession,
    supportsJsonOutput: false,
    supportsToolSandbox: false,
    supportsSystemPrompt: false,
    supportsNativeWebSearch: true,
    buildArgs: vi.fn((params: CLIBuildParams) => {
      capturedBuildParams = params;
      return ['exec', params.prompt];
    }),
    parseOutput: vi.fn((raw: string) => ({ content: raw, metadata: {} })),
  };

  const cliManager: CLISessionManagerPort = {
    spawn: vi.fn(async (request: CLISpawnRequest) => ok({
      processId: `proc-${request.operationId}`,
      operationId: request.operationId,
    })),
    cancel: vi.fn(async () => ok(undefined)),
    getActiveProcesses: vi.fn(() => []),
    getActiveCount: vi.fn(() => 0),
    subscribe: vi.fn(() => () => undefined),
  };

  const contextBuilder: ContextBuilderPort = {
    buildContext: vi.fn(async () => ok(createEmptyOperationContext())),
    estimateTokens: vi.fn(() => 0),
    trimContext: vi.fn((context) => context),
  };

  const resultParser: ResultParserPort = {
    parse: vi.fn(() => ok([])),
    parseJson: vi.fn(() => ok([])),
    extractContent: vi.fn((raw: string) => raw),
    extractTodos: vi.fn(() => []),
    extractReferences: vi.fn(() => []),
  };

  const service = new OperationServiceImpl(
    cliManager,
    provider,
    contextBuilder,
    resultParser,
    new MemoryOperationStorageAdapter(),
    '/notes',
    { readContent: vi.fn(async () => ok('')) } as unknown as DocumentService,
    {} as unknown as NoteCollaborationService,
    {} as unknown as TodoService,
    new MemoryVoidStorageAdapter()
  );

  return {
    service,
    provider,
    cliManager,
    getCapturedBuildParams: () => capturedBuildParams,
  };
}

describe('OperationServiceImpl session fallback', () => {
  it('queues a normal operation when the selected CLI does not support sessions', async () => {
    const { service, provider, cliManager, getCapturedBuildParams } = createFixture({
      supportsSession: false,
    });

    const result = await service.startSession(
      'Research: Anthropic',
      'Research Anthropic using my notes',
      [{ type: 'search', query: 'Anthropic', limit: 10 }]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe('single');
    expect(service.getSessions()).toEqual([]);

    await vi.waitFor(() => expect(cliManager.spawn).toHaveBeenCalledTimes(1));
    expect(provider.buildArgs).toHaveBeenCalledTimes(1);
    expect(getCapturedBuildParams()?.sessionId).toBeUndefined();
    expect(getCapturedBuildParams()?.resumeSessionId).toBeUndefined();
  });

  it('keeps real session behavior when the selected CLI supports sessions', async () => {
    const { service, provider, cliManager, getCapturedBuildParams } = createFixture({
      supportsSession: true,
    });

    const result = await service.startSession(
      'Research: Anthropic',
      'Research Anthropic using my notes'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe('session');
    expect(service.getSessions().map((op: Operation) => op.id)).toContain(result.value.id);

    await vi.waitFor(() => expect(cliManager.spawn).toHaveBeenCalledTimes(1));
    expect(provider.buildArgs).toHaveBeenCalledTimes(1);
    expect(getCapturedBuildParams()?.sessionId).toBeDefined();
    expect(getCapturedBuildParams()?.resumeSessionId).toBeUndefined();
  });

  it('passes native web access into queued legacy research sessions', async () => {
    const { service, cliManager, getCapturedBuildParams } = createFixture({
      supportsSession: false,
    });

    const result = await service.startSession(
      'Research: OpenAI',
      'Research the latest OpenAI model news',
      [{ type: 'search', query: 'OpenAI', limit: 10 }],
      { webAccess: 'native' }
    );

    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(cliManager.spawn).toHaveBeenCalledTimes(1));
    expect(getCapturedBuildParams()?.webAccess).toBe('native');
  });
});
