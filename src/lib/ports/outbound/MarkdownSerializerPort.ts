/**
 * MarkdownSerializerPort — outbound port for translating between
 * markdown text and the domain block list.
 *
 * The application layer uses this port to read and write markdown
 * without depending on ProseMirror or the markdown library directly.
 * Adapters wrap the actual parser/serializer behind it.
 */

import type { Block } from '$lib/domain/entities/Block';
import type { DocumentMeta } from '$lib/domain/values/DocumentMeta';

export interface ParsedMarkdownDocument {
  /** Markdown body with YAML frontmatter removed. */
  content: string;
  /** Metadata parsed from YAML frontmatter. */
  meta: Partial<DocumentMeta>;
  /** Domain block list parsed from content. */
  blocks: Block[];
}

export interface MarkdownSerializerPort {
  /**
   * Parse a markdown string into the domain block list.
   * Round-trips through ProseMirror internally; callers don't see that.
   */
  parseToBlocks(markdown: string): Block[];

  /** Serialize a domain block list to a markdown string. */
  serializeBlocks(blocks: Block[]): string;

  /**
   * Parse a complete markdown document, stripping frontmatter before block
   * parsing and returning the extracted metadata separately.
   */
  parseDocument(markdown: string): ParsedMarkdownDocument;
}
