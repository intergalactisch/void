/**
 * MockAIAssistantAdapter - assistant-compatible mock provider.
 */

import { ok, err, type Result } from '$lib/core';
import type {
  AIAssistantProviderPort,
  AIAssistantRequest,
  AIProviderConnectionConfig,
} from '$lib/ports/outbound/AIAssistantProviderPort';
import type { AIResponse, AIResponseChunk } from '$lib/domain/values/AIResponse';
import type { AIProviderType } from '$lib/domain/values/AIProviderType';

export interface MockAIAssistantAdapterOptions {
  delay?: number;
  simulateUnavailable?: boolean;
  simulateError?: boolean;
  errorMessage?: string;
}

export class MockAIAssistantAdapter implements AIAssistantProviderPort {
  private abortController: AbortController | null = null;
  private options: Required<MockAIAssistantAdapterOptions>;

  constructor(options: MockAIAssistantAdapterOptions = {}) {
    this.options = {
      delay: options.delay ?? 200,
      simulateUnavailable: options.simulateUnavailable ?? false,
      simulateError: options.simulateError ?? false,
      errorMessage: options.errorMessage ?? 'Simulated assistant error',
    };
  }

  getProviderType(): AIProviderType {
    return 'mock';
  }

  async isAvailable(): Promise<boolean> {
    await this.delay(10);
    return !this.options.simulateUnavailable;
  }

  async configure(_config: AIProviderConnectionConfig): Promise<void> {
    return undefined;
  }

  async prompt(request: AIAssistantRequest): Promise<Result<AIResponse, Error>> {
    if (this.options.simulateError) {
      await this.delay();
      return err(new Error(this.options.errorMessage));
    }

    await this.delay();
    return ok(this.buildResponse(request));
  }

  async stream(
    request: AIAssistantRequest,
    onChunk: (chunk: AIResponseChunk) => void
  ): Promise<Result<AIResponse, Error>> {
    this.abortController = new AbortController();
    const response = this.buildResponse(request);
    const words = response.chat.split(/(\s+)/);
    for (const word of words) {
      if (this.abortController.signal.aborted) {
        return err(new Error('Cancelled'));
      }
      onChunk({ type: 'chat', chatDelta: word });
      await this.delay(15);
    }
    return ok(response);
  }

  cancel(): void {
    this.abortController?.abort();
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getMaxContextSize(): number {
    return 32_000;
  }

  async getAvailableModels(): Promise<string[]> {
    return ['mock-assistant'];
  }

  async getRateLimitStatus(): Promise<null> {
    return null;
  }

  private buildResponse(request: AIAssistantRequest): AIResponse {
    const isIntake = request.systemPrompt?.includes('Void intake') ?? false;
    const isSwarmPlanner = request.message.includes('Decompose this Void command-center request');
    const isSwarmWorker = request.systemPrompt?.includes('bounded Void worker agent') ?? false;
    const isSwarmWrite = request.message.includes('You are the main Void orchestrator') ||
      request.message.includes('Worker results:');
    const isAgentContinuation = request.message.includes('Continue the same approved agent run');

    const chat = isIntake
      ? JSON.stringify({
          kind: 'direct_answer',
          confidence: 0.5,
          rationale: 'Mock provider keeps browser/test prompts in normal chat unless a test supplies a model decision.',
        })
      : isSwarmPlanner
        ? JSON.stringify({
            summary: 'Mock swarm plan',
            rationale: 'Mock workers split context gathering and drafting for browser tests.',
            mergeCriteria: ['Create one clear overview note', 'Preserve caveats from workers'],
            workers: [
              {
                title: 'Find relevant context',
                role: 'researcher',
                objective: 'Inspect available note context and summarize what matters.',
                input: request.message.slice(0, 400),
                deliverables: ['Relevant context', 'Gaps'],
                dependencies: [],
                allowedTools: ['note:list', 'search:content'],
              },
              {
                title: 'Draft note material',
                role: 'drafter',
                objective: 'Draft concise material the orchestrator can merge into notes.',
                input: request.message.slice(0, 400),
                deliverables: ['Draft sections', 'Follow-ups'],
                dependencies: [],
                allowedTools: ['note:list', 'search:content'],
              },
            ],
          })
        : isSwarmWorker
          ? JSON.stringify({
              summary: 'Mock worker completed its bounded task.',
              findings: [
                'The orchestrator should remain the only writer.',
                'Worker outputs should be treated as drafts until merged.',
              ],
              artifactDrafts: [
                {
                  type: 'note',
                  title: 'Mock Swarm Overview',
                  content: '# Mock Swarm Overview\n\nWorkers gathered context and draft material for the orchestrator.',
                  summary: 'Draft overview material',
                  confidence: 0.75,
                },
              ],
              citations: [],
              risks: ['Mock data is for browser verification only.'],
              nextActions: ['Review the generated note.'],
              confidence: 0.75,
            })
          : isAgentContinuation
            ? 'Created the mock swarm research notes.'
            : isSwarmWrite
              ? 'Creating the merged mock swarm research notes.'
      : `Mock response: ${request.message.slice(0, 240)}`;

    const toolCalls = isSwarmWrite
      ? [
          {
            id: 'tc_mock_swarm_note',
            toolId: 'note:create' as never,
            args: {
              title: 'Mock Swarm Overview',
              folder: 'Research/Mock Swarm',
              content: [
                '# Mock Swarm Overview',
                '',
                'This note was created by the mock in-app swarm e2e path.',
                '',
                '- Workers gathered context and draft material.',
                '- The orchestrator applied the final write.',
              ].join('\n'),
              autoFocus: false,
            },
          },
          {
            id: 'tc_mock_swarm_sources',
            toolId: 'note:create' as never,
            args: {
              title: 'Mock Swarm Sources',
              folder: 'Research/Mock Swarm',
              content: [
                '# Mock Swarm Sources',
                '',
                'Mocked source notes prove multi-note research folders stay visible.',
                '',
                '- Source review is isolated from final note writing.',
                '- Folder focus should open after multiple notes are written.',
              ].join('\n'),
              autoFocus: false,
            },
          },
        ]
      : [];

    return {
      chat,
      toolCalls,
      meta: {
        provider: 'mock',
        model: 'mock-assistant',
        latencyMs: this.options.delay,
        usage: {
          inputTokens: this.estimateTokens(request.message),
          outputTokens: this.estimateTokens(chat),
          totalTokens: this.estimateTokens(request.message) + this.estimateTokens(chat),
        },
      },
      truncated: false,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    };
  }

  private delay(ms = this.options.delay): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
