/**
 * KeymapServiceImpl - pure logic for chord → command resolution.
 *
 * Holds two maps:
 *  - defaults:  commandId → { defaultChord, scope, priority }
 *  - overrides: commandId → chord (user-set; NULL_CHORD means "unbound")
 *
 * On resolve, builds a candidate list keyed by serialized chord and picks
 * the narrowest matching scope. Ties broken by priority, then registration
 * order.
 *
 * Pure: no DOM, no I/O. Storage is loaded asynchronously via the injected
 * KeymapStoragePort and applied to the in-memory state.
 */

import type {
  KeymapService,
  KeyBinding,
  KeyConflict,
} from '$lib/ports/inbound/KeymapService';
import type { KeymapStoragePort } from '$lib/ports/outbound/KeymapStoragePort';
import type { KeyChord } from '$lib/domain/values';
import {
  NULL_CHORD,
  chordsEqual,
  parseChord,
  serializeChord,
} from '$lib/domain/values/KeyChord';
import type { ScopeSnapshot } from '$lib/domain/values/ScopeSnapshot';
import { ok, err, type Result } from '$lib/core';

interface Registration {
  commandId: string;
  defaultChord: KeyChord;
  scope: string[];
  priority: number;
  /** Insertion order — used as a stable tiebreaker. */
  order: number;
}

const GLOBAL_SCOPE = ['global'];

/**
 * Comparator for scope-narrowness. Returns negative if `a` is narrower than
 * `b`, positive if wider, zero if equally narrow. A scope is "narrower" when:
 *   1. Every scope in its array matches the snapshot AND the count of matching
 *      scopes is greater than the other's, OR
 *   2. It is non-global while the other is global.
 *
 * For Wave 1 we use a simple heuristic: a scope is narrower if it has MORE
 * scope tokens active in the snapshot. e.g. ['editor'] (1 active) is narrower
 * than ['global'] (counted as 0 unless explicitly active).
 */
function scopeMatches(scopes: string[], snapshot: ScopeSnapshot): boolean {
  for (const s of scopes) {
    if (!isScopeActive(s, snapshot)) return false;
  }
  return true;
}

function isScopeActive(scope: string, snapshot: ScopeSnapshot): boolean {
  if (scope.startsWith('context:')) {
    return snapshot.activeContext === scope.slice('context:'.length);
  }

  switch (scope) {
    case 'global':
      return true;
    case 'editor':
      return snapshot.editorFocused;
    case 'editor-or-empty':
      // Editor commands that should also fire in empty-state (no document)
      return !snapshot.modalOpen && !snapshot.paletteOpen;
    case 'palette-open':
      return snapshot.paletteOpen;
    case 'modal-open':
      return snapshot.modalOpen;
    case 'tasks-workspace':
      return snapshot.tasksWorkspaceOpen;
    case 'ai-sidebar':
      return snapshot.aiSidebarOpen;
    case 'tag-view':
      return snapshot.tagViewActive;
    case 'find-bar':
      return snapshot.findBarOpen;
    case 'has-document':
      return snapshot.activeNotePath !== null;
    case 'no-modal':
      return !snapshot.modalOpen;
    case 'no-palette':
      return !snapshot.paletteOpen;
    case 'no-input-focus':
      // Conservative — only true when the editor is NOT focused. Used so
      // global text-keys (single letters) don't fire while typing.
      return !snapshot.editorFocused;
    default:
      // Unknown scopes are treated as inactive — fail-safe.
      return false;
  }
}

/**
 * Specificity score: higher = narrower. 'global' counts as 0; any other
 * matching scope adds 1. This gives editor-scope priority over global-scope
 * when both match.
 */
function specificity(scopes: string[]): number {
  let score = 0;
  for (const s of scopes) {
    if (s === 'global') continue;
    score += s.startsWith('context:') ? 10 : 1;
  }
  return score;
}

export class KeymapServiceImpl implements KeymapService {
  private registrations = new Map<string, Registration>();
  private overrides = new Map<string, KeyChord>();
  private subscribers = new Set<(bindings: KeyBinding[]) => void>();
  private storage: KeymapStoragePort;
  private ready = false;
  private orderCounter = 0;

  constructor(storage: KeymapStoragePort) {
    this.storage = storage;
  }

  /**
   * Load persisted overrides from storage. Call once at startup before
   * dispatching keystrokes. Subsequent calls reload — useful for tests.
   */
  async load(): Promise<Result<void, Error>> {
    const result = await this.storage.loadOverrides();
    if (!result.ok) {
      this.ready = true;
      return err(result.error);
    }
    this.overrides.clear();
    for (const [commandId, serialized] of Object.entries(result.value)) {
      if (!serialized) {
        // Empty string ⇒ explicitly unbound by user.
        this.overrides.set(commandId, NULL_CHORD);
      } else {
        const chord = parseChord(serialized);
        if (chord !== NULL_CHORD) {
          this.overrides.set(commandId, chord);
        }
      }
    }
    this.ready = true;
    this.notify();
    return ok(undefined);
  }

  isReady(): boolean {
    return this.ready;
  }

  register(
    commandId: string,
    defaultChord: KeyChord,
    options: { scope?: string[]; priority?: number } = {}
  ): void {
    const existing = this.registrations.get(commandId);
    const order = existing ? existing.order : this.orderCounter++;
    this.registrations.set(commandId, {
      commandId,
      defaultChord,
      scope: options.scope && options.scope.length > 0 ? options.scope : GLOBAL_SCOPE,
      priority: options.priority ?? 0,
      order,
    });
    this.notify();
  }

  unregister(commandId: string): void {
    this.registrations.delete(commandId);
    this.overrides.delete(commandId);
    this.notify();
  }

  async setOverride(commandId: string, chord: KeyChord): Promise<Result<void, Error>> {
    if (chord === NULL_CHORD || !chord.key) {
      this.overrides.set(commandId, NULL_CHORD);
    } else {
      this.overrides.set(commandId, chord);
    }
    this.notify();
    return this.persist();
  }

  async clearOverride(commandId: string): Promise<Result<void, Error>> {
    this.overrides.delete(commandId);
    this.notify();
    return this.persist();
  }

  resolve(chord: KeyChord, scope: ScopeSnapshot): string | null {
    if (!chord.key) return null;

    let bestCommand: string | null = null;
    let bestSpecificity = -1;
    let bestPriority = -Infinity;
    let bestOrder = Infinity;

    for (const reg of this.registrations.values()) {
      const active = this.activeChord(reg);
      if (active === NULL_CHORD || !active.key) continue;
      if (!chordsEqual(active, chord)) continue;
      if (!scopeMatches(reg.scope, scope)) continue;

      const spec = specificity(reg.scope);
      if (
        spec > bestSpecificity ||
        (spec === bestSpecificity && reg.priority > bestPriority) ||
        (spec === bestSpecificity && reg.priority === bestPriority && reg.order < bestOrder)
      ) {
        bestSpecificity = spec;
        bestPriority = reg.priority;
        bestOrder = reg.order;
        bestCommand = reg.commandId;
      }
    }

    return bestCommand;
  }

  getBindings(): KeyBinding[] {
    const bindings: KeyBinding[] = [];
    for (const reg of this.registrations.values()) {
      const override = this.overrides.get(reg.commandId);
      const isOverride = override !== undefined;
      const active = isOverride ? override! : reg.defaultChord;
      bindings.push({
        commandId: reg.commandId,
        chord: active,
        defaultChord: reg.defaultChord,
        isOverride,
        scope: reg.scope,
        priority: reg.priority,
      });
    }
    return bindings;
  }

  findConflicts(): KeyConflict[] {
    const byChord = new Map<string, KeyBinding[]>();
    for (const binding of this.getBindings()) {
      if (!binding.chord.key) continue; // skip unbound
      const key = serializeChord(binding.chord);
      const list = byChord.get(key) ?? [];
      list.push(binding);
      byChord.set(key, list);
    }

    const conflicts: KeyConflict[] = [];
    for (const list of byChord.values()) {
      if (list.length < 2) continue;
      // Only report conflicts when at least two bindings share an overlapping
      // scope token. Disjoint scopes (e.g. editor vs tasks-workspace) don't
      // conflict because they can never both be active simultaneously.
      if (this.scopesOverlap(list)) {
        conflicts.push({ chord: list[0]!.chord, bindings: list });
      }
    }
    return conflicts;
  }

  subscribe(callback: (bindings: KeyBinding[]) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getBindings());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // ───── private helpers ─────

  private activeChord(reg: Registration): KeyChord {
    const override = this.overrides.get(reg.commandId);
    if (override !== undefined) return override;
    return reg.defaultChord;
  }

  private scopesOverlap(bindings: KeyBinding[]): boolean {
    // Conservative: "global" overlaps with everything. Context scopes are
    // mutually exclusive, so the same chord can be reused safely between
    // notes/tasks/AI contexts.
    for (let i = 0; i < bindings.length; i++) {
      for (let j = i + 1; j < bindings.length; j++) {
        const a = bindings[i]!.scope;
        const b = bindings[j]!.scope;
        if (contextsAreMutuallyExclusive(a, b)) continue;
        if (a.includes('global') || b.includes('global')) return true;
        for (const token of a) {
          if (b.includes(token)) return true;
        }
      }
    }
    return false;
  }

  private async persist(): Promise<Result<void, Error>> {
    const out: Record<string, string> = {};
    for (const [commandId, chord] of this.overrides) {
      out[commandId] = chord === NULL_CHORD ? '' : serializeChord(chord);
    }
    return this.storage.saveOverrides(out);
  }

  private notify(): void {
    if (this.subscribers.size === 0) return;
    const bindings = this.getBindings();
    for (const cb of this.subscribers) {
      try {
        cb(bindings);
      } catch (e) {
        console.error('Error in KeymapService subscriber:', e);
      }
    }
  }
}

function contextToken(scopes: string[]): string | null {
  return scopes.find((scope) => scope.startsWith('context:')) ?? null;
}

function contextsAreMutuallyExclusive(a: string[], b: string[]): boolean {
  const aContext = contextToken(a);
  const bContext = contextToken(b);
  return !!aContext && !!bContext && aContext !== bContext;
}
