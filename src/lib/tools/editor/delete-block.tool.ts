import { defineTool } from '../define';
import { parseRefId } from '$lib/domain/values/RefId';

interface DeleteBlockArgs {
  blockId: string;
}

export default defineTool<DeleteBlockArgs, { success: boolean }>({
  id: 'editor:delete-block',
  name: 'Delete Block',
  description: 'Delete one editor block by block ID',
  category: 'editor',

  args: {
    blockId: { type: 'string', description: 'Block ID to delete', required: true },
  },

  keywords: ['block', 'delete', 'remove'],
  examples: ['Delete this block'],
  estimatedDuration: 80,
  accessMode: 'write',
  resourceId: (args) => args.blockId,

  async execute(args, { services, progress, invocation }) {
    progress(50, 'Deleting block...');
    const blockId = normalizeBlockId(args.blockId);
    const result = await services.collaboration.deleteBlock({
      blockId,
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'delete',
        summary: 'AI deleted block',
        commandId: 'editor:delete-block',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });
    if (!result.ok) throw result.error;

    progress(100, 'Block deleted');
    return { success: true };
  },
});

function normalizeBlockId(blockId: string): string {
  const ref = parseRefId(blockId.trim());
  return ref?.kind === 'block' ? ref.blockId : blockId;
}
