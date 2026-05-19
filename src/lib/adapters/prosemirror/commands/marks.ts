/**
 * Mark Toggle Commands
 *
 * ProseMirror commands for toggling inline marks (formatting).
 * These commands wrap prosemirror-commands toggleMark for consistent behavior.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import type { Command, EditorState } from 'prosemirror-state';
import { toggleMark as pmToggleMark } from 'prosemirror-commands';
import type { MarkType, Schema } from 'prosemirror-model';
import type { MarkType as DomainMarkType } from '$lib/domain/values/Mark';

/**
 * Create a toggle mark command for a given mark type.
 *
 * @param markType - The ProseMirror mark type to toggle
 * @param attrs - Optional attributes for the mark
 * @returns ProseMirror command
 */
export function toggleMark(markType: MarkType, attrs?: Record<string, unknown>): Command {
  return pmToggleMark(markType, attrs);
}

/**
 * Toggle bold mark on the current selection.
 *
 * @param schema - The ProseMirror schema
 * @returns ProseMirror command or null if mark not in schema
 */
export function toggleBold(schema: Schema): Command | null {
  const bold = schema.marks.bold;
  if (!bold) return null;
  return pmToggleMark(bold);
}

/**
 * Toggle italic mark on the current selection.
 *
 * @param schema - The ProseMirror schema
 * @returns ProseMirror command or null if mark not in schema
 */
export function toggleItalic(schema: Schema): Command | null {
  const italic = schema.marks.italic;
  if (!italic) return null;
  return pmToggleMark(italic);
}

/**
 * Toggle underline mark on the current selection.
 *
 * @param schema - The ProseMirror schema
 * @returns ProseMirror command or null if mark not in schema
 */
export function toggleUnderline(schema: Schema): Command | null {
  const underline = schema.marks.underline;
  if (!underline) return null;
  return pmToggleMark(underline);
}

/**
 * Toggle strikethrough mark on the current selection.
 *
 * @param schema - The ProseMirror schema
 * @returns ProseMirror command or null if mark not in schema
 */
export function toggleStrikethrough(schema: Schema): Command | null {
  const strikethrough = schema.marks.strikethrough;
  if (!strikethrough) return null;
  return pmToggleMark(strikethrough);
}

/**
 * Toggle inline code mark on the current selection.
 *
 * @param schema - The ProseMirror schema
 * @returns ProseMirror command or null if mark not in schema
 */
export function toggleCode(schema: Schema): Command | null {
  const code = schema.marks.code;
  if (!code) return null;
  return pmToggleMark(code);
}

/**
 * Toggle or remove highlight on the current selection.
 */
export function toggleHighlight(schema: Schema, color = 'yellow'): Command | null {
  const highlight = schema.marks.highlight;
  if (!highlight) return null;
  return pmToggleMark(highlight, { color });
}

/**
 * Remove highlight mark from the current selection.
 */
export function removeHighlight(schema: Schema): Command | null {
  const highlight = schema.marks.highlight;
  if (!highlight) return null;

  return (state, dispatch) => {
    const { from, to, empty, $from } = state.selection;
    const rangeFrom = empty ? Math.max(0, $from.pos - 1) : from;
    const rangeTo = empty ? $from.pos : to;

    if (!state.doc.rangeHasMark(rangeFrom, rangeTo, highlight)) {
      return false;
    }

    if (dispatch) {
      dispatch(state.tr.removeMark(rangeFrom, rangeTo, highlight));
    }

    return true;
  };
}

/**
 * Apply link mark to the current selection.
 *
 * @param schema - The ProseMirror schema
 * @param href - The URL for the link
 * @param title - Optional title attribute
 * @returns ProseMirror command or null if mark not in schema
 */
export function setLink(schema: Schema, href: string, title?: string): Command | null {
  const link = schema.marks.link;
  if (!link) return null;
  const attrs: Record<string, string> = { href };
  if (title) attrs.title = title;
  return pmToggleMark(link, attrs);
}

/**
 * Remove link mark from the current selection.
 *
 * @param schema - The ProseMirror schema
 * @returns ProseMirror command
 */
export function removeLink(schema: Schema): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const linkMark = schema.marks.link;

    if (!linkMark) return false;

    // Check if there's a link in the selection
    let hasLink = false;
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (node.marks.some((m) => m.type === linkMark)) {
        hasLink = true;
      }
      return true;
    });

    if (!hasLink) return false;

    if (dispatch) {
      const tr = state.tr.removeMark($from.pos, $to.pos, linkMark);
      dispatch(tr);
    }

    return true;
  };
}

/**
 * Check if a mark is active at the current selection.
 *
 * @param state - The editor state
 * @param markType - The mark type to check
 * @returns True if the mark is active
 */
export function isMarkActive(state: EditorState, markType: MarkType): boolean {
  const { from, to, empty, $from } = state.selection;

  if (empty) {
    // Check stored marks or marks at cursor position
    const storedMarks = state.storedMarks;
    if (storedMarks) {
      return storedMarks.some((m) => m.type === markType);
    }
    return $from.marks().some((m) => m.type === markType);
  }

  // Check if mark exists in selection range
  return state.doc.rangeHasMark(from, to, markType);
}

/**
 * Map domain mark type to toggle command.
 *
 * @param schema - The ProseMirror schema
 * @param markType - The domain mark type
 * @returns ProseMirror command or null if type not supported
 */
export function toggleMarkFromDomain(
  schema: Schema,
  markType: DomainMarkType,
  attrs?: Record<string, unknown>
): Command | null {
  switch (markType) {
    case 'bold':
      return toggleBold(schema);
    case 'italic':
      return toggleItalic(schema);
    case 'underline':
      return toggleUnderline(schema);
    case 'strikethrough':
      return toggleStrikethrough(schema);
    case 'code':
      return toggleCode(schema);
    case 'highlight': {
      const color = attrs?.color;
      if (color === null || color === 'none') {
        return removeHighlight(schema);
      }
      return toggleHighlight(schema, typeof color === 'string' ? color : 'yellow');
    }
    case 'link':
      // Link requires attrs, return null (use setLink instead)
      return null;
    default:
      return null;
  }
}
