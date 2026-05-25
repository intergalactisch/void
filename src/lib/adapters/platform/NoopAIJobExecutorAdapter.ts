import { err, ok, type Result } from '$lib/core';
import type { AIJob, AIJobResultBundle } from '$lib/domain/values';
import type { AIExecutorCapabilities, AIJobExecutorPort } from '$lib/ports/outbound';

export class NoopAIJobExecutorAdapter implements AIJobExecutorPort {
  async capabilities(): Promise<Result<AIExecutorCapabilities, Error>> {
    return ok({
      deviceId: 'unavailable',
      available: false,
      canRunLocalCli: false,
      supportedKinds: [],
    });
  }

  async execute(_job: AIJob): Promise<Result<AIJobResultBundle, Error>> {
    return err(new Error('No desktop AI executor is connected'));
  }
}
