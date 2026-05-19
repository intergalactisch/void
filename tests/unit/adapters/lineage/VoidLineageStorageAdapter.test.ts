import { describe, expect, it } from 'vitest';
import { LineageServiceImpl } from '$lib/application/services/LineageServiceImpl';
import { MemoryVoidStorageAdapter } from '$lib/adapters/memory';
import { VoidLineageStorageAdapter } from '$lib/adapters/lineage/VoidLineageStorageAdapter';

describe('VoidLineageStorageAdapter', () => {
  it('persists lineage snapshots and journal entries through VoidStoragePort', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const storage = new VoidLineageStorageAdapter(voidStorage, '/notes');
    const service = new LineageServiceImpl(storage);

    const first = await service.recordMarkdownChange('folder/launch.md', 'Alpha', {
      actor: { kind: 'user' },
      intentKind: 'type',
      summary: 'Initial draft',
    });
    expect(first.ok).toBe(true);

    const second = await service.recordMarkdownChange('folder/launch.md', 'Alpha updated', {
      actor: { kind: 'ai-agent', model: 'codex' },
      intentKind: 'rewrite',
      summary: 'Sharpen alpha',
    });
    expect(second.ok).toBe(true);

    const snapshot = await storage.readSnapshot('folder/launch.md');
    expect(snapshot.ok).toBe(true);
    expect(snapshot.ok ? snapshot.value?.notePath : null).toBe('folder/launch.md');
    expect(snapshot.ok ? Object.values(snapshot.value?.versions ?? {}).map((version) => version.content) : []).toEqual([
      'Alpha',
      'Alpha updated',
    ]);

    const journal = await storage.readJournal('folder/launch.md');
    expect(journal.ok).toBe(true);
    expect(journal.ok ? journal.value.filter((entry) => entry.type === 'version.created') : []).toHaveLength(2);

    const files = await voidStorage.listDir('/notes', 'lineage');
    expect(files.ok).toBe(true);
    expect(files.ok ? files.value : []).toEqual(expect.arrayContaining([
      'folder%2Flaunch%2Emd.journal.jsonl',
      'folder%2Flaunch%2Emd.snapshot.json',
    ]));
  });

  it('reads legacy JSON-array journals together with append-only JSONL entries', async () => {
    const voidStorage = new MemoryVoidStorageAdapter();
    const storage = new VoidLineageStorageAdapter(voidStorage, '/notes');

    const legacyEntry = {
      type: 'snapshot.created' as const,
      snapshotId: 'snapshot_legacy',
      hash: 'legacy',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const legacyWrite = await voidStorage.writeJson(
      '/notes',
      'lineage/legacy%2Emd.journal.json',
      [legacyEntry],
    );
    expect(legacyWrite.ok).toBe(true);

    const append = await storage.appendEntries('legacy.md', [{
      type: 'snapshot.created',
      snapshotId: 'snapshot_jsonl',
      hash: 'jsonl',
      createdAt: '2026-01-01T00:00:01.000Z',
    }]);
    expect(append.ok).toBe(true);

    const journal = await storage.readJournal('legacy.md');
    expect(journal.ok).toBe(true);
    expect(journal.ok ? journal.value : []).toEqual([
      legacyEntry,
      expect.objectContaining({ type: 'snapshot.created', snapshotId: 'snapshot_jsonl' }),
    ]);
  });
});
