/**
 * List Input Rules
 *
 * Automatically converts text patterns into lists:
 * - `- [ ] ` or `* [ ] ` at the start of a line -> todo item
 * - `- ` or `* ` at the start of a line -> bullet list
 * - `1. ` at the start of a line -> ordered list
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { inputRules, wrappingInputRule, InputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { generateBlockId } from '$lib/domain/entities/Block';

/**
 * Create input rules plugin for list creation.
 *
 * @param schema - The ProseMirror schema
 * @returns Plugin with list input rules
 */
export function createListInputRules(schema: Schema): Plugin {
  const rules = [];

  const bulletList = schema.nodes.bulletList;
  const orderedList = schema.nodes.orderedList;
  const listItem = schema.nodes.listItem;
  const todoItem = schema.nodes.todoItem;

  // Todo input rule MUST come before bullet list so `- [ ] ` is matched first
  if (todoItem) {
    rules.push(
      new InputRule(
        /^\s*[-*]\s\[([ xX])\]\s$/,
        (state, match, start, end) => {
          const $start = state.doc.resolve(start);
          const checked = match[1] !== ' ';
          if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), todoItem))
            return null;
          return state.tr
            .delete(start, end)
            .setBlockType(start, start, todoItem, { checked, id: generateBlockId() });
        }
      )
    );
  }

  if (bulletList && listItem) {
    // `- ` or `* ` at start of textblock -> bullet list
    rules.push(
      wrappingInputRule(/^\s*([-*])\s$/, bulletList)
    );
  }

  if (orderedList && listItem) {
    // `1. ` (or any number followed by `.`) at start of textblock -> ordered list
    rules.push(
      wrappingInputRule(
        /^(\d+)\.\s$/,
        orderedList,
        (match) => ({ start: +(match[1] ?? 1) }),
        (match, node) => node.childCount + (node.attrs.start as number) === +(match[1] ?? 1)
      )
    );
  }

  return inputRules({ rules });
}
