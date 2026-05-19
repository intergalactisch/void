import { defineTool } from '../define';
import type { Block } from '$lib/domain/entities/Block';
import { parseRefId } from '$lib/domain/values/RefId';

interface ConvertBlockArgs {
  blockId?: string;
  targetType: Block['type'];
}

export default defineTool<ConvertBlockArgs, { success: boolean; blockId: string | null; targetType: string }>({
  id: 'editor:convert-block',
  name: 'Convert Block',
  description: 'Convert the selected block or a specific block to another block type such as heading1, heading2, paragraph, blockquote, todoItem, or codeBlock',
  category: 'editor',

  args: {
    blockId: { type: 'string', description: 'Block ID to convert. If omitted, converts the current selection.' },
    targetType: {
      type: 'string',
      description: 'Target block type',
      required: true,
      enum: ['paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'blockquote', 'bulletList', 'numberedList', 'todoItem', 'codeBlock'],
    },
  },

  keywords: ['heading', 'convert', 'block', 'line', 'paragraph'],
  examples: [
    'Turn this line into a heading',
    'Convert block to heading2',
    'Make this block a paragraph',
  ],
  estimatedDuration: 100,
  resourceId: (args) => args.blockId ?? 'active-editor',
  accessMode: 'write',

  summary: (args) => `Converted ${args.blockId ?? 'selection'} → ${args.targetType}`,

  async execute(args, { services, progress }) {
    progress(20, 'Converting block...');

    const blockId = args.blockId ? normalizeBlockId(args.blockId) : null;
    if (blockId) {
      services.editor.convertBlock(blockId, args.targetType);
    } else {
      services.editor.setBlockType(args.targetType);
    }

    progress(100, 'Block converted');
    return { success: true, blockId, targetType: args.targetType };
  },
});

function normalizeBlockId(blockId: string): string {
  const ref = parseRefId(blockId.trim());
  return ref?.kind === 'block' ? ref.blockId : blockId;
}
