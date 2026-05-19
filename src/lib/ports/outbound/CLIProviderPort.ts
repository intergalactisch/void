/**
 * CLIProviderPort - Outbound port for CLI backend strategy
 *
 * Each AI CLI (Claude Code, Codex, Aider, etc.) implements this interface.
 * The rest of the system becomes fully generic — no CLI-specific knowledge
 * leaks into the operation pipeline, Rust process manager, or session manager.
 *
 * Part of the Hexagonal Architecture outbound ports layer.
 */

import type { AIReasoningEffort } from '$lib/domain';
import type { AIWebAccess } from '$lib/domain/values/AIWebAccess';

/**
 * Parameters for building CLI arguments.
 * Generic — no CLI-specific fields.
 */
export interface CLIBuildParams {
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  resumeSessionId?: string;
  outputFormat?: 'text' | 'json';
  allowedTools?: string[];
  filePaths?: string[];
  reasoningEffort?: AIReasoningEffort;
  webAccess?: AIWebAccess;
}

/**
 * Normalized output from any CLI.
 */
export interface ParsedCLIOutput {
  content: string;
  sessionId?: string;
  metadata: Record<string, unknown>;
}

/**
 * Strategy interface for a CLI backend.
 *
 * Encapsulates all CLI-specific knowledge:
 * - How to build command-line arguments
 * - How to parse output
 * - What features are supported
 */
export interface CLIProviderPort {
  /** Unique identifier (e.g. 'claude-code', 'codex', 'aider') */
  id: string;
  /** Binary name on $PATH (e.g. 'claude', 'codex', 'aider') */
  binary: string;
  /** Human-readable name (e.g. 'Claude Code', 'Codex CLI') */
  displayName: string;

  // Capability flags — the system adapts behavior based on these
  supportsSession: boolean;
  supportsResume: boolean;
  supportsJsonOutput: boolean;
  supportsToolSandbox: boolean;
  supportsSystemPrompt: boolean;
  supportsNativeWebSearch: boolean;

  /** Build CLI-specific arguments from generic params */
  buildArgs(params: CLIBuildParams): string[];

  /** Parse CLI-specific output into normalized shape */
  parseOutput(raw: string, format: 'text' | 'json'): ParsedCLIOutput;
}
