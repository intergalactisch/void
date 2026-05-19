/**
 * Unit tests for Event Bus
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mitt from 'mitt';
import type { EventMap } from '$lib/events/types';

describe('Event Bus', () => {
  let events: ReturnType<typeof mitt<EventMap>>;

  beforeEach(() => {
    // Create fresh event bus for each test
    events = mitt<EventMap>();
  });

  afterEach(() => {
    events.all.clear();
  });

  describe('emit()', () => {
    it('emits events to listeners', () => {
      const handler = vi.fn();
      events.on('app:ready', handler);

      events.emit('app:ready');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('passes payload to listeners', () => {
      const handler = vi.fn();
      events.on('settings:changed', handler);

      events.emit('settings:changed', { key: 'theme', value: 'dark' });

      expect(handler).toHaveBeenCalledWith({ key: 'theme', value: 'dark' });
    });

    it('notifies multiple listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      events.on('app:ready', handler1);
      events.on('app:ready', handler2);

      events.emit('app:ready');

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('does nothing when no listeners', () => {
      // Should not throw
      expect(() => events.emit('app:ready')).not.toThrow();
    });
  });

  describe('on()', () => {
    it('registers event listener', () => {
      const handler = vi.fn();
      events.on('app:ready', handler);
      events.emit('app:ready');
      expect(handler).toHaveBeenCalled();
    });

    it('can register multiple handlers for same event', () => {
      const handlers = [vi.fn(), vi.fn(), vi.fn()];
      handlers.forEach((h) => events.on('app:ready', h));

      events.emit('app:ready');

      handlers.forEach((h) => expect(h).toHaveBeenCalledTimes(1));
    });
  });

  describe('off()', () => {
    it('removes event listener', () => {
      const handler = vi.fn();
      events.on('app:ready', handler);
      events.off('app:ready', handler);

      events.emit('app:ready');

      expect(handler).not.toHaveBeenCalled();
    });

    it('only removes specific listener', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      events.on('app:ready', handler1);
      events.on('app:ready', handler2);
      events.off('app:ready', handler1);

      events.emit('app:ready');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('does nothing for non-registered listener', () => {
      const handler = vi.fn();
      expect(() => events.off('app:ready', handler)).not.toThrow();
    });
  });

  describe('wildcard listener', () => {
    it('receives all events', () => {
      const handler = vi.fn();
      events.on('*', handler);

      events.emit('app:ready');
      events.emit('settings:changed', { key: 'theme', value: 'dark' });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith('app:ready', undefined);
      expect(handler).toHaveBeenCalledWith('settings:changed', {
        key: 'theme',
        value: 'dark',
      });
    });

    it('can be removed', () => {
      const handler = vi.fn();
      events.on('*', handler);
      events.off('*', handler);

      events.emit('app:ready');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('all', () => {
    it('provides access to all handlers', () => {
      const handler = vi.fn();
      events.on('app:ready', handler);

      expect(events.all.has('app:ready')).toBe(true);
    });

    it('can be cleared', () => {
      const handler = vi.fn();
      events.on('app:ready', handler);

      events.all.clear();
      events.emit('app:ready');

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
