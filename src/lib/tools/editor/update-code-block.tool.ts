import { defineTool } from '../define';
import { buildUpdatedCodeBlockMarkdown, normalizeBlockId } from './codeBlockToolHelpers';

interface UpdateCodeBlockArgs {
  blockId: string;
  code?: string;
  language?: string;
  meta?: string;
  title?: string;
  lineNumbers?: boolean;
  wrap?: boolean;
  highlightLines?: string;
  focusLines?: string;
  mode?: 'replace' | 'append' | 'prepend';
  label?: string;
}

export default defineTool<UpdateCodeBlockArgs, { success: boolean; blockId: string }>({
  id: 'editor:update-code-block',
  name: 'Update Code Block',
  description: 'Update an existing fenced Markdown code block by block ID while preserving unspecified code, language, and metadata',
  category: 'editor',

  args: {
    blockId: { type: 'string', description: 'Code block ID to update', required: true },
    code: { type: 'string', description: 'Replacement code. Omit to only update language or metadata' },
    language: { type: 'string', description: 'New fence language. Omit to preserve the current language' },
    meta: { type: 'string', description: 'Raw replacement fence metadata. Omit to preserve the current metadata' },
    title: { type: 'string', description: 'Title/filename to write into fence metadata' },
    lineNumbers: { type: 'boolean', description: 'Whether the code block should show line numbers' },
    wrap: { type: 'boolean', description: 'Whether the code block should soft-wrap long lines' },
    highlightLines: { type: 'string', description: 'Line ranges to highlight, for example "2,5-7"' },
    focusLines: { type: 'string', description: 'Line ranges to focus, for example "10-14"' },
    mode: {
      type: 'string',
      description: 'How provided code combines with existing code',
      enum: ['replace', 'append', 'prepend'],
      default: 'replace',
    },
    label: { type: 'string', description: 'Short label for the AI operation' },
  },

  keywords: ['code', 'snippet', 'fence', 'update', 'refactor', 'annotate'],
  examples: [
    'Replace this code block with the refactored TypeScript',
    'Turn on line numbers and highlight lines 5-8',
    'Append a usage example to this bash snippet',
  ],
  estimatedDuration: 120,
  accessMode: 'write',
  resourceId: (args) => args.blockId,

  async execute(args, { services, progress, invocation }) {
    progress(15, 'Reading code block...');
    const blockId = normalizeBlockId(args.blockId);
    const block = services.collaboration.getActiveBlocks().find((candidate) => candidate.id === blockId);
    if (!block) {
      throw new Error(`No active editor block found for ${blockId}`);
    }

    const markdown = buildUpdatedCodeBlockMarkdown(block, args);
    const label = args.label ?? 'AI updated code block';
    progress(60, 'Replacing code block...');
    const result = await services.collaboration.replaceBlock({
      blockId,
      markdown,
      label,
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: label,
        commandId: 'editor:update-code-block',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });
    if (!result.ok) throw result.error;

    progress(100, 'Code block updated');
    return { success: true, blockId };
  },
});
