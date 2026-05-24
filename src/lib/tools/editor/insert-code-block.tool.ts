import { defineTool } from '../define';
import { buildCodeBlockMarkdown, normalizeBlockId } from './codeBlockToolHelpers';

interface InsertCodeBlockArgs {
  code: string;
  language?: string;
  meta?: string;
  title?: string;
  afterBlockId?: string;
  replaceSelection?: boolean;
  label?: string;
}

export default defineTool<InsertCodeBlockArgs, { success: boolean; blockId: string | null }>({
  id: 'editor:insert-code-block',
  name: 'Insert Code Block',
  description: 'Insert a fenced Markdown code block with preserved language and metadata such as title, line numbers, wrap, highlight lines, and focus lines',
  category: 'editor',

  args: {
    code: { type: 'string', description: 'Raw code content for the fenced block', required: true },
    language: { type: 'string', description: 'Optional fence language, for example ts, svelte, python, bash, diff, or json' },
    meta: { type: 'string', description: 'Optional raw fence metadata, for example title="api.ts" lineNumbers {2,5-7} wrap' },
    title: { type: 'string', description: 'Optional display title/filename, written into fence metadata' },
    afterBlockId: { type: 'string', description: 'Insert after this block ID. If omitted, inserts at the current editor location' },
    replaceSelection: { type: 'boolean', description: 'Replace the current editor selection with the code block when a selection exists', default: false },
    label: { type: 'string', description: 'Short label for the AI operation' },
  },

  keywords: ['code', 'snippet', 'fence', 'insert', 'developer'],
  examples: [
    'Insert this TypeScript snippet with title api.ts',
    'Add a fenced bash code block after this paragraph',
    'Replace the selection with a highlighted Python example',
  ],
  estimatedDuration: 100,
  accessMode: 'write',
  resourceId: (args) => args.afterBlockId ?? '@ambient:editor',

  async execute(args, { services, progress, invocation }) {
    progress(20, 'Building code fence...');
    const markdown = buildCodeBlockMarkdown(args);
    const label = args.label ?? 'AI inserted code block';
    const lineage = {
      actor: { kind: 'ai-agent' as const },
      intentKind: 'extract' as const,
      summary: label,
      commandId: 'editor:insert-code-block',
      ...(invocation.id ? { receiptId: invocation.id } : {}),
      source: { type: 'tool' as const },
    };

    let result;
    let blockId: string | null = null;
    if (args.afterBlockId) {
      blockId = normalizeBlockId(args.afterBlockId);
      progress(55, 'Inserting after block...');
      result = await services.collaboration.insertBlocksAfter({
        blockId,
        markdown,
        label,
        lineage,
      });
    } else if (args.replaceSelection && services.editor.getState().selection.from < services.editor.getState().selection.to) {
      const selection = services.editor.getState().selection;
      progress(55, 'Replacing selection with code block...');
      result = await services.collaboration.replaceRange({
        from: selection.from,
        to: selection.to,
        markdown,
        label,
        lineage,
      });
    } else {
      progress(55, 'Inserting at cursor...');
      result = await services.collaboration.insertAtCursor(markdown, label);
    }

    if (!result.ok) throw result.error;
    progress(100, 'Code block inserted');
    return { success: true, blockId };
  },
});
