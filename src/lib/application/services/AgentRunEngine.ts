/**
 * AgentRunEngine - durable journal helpers for orchestration services.
 */

import type { Result } from '$lib/core';
import { ok, err } from '$lib/core';
import type {
  AgentArtifact,
  AgentRun,
  AgentRunEvent,
  AgentRunEventType,
  AgentTask,
  AgentTaskKind,
  AgentTaskStatus,
} from '$lib/domain/entities/AgentRun';
import {
  createAgentRunEvent,
  createAgentTask,
  setAgentTaskStatus,
} from '$lib/domain/entities/AgentRun';
import type { AgentRunStoragePort } from '$lib/ports/outbound/AgentRunStoragePort';
import type { AgentEventStreamPort } from '$lib/ports/outbound/AgentEventStreamPort';

export class AgentRunEngine {
  constructor(
    private readonly storage: AgentRunStoragePort,
    private readonly stream?: AgentEventStreamPort | null
  ) {}

  async appendEvent(
    run: AgentRun,
    type: AgentRunEventType,
    params: {
      taskId?: string;
      artifactId?: string;
      message?: string;
      data?: Record<string, unknown>;
    } = {}
  ): Promise<Result<AgentRun, Error>> {
    const event = createAgentRunEvent({
      runId: run.id,
      type,
      sequence: (run.events?.length ?? 0) + 1,
      ...params,
    });
    const appended = await this.storage.appendEvent(run.id, event);
    if (!appended.ok) return err(appended.error);
    if (this.stream) {
      await this.stream.publish(event);
    }
    const next = {
      ...run,
      events: [...(run.events ?? []), event],
      updatedAt: event.createdAt,
    };
    await this.storage.save(next);
    return ok(next);
  }

  async createTask(
    run: AgentRun,
    params: {
      id?: string;
      title: string;
      kind: AgentTaskKind;
      dependencies?: string[];
      detail?: string;
      parentId?: string | null;
    }
  ): Promise<Result<AgentRun, Error>> {
    const task = createAgentTask({ runId: run.id, aiOnly: true, ...params });
    const next = {
      ...run,
      tasks: [...run.tasks, task],
      updatedAt: task.createdAt,
    };
    return this.appendEvent(next, 'task.created', {
      taskId: task.id,
      message: task.title,
      data: { kind: task.kind, dependencies: task.dependencies },
    });
  }

  async updateTask(
    run: AgentRun,
    taskId: string,
    status: AgentTaskStatus,
    params: { progress?: number; detail?: string; result?: string; error?: string } = {}
  ): Promise<Result<AgentRun, Error>> {
    const originalTask = run.tasks.find((task) => task.id === taskId);
    const updatedTask = originalTask ? setAgentTaskStatus(originalTask, status, params) : null;
    const next: AgentRun = {
      ...run,
      tasks: run.tasks.map((task) => {
        if (task.id !== taskId) return task;
        return updatedTask ?? task;
      }),
      updatedAt: new Date().toISOString(),
    };

    const eventType = taskEventType(status);
    if (!eventType) return ok(next);

    const data: Record<string, unknown> = { status };
    const progress = params.progress ?? updatedTask?.progress;
    if (progress !== undefined) data.progress = progress;
    const eventParams: {
      taskId: string;
      message?: string;
      data: Record<string, unknown>;
    } = {
      taskId,
      data,
    };
    const message = params.error ?? params.result ?? params.detail ?? updatedTask?.title;
    if (message !== undefined) eventParams.message = message;

    return this.appendEvent(next, eventType, eventParams);
  }

  async addArtifact(run: AgentRun, artifact: AgentArtifact): Promise<Result<AgentRun, Error>> {
    const next: AgentRun = {
      ...run,
      artifacts: [...run.artifacts, artifact],
      updatedAt: artifact.createdAt,
    };
    const eventType = artifact.type === 'source'
      ? sourceArtifactEventType(artifact)
      : artifact.type === 'note' && /updated/i.test(artifact.summary ?? '')
        ? 'note.updated'
        : artifact.type === 'note'
          ? 'note.created'
          : 'artifact.created';
    return this.appendEvent(next, eventType, {
      artifactId: artifact.id,
      message: artifact.title,
      data: {
        type: artifact.type,
        path: artifact.path,
        url: artifact.url,
        mediaKind: artifact.mediaKind,
        status: artifact.citation?.status,
      },
    });
  }

  async setStatus(
    run: AgentRun,
    status: AgentRun['status'],
    message?: string
  ): Promise<Result<AgentRun, Error>> {
    const next: AgentRun = {
      ...run,
      status,
      updatedAt: new Date().toISOString(),
    };
    return this.appendEvent(next, 'run.status', {
      message: message ?? status,
      data: { status },
    });
  }
}

function sourceArtifactEventType(artifact: AgentArtifact): AgentRunEventType {
  if (artifact.citation?.status === 'verified') return 'source.verified';
  if (artifact.citation?.status === 'failed') return 'source.failed';
  return 'artifact.created';
}

function taskEventType(status: AgentTaskStatus): AgentRunEventType | null {
  switch (status) {
    case 'running':
      return 'task.started';
    case 'completed':
      return 'task.completed';
    case 'failed':
      return 'task.failed';
    case 'cancelled':
      return 'task.cancelled';
    default:
      return null;
  }
}
