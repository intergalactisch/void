import { describe, expect, it } from 'vitest';
import { AIJobQueueServiceImpl } from '$lib/application/services';
import { MemoryVoidStorageAdapter } from '$lib/adapters/memory';

const envelope = {
  encrypted: true,
  algorithm: 'void-sealed-v1',
  keyId: 'device-key',
  ciphertext: 'sealed',
} as const;

describe('AIJobQueueServiceImpl', () => {
  it('queues encrypted desktop-relay AI jobs and completes them with result bundles', async () => {
    const storage = new MemoryVoidStorageAdapter();
    const service = new AIJobQueueServiceImpl(storage, '/notes');

    const queued = await service.queue({
      workspaceId: 'workspace-a',
      requestedByDeviceId: 'phone-a',
      kind: 'agent-run',
      envelope,
    });

    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.value.status).toBe('queued');
    expect(queued.value.envelope.encrypted).toBe(true);

    const completed = await service.complete(queued.value.id, {
      summary: 'Draft ready',
      proposedOperations: [{ kind: 'note.update' }],
      completedAt: '2026-05-25T12:00:00.000Z',
      executorDeviceId: 'desktop-a',
    });

    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.value?.status).toBe('completed');
    expect(completed.value?.result?.executorDeviceId).toBe('desktop-a');

    const all = await service.list();
    expect(all.ok && all.value).toHaveLength(1);
  });
});
