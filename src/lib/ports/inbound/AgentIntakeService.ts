/**
 * AgentIntakeService - model-led routing for AI requests.
 *
 * This service decides whether a prompt should stay in normal chat, invoke a
 * single action, or become a durable agent run. The decision is based on app
 * context and a generated tool manifest, not hard-coded prompt keywords.
 */

import type { Result } from '$lib/core';
import type { ToolCategory } from '$lib/domain/entities/Tool';

export type AgentIntakeDecisionKind = 'direct_answer' | 'single_tool_action' | 'agent_run';

export interface ToolCapabilityManifestItem {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  requiresConfirmation: boolean;
  parameters: string[];
}

export interface AgentIntakeDecision {
  kind: AgentIntakeDecisionKind;
  confidence: number;
  rationale: string;
  suggestedToolId?: string;
  suggestedMode?: string;
}

export interface AgentIntakeOptions {
  conversationId?: string;
}

export interface AgentIntakeService {
  decide(prompt: string, options?: AgentIntakeOptions): Promise<Result<AgentIntakeDecision, Error>>;
  getToolManifest(): Promise<Result<ToolCapabilityManifestItem[], Error>>;
}
