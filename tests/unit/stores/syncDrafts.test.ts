import { describe, expect, it, vi } from 'vitest';
import { syncStore } from '$lib/stores/sync.svelte';
import { ok, err } from '$lib/core/result';
import type { SyncService } from '$lib/ports/inbound';
import type { SyncConflictPreview } from '$lib/domain/values';

const preview = (id: string): SyncConflictPreview => ({
  conflictId: id, path: id + '.md', baseMarkdown: 'base', localMarkdown: 'local',
  remoteMarkdown: 'remote', mergedMarkdown: id, hunks: [], mergeClean: false, supported: true,
});
function initialize(overrides: Partial<SyncService>) {
  syncStore.init({
    subscribe: () => () => {}, getCurrentUser: () => null,
    saveConflictDraft: async () => ok(undefined), ...overrides,
  } as unknown as SyncService);
}

describe('conflict drafts', () => {
  it('ignores a preview that arrives after another file has been selected', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { started = resolve; });
    initialize({
      previewConflict: async id => {
        if (id === 'slow') { started(); await gate; }
        return ok(preview(id));
      },
    });
    const slow = syncStore.previewConflict('slow');
    await waiting;
    await syncStore.previewConflict('fast');
    release();
    expect(await slow).toBeNull();
    expect(syncStore.activeConflictPreview?.conflictId).toBe('fast');
  });

  it('retains a failed draft and retries the latest version before closing', async () => {
    const save = vi.fn().mockResolvedValueOnce(err(new Error('Disk full'))).mockResolvedValue(ok(undefined));
    initialize({ saveConflictDraft: save });
    syncStore.updateConflictDraft('plan', 'first');
    // Queue a later edit while the first disk operation is pending.
    syncStore.updateConflictDraft('plan', 'latest');
    expect((await syncStore.flushConflictDrafts()).ok).toBe(true);
    expect(save).toHaveBeenLastCalledWith('plan', 'latest');
    expect(syncStore.draftSaving).toBe(false);
  });

  it('does not allow closing while a draft still cannot be saved', async () => {
    const save = vi.fn().mockResolvedValue(err(new Error('Offline disk')));
    initialize({ saveConflictDraft: save });
    syncStore.updateConflictDraft('keep', 'Do not lose this');
    expect((await syncStore.flushConflictDrafts()).ok).toBe(false);
    expect(syncStore.draftError?.message).toBe('Offline disk');
    save.mockResolvedValue(ok(undefined));
    expect((await syncStore.flushConflictDrafts()).ok).toBe(true);
    expect(save).toHaveBeenLastCalledWith('keep', 'Do not lose this');
  });
});
