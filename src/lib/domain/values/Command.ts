/**
 * Command value object - command definitions
 *
 * This is a pure domain value with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 *
 * A "command" is any user-initiated action — slash-menu blocks, global
 * shortcuts, palette commands, tool actions. They share one shape so a
 * single registry can serve every surface.
 */

/** Stable category taxonomy used by the registry, palette, and shortcut sheet. */
export type CommandCategory =
  | 'basic'
  | 'media'
  | 'advanced'
  | 'ai'
  | 'editor'
  | 'navigation'
  | 'note'
  | 'view'
  | 'tasks'
  | 'tools'
  | 'settings'
  | 'system'
  | 'search';

export interface SlashCommand {
  /** Unique command identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon name */
  icon?: string;
  /** Search keywords */
  keywords: string[];
  /** Command category for grouping */
  category: CommandCategory;
  /** Keyboard shortcut hint (display-only — for input-rule mnemonics like '##') */
  shortcut?: string;
  /** Description for tooltip / shortcut sheet */
  description?: string;
  /**
   * Cross-platform default keybinding (e.g. 'mod+k', 'mod+shift+f').
   * 'mod' resolves to Cmd on macOS and Ctrl elsewhere.
   * Bound by KeymapService at registration time.
   */
  defaultKeybinding?: string;
  /**
   * Scopes in which the binding is active. Narrowest match wins at resolve time.
   * Examples: ['global'], ['editor'], ['tasks-workspace'], ['palette-open'].
   * Defaults to ['global'] when omitted.
   */
  scope?: string[];
  /** Higher priority wins on ties when multiple bindings overlap. Defaults to 0. */
  priority?: number;
}

export interface CommandGroup {
  category: CommandCategory;
  label: string;
  commands: SlashCommand[];
}

/** Built-in slash-menu commands (block insertion). Global shortcuts live elsewhere. */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    id: 'paragraph',
    label: 'Text',
    keywords: ['text', 'paragraph', 'p'],
    category: 'basic',
    icon: 'text',
  },
  {
    id: 'heading1',
    label: 'Heading 1',
    keywords: ['h1', 'heading', 'title'],
    category: 'basic',
    icon: 'heading1',
    shortcut: '#',
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    keywords: ['h2', 'heading'],
    category: 'basic',
    icon: 'heading2',
    shortcut: '##',
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    keywords: ['h3', 'heading'],
    category: 'basic',
    icon: 'heading3',
    shortcut: '###',
  },
  {
    id: 'bulletList',
    label: 'Bullet List',
    keywords: ['list', 'bullet', 'ul'],
    category: 'basic',
    icon: 'list',
    shortcut: '-',
  },
  {
    id: 'numberedList',
    label: 'Numbered List',
    keywords: ['list', 'numbered', 'ol', 'order'],
    category: 'basic',
    icon: 'listOrdered',
    shortcut: '1.',
  },
  {
    id: 'todoItem',
    label: 'To-do',
    keywords: ['todo', 'task', 'checkbox', 'check'],
    category: 'basic',
    icon: 'checkSquare',
    shortcut: '[]',
  },
  {
    id: 'blockquote',
    label: 'Quote',
    keywords: ['quote', 'blockquote'],
    category: 'basic',
    icon: 'quote',
    shortcut: '>',
  },
  {
    id: 'codeBlock',
    label: 'Code Block',
    keywords: ['code', 'snippet', 'pre'],
    category: 'basic',
    icon: 'code',
    shortcut: '```',
  },
  {
    id: 'horizontalRule',
    label: 'Divider',
    keywords: ['divider', 'hr', 'line', 'separator'],
    category: 'basic',
    icon: 'minus',
    shortcut: '---',
  },
  {
    id: 'callout',
    label: 'Callout',
    keywords: ['callout', 'info', 'warning', 'note'],
    category: 'advanced',
    icon: 'alertCircle',
  },
  {
    id: 'toggle',
    label: 'Toggle',
    keywords: ['toggle', 'details', 'collapse', 'summary'],
    category: 'advanced',
    icon: 'chevronRight',
  },
  {
    id: 'table',
    label: 'Table',
    keywords: ['table', 'grid', 'columns', 'rows'],
    category: 'advanced',
    icon: 'table',
  },
  {
    id: 'image',
    label: 'Image',
    keywords: ['image', 'picture', 'photo', 'img'],
    category: 'media',
    icon: 'image',
  },
];
