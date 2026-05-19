import { defineTool } from '../define';
import { parseRefId } from '$lib/domain/values/RefId';

interface ReplaceBlockArgs {
  blockId: string;
  markdown: string;
  label?: string;
}

export default defineTool<ReplaceBlockArgs, { success: boolean }>({
  id: 'editor:replace-block',
  name: 'Replace Block',
  description: 'Replace one editor block by block ID using AI-safe block locking',
  category: 'editor',

  args: {
    blockId: { type: 'string', description: 'Block ID to replace', required: true },
    markdown: { type: 'string', description: 'Markdown content for the replacement block', required: true },
    label: { type: 'string', description: 'Short label for the AI operation' },
  },

  keywords: ['block', 'replace', 'rewrite'],
  examples: ['Replace this block with a clearer version'],
  estimatedDuration: 100,
  accessMode: 'write',
  resourceId: (args) => args.blockId,

  async execute(args, { services, progress, invocation }) {
    progress(20, 'Locking block...');
    const blockId = normalizeBlockId(args.blockId);
    const result = await services.collaboration.replaceBlock({
      blockId,
      markdown: args.markdown,
      label: args.label ?? 'AI rewrite',
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: args.label ?? 'AI rewrite block',
        commandId: 'editor:replace-block',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });
    if (!result.ok) throw result.error;

    progress(100, 'Block replaced');
    return { success: true };
  },
});

function normalizeBlockId(blockId: string): string {
  const ref = parseRefId(blockId.trim());
  return ref?.kind === 'block' ? ref.blockId : blockId;
}
