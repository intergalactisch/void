/**
 * Pulse store - reactive view over PulseService.
 *
 * Tracks pending insights and exposes the count for a status-bar badge
 * plus the full list for the inbox panel. Refreshes on `pulse:new-insight`
 * and on dismiss.
 */

import type { PulseService } from '$lib/ports/inbound/PulseService';
import type { Insight } from '$lib/domain/entities/Insight';
import { events } from '$lib/events';

class PulseStore {
  private service: PulseService | null = null;
  private offNew: (() => void) | null = null;

  insights = $state<Insight[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);

  /** Reactive count for status bar badge. */
  get count(): number {
    return this.insights.length;
  }

  init(service: PulseService): void {
    if (this.service === service) return;
    this.offNew?.();
    this.service = service;
    const handler = () => {
      void this.refresh();
    };
    events.on('pulse:new-insight', handler);
    this.offNew = () => events.off('pulse:new-insight', handler);
  }

  async refresh(): Promise<void> {
    if (!this.service) return;
    this.loading = true;
    this.error = null;
    const result = await this.service.getInsights();
    if (result.ok) {
      this.insights = result.value
        .filter((insight) => !insight.dismissed)
        .sort((a, b) => b.created.localeCompare(a.created));
    } else {
      this.insights = [];
      this.error = result.error;
    }
    this.loading = false;
  }

  async dismiss(insightId: string): Promise<void> {
    if (!this.service) return;
    await this.service.dismiss(insightId);
    this.insights = this.insights.filter((insight) => insight.id !== insightId);
    events.emit('pulse:dismissed', { insightId });
  }

  async dismissAll(): Promise<void> {
    if (!this.service) return;
    await this.service.dismissAll();
    this.insights = [];
  }

  destroy(): void {
    this.offNew?.();
    this.offNew = null;
    this.service = null;
    this.insights = [];
  }
}

export const pulseStore = new PulseStore();
