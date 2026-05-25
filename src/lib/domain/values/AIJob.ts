export type AIJobKind = 'chat' | 'rewrite' | 'agent-run' | 'tool-action';
export type AIJobStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'awaiting-approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AIJobPolicy {
  autoRunSafe: boolean;
  requiresDesktopApproval: boolean;
  requiresProtectedContextApproval: boolean;
}

export interface AIJobEnvelope {
  encrypted: true;
  algorithm: 'void-sealed-v1';
  keyId: string;
  ciphertext: string;
}

export interface AIJobResultBundle {
  summary: string;
  proposedOperations: unknown[];
  completedAt: string;
  executorDeviceId: string;
}

export interface AIJob {
  id: string;
  workspaceId: string;
  requestedByDeviceId: string;
  claimedByDeviceId: string | null;
  kind: AIJobKind;
  status: AIJobStatus;
  createdAt: string;
  updatedAt: string;
  policy: AIJobPolicy;
  envelope: AIJobEnvelope;
  result: AIJobResultBundle | null;
  error: string | null;
}

export const DEFAULT_AI_JOB_POLICY: AIJobPolicy = {
  autoRunSafe: true,
  requiresDesktopApproval: false,
  requiresProtectedContextApproval: false,
};

export function createAIJob(input: {
  id: string;
  workspaceId: string;
  requestedByDeviceId: string;
  kind: AIJobKind;
  envelope: AIJobEnvelope;
  now?: string;
  policy?: Partial<AIJobPolicy>;
}): AIJob {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    requestedByDeviceId: input.requestedByDeviceId,
    claimedByDeviceId: null,
    kind: input.kind,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    policy: { ...DEFAULT_AI_JOB_POLICY, ...input.policy },
    envelope: input.envelope,
    result: null,
    error: null,
  };
}
