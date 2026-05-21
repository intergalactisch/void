/**
 * ConfigurableCLIProvider - stable provider handle for runtime settings.
 *
 * OperationService keeps a provider reference for its lifetime. This wrapper
 * lets settings changes swap the underlying local CLI strategy without
 * rebuilding the service graph.
 */

import type {
  CLIProviderPort,
  CLIBuildParams,
  ParsedCLIOutput,
} from '$lib/ports/outbound/CLIProviderPort';
import {
  DEFAULT_AI_REASONING_EFFORT,
  type AIReasoningEffort,
  type CLIProviderId,
} from '$lib/domain';
import { ClaudeCodeProvider } from './ClaudeCodeProvider';
import { CodexProvider, type CodexCliFlavor } from './CodexProvider';

export interface ConfigurableCLIProviderOptions {
  cliProvider: CLIProviderId;
  aiReasoningEffort?: AIReasoningEffort;
  codexFlavor?: CodexCliFlavor;
  codexBinaryPath?: string;
}

function createProvider(options: ConfigurableCLIProviderOptions): CLIProviderPort {
  if (options.cliProvider === 'claude-code') {
    return new ClaudeCodeProvider();
  }

  return new CodexProvider({
    reasoningEffort: options.aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
    flavor: options.codexFlavor ?? 'exec',
    ...(options.codexBinaryPath ? { binaryPath: options.codexBinaryPath } : {}),
  });
}

export class ConfigurableCLIProvider implements CLIProviderPort {
  private options: Required<ConfigurableCLIProviderOptions>;
  private provider: CLIProviderPort;

  constructor(options: ConfigurableCLIProviderOptions) {
    this.options = {
      cliProvider: options.cliProvider,
      aiReasoningEffort: options.aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
      codexFlavor: options.codexFlavor ?? 'exec',
      codexBinaryPath: options.codexBinaryPath ?? '',
    };
    this.provider = createProvider(this.options);
  }

  configure(options: Partial<ConfigurableCLIProviderOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
    this.provider = createProvider(this.options);
  }

  get id(): string {
    return this.provider.id;
  }

  get binary(): string {
    return this.provider.binary;
  }

  get displayName(): string {
    return this.provider.displayName;
  }

  get supportsSession(): boolean {
    return this.provider.supportsSession;
  }

  get supportsResume(): boolean {
    return this.provider.supportsResume;
  }

  get supportsJsonOutput(): boolean {
    return this.provider.supportsJsonOutput;
  }

  get supportsToolSandbox(): boolean {
    return this.provider.supportsToolSandbox;
  }

  get supportsSystemPrompt(): boolean {
    return this.provider.supportsSystemPrompt;
  }

  get supportsNativeWebSearch(): boolean {
    return this.provider.supportsNativeWebSearch;
  }

  buildArgs(params: CLIBuildParams): string[] {
    return this.provider.buildArgs({
      ...params,
      reasoningEffort: params.reasoningEffort ?? this.options.aiReasoningEffort,
    });
  }

  parseOutput(raw: string, format: 'text' | 'json'): ParsedCLIOutput {
    return this.provider.parseOutput(raw, format);
  }
}
