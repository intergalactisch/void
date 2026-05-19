/**
 * AgentLoopService - Inbound port for multi-turn agentic AI execution
 *
 * The agentic loop feeds tool results back to the AI so it can make
 * more tool calls. When the AI responds with stopReason 'tool_use',
 * tools are executed and results sent back for the next turn.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';

/** Options for running an agent loop */
export interface AgentOptions {
  /** Maximum turns before stopping (default 15) */
  maxTurns?: number;
  /** Maximum concurrent tool executions (default 5) */
  maxConcurrency?: number;
  /** Continue an existing conversation */
  conversationId?: string;
  /**
   * Keep provider scratch turns out of the visible chat transcript.
   * The caller may still provide a displayMessage for the first turn.
   */
  hideInternalMessages?: boolean;
  /** User-facing message to show for the first turn when hiding internals. */
  displayMessage?: string | null;
  /** Approval callback: called when the AI declares a plan with write operations */
  onPlanReady?: (plan: AgentPlan) => Promise<boolean>;
  /** Called after each tool finishes so orchestrators can stream artifacts live. */
  onToolCompleted?: (invocation: ToolInvocation) => Promise<void>;
  /** Whether provider turns in this loop may use native internet research. */
  webAccess?: AIWebAccess;
  /** Optional caller-owned cancellation signal for this specific loop. */
  signal?: AbortSignal;
}

/** A plan declared by the AI before executing */
export interface AgentPlan {
  summary: string;
  steps: AgentPlanStep[];
}

/** A single step in an agent plan */
export interface AgentPlanStep {
  description: string;
  tools: string[];
  notes?: string[];
}

/** Result of an agent loop execution */
export interface AgentResult {
  /** Total turns executed */
  turns: number;
  /** Final chat response from the AI */
  finalResponse: string;
  /** All tool invocations across all turns */
  toolInvocations: ToolInvocation[];
  /** Conversation ID used */
  conversationId: string;
  /** Whether the loop was cancelled */
  cancelled: boolean;
  /** Non-null when the operation runner or provider failed */
  error?: Error;
}

/** Observable state of the agent loop */
export interface AgentState {
  status: 'idle' | 'planning' | 'executing' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  currentTurn: number;
  maxTurns: number;
  plan?: AgentPlan;
  activeTools: ToolInvocation[];
  completedTools: ToolInvocation[];
  operationId?: string;
}

export interface AgentLoopService {
  /**
   * Run an agentic loop: prompt the AI, execute tools, feed results back, repeat.
   * The loop continues until the AI responds without tool calls or max turns is reached.
   */
  run(prompt: string, options?: AgentOptions): Promise<AgentResult>;

  /**
   * Cancel the currently running agent loop.
   */
  cancel(): void;

  /**
   * Get the current state of the agent loop.
   */
  getState(): AgentState;

  /**
   * Subscribe to agent state changes.
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: AgentState) => void): () => void;
}
