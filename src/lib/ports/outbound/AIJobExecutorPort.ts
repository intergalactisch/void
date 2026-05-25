import type { Result } from '$lib/core';
import type { AIJob, AIJobResultBundle } from '$lib/domain/values';

export interface AIExecutorCapabilities {
  deviceId: string;
  available: boolean;
  canRunLocalCli: boolean;
  supportedKinds: AIJob['kind'][];
}

export interface AIJobExecutorPort {
  capabilities(): Promise<Result<AIExecutorCapabilities, Error>>;
  execute(job: AIJob): Promise<Result<AIJobResultBundle, Error>>;
}
