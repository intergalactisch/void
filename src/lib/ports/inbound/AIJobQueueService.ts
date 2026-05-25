import type { Result } from '$lib/core';
import type { AIJob, AIJobEnvelope, AIJobKind, AIJobPolicy, AIJobResultBundle, AIJobStatus } from '$lib/domain/values';

export interface QueueAIJobInput {
  workspaceId: string;
  requestedByDeviceId: string;
  kind: AIJobKind;
  envelope: AIJobEnvelope;
  policy?: Partial<AIJobPolicy>;
}

export interface AIJobQueueService {
  list(): Promise<Result<AIJob[], Error>>;
  get(jobId: string): Promise<Result<AIJob | null, Error>>;
  queue(input: QueueAIJobInput): Promise<Result<AIJob, Error>>;
  updateStatus(jobId: string, status: AIJobStatus, patch?: Partial<Pick<AIJob, 'claimedByDeviceId' | 'error'>>): Promise<Result<AIJob | null, Error>>;
  complete(jobId: string, result: AIJobResultBundle): Promise<Result<AIJob | null, Error>>;
  cancel(jobId: string): Promise<Result<AIJob | null, Error>>;
}
