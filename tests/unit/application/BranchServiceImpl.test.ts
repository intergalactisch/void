import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import { BranchServiceImpl } from '$lib/application/services/BranchServiceImpl';
import { MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import type { AIAssistantProviderPort } from '$lib/ports/outbound';
import type { DocumentService, NoteCollaborationService } from '$lib/ports/inbound';

describe('BranchServiceImpl lineage flows', () => {
  it('creates branches with base content and compares commitment deltas', async () => {
    const storage = new MemoryVoidStorageAdapter();
    const service = new BranchServiceImpl(
      storage,
      createAI(['Ship receipts first.\n- [ ] Ask Maya']),
      '/notes',
      createDocuments('Ship command center first.'),
    );

    const created = await service.createBranches('launch.md', 'Explore alternative', 1);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value[0]?.notePath).toBe('launch.md');
    expect(created.value[0]?.baseContent).toBe('Ship command center first.');

    const comparison = await service.compareBranch('launch.md', created.value[0]!.id);
    expect(comparison.ok).toBe(true);
    if (comparison.ok) {
      expect(comparison.value.changedLineCount).toBe(2);
      expect(comparison.value.commitmentDelta.added).toBe(1);
    }
  });

  it('accepts, rejects, and restores branches through storage and collaboration', async () => {
    const storage = new MemoryVoidStorageAdapter();
    const applyNoteContent = vi.fn().mockResolvedValue(ok(undefined));
    const service = new BranchServiceImpl(
      storage,
      createAI(['Branch content']),
      '/notes',
      createDocuments('Base'),
      { applyNoteContent } as unknown as NoteCollaborationService,
    );

    const created = await service.createBranches('launch.md', 'Branch it', 1);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const branchId = created.value[0]!.id;

    const accepted = await service.acceptBranch('launch.md', branchId);
    expect(accepted.ok).toBe(true);
    expect(applyNoteContent).toHaveBeenCalledWith(
      'launch.md',
      'Branch content',
      'Accept lineage branch',
      expect.objectContaining({ intentKind: 'accept-branch', branchId }),
    );

    const rejected = await service.rejectBranch('launch.md', branchId);
    expect(rejected.ok).toBe(true);
    const restored = await service.restoreBranch('launch.md', branchId);
    expect(restored.ok).toBe(true);

    const branch = await service.getBranch('launch.md', branchId);
    expect(branch.ok).toBe(true);
    expect(branch.ok ? branch.value?.status : null).toBe('pending');
  });
});

function createAI(responses: string[]): AIAssistantProviderPort {
  let index = 0;
  return {
    prompt: vi.fn(async () => ok({ chat: responses[index++] ?? 'Branch', toolCalls: [] })),
    getProviderType: () => 'mock',
    isAvailable: vi.fn(async () => true),
    configure: vi.fn(),
    stream: vi.fn(),
    cancel: vi.fn(),
    estimateTokens: (text: string) => text.length,
    getMaxContextSize: () => 100000,
    getAvailableModels: vi.fn(async () => []),
    getRateLimitStatus: vi.fn(async () => null),
  } as unknown as AIAssistantProviderPort;
}

function createDocuments(markdown: string): DocumentService {
  return {
    readContent: vi.fn(async () => ok(markdown)),
  } as unknown as DocumentService;
}
