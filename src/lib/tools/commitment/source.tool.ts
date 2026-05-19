import type { TodoId } from '$lib/domain/values/TodoId';
import { defineTool } from '../define';
import { actorLabel, intentLabel, resolveLineageNoteId, toZeroBasedLine } from '../lineage/helpers';
import { normalizeTodoId } from '../todo/refs';

interface CommitmentSourceArgs {
  todoId?: string;
  noteId?: string;
  line?: number;
}

interface CommitmentSourceResult {
  todoId: string | null;
  todoContent: string | null;
  noteId: string;
  line: number;
  unitId: string;
  versionId: string;
  content: string;
  actor: string;
  intent: string;
  createdAt: string;
  sourceVersionIds: string[];
  sourceStatus: string;
  staleReasons: string[];
  sourceContents: string[];
  explanation: string;
}

export default defineTool<CommitmentSourceArgs, CommitmentSourceResult>({
  id: 'commitment:source',
  name: 'Commitment Source',
  description: 'Explain the lineage source of a markdown todo or commitment line',
  category: 'todo',
  args: {
    todoId: { type: 'string', description: 'Todo ID to inspect' },
    noteId: { type: 'string', description: 'Note path when inspecting by line instead of todo ID' },
    line: { type: 'number', description: '1-based markdown line number of the todo', minimum: 1 },
  },
  keywords: ['commitment', 'todo', 'source', 'why', 'lineage'],
  examples: ['Why is this task here?', 'Show the source of todo notes.md:8'],
  estimatedDuration: 80,
  resourceId: (args) => args.noteId ?? args.todoId ?? 'active-note',
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(15, 'Resolving commitment...');
    let noteId: string;
    let line: number;
    let todoContent: string | null = null;
    let todoId: string | null = args.todoId ? normalizeTodoId(args.todoId) : null;

    if (args.todoId) {
      const normalizedTodoId = normalizeTodoId(args.todoId);
      const todoResult = await services.todos.getById(normalizedTodoId);
      if (!todoResult.ok) throw new Error(`Failed to read todo: ${todoResult.error.message}`);
      if (!todoResult.value) throw new Error(`Todo not found: ${args.todoId}`);
      noteId = todoResult.value.sourceFile;
      line = todoResult.value.lineNumber + 1;
      todoContent = todoResult.value.content;
    } else {
      noteId = await resolveLineageNoteId(args.noteId, services);
      if (args.line === undefined) throw new Error('Provide either todoId or line.');
      line = args.line;
    }

    progress(45, 'Reading lineage...');
    const sourceInfo = todoId
      ? await services.commitmentLineage.getSourceForTodo(todoId as TodoId)
      : await services.commitmentLineage.getSourceForLine(noteId, toZeroBasedLine(line));
    if (!sourceInfo.ok) throw new Error(`Failed to inspect commitment source: ${sourceInfo.error.message}`);

    const explanation = await services.lineage.explainLine(noteId, toZeroBasedLine(line));
    if (!explanation.ok) throw new Error(`Failed to explain commitment line: ${explanation.error.message}`);
    if (!explanation.value) throw new Error(`No lineage recorded for ${noteId}:${line}`);

    const version = explanation.value.currentVersion;
    const actor = actorLabel(version.actor);
    const intent = intentLabel(explanation.value.intent);
    progress(100, 'Commitment source ready');
    return {
      todoId,
      todoContent,
      noteId,
      line,
      unitId: explanation.value.unitId,
      versionId: version.id,
      content: version.content,
      actor,
      intent,
      createdAt: version.createdAt,
      sourceVersionIds: version.sourceVersionIds,
      sourceStatus: sourceInfo.value?.status ?? 'unknown',
      staleReasons: sourceInfo.value?.reasons ?? [],
      sourceContents: sourceInfo.value?.sourceVersions.map((source) => source.content) ?? [],
      explanation: `${actor} created the current commitment line via ${intent}. Source status: ${sourceInfo.value?.status ?? 'unknown'}.`,
    };
  },

  summary: (_args, result) => `Explained commitment source at ${result.noteId}:${result.line}`,
});
