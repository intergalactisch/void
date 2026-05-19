import { describe, expect, it, vi } from 'vitest';
import { LineageServiceImpl } from '$lib/application/services/LineageServiceImpl';
import { MemoryLineageStorageAdapter } from '$lib/adapters/memory';
import lineageHistory from '$lib/tools/lineage/history.tool';
import lineageWhy from '$lib/tools/lineage/why.tool';
import lineageRevert from '$lib/tools/lineage/revert.tool';
import lineageTrace from '$lib/tools/lineage/trace.tool';
import lineageBranch from '$lib/tools/lineage/branch.tool';
import lineageCompare from '$lib/tools/lineage/compare.tool';
import lineageRepair from '$lib/tools/lineage/repair.tool';
import lineageContext from '$lib/tools/lineage/context.tool';
import lineageActions from '$lib/tools/lineage/actions.tool';
import { getAllTools } from '$lib/tools/registry';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';

describe('lineage tools', () => {
  it('registers the AI-readable lineage context tool', () => {
    expect(getAllTools().map((entry) => entry.id)).toContain('lineage:context');
    expect(getAllTools().map((entry) => entry.id)).toContain('lineage:actions');
  });

  it('explains why a line exists', async () => {
    const { services } = await createLineageFixture();

    const result = await lineageWhy.handler({ line: 1 }, createContext(services)) as {
      unitId: string;
      versionId: string;
      [key: string]: unknown;
    };

    expect(result).toMatchObject({
      noteId: 'launch.md',
      line: 1,
      content: 'Alpha updated',
      actor: 'AI agent (codex)',
      intent: 'Clarify line',
      previousVersionCount: 1,
    });
    expect(result.unitId).toMatch(/^lu_/);
    expect(result.versionId).toMatch(/^lv_/);
  });

  it('returns version history for a line', async () => {
    const { services } = await createLineageFixture();

    const result = await lineageHistory.handler({ line: 1 }, createContext(services)) as {
      scope: string;
      versions?: Array<{ content: string }>;
      summary: string;
    };

    expect(result.scope).toBe('line');
    expect(result.versions?.map((version) => version.content)).toEqual([
      'Alpha',
      'Alpha updated',
    ]);
    expect(result.summary).toContain('Clarify line');
  });

  it('restores a line to the previous version through collaboration', async () => {
    const { services, applyNoteContent } = await createLineageFixture();

    const result = await lineageRevert.handler({ line: 1 }, createContext(services)) as Record<string, unknown>;

    expect(result).toMatchObject({
      success: true,
      noteId: 'launch.md',
      line: 1,
      restoredContent: 'Alpha',
    });
    expect(applyNoteContent).toHaveBeenCalledWith(
      'launch.md',
      'Alpha',
      'AI lineage restore',
      expect.objectContaining({
        intentKind: 'restore',
        summary: expect.stringContaining('Restore'),
        commandId: 'lineage:revert',
        receiptId: 'inv-lineage',
      }),
    );
  });

  it('traces source versions for a line', async () => {
    const { services } = await createLineageFixture();

    const result = await lineageTrace.handler(
      { line: 1, direction: 'ancestors' },
      createContext(services),
    ) as {
      nodes: Array<{ content: string }>;
      edges: Array<{ fromVersionId: string; toVersionId: string; relation: string }>;
      summary: string;
    };

    expect(result.nodes.map((node) => node.content).sort()).toEqual(['Alpha', 'Alpha updated']);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.relation).toBe('source');
    expect(result.summary).toContain('2 versions');
  });

  it('returns AI-readable lineage context and edit clusters', async () => {
    const { services } = await createLineageFixture();

    const result = await lineageContext.handler(
      { line: 1, clusterLimit: 5 },
      createContext(services),
    ) as {
      target: { currentVersion: { content: string } } | null;
      clusters: Array<{ summary: string }>;
      lines: Array<{ content: string }>;
    };

    expect(result.target?.currentVersion.content).toBe('Alpha updated');
    expect(result.clusters.some((cluster) => cluster.summary.includes('Clarify line'))).toBe(true);
    expect(result.lines.map((line) => line.content)).toEqual(['Alpha updated']);
  });

  it('lists available actions for a lineage-tracked line', async () => {
    const { services } = await createLineageFixture();

    const result = await lineageActions.handler(
      { line: 1 },
      createContext(services),
    ) as {
      unitId?: string;
      previousVersionCount: number;
      warningCount: number;
      actions: Array<{
        id: string;
        toolId: string;
        available: boolean;
        requiresConfirmation: boolean;
        args: Record<string, unknown>;
      }>;
    };

    expect(result.unitId).toMatch(/^lu_/);
    expect(result.previousVersionCount).toBe(1);
    expect(result.warningCount).toBeGreaterThanOrEqual(0);
    expect(result.actions.find((action) => action.id === 'why')).toBeUndefined();
    expect(result.actions.find((action) => action.id === 'explain')).toMatchObject({
      toolId: 'lineage:why',
      available: true,
      requiresConfirmation: false,
      args: { noteId: 'launch.md', line: 1 },
    });
    expect(result.actions.find((action) => action.id === 'revert')).toMatchObject({
      toolId: 'lineage:revert',
      available: true,
      requiresConfirmation: true,
    });
    expect(result.actions.find((action) => action.id === 'repair')).toMatchObject({
      toolId: 'lineage:repair',
    });
  });

  it('creates branches and records branch lineage metadata', async () => {
    const { services } = await createLineageFixture();
    const createBranches = vi.fn().mockResolvedValue({
      ok: true,
      value: [{ id: 'branch_1' }, { id: 'branch_2' }],
    });
    services.branches = { createBranches } as unknown as ToolServices['branches'];
    const recordMarkdownChange = vi.spyOn(services.lineage, 'recordMarkdownChange');

    const result = await lineageBranch.handler(
      { prompt: 'Explore a sharper launch plan', count: 2 },
      createContext(services),
    ) as { noteId: string; branchIds: string[]; count: number };

    expect(result).toEqual({
      noteId: 'launch.md',
      branchIds: ['branch_1', 'branch_2'],
      count: 2,
    });
    expect(createBranches).toHaveBeenCalledWith('launch.md', 'Explore a sharper launch plan', 2);
    expect(recordMarkdownChange).toHaveBeenCalledWith(
      'launch.md',
      'Alpha updated',
      expect.objectContaining({
        intentKind: 'branch',
        commandId: 'lineage:branch',
        receiptId: 'inv-lineage',
        prompt: 'Explore a sharper launch plan',
      }),
    );
  });

  it('compares a lineage branch through BranchService', async () => {
    const { services } = await createLineageFixture();
    const compareBranch = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        branchId: 'branch_1',
        notePath: 'launch.md',
        addedLines: ['Beta'],
        removedLines: ['Alpha'],
        changedLineCount: 1,
        unchangedLineCount: 0,
        commitmentDelta: { added: 0, removed: 0 },
        summary: '1 changed line',
      },
    });
    services.branches = { compareBranch } as ToolServices['branches'];

    const result = await lineageCompare.handler(
      { branchId: 'branch_1' },
      createContext(services),
    ) as { summary: string };

    expect(result.summary).toBe('1 changed line');
    expect(compareBranch).toHaveBeenCalledWith('launch.md', 'branch_1');
  });

  it('lists and repairs reconciliation warnings', async () => {
    const { services } = await createLineageFixture();
    const warning = {
      id: 'rw_1',
      notePath: 'launch.md',
      message: 'Ambiguous',
      matches: [{ oldUnitId: 'lu_1', newLineIndex: 0, matchKind: 'edited', confidence: 0.6, reasons: ['ambiguous'] }],
      createdAt: new Date().toISOString(),
    };
    services.lineage.getReconciliationWarnings = vi.fn().mockResolvedValue({ ok: true, value: [warning] });
    services.lineage.repairLineMatch = vi.fn().mockResolvedValue({ ok: true, value: {} });

    const listed = await lineageRepair.handler({ listOnly: true }, createContext(services)) as { warningCount: number };
    expect(listed.warningCount).toBe(1);

    const repaired = await lineageRepair.handler(
      { line: 1, unitId: 'lu_1', warningId: 'rw_1' },
      createContext(services),
    ) as { repaired: boolean };

    expect(repaired.repaired).toBe(true);
    expect(services.lineage.repairLineMatch).toHaveBeenCalledWith(
      'launch.md',
      0,
      'lu_1',
      expect.objectContaining({ commandId: 'lineage:repair', receiptId: 'inv-lineage', warningId: 'rw_1' }),
    );
  });
});

async function createLineageFixture() {
  const lineage = new LineageServiceImpl(new MemoryLineageStorageAdapter());
  const initial = await lineage.recordMarkdownChange('launch.md', 'Alpha', {
    actor: { kind: 'user', name: 'Test User' },
    intentKind: 'type',
    summary: 'Initial line',
  });
  expect(initial.ok).toBe(true);

  const updated = await lineage.recordMarkdownChange('launch.md', 'Alpha updated', {
    actor: { kind: 'ai-agent', model: 'codex' },
    intentKind: 'rewrite',
    summary: 'Clarify line',
  });
  expect(updated.ok).toBe(true);

  const applyNoteContent = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const services = {
    notes: { getSelectedPath: () => 'launch.md' },
    lineage,
    collaboration: { applyNoteContent },
    branches: {},
  } as unknown as ToolServices;

  return { services, applyNoteContent };
}

function createContext(services: ToolServices): ToolExecutionContext {
  return {
    services,
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
    invocation: { id: 'inv-lineage' } as ToolInvocation,
  } as ToolExecutionContext;
}
