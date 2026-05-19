import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActionHistoryServiceImpl } from '$lib/application/services/ActionHistoryServiceImpl';

describe('ActionHistoryServiceImpl', () => {
  let service: ActionHistoryServiceImpl;

  beforeEach(() => {
    service = new ActionHistoryServiceImpl();
  });

  it('records actions newest-first', () => {
    service.record({ type: 't', summary: 'first', undo: () => {} });
    service.record({ type: 't', summary: 'second', undo: () => {} });
    const stack = service.getStack();
    expect(stack[0]?.summary).toBe('second');
    expect(stack[1]?.summary).toBe('first');
  });

  it('undoLast pops and runs the inverse', async () => {
    const undo = vi.fn();
    service.record({ type: 't', summary: 'do', undo });
    const result = await service.undoLast();
    expect(result.ok).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(service.getStack()).toEqual([]);
  });

  it('returns null when stack is empty', async () => {
    const result = await service.undoLast();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it('restores the action when undo throws', async () => {
    const undo = vi.fn().mockRejectedValue(new Error('boom'));
    service.record({ type: 't', summary: 'flaky', undo });
    const result = await service.undoLast();
    expect(result.ok).toBe(false);
    // Failed action remains in stack so user can retry.
    expect(service.getStack()).toHaveLength(1);
    expect(service.getStack()[0]?.summary).toBe('flaky');
  });

  it('caps stack at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      service.record({ type: 't', summary: `n${i}`, undo: () => {} });
    }
    expect(service.getStack().length).toBe(50);
    // Most recent should still be at the top.
    expect(service.getStack()[0]?.summary).toBe('n59');
  });

  it('notifies subscribers on changes', () => {
    const cb = vi.fn();
    const unsubscribe = service.subscribe(cb);
    expect(cb).toHaveBeenCalledTimes(1); // initial snapshot
    service.record({ type: 't', summary: 'a', undo: () => {} });
    expect(cb).toHaveBeenCalledTimes(2);
    unsubscribe();
    service.record({ type: 't', summary: 'b', undo: () => {} });
    expect(cb).toHaveBeenCalledTimes(2); // not called after unsubscribe
  });
});
