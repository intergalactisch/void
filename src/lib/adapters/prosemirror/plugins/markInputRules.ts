/**
 * Mark Input Rules
 *
 * Automatically converts inline markdown patterns to formatted marks:
 * - **text** -> bold
 * - *text* -> italic
 * - `text` -> inline code
 * - ~~text~~ -> strikethrough
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { MarkType, Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

/**
 * Creates an InputRule that wraps matched text in the given mark.
 *
 * The regex must have two capture groups:
 *   match[1] = full delimited text (e.g. "**bold**")
 *   match[2] = inner text content (e.g. "bold")
 *
 * When the rule fires the full delimited text is replaced with the inner
 * text wrapped in the specified mark.
 */
function markInputRule(regex: RegExp, markType: MarkType): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    const fullMatch = match[1];
    const textContent = match[2];
    if (!textContent || !fullMatch) return null;

    const matchStart = end - fullMatch.length;
    const tr = state.tr;
    tr.replaceWith(matchStart, end, state.schema.text(textContent, [markType.create()]));
    return tr;
  });
}

/**
 * Creates a ProseMirror plugin containing input rules for inline markdown
 * mark formatting. Only registers rules for marks that exist in the schema.
 */
export function createMarkInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];

  if (schema.marks.bold) {
    // Bold: **text** -- lookbehind rejects *** (triple asterisk)
    rules.push(markInputRule(/(?:^|[^*])(\*\*(.+?)\*\*)$/, schema.marks.bold));
  }

  if (schema.marks.italic) {
    // Italic: *text* -- lookbehind rejects **text** (double asterisk)
    rules.push(markInputRule(/(?:^|[^*])(\*(.+?)\*)$/, schema.marks.italic));
  }

  if (schema.marks.code) {
    // Inline code: `text` -- lookbehind rejects `` (double backtick)
    rules.push(markInputRule(/(?:^|[^`])(`(.+?)`)$/, schema.marks.code));
  }

  if (schema.marks.strikethrough) {
    // Strikethrough: ~~text~~ -- lookbehind rejects ~~~ (triple tilde)
    rules.push(markInputRule(/(?:^|[^~])(~~(.+?)~~)$/, schema.marks.strikethrough));
  }

  return inputRules({ rules });
}
