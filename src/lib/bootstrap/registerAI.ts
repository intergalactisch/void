/**
 * AI provider registration.
 *
 * Picks the right AIAssistantProviderPort implementation based on the
 * environment: mock for tests/browser dev, otherwise the selected local
 * CLI. API-key providers are intentionally not wired.
 *
 * Extracted from `bootstrap.ts` so the composition root stays readable.
 */

import type { Container } from '$lib/core';
import { TOKENS } from '$lib/core';
import {
  DEFAULT_AI_REASONING_EFFORT,
  type AIReasoningEffort,
  type CLIProviderId,
} from '$lib/domain';
import { MockAIAssistantAdapter, CLIAIAdapter } from '$lib/adapters/ai';
import { getLogger } from '$lib/logging';

const log = getLogger('Bootstrap.AI');

export interface RegisterAIOptions {
  /** When true, register a mock AI provider (tests / browser dev). */
  useMocks: boolean;
  /** Notes base path — used by the CLI adapter. */
  notesPath: string;
  /** Local CLI provider selected in Settings. */
  cliProviderSetting?: CLIProviderId;
  /** Codex reasoning effort selected in Settings. */
  aiReasoningEffort?: AIReasoningEffort;
}

function toPreferredCli(provider: CLIProviderId | undefined): 'claude' | 'codex' {
  return provider === 'claude-code' ? 'claude' : 'codex';
}

/**
 * Register the AIAssistantProvider token. Returns nothing — the caller
 * resolves the provider via the container when needed.
 */
export async function registerAIAssistantProvider(
  container: Container,
  options: RegisterAIOptions
): Promise<void> {
  const { useMocks, notesPath, cliProviderSetting, aiReasoningEffort } = options;

  if (useMocks) {
    container.register(TOKENS.AIAssistantProvider, () => new MockAIAssistantAdapter({ delay: 120 }));
    log.info('Using mock adapter');
    return;
  }

  const cliAdapter = new CLIAIAdapter({
    notesBasePath: notesPath,
    preferredCli: toPreferredCli(cliProviderSetting),
    reasoningEffort: aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
  });
  const cliAvailable = await cliAdapter.isAvailable();

  if (!cliAvailable) {
    log.warn('Selected local CLI is not available', {
      cli: cliAdapter.getActiveCli(),
      selected: cliProviderSetting ?? 'codex',
    });
  }

  container.register(TOKENS.AIAssistantProvider, () => cliAdapter);
  log.info('Using local CLI adapter', {
    cli: cliAdapter.getActiveCli(),
    selected: cliProviderSetting ?? 'codex',
    aiReasoningEffort: aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
  });
}
