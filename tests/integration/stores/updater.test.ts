import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryUpdaterAdapter } from '$lib/adapters/memory';
import { UpdaterServiceImpl } from '$lib/application/services';
import { updaterStore } from '$lib/stores/updater.svelte';
import type { UpdateInfo } from '$lib/ports/inbound';

const update: UpdateInfo = {
  version: '0.2.0',
  currentVersion: '0.1.1',
  notes: 'Security fixes.',
  pubDate: '2026-05-21T10:00:00Z',
};

describe('Updater Store Integration', () => {
  let adapter: MemoryUpdaterAdapter;

  beforeEach(() => {
    adapter = new MemoryUpdaterAdapter();
    updaterStore.init(new UpdaterServiceImpl(adapter));
    updaterStore.resetState();
  });

  it('loads the current version', async () => {
    adapter.setCurrentVersion('0.1.1');

    const result = await updaterStore.loadCurrentVersion();

    expect(result).toEqual({ ok: true, value: '0.1.1' });
    expect(updaterStore.currentVersion).toBe('0.1.1');
  });

  it('records no-update checks', async () => {
    const result = await updaterStore.checkForUpdates();

    expect(result).toEqual({ ok: true, value: null });
    expect(updaterStore.availableUpdate).toBeNull();
    expect(updaterStore.lastCheckedAt).not.toBeNull();
    expect(updaterStore.checking).toBe(false);
  });

  it('stores available update metadata', async () => {
    adapter.seed(update);

    const result = await updaterStore.checkForUpdates();

    expect(result).toEqual({ ok: true, value: update });
    expect(updaterStore.availableUpdate).toEqual(update);
    expect(updaterStore.currentVersion).toBe('0.1.1');
  });

  it('tracks install progress and restart-required state', async () => {
    adapter.seed(update);
    await updaterStore.checkForUpdates();

    const result = await updaterStore.installUpdate();

    expect(result.ok).toBe(true);
    expect(updaterStore.installing).toBe(false);
    expect(updaterStore.contentLength).toBe(100);
    expect(updaterStore.downloadedBytes).toBe(100);
    expect(updaterStore.installProgress).toBe(100);
    expect(updaterStore.restartRequired).toBe(true);
  });

  it('stores install errors', async () => {
    adapter.seed(update);
    adapter.failInstall(new Error('signature rejected'));

    const result = await updaterStore.installUpdate();

    expect(result.ok).toBe(false);
    expect(updaterStore.error?.message).toBe('signature rejected');
    expect(updaterStore.restartRequired).toBe(false);
  });

  it('can dismiss restart prompt', async () => {
    adapter.seed(update);
    await updaterStore.installUpdate();

    updaterStore.dismissRestartPrompt();

    expect(updaterStore.restartRequired).toBe(false);
  });
});
