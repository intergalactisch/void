/**
 * ResultParserAdapter - Parses CLI output into structured operation outputs
 *
 * Handles both raw text and JSON output from CLI processes.
 * Extracts content, todos, references, and metadata.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import { ok, err, type Result } from '$lib/core/result';
import type { ResultParserPort } from '$lib/ports/outbound/ResultParserPort';
import type {
  OperationOutput,
  ContentOutput,
  TodoOutput,
  ReferenceOutput,
} from '$lib/domain/values/OperationResult';
import type { OperationType } from '$lib/domain/values/OperationType';

export class ResultParserAdapter implements ResultParserPort {
  parse(rawOutput: string, _operationType: OperationType): Result<OperationOutput[], Error> {
    try {
      const outputs: OperationOutput[] = [];

      // Extract content (everything that isn't a todo or reference)
      const content = this.extractContent(rawOutput);
      if (content) {
        outputs.push({ type: 'content', content });
      }

      // Extract todos
      const todos = this.extractTodos(rawOutput);
      outputs.push(...todos);

      // Extract references (without known notes, best effort)
      const refs = this.extractReferences(rawOutput, []);
      outputs.push(...refs);

      return ok(outputs);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  parseJson(jsonOutput: string): Result<OperationOutput[], Error> {
    try {
      // Generic JSON fallback — CLI-specific parsing is done by CLIProviderPort.parseOutput().
      // This remains for backward compat with ResultParserPort consumers.
      const parsed = JSON.parse(jsonOutput);
      const outputs: OperationOutput[] = [];

      const result = parsed.result ?? parsed.content ?? parsed;
      const rawText = typeof result === 'string' ? result : JSON.stringify(result);

      if (rawText) {
        outputs.push({ type: 'content', content: rawText });
      }

      return ok(outputs);
    } catch (e) {
      return err(new Error(`Failed to parse JSON output: ${e}`));
    }
  }

  extractContent(raw: string): string {
    // Remove todo lines and wiki-link-only lines
    return raw
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !(
          /^- \[ \]/.test(trimmed) ||
          /^TODO:/.test(trimmed) ||
          /^FIXME:/.test(trimmed)
        );
      })
      .join('\n')
      .trim();
  }

  extractTodos(raw: string): TodoOutput[] {
    const todos: TodoOutput[] = [];
    const lines = raw.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Match markdown checkbox: - [ ] text
      const checkboxMatch = trimmed.match(/^- \[ \]\s+(.+)/);
      if (checkboxMatch?.[1]) {
        todos.push({
          type: 'todo',
          text: checkboxMatch[1],
        });
        continue;
      }

      // Match TODO: or FIXME: comments
      const todoMatch = trimmed.match(/^(TODO|FIXME):\s*(.+)/);
      if (todoMatch?.[1] && todoMatch[2]) {
        todos.push({
          type: 'todo',
          text: todoMatch[2],
          ...(todoMatch[1] === 'FIXME' ? { priority: 'high' } : {}),
        });
      }
    }

    return todos;
  }

  extractReferences(raw: string, knownNotes: string[]): ReferenceOutput[] {
    const refs: ReferenceOutput[] = [];
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    let match;

    while ((match = wikiLinkRegex.exec(raw)) !== null) {
      const target = match[1];
      if (target && (knownNotes.length === 0 || knownNotes.some((n) => n.includes(target)))) {
        refs.push({
          type: 'reference',
          fromNote: '',
          toNote: target,
        });
      }
    }

    return refs;
  }
}
