/**
 * AgentEventStreamPort - replayable event stream adapter above the journal.
 */

import type { Result } from '$lib/core';
import type { AgentRunEvent } from '$lib/domain/entities/AgentRun';

export interface AgentEventSubscription {
  events: AsyncIterable<AgentRunEvent>;
  close(): void;
}

export interface AgentEventStreamPort {
  subscribe(runId: string, fromEventId?: string): Promise<Result<AgentEventSubscription, Error>>;
  publish(event: AgentRunEvent): Promise<Result<void, Error>>;
}

export function formatAgentSseEvent(event: AgentRunEvent): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
}
