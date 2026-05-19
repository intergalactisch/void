/**
 * ClaudeCodeProvider - Claude Code CLI strategy
 *
 * Encapsulates all Claude Code-specific CLI knowledge:
 * argument building, output parsing, and capability flags.
 */

import type { CLIProviderPort, CLIBuildParams, ParsedCLIOutput } from '$lib/ports/outbound/CLIProviderPort';

export class ClaudeCodeProvider implements CLIProviderPort {
  id = 'claude-code';
  binary = 'claude';
  displayName = 'Claude Code';

  supportsSession = true;
  supportsResume = true;
  supportsJsonOutput = true;
  supportsToolSandbox = true;
  supportsSystemPrompt = true;
  supportsNativeWebSearch = true;

  buildArgs(params: CLIBuildParams): string[] {
    const args: string[] = [];

    // Build prompt with system prompt prefix
    const prompt = params.systemPrompt
      ? `${params.systemPrompt}\n\n---\n\n${params.prompt}`
      : params.prompt;

    args.push('-p', prompt);

    // Session management
    if (params.resumeSessionId) {
      args.push('--resume', params.resumeSessionId);
    } else if (params.sessionId) {
      args.push('--session-id', params.sessionId);
    }

    // Output format
    if (params.outputFormat === 'json') {
      args.push('--output-format', 'json');
    }

    // Tool sandboxing
    const allowedTools = new Set(params.allowedTools ?? []);
    if (params.webAccess === 'native') {
      allowedTools.add('WebSearch');
      allowedTools.add('WebFetch');
    }
    if (allowedTools.size > 0) {
      args.push('--allowedTools', Array.from(allowedTools).join(','));
    }

    // File paths (appended at the end)
    if (params.filePaths) {
      args.push(...params.filePaths);
    }

    return args;
  }

  parseOutput(raw: string, format: 'text' | 'json'): ParsedCLIOutput {
    if (format === 'text') {
      return { content: raw, metadata: {} };
    }

    try {
      const parsed = JSON.parse(raw);

      // Handle Claude Code JSON output: { result, session_id, ... }
      const result = parsed.result ?? parsed.content ?? parsed;
      const content = typeof result === 'string' ? result : JSON.stringify(result);

      return {
        content,
        ...(parsed.session_id ? { sessionId: parsed.session_id } : {}),
        metadata: {
          ...(parsed.model ? { model: parsed.model } : {}),
          ...(parsed.cost_usd ? { costUsd: parsed.cost_usd } : {}),
        },
      };
    } catch {
      // JSON parse failed — treat as plain text
      return { content: raw, metadata: {} };
    }
  }
}
