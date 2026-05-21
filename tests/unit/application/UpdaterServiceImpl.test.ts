import { describe, expect, it } from 'vitest';
import { MemoryUpdaterAdapter } from '$lib/adapters/memory';
import { UpdaterServiceImpl } from '$lib/application/services';
import type { UpdateInfo, UpdateInstallEvent } from '$lib/ports/inbound';

const update: UpdateInfo = {
  version: '0.2.0',
  currentVersion: '0.1.1',
  notes: 'Security fixes.',
  pubDate: '2026-05-21T10:00:00Z',
};

describe('UpdaterServiceImpl', () => {
  it('returns the current version', async () => {
    const adapter = new MemoryUpdaterAdapter();
    adapter.setCurrentVersion('0.1.1');
    const service = new UpdaterServiceImpl(adapter);

    const result = await service.getCurrentVersion();

    expect(result).toEqual({ ok: true, value: '0.1.1' });
  });

  it('reports no update when the adapter is up to date', async () => {
    const service = new UpdaterServiceImpl(new MemoryUpdaterAdapter());

    const result = await service.checkForUpdates();

    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns available update metadata', async () => {
    const adapter = new MemoryUpdaterAdapter();
    adapter.seed(update);
    const service = new UpdaterServiceImpl(adapter);

    const result = await service.checkForUpdates();

    expect(result).toEqual({ ok: true, value: update });
  });

  it('downloads, installs, and emits progress events', async () => {
    const adapter = new MemoryUpdaterAdapter();
    adapter.seed(update);
    const service = new UpdaterServiceImpl(adapter);
    const events: UpdateInstallEvent[] = [];

    const result = await service.installUpdate((event) => events.push(event));

    expect(result.ok).toBe(true);
    expect(adapter.getInstallCount()).toBe(1);
    expect(events).toEqual([
      { event: 'Started', data: { contentLength: 100 } },
      { event: 'Progress', data: { chunkLength: 40 } },
      { event: 'Progress', data: { chunkLength: 60 } },
      { event: 'Finished' },
    ]);
  });

  it('fails install when no update is pending', async () => {
    const service = new UpdaterServiceImpl(new MemoryUpdaterAdapter());

    const result = await service.installUpdate();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('No pending update');
    }
  });

  it('surfaces install failures without counting install success', async () => {
    const adapter = new MemoryUpdaterAdapter();
    adapter.seed(update);
    adapter.failInstall(new Error('signature rejected'));
    const service = new UpdaterServiceImpl(adapter);

    const result = await service.installUpdate();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('signature rejected');
    }
    expect(adapter.getInstallCount()).toBe(0);
  });

  it('restarts through the updater port', async () => {
    const adapter = new MemoryUpdaterAdapter();
    const service = new UpdaterServiceImpl(adapter);

    const result = await service.restartApp();

    expect(result.ok).toBe(true);
    expect(adapter.getRestartCount()).toBe(1);
  });
});
