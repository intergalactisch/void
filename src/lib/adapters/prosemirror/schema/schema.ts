/**
 * Void Editor ProseMirror Schema
 *
 * Combines node and mark definitions into a complete schema.
 * This schema defines the structure of documents in the editor.
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Schema } from 'prosemirror-model';
import { nodes } from './nodes';
import { marks } from './marks';

/**
 * The main editor schema
 * Defines all valid document structures
 */
export const voidSchema = new Schema({ nodes, marks });

/**
 * Schema type for type-safe operations
 */
export type VoidSchema = typeof voidSchema;

/**
 * Re-export schema parts for convenience
 */
export { nodes, marks };
