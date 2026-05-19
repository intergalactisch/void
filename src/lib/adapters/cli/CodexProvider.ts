/**
 * CodexProvider - Codex CLI strategy
 *
 * Minimal provider: quiet mode prompt, text-only output,
 * no sessions, no JSON, no tool sandboxing.
 */

import type { CLIProviderPort, CLIBuildParams, ParsedCLIOutput } from '$lib/ports/outbound/CLIProviderPort';
import {
  DEFAULT_AI_REASONING_EFFORT,
  type AIReasoningEffort,
} from '$lib/domain';

export interface CodexProviderOptions {
  reasoningEffort?: AIReasoningEffort;
}

export class CodexProvider implements CLIProviderPort {
  id = 'codex';
  binary = 'codex';
  displayName = 'Codex CLI';

  supportsSession = false;
  supportsResume = false;
  supportsJsonOutput = false;
  supportsToolSandbox = false;
  supportsSystemPrompt = false;
  supportsNativeWebSearch = true;

  private reasoningEffort: AIReasoningEffort;

  constructor(options?: CodexProviderOptions) {
    this.reasoningEffort = options?.reasoningEffort ?? DEFAULT_AI_REASONING_EFFORT;
  }

  buildArgs(params: CLIBuildParams): string[] {
    const args: string[] = [];

    const reasoningEffort = params.reasoningEffort ?? this.reasoningEffort;

    // Codex non-interactive mode. System prompt is prepended since
    // Codex has no native system prompt flag for exec prompts.
    const prompt = params.systemPrompt
      ? `${params.systemPrompt}\n\n---\n\n${params.prompt}`
      : params.prompt;

    if (params.webAccess === 'native') {
      args.push('--search');
    }

    args.push(
      'exec',
      '-c',
      `model_reasoning_effort="${reasoningEffort}"`,
      '--skip-git-repo-check',
      prompt,
    );

    if (params.filePaths) {
      args.push(...params.filePaths);
    }

    return args;
  }

  parseOutput(raw: string, _format: 'text' | 'json'): ParsedCLIOutput {
    // Codex always returns plain text
    return { content: raw, metadata: {} };
  }
}
