import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  CLIAIAdapter,
  extractCLIResultContent,
  mapCLIProgressToStatus,
  type CLIProgressPayload,
} from '$lib/adapters/ai/CLIAIAdapter';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import { createUserMessage, createAssistantMessage } from '$lib/domain/entities/Message';
import { createTool } from '$lib/domain/entities/Tool';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { AIAssistantRequest } from '$lib/ports/outbound';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

function request(): AIAssistantRequest {
  return {
    message: 'Create a note',
    context: createEmptyContext(),
    tools: [],
    conversationHistory: [],
  };
}

describe('CLIAIAdapter live progress', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockReset();
  });

  it('maps Codex JSONL events to friendly status chunks', () => {
    const turn = mapCLIProgressToStatus(
      { request_id: 'r1', stream: 'stdout', line: '{"type":"turn.started"}' },
      'codex'
    );
    expect(turn?.status?.label).toBe('Thinking through the request');

    const tool = mapCLIProgressToStatus(
      {
        request_id: 'r1',
        stream: 'stdout',
        line: '{"type":"item.started","item":{"type":"command_execution","command":"curl -I https://example.com"}}',
      },
      'codex'
    );
    expect(tool?.status?.label).toBe('Using local tools');
    expect(tool?.status?.detail).toBe('curl -I https://example.com');
  });

  it('maps Claude stream-json events to friendly status chunks', () => {
    const tool = mapCLIProgressToStatus(
      {
        request_id: 'r1',
        stream: 'stdout',
        line: '{"type":"content_block_start","content_block":{"type":"tool_use","name":"Read"}}',
      },
      'claude'
    );

    expect(tool?.status?.label).toBe('Using local tools');
    expect(tool?.status?.detail).toBe('Read');
  });

  it('extracts final text from JSONL output without preserving raw events', () => {
    const claude = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Draft"}]}}',
      '{"type":"result","result":"Final answer"}',
    ].join('\n');

    expect(extractCLIResultContent('claude', claude)).toBe('Final answer');
    expect(extractCLIResultContent('codex', '{"type":"agent_message","message":"Done"}')).toBe('Done');
  });

  it('extracts Codex assistant messages nested in item events', () => {
    const codex = [
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"{\\"summary\\":\\"Bonsai findings\\",\\"findings\\":[\\"Bonsai is a cultivation practice.\\"],\\"artifactDrafts\\":[],\\"citations\\":[],\\"risks\\":[],\\"nextActions\\":[],\\"confidence\\":0.8}"}]}}',
    ].join('\n');

    expect(extractCLIResultContent('codex', codex)).toContain('"summary":"Bonsai findings"');
  });

  it('emits progress status chunks before final chat and tool chunks', async () => {
    let progressHandler: ((event: { payload: CLIProgressPayload }) => void) | null = null;
    mockListen.mockImplementation(async (_event, handler) => {
      progressHandler = handler as (event: { payload: CLIProgressPayload }) => void;
      return vi.fn();
    });

    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'check_cli_available') {
        return { codex: true, claude: false };
      }

      if (command === 'run_cli_prompt') {
        const requestId = (args as { requestId?: string }).requestId;
        progressHandler?.({
          payload: {
            request_id: requestId,
            stream: 'stdout',
            line: '{"type":"turn.started"}',
          },
        });

        return {
          stdout:
            'Done.\n<tool_call><tool>note:create</tool><args>{"title":"Weather"}</args></tool_call>',
          stderr: '',
          exit_code: 0,
          timed_out: false,
        };
      }

      throw new Error(`Unexpected command ${command}`);
    });

    const adapter = new CLIAIAdapter({ preferredCli: 'codex' });
    const chunks: string[] = [];
    const result = await adapter.stream(request(), (chunk) => {
      if (chunk.type === 'status') chunks.push(`status:${chunk.status?.label}`);
      if (chunk.type === 'chat') chunks.push(`chat:${chunk.chatDelta}`);
      if (chunk.type === 'tool_start') chunks.push(`tool:${chunk.toolCall?.toolId}`);
    });

    expect(result.ok).toBe(true);
    expect(chunks).toContain('status:Thinking through the request');
    expect(chunks).toContain('status:Finished local agent');
    expect(chunks).toContain('chat:Done.');
    expect(chunks).toContain('tool:note:create');
  });

  it('passes conversation history to local CLI prompts', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'check_cli_available') {
        return { codex: true, claude: false };
      }

      if (command === 'run_cli_prompt') {
        expect((args as { prompt: string }).prompt).toContain('Conversation history:');
        expect((args as { prompt: string }).prompt).toContain('USER: Original research request');
        expect((args as { prompt: string }).prompt).toContain('ASSISTANT: Paused for approval');
        expect((args as { prompt: string }).prompt).toContain('Current message:');
        return {
          stdout: 'Done.',
          stderr: '',
          exit_code: 0,
          timed_out: false,
        };
      }

      throw new Error(`Unexpected command ${command}`);
    });

    const adapter = new CLIAIAdapter({ preferredCli: 'codex' });
    const req = request();
    req.message = 'Tool execution results';
    req.conversationHistory = [
      createUserMessage('Original research request'),
      createAssistantMessage({ text: 'Paused for approval' }),
    ];

    const result = await adapter.prompt(req);
    expect(result.ok).toBe(true);
  });

  it('includes app tool-call instructions for direct CLI provider requests with tools', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'check_cli_available') {
        return { codex: true, claude: false };
      }

      if (command === 'run_cli_prompt') {
        const prompt = (args as { prompt: string }).prompt;
        expect(prompt).toContain('## Available Tools');
        expect(prompt).toContain('<tool_call>');
        expect(prompt).toContain('note:read');
        expect(prompt).toContain('After tool results are provided');
        return {
          stdout: 'Done.',
          stderr: '',
          exit_code: 0,
          timed_out: false,
        };
      }

      throw new Error(`Unexpected command ${command}`);
    });

    const adapter = new CLIAIAdapter({ preferredCli: 'codex' });
    const req = request();
    req.tools = [
      createTool({
        id: 'note:read' as ToolId,
        name: 'Read Note',
        description: 'Read a note by path',
        category: 'note',
        parameters: {
          noteId: { type: 'string', description: 'Note path', required: true },
        },
      }),
    ];

    const result = await adapter.prompt(req);
    expect(result.ok).toBe(true);
  });

  it('passes native web access to the Tauri CLI command when requested', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'check_cli_available') {
        return { codex: true, claude: false };
      }

      if (command === 'run_cli_prompt') {
        expect((args as { webAccess?: string }).webAccess).toBe('native');
        return {
          stdout: 'Done.',
          stderr: '',
          exit_code: 0,
          timed_out: false,
        };
      }

      throw new Error(`Unexpected command ${command}`);
    });

    const adapter = new CLIAIAdapter({ preferredCli: 'codex' });
    const req = request();
    req.webAccess = 'native';

    const result = await adapter.prompt(req);
    expect(result.ok).toBe(true);
  });
});
