import { defineTool } from '../define';

interface InsertBlocksArgs {
  afterBlockId: string;
  markdown: string;
  label?: string;
}

export default defineTool<InsertBlocksArgs, { success: boolean }>({
  id: 'editor:insert-blocks',
  name: 'Insert Blocks',
  description: 'Insert markdown blocks after a specific editor block',
  category: 'editor',

  args: {
    afterBlockId: { type: 'string', description: 'Block ID to insert after', required: true },
    markdown: { type: 'string', description: 'Markdown blocks to insert', required: true },
    label: { type: 'string', description: 'Short label for the AI operation' },
  },

  keywords: ['block', 'insert', 'append'],
  examples: ['Insert a follow-up section after this block'],
  estimatedDuration: 100,
  accessMode: 'write',
  resourceId: (args) => args.afterBlockId,

  async execute(args, { services, progress, invocation }) {
    progress(20, 'Preparing insertion...');
    const result = await services.collaboration.insertBlocksAfter({
      blockId: args.afterBlockId,
      markdown: args.markdown,
      label: args.label ?? 'AI insert',
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'extract',
        summary: args.label ?? 'AI inserted blocks',
        commandId: 'editor:insert-blocks',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });
    if (!result.ok) throw result.error;

    progress(100, 'Blocks inserted');
    return { success: true };
  },
});
