/**
 * CLIAIAdapter - AI provider that delegates to CLI tools (claude, codex)
 *
 * Primary AI path: detects locally installed CLI tools and spawns them
 * against the user's note file. No API key needed.
 *
 * Supports:
 * - Claude CLI (`claude --print -p "prompt" file`)
 * - Codex CLI (`codex exec ... "prompt"` on newer builds, `codex -q "prompt"` on legacy builds)
 *
 * Part of the Hexagonal Architecture adapter layer.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  KEYLESS_CODEX_UNSUPPORTED_MESSAGE,
  sanitizeCLIErrorMessage,
  type Result,
} from '$lib/core';
import type { AIResponse, AIResponseChunk, AIStatusUpdate } from '$lib/domain/values/AIResponse';
import { getLogger } from '$lib/logging';
import { createEmptyResponse, parseToolCalls, extractChatContent } from '$lib/domain/values/AIResponse';
import type { AIProviderType } from '$lib/domain/values/AIProviderType';
import type { Tool } from '$lib/domain/entities/Tool';
import { formatToolForAI } from '$lib/domain/entities/Tool';
import {
  DEFAULT_AI_REASONING_EFFORT,
  type AIReasoningEffort,
} from '$lib/domain';
import type {
  AIAssistantProviderPort,
  AIAssistantRequest,
  AIProviderConnectionConfig,
} from '$lib/ports/outbound';

interface CLIAvailability {
  claude: boolean;
  codex: boolean;
  codex_flavor?: 'exec' | 'legacy' | 'api-key-only' | string;
  codexFlavor?: 'exec' | 'legacy' | 'api-key-only' | string;
  codex_version?: string;
  codexVersion?: string;
  codex_path?: string;
  codexPath?: string;
}

interface CLIAIResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  /** Codex `--output-last-message` payload, when present. Preferred over re-parsing stdout. */
  final_message?: string;
}

export interface CLIProgressPayload {
  request_id?: string;
  requestId?: string;
  stream: 'stdout' | 'stderr' | string;
  line: string;
  sequence?: number;
}

export interface CLIAIAdapterOptions {
  /** Preferred CLI tool (auto-detected if not specified) */
  preferredCli?: 'claude' | 'codex';
  /** Base path for resolving relative note paths to absolute */
  notesBasePath?: string;
  /** Codex CLI reasoning effort. Claude ignores this. */
  reasoningEffort?: AIReasoningEffort;
}

const log = getLogger('CLIAdapter');
const STATUS_THROTTLE_MS = 1_000;

function getCodexFlavor(availability: CLIAvailability): string | undefined {
  return availability.codex_flavor ?? availability.codexFlavor;
}

function getCodexVersion(availability: CLIAvailability): string | undefined {
  return availability.codex_version ?? availability.codexVersion;
}

function getCodexPath(availability: CLIAvailability): string | undefined {
  return availability.codex_path ?? availability.codexPath;
}

function isCodexApiKeyOnly(availability: CLIAvailability | null): boolean {
  return availability ? getCodexFlavor(availability) === 'api-key-only' : false;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function sanitizeDetail(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;

  const collapsed = text
    .replace(/\s+/g, ' ')
    .replace(/<stdin>[\s\S]*?<\/stdin>/g, '<stdin>')
    .trim();

  if (!collapsed || collapsed.startsWith('{')) return undefined;
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

function status(
  id: string,
  label: string,
  state: AIStatusUpdate['status'] = 'running',
  detail?: string
): AIResponseChunk {
  return {
    type: 'status',
    status: {
      id,
      status: state,
      label,
      ...(detail ? { detail } : {}),
    },
  };
}

function getNestedString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function mapCodexJsonEvent(event: Record<string, unknown>): AIResponseChunk | null {
  const type = asString(event.type)?.toLowerCase() ?? '';
  const item = asRecord(event.item) ?? asRecord(event.msg) ?? asRecord(event.message) ?? event;
  const itemType = asString(item.type)?.toLowerCase() ?? '';
  const combinedType = `${type} ${itemType}`;

  if (combinedType.includes('session')) {
    if (combinedType.includes('completed') || combinedType.includes('finished')) {
      return status('cli-finalize', 'Finalizing the response', 'completed');
    }
    return status('cli-start', 'Started local agent');
  }

  if (combinedType.includes('turn') && combinedType.includes('started')) {
    return status('cli-think', 'Thinking through the request');
  }

  if (combinedType.includes('reasoning')) {
    return status('cli-think', 'Thinking through the request');
  }

  if (
    combinedType.includes('command') ||
    combinedType.includes('exec') ||
    combinedType.includes('tool') ||
    combinedType.includes('function')
  ) {
    const command =
      getNestedString(item, ['command', 'cmd', 'name', 'tool', 'tool_name']) ??
      getNestedString(event, ['command', 'cmd', 'name', 'tool', 'tool_name']);
    const done =
      combinedType.includes('completed') ||
      combinedType.includes('finished') ||
      combinedType.includes('success');
    return status(
      'cli-tool',
      command ? 'Using local tools' : 'Using tools',
      done ? 'completed' : 'running',
      sanitizeDetail(command)
    );
  }

  if (combinedType.includes('message') || combinedType.includes('assistant')) {
    return status('cli-draft', 'Drafting the response');
  }

  if (combinedType.includes('completed') || combinedType.includes('finished')) {
    return status('cli-finalize', 'Finalizing the response', 'completed');
  }

  return null;
}

function mapClaudeJsonEvent(event: Record<string, unknown>): AIResponseChunk | null {
  const type = asString(event.type)?.toLowerCase() ?? '';

  if (type === 'system') {
    return status('cli-start', 'Started Claude Code');
  }

  if (type === 'message_start') {
    return status('cli-think', 'Thinking through the request');
  }

  if (type === 'content_block_start') {
    const block = asRecord(event.content_block);
    const blockType = asString(block?.type)?.toLowerCase() ?? '';
    if (blockType === 'tool_use') {
      return status(
        'cli-tool',
        'Using local tools',
        'running',
        sanitizeDetail(block?.name)
      );
    }
    return status('cli-draft', 'Drafting the response');
  }

  if (type === 'content_block_delta') {
    return status('cli-draft', 'Drafting the response');
  }

  if (type === 'content_block_stop') {
    return status('cli-tool', 'Using local tools', 'completed');
  }

  if (type === 'message_stop') {
    return status('cli-finalize', 'Finalizing the response');
  }

  if (type === 'assistant') {
    return status('cli-draft', 'Drafting the response');
  }

  if (type === 'result') {
    return status('cli-finish', 'Finished local agent', 'completed');
  }

  return null;
}

function mapTextProgress(payload: CLIProgressPayload): AIResponseChunk | null {
  const line = payload.line.trim();
  if (!line) return null;

  if (/could not update path|operation not permitted|warning: proceeding/i.test(line)) {
    return null;
  }

  // Plain stdout is often the final answer in text-mode CLIs, so avoid turning
  // it into persisted work-log detail.
  if (payload.stream === 'stdout') {
    return null;
  }

  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('failed')) {
    return status('cli-diagnostic', 'Checking local agent output', 'running');
  }
  if (lower.includes('search') || lower.includes('grep')) {
    return status('cli-search', 'Searching context');
  }
  if (lower.includes('read')) {
    return status('cli-read', 'Reading context');
  }
  if (lower.includes('write') || lower.includes('edit') || lower.includes('create')) {
    return status('cli-write', 'Preparing note changes');
  }

  return status('cli-work', 'Working on the request');
}

export function mapCLIProgressToStatus(
  payload: CLIProgressPayload,
  cli: 'claude' | 'codex'
): AIResponseChunk | null {
  const parsed = parseJsonLine(payload.line);
  if (parsed) {
    return cli === 'codex'
      ? mapCodexJsonEvent(parsed) ?? mapClaudeJsonEvent(parsed)
      : mapClaudeJsonEvent(parsed) ?? mapCodexJsonEvent(parsed);
  }

  return mapTextProgress(payload);
}

function extractTextFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(extractTextFromContent).filter(Boolean).join('');
  }

  const record = asRecord(value);
  if (!record) return '';

  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  return extractTextFromContent(record.content);
}

export function extractCLIResultContent(cli: 'claude' | 'codex', rawOutput: string): string {
  const lines = rawOutput.split(/\r?\n/).filter((line) => line.trim().startsWith('{'));
  if (lines.length === 0) return rawOutput;

  let resultText = '';
  let lastAssistantText = '';

  for (const line of lines) {
    const event = parseJsonLine(line);
    if (!event) continue;

    if (typeof event.result === 'string') {
      resultText = event.result;
    }

    const type = asString(event.type)?.toLowerCase() ?? '';
    const role = asString(event.role)?.toLowerCase();
    const message = asRecord(event.message);
    const messageRole = asString(message?.role)?.toLowerCase();
    const item = asRecord(event.item) ?? asRecord(event.msg);
    const itemRole = asString(item?.role)?.toLowerCase();
    const itemType = asString(item?.type)?.toLowerCase() ?? '';

    if (
      role === 'assistant' ||
      messageRole === 'assistant' ||
      itemRole === 'assistant' ||
      type.includes('assistant') ||
      type.includes('agent_message') ||
      itemType.includes('agent_message') ||
      (itemRole === 'assistant' && itemType.includes('message'))
    ) {
      const text =
        extractTextFromContent(event.content) ||
        extractTextFromContent(item?.content) ||
        extractTextFromContent(message?.content) ||
        extractTextFromContent(event.message) ||
        extractTextFromContent(event.item) ||
        extractTextFromContent(event.msg);
      if (text.trim()) {
        lastAssistantText = text;
      }
    }
  }

  return (resultText || lastAssistantText || rawOutput).trim();
}

export class CLIAIAdapter implements AIAssistantProviderPort {
  private availability: CLIAvailability | null = null;
  private activeCli: 'claude' | 'codex' | null = null;
  private preferredCli: 'claude' | 'codex' | undefined;
  private notesBasePath: string;
  private reasoningEffort: AIReasoningEffort;
  private cancelled = false;

  constructor(options?: CLIAIAdapterOptions) {
    this.preferredCli = options?.preferredCli;
    this.notesBasePath = options?.notesBasePath ?? '';
    this.reasoningEffort = options?.reasoningEffort ?? DEFAULT_AI_REASONING_EFFORT;
  }

  /** Update the notes base path (called when settings change) */
  setNotesBasePath(path: string): void {
    this.notesBasePath = path;
  }

  /** Update the selected local CLI when Settings changes. */
  setPreferredCli(cli: 'claude' | 'codex'): void {
    this.preferredCli = cli;
    this.availability = null;
    this.activeCli = null;
  }

  /** Update Codex reasoning effort when Settings changes. */
  setReasoningEffort(reasoningEffort: AIReasoningEffort): void {
    this.reasoningEffort = reasoningEffort;
  }

  getProviderType(): AIProviderType {
    return 'claude'; // Falls under Claude provider umbrella
  }

  async isAvailable(): Promise<boolean> {
    await this.detectCLI();
    return this.activeCli !== null;
  }

  async configure(_config: AIProviderConnectionConfig): Promise<void> {
    await this.detectCLI();
  }

  async prompt(request: AIAssistantRequest): Promise<Result<AIResponse, Error>> {
    return this.runPrompt(request);
  }

  async stream(
    request: AIAssistantRequest,
    onChunk: (chunk: AIResponseChunk) => void
  ): Promise<Result<AIResponse, Error>> {
    const result = await this.runPrompt(request, onChunk);

    if (result.ok) {
      // Emit the chat content
      onChunk({ type: 'chat', chatDelta: result.value.chat });

      // Emit tool call chunks so the streaming pipeline picks them up
      result.value.toolCalls.forEach((tc, i) => {
        onChunk({ type: 'tool_start', toolCall: tc, toolIndex: i });
        onChunk({ type: 'tool_end', toolCall: tc, toolIndex: i });
      });
    }

    return result;
  }

  private async runPrompt(
    request: AIAssistantRequest,
    onChunk?: (chunk: AIResponseChunk) => void
  ): Promise<Result<AIResponse, Error>> {
    if (!this.activeCli) {
      await this.detectCLI();
    }

    if (!this.activeCli) {
      const selected = this.preferredCli === 'claude' ? 'Claude Code' : 'Codex';
      return { ok: false, error: new Error(`${selected} CLI not found. Install it or choose another local CLI in Settings.`) };
    }

    if (this.activeCli === 'codex' && isCodexApiKeyOnly(this.availability)) {
      await this.detectCLI(true);
    }

    if (this.activeCli === 'codex' && isCodexApiKeyOnly(this.availability)) {
      return { ok: false, error: new Error(KEYLESS_CODEX_UNSUPPORTED_MESSAGE) };
    }

    // Get the file path from context and resolve to absolute (optional — AI works without a note)
    const relativePath = request.context.currentNote?.path;
    const filePath = relativePath
      ? (relativePath.startsWith('/') ? relativePath : `${this.notesBasePath}/${relativePath}`)
      : null;

    this.cancelled = false;
    const startTime = Date.now();
    const requestId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let unlisten: UnlistenFn | null = null;

    log.info('Sending prompt', { cli: this.activeCli, messageLength: request.message.length, filePath: filePath ?? null });

    try {
      if (onChunk) {
        onChunk(status('cli-start', `Starting ${this.activeCli === 'codex' ? 'Codex' : 'Claude Code'}`));
        unlisten = await this.listenForProgress(requestId, this.activeCli, onChunk);
      }

      const result = await invoke<CLIAIResult>('run_cli_prompt', {
        cli: this.activeCli,
        prompt: buildCLIPrompt(request),
        filePath,
        workingDirectory: this.notesBasePath || undefined,
        systemPrompt: request.systemPrompt || undefined,
        reasoningEffort: this.reasoningEffort,
        webAccess: request.webAccess ?? 'off',
        requestId: onChunk ? requestId : undefined,
      });

      if (this.cancelled) {
        log.info('Request cancelled');
        return { ok: false, error: new Error('Request cancelled') };
      }

      if (result.timed_out) {
        log.error('CLI timed out', { cli: this.activeCli, latencyMs: Date.now() - startTime });
        onChunk?.(status('cli-finish', 'Local agent timed out', 'failed'));
        return { ok: false, error: new Error('CLI timed out after 5 minutes') };
      }

      if (result.exit_code !== 0) {
        const rawError = result.stderr || result.stdout || `CLI exited with code ${result.exit_code}`;
        const sanitizedError = sanitizeCLIErrorMessage(rawError);
        const hasSensitiveGuidance = sanitizedError !== rawError;
        if (result.stdout.trim() && !hasSensitiveGuidance) {
          log.warn('CLI exited non-zero with stdout; attempting to parse output', {
            cli: this.activeCli,
            exitCode: result.exit_code,
            stderr: sanitizeCLIErrorMessage(result.stderr),
          });
        } else {
          log.error('CLI exited with error', {
            cli: this.activeCli,
            exitCode: result.exit_code,
            stderr: sanitizedError,
          });
          onChunk?.(status('cli-finish', 'Local agent failed', 'failed'));
          return {
            ok: false,
            error: new Error(sanitizedError),
          };
        }
      }

      const finalMessage = result.final_message?.trim();
      const rawOutput = finalMessage && finalMessage.length > 0
        ? finalMessage
        : extractCLIResultContent(this.activeCli, result.stdout || result.stderr);
      const toolCalls = parseToolCalls(rawOutput);
      const chat = toolCalls.length > 0 ? extractChatContent(rawOutput) : rawOutput;

      const response: AIResponse = {
        ...createEmptyResponse(this.activeCli, 'cli'),
        chat,
        toolCalls,
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
        meta: {
          provider: this.activeCli,
          model: 'cli',
          latencyMs: Date.now() - startTime,
        },
      };

      log.info('Prompt complete', { cli: this.activeCli, latencyMs: response.meta.latencyMs, outputLength: response.chat.length, toolCount: response.toolCalls.length });
      onChunk?.(status('cli-finish', 'Finished local agent', 'completed'));

      return { ok: true, value: response };
    } catch (e) {
      const sanitizedError = sanitizeCLIErrorMessage(e);
      log.error('Prompt failed', { cli: this.activeCli, error: sanitizedError });
      onChunk?.(status('cli-finish', 'Local agent failed', 'failed'));
      return { ok: false, error: new Error(sanitizedError) };
    } finally {
      unlisten?.();
    }
  }

  private async listenForProgress(
    requestId: string,
    cli: 'claude' | 'codex',
    onChunk: (chunk: AIResponseChunk) => void
  ): Promise<UnlistenFn | null> {
    let lastKey = '';
    let lastEmittedAt = 0;

    try {
      return await listen<CLIProgressPayload>('cli:prompt:progress', (event) => {
        const payload = event.payload;
        const payloadRequestId = payload.request_id ?? payload.requestId;
        if (payloadRequestId !== requestId) return;

        const chunk = mapCLIProgressToStatus(payload, cli);
        if (!chunk?.status) return;

        const key = `${chunk.status.id ?? ''}:${chunk.status.status}:${chunk.status.label}:${chunk.status.detail ?? ''}`;
        const now = Date.now();
        if (
          chunk.status.status === 'running' &&
          key === lastKey &&
          now - lastEmittedAt < STATUS_THROTTLE_MS
        ) {
          return;
        }

        lastKey = key;
        lastEmittedAt = now;
        onChunk(chunk);
      });
    } catch (e) {
      log.warn('Failed to subscribe to CLI progress', {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  cancel(): void {
    this.cancelled = true;
    // Note: Can't easily kill the Rust subprocess from TS.
    // The 5-minute timeout on the Rust side acts as the safety net.
  }

  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  getMaxContextSize(): number {
    // CLI tools manage their own context
    return Infinity;
  }

  async getAvailableModels(): Promise<string[]> {
    return ['cli'];
  }

  async getRateLimitStatus(): Promise<null> {
    return null; // No rate limits for CLI
  }

  /** Get which CLI is active */
  getActiveCli(): string | null {
    return this.activeCli;
  }

  getCodexFlavor(): string | undefined {
    return this.availability ? getCodexFlavor(this.availability) : undefined;
  }

  getCodexPath(): string | undefined {
    return this.availability ? getCodexPath(this.availability) : undefined;
  }

  async refreshAvailability(): Promise<void> {
    await this.detectCLI(true);
  }

  /** Detect available CLI tools */
  private async detectCLI(force = false): Promise<void> {
    if (!force && this.availability !== null) return;

    try {
      this.availability = await invoke<CLIAvailability>('check_cli_available');
    } catch {
      this.availability = { claude: false, codex: false };
    }

    this.selectActiveCli();

    log.info('CLI detection complete', {
      claude: this.availability.claude,
      codex: this.availability.codex,
      codexFlavor: getCodexFlavor(this.availability),
      codexVersion: getCodexVersion(this.availability),
      codexPath: getCodexPath(this.availability),
      active: this.activeCli,
    });
  }

  private selectActiveCli(): void {
    if (!this.availability) return;

    if (this.preferredCli) {
      this.activeCli = this.availability[this.preferredCli] ? this.preferredCli : null;
      return;
    }

    // Codex is the default local backend. Claude Code remains a fallback
    // only when no explicit Settings choice has been supplied.
    if (this.availability.codex) {
      this.activeCli = 'codex';
    } else if (this.availability.claude) {
      this.activeCli = 'claude';
    } else {
      this.activeCli = null;
    }
  }
}

function buildCLIPrompt(request: AIAssistantRequest): string {
  const history = request.conversationHistory
    .filter((message) => message.visibility !== 'internal')
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.text.trim()}`)
    .filter((line) => line.length > 0);
  const needsToolPrompt = request.tools.length > 0 && !request.systemPrompt?.includes('## Available Tools');
  const toolPrompt = needsToolPrompt ? buildToolPrompt(request.tools) : '';

  if (history.length === 0 && !toolPrompt) {
    return request.message;
  }

  const sections: string[] = [];
  if (history.length > 0) {
    sections.push('Conversation history:', history.join('\n\n'), '');
  }
  if (toolPrompt) {
    sections.push(toolPrompt, '');
  }
  sections.push('Current message:', request.message);
  return sections.join('\n');
}

function buildToolPrompt(tools: Tool[]): string {
  return [
    '## Available Tools',
    '',
    'You can ask Void to run these app tools by including one or more tool calls exactly in this format:',
    '',
    '<tool_call>',
    '<tool>namespace:action</tool>',
    '<args>{"param":"value"}</args>',
    '</tool_call>',
    '',
    'After tool results are provided, answer the user normally or return the requested final JSON.',
    '',
    ...tools.map((tool) => `${formatToolForAI(tool)}\n`),
  ].join('\n').trim();
}
