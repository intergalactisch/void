/**
 * Keymap store - reactive view over KeymapService for the Settings UI and
 * the ShortcutSheet. Exposes bindings, conflicts, and chord-record state.
 *
 * Primary adapter: stays thin and delegates all logic to the service.
 */

import type { KeymapService, KeyBinding, KeyConflict } from '$lib/ports/inbound/KeymapService';
import type { CommandService } from '$lib/ports/inbound/CommandService';
import type { KeyChord } from '$lib/domain/values/KeyChord';
import type { CommandCategory } from '$lib/domain/values';

export type KeymapBindingContext = 'global' | 'notes' | 'tasks' | 'ai-command-center';

export interface KeymapBindingView extends KeyBinding {
  label: string;
  description?: string;
  category: CommandCategory | string;
  context: KeymapBindingContext;
  contextLabel: string;
  hasConflict: boolean;
}

export interface KeymapBindingGroup {
  context: KeymapBindingContext;
  label: string;
  bindings: KeymapBindingView[];
}

interface CommandMeta {
  label: string;
  description?: string;
  category: CommandCategory | string;
}

const CONTEXT_LABELS: Record<KeymapBindingContext, string> = {
  global: 'Global',
  notes: 'Notes',
  tasks: 'Todos',
  'ai-command-center': 'AI Command Center',
};

const CONTEXT_ORDER: KeymapBindingContext[] = [
  'global',
  'notes',
  'tasks',
  'ai-command-center',
];

class KeymapStore {
  private service: KeymapService | null = null;
  private commands: CommandService | null = null;
  private commandMeta = new Map<string, CommandMeta>();
  private unsubscribe: (() => void) | null = null;

  bindings = $state<KeyBinding[]>([]);
  bindingViews = $state<KeymapBindingView[]>([]);
  bindingGroups = $state<KeymapBindingGroup[]>([]);
  conflicts = $state<KeyConflict[]>([]);
  ready = $state(false);

  /** Wire to a KeymapService instance. Idempotent. */
  init(service: KeymapService, commands?: CommandService): void {
    if (this.service === service && this.commands === (commands ?? null)) return;
    this.unsubscribe?.();
    this.service = service;
    this.commands = commands ?? null;
    this.refreshCommandMeta();
    this.unsubscribe = service.subscribe((bindings) => {
      this.bindings = bindings;
      this.conflicts = service.findConflicts();
      this.refreshBindingViews();
    });
    this.ready = service.isReady();
  }

  /** Mark service as ready (used after KeymapService.load() resolves). */
  markReady(): void {
    this.ready = true;
  }

  /** Apply a user override for the given command. */
  async setOverride(commandId: string, chord: KeyChord) {
    if (!this.service) return;
    await this.service.setOverride(commandId, chord);
  }

  /** Restore the default for the given command. */
  async clearOverride(commandId: string) {
    if (!this.service) return;
    await this.service.clearOverride(commandId);
  }

  /** Tear down subscription. Used in tests / hot reload. */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.service = null;
    this.commands = null;
    this.commandMeta.clear();
    this.bindings = [];
    this.bindingViews = [];
    this.bindingGroups = [];
    this.conflicts = [];
    this.ready = false;
  }

  private refreshCommandMeta(): void {
    this.commandMeta.clear();
    if (!this.commands) return;
    for (const command of this.commands.getAllCommands()) {
      const meta: CommandMeta = {
        label: command.label,
        category: command.category,
      };
      if (command.description) {
        meta.description = command.description;
      }
      this.commandMeta.set(command.id, meta);
    }
  }

  private refreshBindingViews(): void {
    const views = this.bindings.map((binding) => {
      const meta = this.commandMeta.get(binding.commandId);
      const context = bindingContext(binding.scope);
      const view: KeymapBindingView = {
        ...binding,
        label: meta?.label ?? prettyCommandLabel(binding.commandId),
        category: meta?.category ?? categoryFromCommandId(binding.commandId),
        context,
        contextLabel: CONTEXT_LABELS[context],
        hasConflict: this.bindingHasConflict(binding),
      };
      if (meta?.description) {
        view.description = meta.description;
      }
      return view;
    });

    views.sort((a, b) => {
      const contextDelta = CONTEXT_ORDER.indexOf(a.context) - CONTEXT_ORDER.indexOf(b.context);
      if (contextDelta !== 0) return contextDelta;
      return a.label.localeCompare(b.label);
    });

    this.bindingViews = views;
    this.bindingGroups = CONTEXT_ORDER
      .map((context) => ({
        context,
        label: CONTEXT_LABELS[context],
        bindings: views.filter((binding) => binding.context === context),
      }))
      .filter((group) => group.bindings.length > 0);
  }

  private bindingHasConflict(binding: KeyBinding): boolean {
    return this.conflicts.some((conflict) =>
      conflict.bindings.some((candidate) => candidate.commandId === binding.commandId)
    );
  }
}

export const keymapStore = new KeymapStore();

function bindingContext(scopes: string[]): KeymapBindingContext {
  if (scopes.includes('context:tasks') || scopes.includes('tasks-workspace')) return 'tasks';
  if (scopes.includes('context:ai-command-center') || scopes.includes('ai-sidebar')) {
    return 'ai-command-center';
  }
  if (
    scopes.includes('context:notes') ||
    scopes.includes('editor') ||
    scopes.includes('editor-or-empty') ||
    scopes.includes('find-bar') ||
    scopes.includes('has-document') ||
    scopes.includes('tag-view')
  ) {
    return 'notes';
  }
  return 'global';
}

function categoryFromCommandId(commandId: string): string {
  return commandId.split('.')[0] ?? 'system';
}

function prettyCommandLabel(commandId: string): string {
  const tail = commandId.split('.').slice(1).join('.') || commandId;
  return tail
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}
