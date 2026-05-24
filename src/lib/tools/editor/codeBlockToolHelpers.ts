import { parseRefId } from '$lib/domain/values/RefId';
export {
  buildCodeBlockMarkdown,
  buildUpdatedCodeBlockMarkdown,
  type CodeBlockMarkdownInput,
  type CodeBlockUpdateInput,
} from '$lib/core/codeFence';

export function normalizeBlockId(blockId: string): string {
  const ref = parseRefId(blockId.trim());
  return ref?.kind === 'block' ? ref.blockId : blockId.trim();
}
