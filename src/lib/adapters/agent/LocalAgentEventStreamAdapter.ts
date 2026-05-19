/**
 * LocalAgentEventStreamAdapter - in-process replayable agent event stream.
 *
 * SSE can wrap this adapter later. The durable journal remains the source of
 * truth; this adapter only replays and pushes events to local subscribers.
 */

import { ok, err, type Result } from '$lib/core';
import type { AgentRunEvent } from '$lib/domain/entities/AgentRun';
import type {
  AgentEventStreamPort,
  AgentEventSubscription,
} from '$lib/ports/outbound/AgentEventStreamPort';
import type { AgentRunStoragePort } from '$lib/ports/outbound/AgentRunStoragePort';

export class LocalAgentEventStreamAdapter implements AgentEventStreamPort {
  private readonly subscribers = new Map<string, Set<(event: AgentRunEvent) => void>>();

  constructor(private readonly storage: AgentRunStoragePort) {}

  async subscribe(runId: string, fromEventId?: string): Promise<Result<AgentEventSubscription, Error>> {
    const replay = await this.storage.listEvents(runId, fromEventId);
    if (!replay.ok) return err(replay.error);

    const queue = [...replay.value];
    const waiters: Array<(value: IteratorResult<AgentRunEvent>) => void> = [];
    let closed = false;

    const push = (event: AgentRunEvent) => {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value: event, done: false });
      } else {
        queue.push(event);
      }
    };

    const runSubscribers = this.subscribers.get(runId) ?? new Set<(event: AgentRunEvent) => void>();
    runSubscribers.add(push);
    this.subscribers.set(runId, runSubscribers);

    const events: AsyncIterable<AgentRunEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<AgentRunEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => waiters.push(resolve));
          },
        };
      },
    };

    return ok({
      events,
      close: () => {
        closed = true;
        runSubscribers.delete(push);
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined, done: true });
        }
      },
    });
  }

  async publish(event: AgentRunEvent): Promise<Result<void, Error>> {
    const subscribers = this.subscribers.get(event.runId);
    if (!subscribers) return ok(undefined);
    for (const subscriber of subscribers) {
      subscriber(event);
    }
    return ok(undefined);
  }
}
