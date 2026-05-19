/**
 * List Commands
 *
 * ProseMirror commands for creating and manipulating lists.
 * Uses prosemirror-schema-list for battle-tested list operations.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Command, EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { NodeType, Schema } from 'prosemirror-model';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { generateBlockId } from '$lib/domain/entities/Block';

/**
 * Check if the selection is currently inside a list of the given type.
 */
function isInList(state: EditorState, listType: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listType) return true;
  }
  return false;
}

/**
 * Toggle a list type on the current selection.
 *
 * - If not in any list: wrap in the target list type
 * - If already in the same list type: lift out to paragraphs
 * - If in a different list type: change the list type
 *
 * @param schema - The ProseMirror schema
 * @param listTypeName - The schema node name ('bulletList' or 'orderedList')
 * @returns ProseMirror command
 */
export function toggleList(schema: Schema, listTypeName: string): Command {
  const listType = schema.nodes[listTypeName];
  const listItemType = schema.nodes.listItem;

  if (!listType || !listItemType) {
    return () => false;
  }

  return (state, dispatch) => {
    if (isInList(state, listType)) {
      // Already in this list type — lift out
      return liftListItem(listItemType)(state, dispatch);
    }

    // Check if we're in the other list type
    const otherListName = listTypeName === 'bulletList' ? 'orderedList' : 'bulletList';
    const otherListType = schema.nodes[otherListName];
    if (otherListType && isInList(state, otherListType)) {
      // In a different list type — lift out first, then wrap
      const lifted = liftListItem(listItemType)(state, (tr) => {
        if (dispatch) {
          // After lifting, apply the wrap on the new state
          const newState = state.apply(tr);
          const wrapped = wrapInList(listType)(newState, (tr2) => {
            dispatch(tr2);
          });
          if (!wrapped) {
            // If wrapping fails, at least apply the lift
            dispatch(tr);
          }
        }
      });
      return lifted;
    }

    // Not in any list — wrap in the target list type
    return wrapInList(listType)(state, dispatch);
  };
}

/**
 * Delete an empty list item on Backspace.
 *
 * When the cursor is at the start of an empty list item, this deletes the
 * item entirely (instead of lifting it into an empty paragraph). If the item
 * is the last one in the list, the entire list is removed.
 *
 * @param listItemType - The listItem node type from the schema
 * @returns ProseMirror command
 */
export function deleteEmptyListItem(listItemType: NodeType): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.parentOffset !== 0) return false;
    if ($from.parent.content.size !== 0) return false;

    // Find the list item ancestor
    let listItemDepth = -1;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type === listItemType) {
        listItemDepth = d;
        break;
      }
    }
    if (listItemDepth === -1) return false;

    // Only handle single-child list items (just the empty paragraph)
    const listItem = $from.node(listItemDepth);
    if (listItem.childCount !== 1) return false;

    const listDepth = listItemDepth - 1;
    const list = $from.node(listDepth);

    if (dispatch) {
      const tr = state.tr;

      if (list.childCount === 1) {
        // Last item in the list — replace entire list with an empty paragraph
        const listPos = $from.before(listDepth);
        const listEnd = $from.after(listDepth);
        const paragraphType = state.schema.nodes.paragraph;
        if (paragraphType) {
          const emptyParagraph = paragraphType.create({ id: generateBlockId() });
          tr.replaceWith(listPos, listEnd, emptyParagraph);
          tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
        } else {
          tr.delete(listPos, listEnd);
        }
      } else {
        // Delete just this list item
        const listItemPos = $from.before(listItemDepth);
        const listItemEnd = $from.after(listItemDepth);
        tr.delete(listItemPos, listItemEnd);
        const mapped = tr.mapping.map(listItemPos);
        const resolvedPos = tr.doc.resolve(Math.min(mapped, tr.doc.content.size));
        tr.setSelection(TextSelection.near(resolvedPos, -1));
      }

      dispatch(tr.scrollIntoView());
    }

    return true;
  };
}
