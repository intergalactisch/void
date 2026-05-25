import { err, ok, type Result } from '$lib/core';
import type { AIJob, AIJobResultBundle } from '$lib/domain/values';
import type { AIExecutorCapabilities, AIJobExecutorPort } from '$lib/ports/outbound';

export class MemoryAIJobExecutorAdapter implements AIJobExecutorPort {
  private available = false;

  constructor(private readonly deviceId = 'memory-desktop') {}

  async capabilities(): Promise<Result<AIExecutorCapabilities, Error>> {
    return ok({
      deviceId: this.deviceId,
      available: this.available,
      canRunLocalCli: this.available,
      supportedKinds: ['chat', 'rewrite', 'agent-run', 'tool-action'],
    });
  }

  async execute(job: AIJob): Promise<Result<AIJobResultBundle, Error>> {
    if (!this.available) return err(new Error('No trusted desktop AI executor is available'));
    return ok({
      summary: `Executed ${job.kind} in memory`,
      proposedOperations: [],
      completedAt: new Date().toISOString(),
      executorDeviceId: this.deviceId,
    });
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }
}
