/**
 * CLI provider registration.
 *
 * Resolves the CLIProviderPort token based on the user's setting:
 *   - `codex` is the default local CLI backend
 *   - `claude-code` remains available as an explicit local choice
 */

import type { Container } from '$lib/core';
import { TOKENS } from '$lib/core';
import { invoke } from '@tauri-apps/api/core';
import {
  DEFAULT_AI_REASONING_EFFORT,
  type AIReasoningEffort,
  type CLIProviderId,
} from '$lib/domain';
import {
  ConfigurableCLIProvider,
  normalizeCodexCliFlavor,
  type CodexCliFlavor,
} from '$lib/adapters/cli';
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

interface CLIAvailability {
  codex_flavor?: string;
  codexFlavor?: string;
  codex_path?: string;
  codexPath?: string;
}

async function detectCodexInfo(
  useMocks: boolean
): Promise<{ flavor: CodexCliFlavor; binaryPath?: string }> {
  if (useMocks) return { flavor: 'exec' };

  try {
    const availability = await invoke<CLIAvailability>('check_cli_available');
    return {
      flavor: normalizeCodexCliFlavor(availability.codex_flavor ?? availability.codexFlavor),
      ...(availability.codex_path || availability.codexPath
        ? { binaryPath: availability.codex_path ?? availability.codexPath }
        : {}),
    };
  } catch {
    return { flavor: 'exec' };
  }
}

export async function registerCLIProvider(
  container: Container,
  options: RegisterCLIOptions
): Promise<void> {
  const { useMocks, cliProviderSetting, aiReasoningEffort } = options;
  const cliProvider = normalizeCLIProvider(cliProviderSetting);
  const codexInfo = cliProvider === 'codex'
    ? await detectCodexInfo(useMocks)
    : { flavor: 'exec' as const };

  container.register(TOKENS.CLIProvider, () =>
    new ConfigurableCLIProvider({
      cliProvider,
      aiReasoningEffort: aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
      codexFlavor: codexInfo.flavor,
      ...(codexInfo.binaryPath ? { codexBinaryPath: codexInfo.binaryPath } : {}),
    })
  );
  log.info('Using local CLI provider', {
    id: cliProvider,
    codexFlavor: codexInfo.flavor,
    codexPath: codexInfo.binaryPath,
    useMocks,
    aiReasoningEffort: aiReasoningEffort ?? DEFAULT_AI_REASONING_EFFORT,
  });
}
