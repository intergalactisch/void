/**
 * ProseMirrorEditorPortFactory - infrastructure factory for editor ports.
 */

import type { EditorPortFactory, EditorPortFactoryOptions } from '$lib/ports/outbound';
import type { BlockType } from '$lib/domain/values/BlockType';
import { ProseMirrorAdapter, type ProseMirrorAdapterOptions } from './ProseMirrorAdapter';

export class ProseMirrorEditorPortFactory implements EditorPortFactory {
  create(options: EditorPortFactoryOptions): ProseMirrorAdapter {
    const adapterOptions: ProseMirrorAdapterOptions = {
      commandRegistry: options.commandRegistry,
    };

    if (options.notesProvider) adapterOptions.notesProvider = options.notesProvider;
    if (options.enableDragDrop !== undefined) adapterOptions.enableDragDrop = options.enableDragDrop;
    if (options.enableAIRewrite !== undefined) adapterOptions.enableAIRewrite = options.enableAIRewrite;
    if (options.onSlashMenuChange) adapterOptions.onSlashMenuChange = options.onSlashMenuChange;
    if (options.onPageLinkChange) adapterOptions.onPageLinkChange = options.onPageLinkChange;
    if (options.onPageLinkClick) adapterOptions.onPageLinkClick = options.onPageLinkClick;
    if (options.onExternalLinkClick) adapterOptions.onExternalLinkClick = options.onExternalLinkClick;
    if (options.onTodoToggle) adapterOptions.onTodoToggle = options.onTodoToggle;
    if (options.resolveImageSrc) adapterOptions.resolveImageSrc = options.resolveImageSrc;
    if (options.onAIInlineGenerate) adapterOptions.onAIInlineGenerate = options.onAIInlineGenerate;
    if (options.onBlockMenuRequest) {
      adapterOptions.onMenuClick = (blockId, lineIndex, event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const wrapper = target?.closest('[data-block-type]');
        const currentType = (wrapper?.getAttribute('data-block-type') ?? 'paragraph') as BlockType;
        options.onBlockMenuRequest?.(
          blockId,
          { top: event.clientY, left: event.clientX },
          currentType,
          lineIndex,
          'actions',
        );
      };
    }
    if (options.onLineageInspectRequest) {
      adapterOptions.onLineageClick = (blockId, lineIndex, event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const wrapper = target?.closest('[data-block-type]');
        const currentType = (wrapper?.getAttribute('data-block-type') ?? 'paragraph') as BlockType;
        options.onLineageInspectRequest?.(
          blockId,
          lineIndex,
          { top: event.clientY, left: event.clientX },
          currentType,
        );
      };
    }

    return new ProseMirrorAdapter(adapterOptions);
  }
}
