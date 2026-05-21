import { defineTool } from '../define';

interface ReplaceArgs {
  text: string;
  from?: number;
  to?: number;
  targetText?: string;
  occurrence?: number;
}

interface ReplaceResult {
  success: boolean;
  from: number;
  to: number;
}

export default defineTool<ReplaceArgs, ReplaceResult>({
  id: 'editor:replace',
  name: 'Replace Selection',
  description:
    'Replace the active selection, an explicit editor range, or a specific substring inside the active selection',
  category: 'editor',

  args: {
    text: { type: 'string', description: 'Replacement text or markdown', required: true },
    from: { type: 'number', description: 'Optional ProseMirror start position to replace' },
    to: { type: 'number', description: 'Optional ProseMirror end position to replace' },
    targetText: {
      type: 'string',
      description: 'Exact substring inside the active selection to replace instead of the whole selection',
    },
    occurrence: {
      type: 'number',
      description: '1-based occurrence of targetText to replace when it appears multiple times',
    },
  },

  keywords: ['change', 'swap', 'substitute', 'update', 'selection', 'substring'],
  examples: [
    'Replace the selected text with "updated text"',
    'Change only the second occurrence of this phrase',
    'Substitute part of the selected content',
  ],
  estimatedDuration: 50,
  accessMode: 'write',
  resourceId: () => 'active-editor',

  async execute(args, { services, progress, invocation }) {
    progress(20, 'Resolving selection...');

    const selection = services.editor.getState().selection;
    let from = Number.isFinite(args.from) ? args.from! : selection.from;
    let to = Number.isFinite(args.to) ? args.to! : selection.to;

    if (args.targetText) {
      if (!selection.text || selection.from === selection.to) {
        throw new Error('No active selection available for targetText replacement');
      }

      const matches = findOccurrences(selection.text, args.targetText);
      if (matches.length === 0) {
        throw new Error('targetText was not found in the active selection');
      }
      if (matches.length > 1 && args.occurrence === undefined) {
        throw new Error('targetText matched multiple times; pass occurrence to choose which one');
      }

      const occurrence = args.occurrence ?? 1;
      if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > matches.length) {
        throw new Error(`occurrence must be between 1 and ${matches.length}`);
      }

      const matchStart = matches[occurrence - 1]!;
      from = selection.from + matchStart;
      to = from + args.targetText.length;
    }

    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new Error('No active selection or valid explicit range to replace');
    }

    progress(60, 'Replacing selection...');
    const result = await services.collaboration.replaceRange({
      from,
      to,
      markdown: args.text,
      label: 'AI replace selection',
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: 'AI replace selection',
        commandId: 'editor:replace',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });
    if (!result.ok) {
      throw new Error(`Failed to replace selection: ${result.error.message}`);
    }

    progress(100, 'Selection replaced');
    return { success: true, from, to };
  },

  summary: (_args, result) => `Replaced selection range ${result.from}-${result.to}`,
});

function findOccurrences(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  if (!needle) return indices;

  let start = 0;
  while (start <= haystack.length) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) break;
    indices.push(index);
    start = index + needle.length;
  }
  return indices;
}
