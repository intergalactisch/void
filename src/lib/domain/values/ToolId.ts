/**
 * ToolId - Namespaced tool identifier
 *
 * Tools are identified by a namespaced ID in the format 'namespace:action'.
 * Examples:
 * - 'note:create' - Create a new note
 * - 'note:delete' - Delete a note
 * - 'editor:format' - Format selected text
 * - 'search:notes' - Search through notes
 *
 * Part of the Hexagonal Architecture domain layer.
 */

/**
 * Tool namespaces organize tools by category.
 */
export type ToolNamespace =
  | 'note'          // Note CRUD + organization
  | 'editor'        // Editor manipulation
  | 'search'        // Search operations
  | 'media'         // Durable media assets
  | 'navigation'    // Navigation between views
  | 'todo'          // Todo operations
  | 'content'       // Content generation
  | 'transform'     // Content transformation
  | 'intelligence'  // Cross-note analysis
  | 'action'        // Document actions (/distill, /synthesize, etc.)
  | 'lineage'       // Line-level history and version tools
  | 'commitment'    // Commitment source/staleness tools
  | 'fs'            // File system (CLI-exclusive)
  | 'system'        // System-level operations
  | 'ai'            // AI meta tools
  | 'custom';       // User-defined tools

/**
 * Tool ID in the format 'namespace:action'.
 * Branded type for type safety.
 */
export type ToolId = string & { readonly __brand: 'ToolId' };

/**
 * Create a ToolId from namespace and action.
 */
export function createToolId(namespace: ToolNamespace, action: string): ToolId {
  if (!action || action.includes(':')) {
    throw new Error(`Invalid tool action: "${action}". Action must be non-empty and cannot contain ":"`);
  }
  return `${namespace}:${action}` as ToolId;
}

/**
 * Parse a ToolId string into namespace and action.
 */
export function parseToolId(id: string): { namespace: ToolNamespace; action: string } | null {
  const parts = id.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [namespace, action] = parts;
  const validNamespaces: ToolNamespace[] = [
    'note', 'editor', 'search', 'media', 'navigation', 'todo', 'content',
    'transform', 'intelligence', 'action', 'lineage', 'commitment',
    'fs', 'system', 'ai', 'custom',
  ];

  if (!validNamespaces.includes(namespace as ToolNamespace) || !action) {
    return null;
  }

  return { namespace: namespace as ToolNamespace, action };
}

/**
 * Check if a string is a valid ToolId.
 */
export function isValidToolId(id: string): id is ToolId {
  return parseToolId(id) !== null;
}

/**
 * Get the namespace from a ToolId.
 */
export function getToolNamespace(id: ToolId): ToolNamespace {
  const parsed = parseToolId(id);
  if (!parsed) {
    throw new Error(`Invalid ToolId: "${id}"`);
  }
  return parsed.namespace;
}

/**
 * Get the action from a ToolId.
 */
export function getToolAction(id: ToolId): string {
  const parsed = parseToolId(id);
  if (!parsed) {
    throw new Error(`Invalid ToolId: "${id}"`);
  }
  return parsed.action;
}

// =========================================================================
// Common tool IDs (type-safe constants)
// =========================================================================

export const TOOL_IDS = {
  // Note tools
  NOTE_CREATE: createToolId('note', 'create'),
  NOTE_READ: createToolId('note', 'read'),
  NOTE_UPDATE: createToolId('note', 'update'),
  NOTE_DELETE: createToolId('note', 'delete'),
  NOTE_LIST: createToolId('note', 'list'),

  // Editor tools
  EDITOR_FORMAT: createToolId('editor', 'format'),
  EDITOR_INSERT: createToolId('editor', 'insert'),
  EDITOR_REPLACE: createToolId('editor', 'replace'),
  EDITOR_INSERT_CODE_BLOCK: createToolId('editor', 'insert-code-block'),
  EDITOR_UPDATE_CODE_BLOCK: createToolId('editor', 'update-code-block'),
  EDITOR_SELECT: createToolId('editor', 'select'),

  // Search tools
  SEARCH_NOTES: createToolId('search', 'notes'),
  SEARCH_CONTENT: createToolId('search', 'content'),
  SEARCH_MEDIA: createToolId('search', 'media'),

  // Media tools
  MEDIA_ATTACH_IMAGE: createToolId('media', 'attach-image'),
  MEDIA_LIST_ASSETS: createToolId('media', 'list-assets'),
  MEDIA_DOWNLOAD_IMAGE: createToolId('media', 'download-image'),
  MEDIA_CLEANUP_ORPHANS: createToolId('media', 'cleanup-orphans'),

  // Navigation tools
  NAV_GOTO: createToolId('navigation', 'goto'),
  NAV_BACK: createToolId('navigation', 'back'),
  NAV_FORWARD: createToolId('navigation', 'forward'),

  // System tools
  SYSTEM_SETTINGS: createToolId('system', 'settings'),
  SYSTEM_HELP: createToolId('system', 'help'),
} as const;
