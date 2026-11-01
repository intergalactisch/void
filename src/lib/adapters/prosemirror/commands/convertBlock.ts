/** Schema-checked block conversion. Unsupported conversions leave content intact. */
import type { Command } from 'prosemirror-state';
import { Fragment, type Node as PmNode } from 'prosemirror-model';
import type { BlockType } from '$lib/domain/values/BlockType';
import { generateBlockId } from '$lib/domain/entities/Block';
import { getNodeTypeForBlockType } from '../DocumentConverter';
import { isolateHistory } from '../plugins/history';

export function convertBlock(blockId: string, targetType: BlockType): Command {
  return (state, dispatch) => {
    const type = getNodeTypeForBlockType(targetType);
    if (!type) return false;
    let pos = -1;
    state.doc.descendants((node, at) => {
      if (pos >= 0) return false;
      if (node.attrs.id === blockId) { pos = at; return false; }
      return true;
    });
    if (pos < 0) return false;
    const source = state.doc.nodeAt(pos)!;
    const $pos = state.doc.resolve(pos);
    if (!$pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) return false;
    const attrs = {
      id: blockId,
      ...(targetType.startsWith('heading') ? { level: Number(targetType.slice(7)) } : {}),
    };

    // Standard text conversion preserves selection mapping and translates
    // hard breaks to code newlines (and back), instead of discarding them.
    if (source.isTextblock && type.isTextblock) {
      const tr = state.tr.setBlockType(pos, pos + source.nodeSize, type, attrs);
      if (!tr.docChanged) return false;
      if (dispatch) dispatch(isolateHistory(tr).scrollIntoView());
      return true;
    }

    let content = source.content;
    const isList = (node: PmNode) => ['bulletList', 'orderedList'].includes(node.type.name);
    if (['bulletList', 'orderedList'].includes(type.name) && !isList(source)) {
      if (!source.isTextblock) return false;
      const paragraph = state.tr.setBlockType(pos, pos + source.nodeSize,
        state.schema.nodes.paragraph!, { id: generateBlockId() }).doc.nodeAt(pos)!;
      const item = state.schema.nodes.listItem!.create({ id: generateBlockId() }, paragraph);
      content = Fragment.from(item);
    } else if (['blockquote', 'callout'].includes(type.name)) {
      if (source.isTextblock || isList(source)) {
        content = Fragment.from(source.type.create({ ...source.attrs, id: generateBlockId() }, source.content));
      } else if (!['blockquote', 'callout'].includes(source.type.name)) return false;
    } else if (!isList(source)) {
      // In particular, never replace text with an empty image/rule/table.
      return false;
    }

    if (!type.validContent(content)) return false;
    const converted = type.create(attrs, content);
    if (converted.eq(source)) return false;
    if (dispatch) dispatch(isolateHistory(state.tr.replaceWith(pos, pos + source.nodeSize, converted)).scrollIntoView());
    return true;
  };
}
