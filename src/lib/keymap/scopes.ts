/**
 * Scope predicate registry.
 *
 * Bridges store state to the keymap layer without the keymap layer importing
 * any specific store. Stores call `registerScopePredicate(name, fn)` at boot;
 * the global keymap binder calls `buildScopeSnapshot()` at dispatch time to
 * compose the current ScopeSnapshot from all registered predicates.
 *
 * Built-in predicates (DOM-derived) live here. Store-derived predicates are
 * wired in the bootstrap composition root so this module stays free of any
 * store import.
 */

import type { ScopeSnapshot } from '$lib/domain/values/ScopeSnapshot';
import { EMPTY_SCOPE } from '$lib/domain/values/ScopeSnapshot';

type ScopeKey = keyof ScopeSnapshot;

type Predicate<K extends ScopeKey = ScopeKey> = () => ScopeSnapshot[K];

const predicates = new Map<ScopeKey, Predicate>();

/** Register a predicate for a single scope key. Replaces any prior registration. */
export function registerScopePredicate<K extends ScopeKey>(
  key: K,
  predicate: Predicate<K>
): void {
  predicates.set(key, predicate as Predicate);
}

/** Remove a registered predicate. */
export function unregisterScopePredicate(key: ScopeKey): void {
  predicates.delete(key);
}

/**
 * Read every registered predicate and produce a snapshot. Missing keys fall
 * back to EMPTY_SCOPE defaults so the consumer always sees a complete shape.
 */
export function buildScopeSnapshot(): ScopeSnapshot {
  const snapshot: ScopeSnapshot = { ...EMPTY_SCOPE };
  for (const [key, predicate] of predicates) {
    try {
      const value = predicate();
      // Type assertion is safe because registerScopePredicate constrains
      // the predicate's return type to ScopeSnapshot[K].
      (snapshot as Record<ScopeKey, unknown>)[key] = value;
    } catch (e) {
      console.error(`Error in scope predicate '${key}':`, e);
    }
  }
  return snapshot;
}

/**
 * Default editor-focus predicate. Looks for a focused contenteditable inside
 * the active document. Re-registerable so tests can override.
 */
export function defaultEditorFocusedPredicate(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active) return false;
  // Match ProseMirror, plain contenteditables, and form controls.
  if (active.matches('.ProseMirror, [contenteditable="true"], input, textarea, select')) {
    return true;
  }
  // Match descendant inside a ProseMirror tree (e.g. a node-view child)
  return !!active.closest('.ProseMirror, [contenteditable="true"]');
}

/** Default modal-open predicate: any visible [role="dialog"] in the DOM. */
export function defaultModalOpenPredicate(): boolean {
  if (typeof document === 'undefined') return false;
  const dialogs = document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"])');
  return dialogs.length > 0;
}

/** Reset registry — exposed for test isolation. */
export function clearScopePredicates(): void {
  predicates.clear();
}
