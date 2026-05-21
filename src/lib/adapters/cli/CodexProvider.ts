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
import { KEYLESS_CODEX_UNSUPPORTED_MESSAGE } from '$lib/core';

export type CodexCliFlavor = 'exec' | 'legacy' | 'api-key-only';

export interface CodexProviderOptions {
  reasoningEffort?: AIReasoningEffort;
  flavor?: CodexCliFlavor;
  binaryPath?: string;
}

export function normalizeCodexCliFlavor(value: unknown): CodexCliFlavor {
  return value === 'legacy' || value === 'api-key-only' ? value : 'exec';
}

export class CodexProvider implements CLIProviderPort {
  id = 'codex';
  binary: string;
  displayName = 'Codex CLI';

  supportsSession = false;
  supportsResume = false;
  supportsJsonOutput = false;
  supportsToolSandbox = false;
  supportsSystemPrompt = false;
  supportsNativeWebSearch: boolean;

  private reasoningEffort: AIReasoningEffort;
  private flavor: CodexCliFlavor;

  constructor(options?: CodexProviderOptions) {
    this.reasoningEffort = options?.reasoningEffort ?? DEFAULT_AI_REASONING_EFFORT;
    this.flavor = normalizeCodexCliFlavor(options?.flavor);
    this.binary = options?.binaryPath?.trim() || 'codex';
    this.supportsNativeWebSearch = this.flavor === 'exec';
  }

  buildArgs(params: CLIBuildParams): string[] {
    if (this.flavor === 'api-key-only') {
      throw new Error(KEYLESS_CODEX_UNSUPPORTED_MESSAGE);
    }

    const args: string[] = [];

    const reasoningEffort = params.reasoningEffort ?? this.reasoningEffort;

    // Codex non-interactive mode. System prompt is prepended since
    // Codex has no native system prompt flag for exec prompts.
    const prompt = params.systemPrompt
      ? `${params.systemPrompt}\n\n---\n\n${params.prompt}`
      : params.prompt;

    if (this.flavor === 'legacy') {
      return ['-q', prompt];
    }

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
