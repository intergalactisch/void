/**
 * AgentWorkerBus - internal MCP-shaped communication helper.
 *
 * The bus shape is intentionally protocol-like even though v1 stays in-app:
 * worker messages have stable types, payloads, and durable run events.
 */

import type {
  AgentRunEventType,
  AgentWorkerMessage,
  AgentWorkerMessageType,
  AgentWorkerResult,
  AgentArtifactDraft,
} from '$lib/domain/entities/AgentRun';
import { createAgentWorkerMessage } from '$lib/domain/entities/AgentRun';

export interface WorkerBusMessageInput {
  runId: string;
  type: AgentWorkerMessageType;
  message: string;
  workerId?: string;
  progress?: number;
  toolId?: string;
  artifactDraft?: AgentArtifactDraft;
  result?: AgentWorkerResult;
  data?: Record<string, unknown>;
}

export class AgentWorkerBus {
  createMessage(input: WorkerBusMessageInput): AgentWorkerMessage {
    return createAgentWorkerMessage(input);
  }

  eventTypeFor(message: AgentWorkerMessage): AgentRunEventType {
    switch (message.type) {
      case 'worker.result':
        return 'worker.completed';
      case 'worker.failed':
        return 'worker.failed';
      case 'orchestrator.merge_decision':
        return 'merge.completed';
      default:
        return 'worker.message';
    }
  }
}
