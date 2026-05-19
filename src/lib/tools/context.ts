/**
 * Tool service context
 *
 * The `ToolServices` aggregate is defined alongside the inbound ports
 * (`$lib/ports/inbound/ToolServices`). This module re-exports it for
 * tool authors and provides convenience helpers like `aiPrompt`.
 */

export type { ToolServices, ToolServicesProvider } from '$lib/ports/inbound/ToolServices';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import { createEmptyContext } from '$lib/domain/values/PromptContext';

/**
 * Send a simple AI prompt and return the chat text.
 * Convenience helper for content/transform tools.
 */
export async function aiPrompt(
  services: ToolServices,
  message: string
): Promise<string> {
  const result = await services.ai.prompt({
    message,
    context: createEmptyContext(),
    tools: [],
    conversationHistory: [],
  });

  if (!result.ok) {
    throw new Error(`AI prompt failed: ${result.error.message}`);
  }

  return result.value.chat;
}
