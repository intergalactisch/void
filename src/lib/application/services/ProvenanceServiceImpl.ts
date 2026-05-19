/**
 * ProvenanceServiceImpl - Implementation of ProvenanceService
 *
 * Records interaction history using VoidStoragePort.
 * Emits events via the event bus when provenance is recorded.
 *
 * Part of the Hexagonal Architecture application layer.
 */

import { ok, err, type Result } from '$lib/core/result';
import type { ProvenanceService } from '$lib/ports/inbound/ProvenanceService';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { ProvenanceEvent, ProvenanceEventType } from '$lib/domain/values/ProvenanceEvent';
import { isAIEvent } from '$lib/domain/values/ProvenanceEvent';
import { events } from '$lib/events';
import { ResourceLock } from '$lib/events/queue/ResourceLock';

export class ProvenanceServiceImpl implements ProvenanceService {
  private readonly lock = new ResourceLock();

  constructor(
    private readonly storage: VoidStoragePort,
    private readonly notesDir: string
  ) {}

  async record(
    noteName: string,
    eventData: Omit<ProvenanceEvent, 'id' | 'ts'>
  ): Promise<Result<void, Error>> {
    return this.lock.withLock(`provenance:${noteName}`, async () => {
      const event: ProvenanceEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        ...eventData,
      };

      const result = await this.storage.appendProvenance(
        this.notesDir,
        noteName,
        event
      );

      if (result.ok) {
        events.emit('provenance:recorded', { noteName, event });
      }

      return result;
    });
  }

  async getHistory(noteName: string): Promise<Result<ProvenanceEvent[], Error>> {
    return this.storage.readProvenance(this.notesDir, noteName);
  }

  async getAITouchCount(noteName: string): Promise<Result<number, Error>> {
    const result = await this.storage.readProvenance(this.notesDir, noteName);
    if (!result.ok) return result;

    const count = result.value.filter(isAIEvent).length;
    return ok(count);
  }

  async getRecentByType(
    noteName: string,
    type: ProvenanceEventType,
    limit = 10
  ): Promise<Result<ProvenanceEvent[], Error>> {
    const result = await this.storage.readProvenance(this.notesDir, noteName);
    if (!result.ok) return result;

    const filtered = result.value
      .filter((e) => e.type === type)
      .slice(-limit);

    return ok(filtered);
  }
}
