/**
 * CLITextTransformAdapter - AIProviderPort bridge backed by local AI CLI.
 *
 * The legacy AIProviderPort is still used by AIRewriteService for selected
 * text actions. This adapter keeps that path on the same local CLI assistant
 * provider as the rest of Void instead of using cloud/API-key providers.
 */

import type {
  AIAssistantProviderPort,
  AIProviderPort,
  AIRewriteRequest,
  AIRewriteResponse,
  AIOperation,
} from '$lib/ports/outbound';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import { err, ok, sanitizeCLIErrorMessage, type Result } from '$lib/core';

const SYSTEM_PROMPT = [
  'You transform selected text inside a Void note.',
  'Return only the replacement text.',
  'Do not explain, quote, wrap in Markdown fences, or include alternatives.',
  'Preserve the input language unless the instruction explicitly asks otherwise.',
].join('\n');

function textBlock(label: string, text: string): string {
  return `${label}:\n--- BEGIN VOID SELECTION ---\n${text}\n--- END VOID SELECTION ---`;
}

function buildMessage(operation: string, text: string, instruction: string, context?: string): string {
  return [
    `Operation: ${operation}`,
    `Instruction: ${instruction}`,
    context ? textBlock('Context', context) : '',
    textBlock('Selected text', text),
    'Return only the replacement text.',
  ].filter(Boolean).join('\n\n');
}

function normalizeOutput(text: string): string {
  return text.trim().replace(/^```(?:\w+)?\s*/, '').replace(/\s*```$/, '').trim();
}

export class CLITextTransformAdapter implements AIProviderPort {
  constructor(private readonly assistantProvider: AIAssistantProviderPort) {}

  async isAvailable(): Promise<boolean> {
    return this.assistantProvider.isAvailable();
  }

  async rewrite(request: AIRewriteRequest): Promise<Result<AIRewriteResponse, Error>> {
    const result = await this.runTransform(
      'rewrite',
      request.text,
      request.instruction,
      request.context
    );

    return result.ok
      ? ok({ text: result.value, confidence: 1 })
      : result;
  }

  async expand(text: string, context?: string): Promise<Result<string, Error>> {
    return this.runTransform(
      'expand',
      text,
      'Expand the selected text with useful detail while preserving its voice.',
      context
    );
  }

  async summarize(text: string): Promise<Result<string, Error>> {
    return this.runTransform(
      'summarize',
      text,
      'Summarize the selected text concisely.'
    );
  }

  async fixGrammar(text: string): Promise<Result<string, Error>> {
    return this.runTransform(
      'fix grammar',
      text,
      'Fix grammar, spelling, and punctuation without changing meaning.'
    );
  }

  async custom(
    operation: string,
    text: string,
    instruction?: string
  ): Promise<Result<string, Error>> {
    return this.runTransform(
      operation,
      text,
      instruction ?? 'Transform the selected text according to the operation.'
    );
  }

  async stream(
    operation: AIOperation,
    text: string,
    onChunk: (chunk: string) => void
  ): Promise<Result<void, Error>> {
    const result = await this.custom(operation, text);
    if (!result.ok) return result;
    onChunk(result.value);
    return ok(undefined);
  }

  cancel(): void {
    this.assistantProvider.cancel();
  }

  private async runTransform(
    operation: string,
    text: string,
    instruction: string,
    context?: string
  ): Promise<Result<string, Error>> {
    const result = await this.assistantProvider.prompt({
      message: buildMessage(operation, text, instruction, context),
      systemPrompt: SYSTEM_PROMPT,
      context: createEmptyContext(),
      tools: [],
      conversationHistory: [],
      webAccess: 'off',
    });

    if (!result.ok) {
      return err(new Error(sanitizeCLIErrorMessage(result.error)));
    }

    const transformed = normalizeOutput(result.value.chat);
    if (!transformed) {
      return err(new Error('Local CLI returned an empty rewrite.'));
    }

    return ok(transformed);
  }
}
