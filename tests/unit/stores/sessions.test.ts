import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemorySessionStorageAdapter } from '$lib/adapters/memory/MemorySessionStorageAdapter';
import { SessionServiceImpl } from '$lib/application/services/SessionServiceImpl';
import { SessionsStore } from '$lib/stores/sessions.svelte';

function createStore(): {
  service: SessionServiceImpl;
  store: SessionsStore;
} {
  const service = new SessionServiceImpl(new MemorySessionStorageAdapter());
  const store = new SessionsStore();
  store.init(service);
  return { service, store };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SessionsStore', () => {
  let service: SessionServiceImpl;
  let store: SessionsStore;

  beforeEach(() => {
    ({ service, store } = createStore());
  });

  afterEach(() => {
    store.destroy();
  });

  it('keeps session lists cached per note path', async () => {
    await service.create({
      id: 'sess-alpha',
      type: 'research-session',
      kind: 'swarm',
      title: 'Alpha research',
      members: [{ notePath: 'alpha.md', role: 'derived' }],
      createdBy: 'ai-agent',
    });
    await service.create({
      id: 'sess-beta',
      type: 'research-session',
      kind: 'swarm',
      title: 'Beta research',
      members: [{ notePath: 'beta.md', role: 'derived' }],
      createdBy: 'ai-agent',
    });

    await store.fetchFor('alpha.md');
    await store.fetchFor('beta.md');

    expect(store.sessionsFor('alpha.md').map((session) => session.id)).toEqual(['sess-alpha']);
    expect(store.sessionsFor('beta.md').map((session) => session.id)).toEqual(['sess-beta']);
    expect(store.sessions.map((session) => session.id)).toEqual(['sess-beta']);
  });

  it('refreshes cached note paths when a session is created without a specific note event', async () => {
    await store.fetchFor('alpha.md');
    await store.fetchFor('beta.md');
    expect(store.sessionsFor('alpha.md')).toEqual([]);
    expect(store.sessionsFor('beta.md')).toEqual([]);

    await service.create({
      id: 'sess-shared',
      type: 'research-session',
      kind: 'swarm',
      title: 'Shared research',
      members: [
        { notePath: 'alpha.md', role: 'derived' },
        { notePath: 'beta.md', role: 'derived' },
      ],
      createdBy: 'ai-agent',
    });
    await nextTick();

    expect(store.sessionsFor('alpha.md').map((session) => session.id)).toEqual(['sess-shared']);
    expect(store.sessionsFor('beta.md').map((session) => session.id)).toEqual(['sess-shared']);
  });
});
