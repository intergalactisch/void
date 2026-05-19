/**
 * ProseMirror Adapter exports
 *
 * Infrastructure adapter for ProseMirror-based rich text editing.
 * Implements EditorPort interface for hexagonal architecture.
 */

// Main adapter
export { ProseMirrorAdapter, type ProseMirrorAdapterOptions } from './ProseMirrorAdapter';
export { ProseMirrorEditorPortFactory } from './ProseMirrorEditorPortFactory';

// Schema exports
export { voidSchema, type VoidSchema, nodes, marks } from './schema';

// Commands
export * from './commands';

// Plugins
export * from './plugins';

// Views (NodeViews with drag handles)
export { BlockView, createBlockViewFactory, type BlockViewOptions } from './views';
