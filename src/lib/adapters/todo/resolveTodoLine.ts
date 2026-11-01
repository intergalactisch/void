import { ok, err, type Result } from '$lib/core';
import type { Todo } from '$lib/domain/entities/Todo';
import type { TodoSource } from '$lib/domain/values/TodoSource';
import type { TodoParserPort } from '$lib/ports/outbound/TodoParserPort';
import type { TodoLineReference } from '$lib/ports/outbound/TodoRepositoryPort';
import { literalMarkdownLines } from './markdownStructure';

interface ResolvedTodoLine {
  lineNumber: number;
  line: string;
  todo: Todo;
}

export function resolveTodoLine(
  lines: string[],
  filePath: string,
  requestedLineNumber: number,
  parser: TodoParserPort,
  source: TodoSource,
  expected?: TodoLineReference,
): Result<ResolvedTodoLine, Error> {
  const excluded = literalMarkdownLines(lines);
  const direct = excluded.has(requestedLineNumber)
    ? err(new Error(`Line ${requestedLineNumber} is literal Markdown, not a todo`))
    : parseTodoLineAt(lines, filePath, requestedLineNumber, parser, source);

  if (!expected) {
    if (!direct.ok) return direct;
    return ok(direct.value);
  }

  if (direct.ok && sameSourceLine(direct.value.line, expected.rawLine)) {
    return direct;
  }

  const rebased = findExpectedTodoLine(lines, filePath, expected, parser, source, excluded);
  if (rebased) {
    return ok(rebased);
  }

  if (!direct.ok) {
    return direct;
  }

  return err(
    new Error(
      `Todo at line ${expected.lineNumber} in ${filePath} changed before the mutation could be applied`,
    ),
  );
}

function parseTodoLineAt(
  lines: string[],
  filePath: string,
  lineNumber: number,
  parser: TodoParserPort,
  source: TodoSource,
): Result<ResolvedTodoLine, Error> {
  if (lineNumber < 0 || lineNumber >= lines.length) {
    return err(new Error(`Line ${lineNumber} out of bounds in ${filePath}`));
  }

  const line = lines[lineNumber]!;
  const todo = parser.parseLine(line, lineNumber, filePath, undefined, { source });
  if (!todo) {
    return err(new Error(`Line ${lineNumber} is not a valid todo`));
  }

  return ok({ lineNumber, line, todo });
}

function findExpectedTodoLine(
  lines: string[],
  filePath: string,
  expected: TodoLineReference,
  parser: TodoParserPort,
  source: TodoSource,
  excluded: Set<number>,
): ResolvedTodoLine | null {
  let nearest: ResolvedTodoLine | null = null;
  let distance = Infinity;
  let ambiguous = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (excluded.has(index)) continue;
    const line = lines[index]!;
    if (!sameSourceLine(line, expected.rawLine)) continue;

    const todo = parser.parseLine(line, index, filePath, undefined, { source });
    if (todo) {
      const candidateDistance = Math.abs(index - expected.lineNumber);
      if (candidateDistance < distance) {
        nearest = { lineNumber: index, line, todo };
        distance = candidateDistance;
        ambiguous = false;
      } else if (candidateDistance === distance) {
        ambiguous = true;
      }
    }
  }

  // Do not silently modify an arbitrary identical task after external edits.
  return ambiguous ? null : nearest;
}

function sameSourceLine(actual: string, expected: string): boolean {
  // Editor snapshots use LF even when the file on disk uses CRLF.
  return actual.replace(/\r$/, '') === expected.replace(/\r$/, '');
}
