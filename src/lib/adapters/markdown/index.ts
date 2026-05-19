/**
 * Markdown Adapter Module
 *
 * Provides markdown-based document persistence implementing DocumentPort.
 * Documents are stored as markdown files with YAML frontmatter for metadata.
 *
 * Exports:
 * - MarkdownAdapter: Main adapter implementing DocumentPort
 * - parseMarkdown: Parse markdown to ProseMirror document
 * - serializeToMarkdown: Serialize ProseMirror document to markdown
 * - parseMarkdownWithFrontmatter: Parse markdown with YAML frontmatter
 * - serializeFrontmatter: Serialize metadata to YAML frontmatter
 * - combineWithFrontmatter: Combine content with frontmatter
 * - updateFrontmatter: Update frontmatter in existing markdown
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

// Main adapter
export { MarkdownAdapter, type MarkdownAdapterConfig, prosemirrorDocToBlocks, blocksToProsemirrorDoc } from './MarkdownAdapter';

// Parser
export { parseMarkdown } from './parser';

// Serializer
export { serializeToMarkdown } from './serializer';

// Frontmatter utilities
export {
  parseMarkdownWithFrontmatter,
  serializeFrontmatter,
  combineWithFrontmatter,
  updateFrontmatter,
  type ParsedMarkdown,
} from './frontmatter';

// Port-friendly serializer wrapper
export { MarkdownSerializerAdapter } from './MarkdownSerializerAdapter';
