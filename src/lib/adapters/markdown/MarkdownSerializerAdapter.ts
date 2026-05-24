/**
 * MarkdownSerializerAdapter — implements MarkdownSerializerPort.
 *
 * Wraps the markdown-it parser, the ProseMirror serializer, and the
 * void schema so the application layer can convert between markdown
 * and the domain block list without importing any of those modules
 * directly.
 */

import type { Block } from '$lib/domain/entities/Block';
import type { MarkdownSerializerPort, ParsedMarkdownDocument } from '$lib/ports/outbound/MarkdownSerializerPort';
import { parseMarkdown } from './parser';
import { serializeToMarkdown } from './serializer';
import { prosemirrorDocToBlocks, blocksToProsemirrorDoc } from './index';
import { voidSchema } from '$lib/adapters/prosemirror/schema';
import { parseMarkdownWithFrontmatter } from './frontmatter';

export class MarkdownSerializerAdapter implements MarkdownSerializerPort {
  parseToBlocks(markdown: string): Block[] {
    const pmDoc = parseMarkdown(markdown, voidSchema);
    return prosemirrorDocToBlocks(pmDoc);
  }

  serializeBlocks(blocks: Block[]): string {
    const pmDoc = blocksToProsemirrorDoc(blocks);
    return serializeToMarkdown(pmDoc);
  }

  parseDocument(markdown: string): ParsedMarkdownDocument {
    const { content, meta } = parseMarkdownWithFrontmatter(markdown);
    return {
      content,
      meta,
      blocks: this.parseToBlocks(content),
    };
  }
}
