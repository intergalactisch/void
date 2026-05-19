/**
 * Placeholder Plugin
 *
 * Shows placeholder text ("Type / for commands...") when a block is empty.
 * Uses ProseMirror decorations to render the placeholder without affecting
 * the document content.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PmNode } from 'prosemirror-model';

/**
 * Plugin key for the placeholder plugin.
 * Can be used to access the plugin state from other parts of the application.
 */
export const placeholderPluginKey = new PluginKey('placeholder');

/**
 * Configuration options for the placeholder plugin.
 */
export interface PlaceholderPluginOptions {
  /**
   * The placeholder text to display.
   * @default "Type / for commands..."
   */
  text?: string;

  /**
   * CSS class to apply to the placeholder element.
   * @default "void-placeholder"
   */
  className?: string;

  /**
   * Whether to show placeholder on first empty block only.
   * @default false
   */
  firstBlockOnly?: boolean;

  /**
   * Block types that should show placeholders.
   * If not specified, only 'paragraph' blocks show placeholders.
   */
  blockTypes?: string[];

  /**
   * Placeholder text for empty document (single empty paragraph).
   * When the document has only one empty block, this text is shown instead of `text`.
   * @default ""
   */
  emptyDocText?: string;
}

/**
 * Default configuration for the placeholder plugin.
 */
const defaultOptions: Required<PlaceholderPluginOptions> = {
  text: 'Type / for commands...',
  className: 'void-placeholder',
  firstBlockOnly: false,
  blockTypes: ['paragraph'],
  emptyDocText: '',
};

/**
 * Create the placeholder decoration for an empty block.
 */
function createPlaceholderDecoration(
  pos: number,
  options: Required<PlaceholderPluginOptions>,
  text: string
): Decoration {
  return Decoration.widget(pos + 1, () => {
    const placeholder = document.createElement('span');
    placeholder.className = options.className;
    placeholder.textContent = text;
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.setAttribute('contenteditable', 'false');
    // Style to position absolutely within the block
    placeholder.style.cssText = `
      position: absolute;
      pointer-events: none;
      user-select: none;
      color: var(--color-text-muted, #9ca3af);
      opacity: 0.7;
    `;
    return placeholder;
  }, {
    key: `placeholder-${pos}`,
    side: -1,
  });
}

/**
 * Find decorations for empty blocks in the document.
 */
function findPlaceholderDecorations(
  doc: PmNode,
  options: Required<PlaceholderPluginOptions>,
  cursorPos: number | null
): Decoration[] {
  const decorations: Decoration[] = [];
  let foundFirst = false;

  const isEmptyDoc = doc.childCount === 1 && doc.firstChild?.content.size === 0;

  doc.descendants((node: PmNode, pos: number) => {
    // Skip if not a supported block type
    if (!options.blockTypes.includes(node.type.name)) {
      return true;
    }

    // Check if block is empty (textblock with no content)
    if (node.isTextblock && node.content.size === 0) {
      // If firstBlockOnly, skip after first
      if (options.firstBlockOnly && foundFirst) {
        return true;
      }

      // Only show placeholder on the empty block where the cursor is
      if (cursorPos === null || pos >= cursorPos || cursorPos > pos + node.nodeSize) {
        return true;
      }

      const placeholderText = (isEmptyDoc && options.emptyDocText) ? options.emptyDocText : options.text;
      // Skip when the chosen text is empty — avoids painting invisible
      // placeholder widgets on every empty line.
      if (!placeholderText) {
        return true;
      }
      decorations.push(createPlaceholderDecoration(pos, options, placeholderText));
      foundFirst = true;
    }

    return true;
  });

  return decorations;
}

/**
 * Create a placeholder plugin for the editor.
 *
 * The plugin shows a placeholder text when a block is empty, providing
 * visual guidance for users. The placeholder is implemented as a decoration
 * that doesn't affect the document content.
 *
 * @param options - Configuration options for the placeholder
 * @returns ProseMirror plugin
 *
 * @example
 * ```typescript
 * import { placeholderPlugin } from './plugins/placeholder';
 *
 * const plugins = [
 *   placeholderPlugin({ text: 'Start typing...' }),
 *   // ... other plugins
 * ];
 * ```
 */
export function placeholderPlugin(options: PlaceholderPluginOptions = {}): Plugin {
  const mergedOptions: Required<PlaceholderPluginOptions> = {
    ...defaultOptions,
    ...options,
  };

  return new Plugin({
    key: placeholderPluginKey,

    state: {
      init(_, state) {
        const { $from, empty } = state.selection;
        const cursorPos = empty ? $from.pos : null;
        return DecorationSet.create(
          state.doc,
          findPlaceholderDecorations(state.doc, mergedOptions, cursorPos)
        );
      },

      apply(tr, decorationSet, _oldState, newState) {
        // Recalculate on document changes or selection changes
        if (!tr.docChanged && !tr.selectionSet) {
          return decorationSet;
        }

        const { $from, empty } = newState.selection;
        const cursorPos = empty ? $from.pos : null;
        return DecorationSet.create(
          newState.doc,
          findPlaceholderDecorations(newState.doc, mergedOptions, cursorPos)
        );
      },
    },

    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/**
 * CSS styles for the placeholder.
 * Add these styles to your stylesheet or use Tailwind equivalents.
 *
 * ```css
 * .void-placeholder {
 *   position: absolute;
 *   pointer-events: none;
 *   user-select: none;
 *   color: var(--color-text-muted, #9ca3af);
 *   opacity: 0.7;
 * }
 *
 * .ProseMirror p {
 *   position: relative;
 * }
 * ```
 */
export const placeholderStyles = `
.void-placeholder {
  position: absolute;
  pointer-events: none;
  user-select: none;
  color: var(--color-text-muted, #9ca3af);
  opacity: 0.7;
}

.ProseMirror p {
  position: relative;
}
`;
