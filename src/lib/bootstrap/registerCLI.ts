/**
 * CLI provider registration.
 *
 * Resolves the CLIProviderPort token based on the user's setting:
 *   - `codex` is the default local CLI backend
 *   - `claude-code` remains available as an explicit local choice
 */

import type { Container } from '$lib/core';
import { TOKENS } from '$lib/core';
import {
  DEFAULT_AI_REASONING_EFFORT,
  type AIReasoningEffort,
  type CLIProviderId,
} from '$lib/domain';
import { ConfigurableCLIProvider } from '$lib/adapters/cli';
import { getLogger } from '$lib/logging';

const log = getLogger('Bootstrap.CLI');

export interface RegisterCLIOptions {
  /** When true, skip auto-detect (no Tauri runtime). */
  useMocks: boolean;
  /** Explicit user choice: 'claude-code' | 'codex' (legacy 'auto' maps to 'codex'). */
  cliProviderSetting: string | undefined;
  /** Codex CLI reasoning effort. */
  aiReasoningEffort?: AIReasoningEffort;
}

function normalizeCLIProvider(setting: string | undefined): CLIProviderId {
  return setting === 'claude-code' ? 'claude-code' : 'codex';
}

export async function registerCLIProvider(
  container: Container,
  options: RegisterCLIOptions
): Promise<void> {
  const { useMocks, cliProviderSetting, aiReasoningEffort } = options;
  const cliProvider = normalizeCLIProvider(cliProviderSetting);

  container.register(TOKENS.CLIProvider, () =>
    new ConfigurableCLIProvider({
      cliProvider,
      aiReasoningEffort: aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
    })
  );
  log.info('Using local CLI provider', {
    id: cliProvider,
    useMocks,
    aiReasoningEffort: aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
  });
}
