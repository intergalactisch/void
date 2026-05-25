import type { AIJob, AIJobEnvelope, AIJobKind, AIJobPolicy } from '$lib/domain/values';
import type { AIJobQueueService } from '$lib/ports/inbound';
import { events } from '$lib/events';

class AIJobQueueStore {
  #service: AIJobQueueService | null = null;
  jobs = $state<AIJob[]>([]);
  loading = $state(false);
  error = $state<Error | null>(null);

  init(service: AIJobQueueService): void {
    this.#service = service;
    void this.refresh();
  }

  async refresh(): Promise<boolean> {
    if (!this.#service) return false;
    this.loading = true;
    this.error = null;
    try {
      const result = await this.#service.list();
      if (!result.ok) {
        this.error = result.error;
        return false;
      }
      this.jobs = result.value;
      return true;
    } finally {
      this.loading = false;
    }
  }

  async queue(input: {
    workspaceId: string;
    requestedByDeviceId: string;
    kind: AIJobKind;
    envelope: AIJobEnvelope;
    policy?: Partial<AIJobPolicy>;
  }): Promise<AIJob | null> {
    if (!this.#service) return null;
    const result = await this.#service.queue(input);
    if (!result.ok) {
      this.error = result.error;
      events.emit('error:user-facing', { source: 'AI job queue', error: result.error });
      return null;
    }
    await this.refresh();
    return result.value;
  }
}

export const aiJobQueueStore = new AIJobQueueStore();
