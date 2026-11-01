/**
 * Block Input Rules
 *
 * Automatically converts text patterns into block types:
 * - `# ` -> Heading 1, `## ` -> Heading 2, `### ` -> Heading 3
 * - `> ` -> Blockquote
 * - `---` -> Horizontal rule
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule } from 'prosemirror-inputrules';
import { Fragment } from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { Plugin } from 'prosemirror-state';
import { generateBlockId } from '$lib/domain/entities/Block';

/**
 * Create input rules plugin for block-level conversions.
 *
 * @param schema - The ProseMirror schema
 * @returns Plugin with block input rules
 */
export function createBlockInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  const heading = schema.nodes.heading;
  const blockquote = schema.nodes.blockquote;
  const horizontalRule = schema.nodes.horizontalRule;
  const paragraph = schema.nodes.paragraph;

  // Heading rules: most specific first so ###### matches before ##### etc.
  if (heading) {
    rules.push(
      textblockTypeInputRule(/^\s*######\s$/, heading, () => ({ level: 6, id: generateBlockId() }))
    );
    rules.push(
      textblockTypeInputRule(/^\s*#####\s$/, heading, () => ({ level: 5, id: generateBlockId() }))
    );
    rules.push(
      textblockTypeInputRule(/^\s*####\s$/, heading, () => ({ level: 4, id: generateBlockId() }))
    );
    rules.push(
      textblockTypeInputRule(/^\s*###\s$/, heading, () => ({ level: 3, id: generateBlockId() }))
    );
    rules.push(
      textblockTypeInputRule(/^\s*##\s$/, heading, () => ({ level: 2, id: generateBlockId() }))
    );
    rules.push(
      textblockTypeInputRule(/^\s*#\s$/, heading, () => ({ level: 1, id: generateBlockId() }))
    );
  }

  // Blockquote: `> ` at start of line
  if (blockquote) {
    rules.push(
      wrappingInputRule(/^\s*>\s$/, blockquote, () => ({ id: generateBlockId() }))
    );
  }

  // Horizontal rule: `---` in an empty paragraph replaces it with HR + new paragraph
  if (horizontalRule && paragraph) {
    rules.push(
      new InputRule(/^---$/, (state, match, start, end) => {
        const $from = state.doc.resolve(start);
        if (end !== $from.end()) return null;
        const blockStart = $from.before($from.depth);
        const blockEnd = $from.after($from.depth);

        const hr = horizontalRule.create({ id: generateBlockId() });
        const newParagraph = paragraph.create({ id: generateBlockId() });

        const tr = state.tr.replaceWith(blockStart, blockEnd, Fragment.from([hr, newParagraph]));
        // Place cursor in the new paragraph
        tr.setSelection(TextSelection.near(tr.doc.resolve(blockStart + hr.nodeSize + 1)));
        return tr;
      })
    );
  }

  return inputRules({ rules });
}
