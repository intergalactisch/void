/**
 * EditorPortFactory - creates editor rendering ports.
 *
 * The application service owns editor lifecycle, but concrete editor
 * construction remains an infrastructure concern.
 */

import type {
  EditorBlockMenuMode,
  EditorInlineGenerateRequest,
  EditorPort,
  EditorInlineGenerateCallbacks,
  EditorMenuPosition,
  EditorMenuStatePayload,
  EditorPageLinkNote,
} from './EditorPort';
import type { CommandRegistryPort } from './CommandRegistryPort';
import type { Block } from '$lib/domain';
import type { BlockType } from '$lib/domain/values/BlockType';

export interface EditorNotesProvider {
  searchNotes(query: string, context?: { mode: 'typed' | 'selection'; activePath?: string | null }): EditorPageLinkNote[];
  getAllNotes(context?: { mode: 'typed' | 'selection'; activePath?: string | null }): EditorPageLinkNote[];
}

export interface EditorPortFactoryOptions {
  commandRegistry: CommandRegistryPort;
  notesProvider?: EditorNotesProvider;
  onSlashMenuChange?: (state: EditorMenuStatePayload) => void;
  onPageLinkChange?: (state: EditorMenuStatePayload) => void;
  onBlockMenuRequest?: (
    blockId: string,
    position: EditorMenuPosition,
    currentType: BlockType,
    lineIndex: number,
    mode: EditorBlockMenuMode
  ) => void;
  onLineageInspectRequest?: (
    blockId: string,
    lineIndex: number,
    position: EditorMenuPosition,
    currentType: BlockType
  ) => void;
  onPageLinkClick?: (path: string) => void;
  onExternalLinkClick?: (url: string) => void;
  onTodoToggle?: (blockId: string, content: string, checked: boolean) => void;
  onAIInlineGenerate?: (
    prompt: string,
    selectionText: string | null,
    callbacks: EditorInlineGenerateCallbacks,
    request: EditorInlineGenerateRequest
  ) => void;
  enableDragDrop?: boolean;
  enableAIRewrite?: boolean;
  defaultBlockAttrs?: (type: Block['type']) => Block['attrs'] | undefined;
}

export interface EditorPortFactory {
  create(options: EditorPortFactoryOptions): EditorPort;
}
