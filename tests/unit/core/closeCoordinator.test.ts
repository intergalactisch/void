import { describe, expect, it, vi } from 'vitest';
import { createCloseCoordinator } from '$lib/core/closeCoordinator';
import { ok, err } from '$lib/core/result';

describe('closing the app', () => {
  it('waits for persistence and upgrades a pending hide to a single quit', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const prepare = vi.fn(async () => { await gate; return ok(undefined); });
    const hide = vi.fn(async () => {});
    const quit = vi.fn(async () => {});
    const request = createCloseCoordinator({ prepare, hide, quit });
    const closing = request();
    const quitting = request(true);
    expect(quitting).toBe(closing);
    await Promise.resolve();
    expect(quit).not.toHaveBeenCalled();
    release();
    expect((await quitting).ok).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('keeps the window open after failed storage and supports retry', async () => {
    const prepare = vi.fn().mockResolvedValueOnce(err(new Error('Disk full'))).mockResolvedValue(ok(undefined));
    const hide = vi.fn(async () => {});
    const quit = vi.fn(async () => {});
    const request = createCloseCoordinator({ prepare, hide, quit });
    expect((await request(true)).ok).toBe(false);
    expect(quit).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    expect((await request()).ok).toBe(true);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('turns rejected persistence into a recoverable error', async () => {
    const hide = vi.fn(async () => {});
    const request = createCloseCoordinator({
      prepare: async () => { throw new Error('Storage disconnected'); },
      hide, quit: hide,
    });
    expect((await request()).ok).toBe(false);
    expect(hide).not.toHaveBeenCalled();
  });
});
