/**
 * ContextBuilderAdapter - Builds operation context from notes
 *
 * Reads notes and assembles context based on requirements.
 * Depends on DocumentService, NotesService, and ProtectionService via DI.
 *
 * Part of the Hexagonal Architecture secondary adapters layer.
 */

import { ok, err, type Result } from '$lib/core/result';
import type {
  ContextBuilderPort,
  ContextBuildOptions,
} from '$lib/ports/outbound/ContextBuilderPort';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import type { NotesService } from '$lib/ports/inbound/NotesService';
import type { ProtectionService } from '$lib/ports/inbound/ProtectionService';
import type { OperationContext } from '$lib/domain/values/OperationContext';
import { createEmptyOperationContext } from '$lib/domain/values/OperationContext';
import type { ContextRequirement } from '$lib/domain/values/OperationTemplate';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';

export class ContextBuilderAdapter implements ContextBuilderPort {
  #documentService: DocumentService;
  #notesService: NotesService;
  #protectionService: ProtectionService;

  constructor(
    documentService: DocumentService,
    notesService: NotesService,
    protectionService: ProtectionService,
  ) {
    this.#documentService = documentService;
    this.#notesService = notesService;
    this.#protectionService = protectionService;
  }

  async buildContext(
    requirements: ContextRequirement[],
    options?: ContextBuildOptions
  ): Promise<Result<OperationContext, Error>> {
    try {
      const context = createEmptyOperationContext();

      for (const req of requirements) {
        switch (req.type) {
          case 'currentNote': {
            if (options?.currentNotePath) {
              const note = this.#findNote(options.currentNotePath);
              if (this.#canReadProtectedNote(note)) {
                const result = await this.#documentService.readContent(options.currentNotePath);
                if (result.ok) {
                  context.noteContents.set(options.currentNotePath, result.value);
                }
              }
            }
            break;
          }
          case 'recentNotes': {
            const flatNotes = this.#flattenItems(this.#notesService.getState().items);
            const limit = req.limit ?? 10;
            for (const note of flatNotes.slice(0, limit)) {
              context.noteSummaries.push({
                path: note.path,
                title: note.title,
                excerpt: '',
              });
            }
            break;
          }
          case 'search': {
            if (req.query) {
              const flatNotes = this.#flattenItems(this.#notesService.getState().items);
              const query = req.query.toLowerCase();
              const matches = flatNotes.filter(
                (n) => n.title.toLowerCase().includes(query)
              );
              for (const note of matches.slice(0, req.limit ?? 10)) {
                context.noteSummaries.push({
                  path: note.path,
                  title: note.title,
                  excerpt: '',
                });
              }
            }
            break;
          }
          case 'allNotes': {
            const flatNotes = this.#flattenItems(this.#notesService.getState().items);
            for (const note of flatNotes) {
              context.noteSummaries.push({
                path: note.path,
                title: note.title,
                excerpt: '',
              });
            }
            break;
          }
          case 'folder': {
            const flatNotes = this.#flattenItems(this.#notesService.getState().items);
            const folder = req.folder ?? '';
            const folderNotes = flatNotes.filter((n) => n.path.startsWith(folder));
            for (const note of folderNotes) {
              const result = this.#canReadProtectedNote(note)
                ? await this.#documentService.readContent(note.path)
                : null;
              if (result?.ok) context.noteContents.set(note.path, result.value);
              context.noteSummaries.push({
                path: note.path,
                title: note.title,
                excerpt: result?.ok ? result.value.slice(0, 200) : '',
              });
            }
            break;
          }
        }
      }

      // Build system prompt from context
      context.systemPrompt = this.#buildSystemPrompt(context);

      // Trim if needed
      if (options?.maxTokens) {
        return ok(this.trimContext(context, options.maxTokens));
      }

      return ok(context);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  estimateTokens(context: OperationContext): number {
    let chars = context.systemPrompt.length;
    for (const content of context.noteContents.values()) {
      chars += content.length;
    }
    for (const summary of context.noteSummaries) {
      chars += summary.title.length + summary.excerpt.length + summary.path.length;
    }
    return Math.ceil(chars / 4);
  }

  trimContext(context: OperationContext, targetTokens: number): OperationContext {
    const trimmed = { ...context, noteContents: new Map(context.noteContents) };
    let currentTokens = this.estimateTokens(trimmed);

    // Remove note contents starting from the end until we're under budget
    if (currentTokens > targetTokens) {
      const paths = Array.from(trimmed.noteContents.keys());
      for (let i = paths.length - 1; i >= 0 && currentTokens > targetTokens; i--) {
        const path = paths[i]!;
        const removed = trimmed.noteContents.get(path);
        trimmed.noteContents.delete(path);
        currentTokens -= Math.ceil((removed?.length ?? 0) / 4);
      }
    }

    return trimmed;
  }

  #flattenItems(items: NotesListItem[]): NotesListItem[] {
    const result: NotesListItem[] = [];
    for (const item of items) {
      if (!item.isFolder) {
        result.push(item);
      }
      if (item.children) {
        result.push(...this.#flattenItems(item.children));
      }
    }
    return result;
  }

  #findNote(path: string): NotesListItem | null {
    return this.#flattenItems(this.#notesService.getState().items)
      .find((item) => !item.isFolder && item.path === path) ?? null;
  }

  #canReadProtectedNote(note: NotesListItem | null): boolean {
    const protection = note?.protection;
    if (!protection || protection.level !== 'protected') return true;
    if (protection.lockState === 'locked') return false;
    const policy = this.#protectionService.currentPolicy();
    if (!policy.requireAIApprovalForProtectedReads) return true;
    return this.#protectionService.hasAIContextAuthorization(protection.noteId, 'note.read');
  }

  #buildSystemPrompt(context: OperationContext): string {
    const parts: string[] = [
      'You are an AI assistant integrated into a note-taking application called Void.',
      'You have access to the user\'s notes and can help with research, writing, and organization.',
    ];

    if (context.noteSummaries.length > 0) {
      parts.push(`\nAvailable notes (${context.noteSummaries.length}):`);
      for (const summary of context.noteSummaries.slice(0, 20)) {
        parts.push(`- ${summary.title} (${summary.path})`);
      }
    }

    if (context.noteContents.size > 0) {
      parts.push(`\nFull content loaded for ${context.noteContents.size} note(s).`);
    }

    return parts.join('\n');
  }
}
