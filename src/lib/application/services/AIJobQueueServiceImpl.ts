import { err, ok, type Result } from '$lib/core';
import {
  createAIJob,
  type AIJob,
  type AIJobResultBundle,
  type AIJobStatus,
} from '$lib/domain/values';
import type { AIJobQueueService, QueueAIJobInput } from '$lib/ports/inbound';
import type { VoidStoragePort } from '$lib/ports/outbound';

const AI_JOBS_PATH = 'relay/ai-jobs.json';

function createJobId(): string {
  const cryptoLike = globalThis.crypto as Crypto | undefined;
  if (cryptoLike?.randomUUID) return `ai-job-${cryptoLike.randomUUID()}`;
  return `ai-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AIJobQueueServiceImpl implements AIJobQueueService {
  constructor(
    private readonly storage: VoidStoragePort,
    private readonly notesPath: string,
  ) {}

  async list(): Promise<Result<AIJob[], Error>> {
    return this.readAll();
  }

  async get(jobId: string): Promise<Result<AIJob | null, Error>> {
    const jobs = await this.readAll();
    if (!jobs.ok) return err(jobs.error);
    return ok(jobs.value.find((job) => job.id === jobId) ?? null);
  }

  async queue(input: QueueAIJobInput): Promise<Result<AIJob, Error>> {
    if (!input.envelope.encrypted) return err(new Error('AI jobs must be queued as encrypted envelopes'));
    const job = createAIJob({
      id: createJobId(),
      workspaceId: input.workspaceId,
      requestedByDeviceId: input.requestedByDeviceId,
      kind: input.kind,
      envelope: input.envelope,
      ...(input.policy ? { policy: input.policy } : {}),
    });
    const jobs = await this.readAll();
    if (!jobs.ok) return err(jobs.error);
    const saved = await this.writeAll([...jobs.value, job]);
    if (!saved.ok) return err(saved.error);
    return ok(job);
  }

  async updateStatus(
    jobId: string,
    status: AIJobStatus,
    patch: Partial<Pick<AIJob, 'claimedByDeviceId' | 'error'>> = {},
  ): Promise<Result<AIJob | null, Error>> {
    return this.update(jobId, (job) => ({
      ...job,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    }));
  }

  async complete(jobId: string, result: AIJobResultBundle): Promise<Result<AIJob | null, Error>> {
    return this.update(jobId, (job) => ({
      ...job,
      status: 'completed',
      result,
      error: null,
      updatedAt: result.completedAt,
    }));
  }

  cancel(jobId: string): Promise<Result<AIJob | null, Error>> {
    return this.updateStatus(jobId, 'cancelled');
  }

  private async update(jobId: string, mutate: (job: AIJob) => AIJob): Promise<Result<AIJob | null, Error>> {
    const jobs = await this.readAll();
    if (!jobs.ok) return err(jobs.error);
    let updated: AIJob | null = null;
    const next = jobs.value.map((job) => {
      if (job.id !== jobId) return job;
      updated = mutate(job);
      return updated;
    });
    if (!updated) return ok(null);
    const saved = await this.writeAll(next);
    if (!saved.ok) return err(saved.error);
    return ok(updated);
  }

  private async readAll(): Promise<Result<AIJob[], Error>> {
    const result = await this.storage.readJson<AIJob[]>(this.notesPath, AI_JOBS_PATH);
    if (!result.ok) return err(result.error);
    return ok(Array.isArray(result.value) ? result.value : []);
  }

  private writeAll(jobs: AIJob[]): Promise<Result<void, Error>> {
    return this.storage.writeJson(this.notesPath, AI_JOBS_PATH, jobs);
  }
}
