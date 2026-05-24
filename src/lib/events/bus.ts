/**
 * Event Bus - Typed event emitter singleton using mitt
 *
 * Usage:
 *   import { events } from '$lib/events';
 *   events.emit('app:ready');
 *   events.on('settings:changed', ({ key, value }) => console.log(key, value));
 */
import mitt from 'mitt';
import type { EventMap } from './types';
import { getLoggerPort } from '$lib/logging';
import { createLogEntry } from '$lib/domain/values/LogEntry';

const bus = mitt<EventMap>();

// ============================================================================
// Event Buffering
// ============================================================================

/** Buffered events waiting to be flushed */
let buffer: Array<{ type: string; payload: unknown }> | null = null;

/**
 * Start buffering events. Events emitted during buffering are collected
 * and only dispatched when flush() is called. If discard() is called,
 * buffered events are dropped.
 */
export function startBuffering() {
  buffer = [];
  return {
    flush() {
      const b = buffer;
      buffer = null;
      if (b) {
        for (const e of b) {
          bus.emit(e.type as keyof EventMap, e.payload as EventMap[keyof EventMap]);
        }
      }
    },
    discard() {
      buffer = null;
    },
  };
}

// Wrap emit to support buffering
const originalEmit = bus.emit.bind(bus);
bus.emit = ((type: string, payload?: unknown) => {
  if (buffer) {
    buffer.push({ type, payload });
    return;
  }
  originalEmit(type as keyof EventMap, payload as EventMap[keyof EventMap]);
}) as typeof bus.emit;

export const events = bus;

// Structured event logging - always active, silent no-op before bootstrap
events.on('*', (type, e) => {
  queueMicrotask(() => {
    getLoggerPort()?.log(createLogEntry('debug', 'Event', String(type), { payload: e }));
  });
});
