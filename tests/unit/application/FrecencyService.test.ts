import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FrecencyServiceImpl } from '$lib/application/services/FrecencyServiceImpl';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import { ok } from '$lib/core';

function memoryStorage(): VoidStoragePort & { written: Record<string, unknown> } {
  const written: Record<string, unknown> = {};
  return {
    written,
    async ensureStructure() {
      return ok(undefined);
    },
    async appendProvenance() {
      return ok(undefined);
    },
    async readProvenance() {
      return ok([]);
    },
    async writeJson(_dir: string, path: string, data: unknown) {
      written[path] = data;
      return ok(undefined);
    },
    async readJson<T>(_dir: string, path: string) {
      const data = written[path];
      return ok(data === undefined ? null : (data as T));
    },
    async listDir() {
      return ok([]);
    },
    async appendDigest() {
      return ok(undefined);
    },
  } as unknown as VoidStoragePort & { written: Record<string, unknown> };
}

describe('FrecencyServiceImpl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  });

  it('records interactions and returns score > 0', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    expect(service.score('command', 'a')).toBe(0);
    service.record('command', 'a');
    expect(service.score('command', 'a')).toBeGreaterThan(0);
  });

  it('isolates kinds (command vs note)', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    service.record('command', 'view.toggleSidebar');
    expect(service.score('note', 'view.toggleSidebar')).toBe(0);
  });

  it('frequent items outrank rare items at same time', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    service.record('command', 'rare');
    for (let i = 0; i < 10; i++) service.record('command', 'frequent');
    expect(service.score('command', 'frequent')).toBeGreaterThan(service.score('command', 'rare'));
  });

  it('older interactions decay', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    service.record('command', 'old');
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
    service.record('command', 'recent');
    expect(service.score('command', 'recent')).toBeGreaterThan(service.score('command', 'old'));
  });

  it('topRecent returns ids sorted by score', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    service.record('command', 'a');
    service.record('command', 'b');
    service.record('command', 'b');
    service.record('command', 'c');
    service.record('command', 'c');
    service.record('command', 'c');
    expect(service.topRecent('command', 3)).toEqual(['c', 'b', 'a']);
  });

  it('lastAccessed returns entries sorted by most recent interaction', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    service.record('note', 'old.md');
    service.record('note', 'old.md');
    service.record('note', 'old.md');
    vi.setSystemTime(new Date('2026-05-07T12:01:00Z'));
    service.record('note', 'new.md');

    expect(service.lastAccessed('note', 2).map((entry) => entry.id)).toEqual(['new.md', 'old.md']);
  });

  it('forgets and clears persisted entries by kind', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    service.record('note', 'a.md');
    service.record('note', 'b.md');
    service.record('command', 'view.toggleSidebar');

    service.forget('note', 'a.md');
    expect(service.lastAccessed('note', 10).map((entry) => entry.id)).toEqual(['b.md']);

    service.clear('note');
    expect(service.lastAccessed('note', 10)).toEqual([]);
    expect(service.topRecent('command', 1)).toEqual(['view.toggleSidebar']);
  });

  it('moves a tracked note id while preserving access data', async () => {
    const service = new FrecencyServiceImpl(memoryStorage(), '/notes');
    await service.load();
    service.record('note', 'old.md');
    service.record('note', 'old.md');

    service.move('note', 'old.md', 'new.md');

    expect(service.score('note', 'old.md')).toBe(0);
    expect(service.score('note', 'new.md')).toBeGreaterThan(0);
    expect(service.lastAccessed('note', 1)[0]).toMatchObject({
      id: 'new.md',
      kind: 'note',
      count: 2,
    });
  });

  it('persists note interactions without waiting for the command throttle', async () => {
    const storage = memoryStorage();
    const first = new FrecencyServiceImpl(storage, '/notes');
    await first.load();
    first.record('note', 'instant.md');
    await Promise.resolve();
    await Promise.resolve();

    const second = new FrecencyServiceImpl(storage, '/notes');
    await second.load();
    expect(second.lastAccessed('note', 1).map((entry) => entry.id)).toEqual(['instant.md']);
  });

  it('persists and reloads frecency', async () => {
    const storage = memoryStorage();
    const first = new FrecencyServiceImpl(storage, '/notes');
    await first.load();
    first.record('command', 'persisted');
    // advance past the persist interval to force a write
    vi.advanceTimersByTime(11_000);
    await Promise.resolve();
    await Promise.resolve();

    const second = new FrecencyServiceImpl(storage, '/notes');
    await second.load();
    expect(second.score('command', 'persisted')).toBeGreaterThan(0);
  });
});
