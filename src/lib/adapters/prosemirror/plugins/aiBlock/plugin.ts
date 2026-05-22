/**
 * AI Block Lock Plugin
 *
 * Manages per-block AI locks in ProseMirror:
 * - filterTransaction prevents user edits to hard-locked blocks
 *   (queued, locking, streaming, applying, error phases)
 * - Streaming text accumulates in plugin state (overlay approach),
 *   not in the PM doc — single doc-modifying transaction at finalization
 * - Decorations apply phase-specific CSS classes (void-block--ai-{phase})
 *   to locked blocks — this fires on meta-only transactions where NodeView.update() won't
 * - BlockView reads plugin state for overlay text and action bar DOM updates
 * - onLocksChanged callback notifies EditorStore for reactive UI
 *
 * Part of the ProseMirror infrastructure adapter.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { AIBlockState, AIBlockMeta, AIBlockLock, AIBlockPhase } from './state';
import {
  createAIContinuationWidget,
  insertAIContinuation,
  resolveAIContinuationTargetForBlockId,
  shouldActivateAIContinuationFromKey,
} from '../aiContinuation';

export const aiBlockKey = new PluginKey<AIBlockState>('aiBlock');

/** Meta key used by AI finalization to bypass filterTransaction */
export const AI_BYPASS = 'aiBlockBypass';

/** Phases where the block is hard-locked (user cannot edit) */
const HARD_LOCK_PHASES: Set<AIBlockPhase> = new Set([
  'queued', 'locking', 'streaming', 'applying', 'error',
]);

export interface AIBlockPluginOptions {
  /** Called whenever the set of locked blocks changes. Used by EditorStore. */
  onLocksChanged?: ((locks: AIBlockState) => void) | undefined;
}

/**
 * Create the AI block lock plugin.
 *
 * Lock/unlock operations are dispatched via transaction meta:
 *   tr.setMeta(aiBlockKey, { type: 'QUEUE', blockId, operation, originalContent, abortId })
 *   tr.setMeta(aiBlockKey, { type: 'LOCK', blockId, operation, originalContent, abortId })
 *   tr.setMeta(aiBlockKey, { type: 'STREAM_CHUNK', blockId, text })
 *   tr.setMeta(aiBlockKey, { type: 'STREAM_COMPLETE', blockId })
 *   tr.setMeta(aiBlockKey, { type: 'APPLYING', blockId })
 *   tr.setMeta(aiBlockKey, { type: 'COMPLETE', blockId })
 *   tr.setMeta(aiBlockKey, { type: 'ACCEPT', blockId })
 *   tr.setMeta(aiBlockKey, { type: 'REJECT', blockId })
 *   tr.setMeta(aiBlockKey, { type: 'CANCEL', blockId })
 *   tr.setMeta(aiBlockKey, { type: 'CANCEL_ALL' })
 *   tr.setMeta(aiBlockKey, { type: 'ERROR', blockId, message })
 *
 * AI content finalization (replacing block content with streamed result):
 *   tr.setMeta(AI_BYPASS, true)
 */
/** 4-pointed sparkle icon for AI gutter indicator */
const SPARKLE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
  <path d="M8 1.5l1.3 4.2L13.5 7l-4.2 1.3L8 12.5l-1.3-4.2L2.5 7l4.2-1.3z"/>
  <path d="M12 0.5l0.5 1.5L14 2.5l-1.5 0.5L12 4.5l-0.5-1.5L10 2.5l1.5-0.5z" opacity="0.5"/>
</svg>`;

/** Error icon (circle with exclamation) for AI error state */
const ERROR_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
  <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M8 4.5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="8" cy="11" r="0.75"/>
</svg>`;

export function createAIBlockPlugin(
  options: AIBlockPluginOptions = {}
): Plugin<AIBlockState> {
  let previousLocks: AIBlockState = new Map();
  let previousLockIds: Set<string> = new Set();
  const previousUnlockedIds: Set<string> = new Set();

  return new Plugin<AIBlockState>({
    key: aiBlockKey,

    state: {
      init(): AIBlockState {
        return new Map();
      },

      apply(tr: Transaction, state: AIBlockState): AIBlockState {
        const meta = tr.getMeta(aiBlockKey) as AIBlockMeta | undefined;
        if (!meta) return state;

        const next = new Map(state);

        switch (meta.type) {
          case 'QUEUE':
          case 'LOCK': {
            const lock: AIBlockLock = {
              blockId: meta.blockId,
              operation: meta.operation,
              phase: meta.type === 'QUEUE' ? 'queued' : 'locking',
              originalContent: meta.originalContent,
              streamedText: meta.expectedContent ?? '',
              abortId: meta.abortId,
              lockedAt: Date.now(),
              error: null,
            };
            next.set(meta.blockId, lock);
            break;
          }

          case 'ACCEPT':
          case 'REJECT':
            next.delete(meta.blockId);
            break;

          case 'STREAM_CHUNK': {
            const existing = next.get(meta.blockId);
            if (existing) {
              next.set(meta.blockId, {
                ...existing,
                phase: 'streaming',
                streamedText: existing.streamedText + meta.text,
              });
            }
            break;
          }

          case 'STREAM_COMPLETE':
          case 'APPLYING': {
            const existing = next.get(meta.blockId);
            if (existing) {
              next.set(meta.blockId, { ...existing, phase: 'applying' });
            }
            break;
          }

          case 'COMPLETE': {
            const existing = next.get(meta.blockId);
            if (existing) {
              next.set(meta.blockId, { ...existing, phase: 'complete' });
            }
            break;
          }

          case 'CANCEL':
            next.delete(meta.blockId);
            break;

          case 'CANCEL_ALL':
            next.clear();
            break;

          case 'ERROR': {
            const existing = next.get(meta.blockId);
            if (existing) {
              next.set(meta.blockId, {
                ...existing,
                phase: 'error',
                error: meta.message,
              });
            }
            break;
          }

          case 'PHASE': {
            const existing = next.get(meta.blockId);
            if (existing) {
              next.set(meta.blockId, { ...existing, phase: meta.phase });
            }
            break;
          }
        }

        return next;
      },
    },

    view() {
      return {
        update(view: EditorView) {
          const currentLocks = aiBlockKey.getState(view.state);
          if (!currentLocks) return;

          // Notify EditorStore when locks change
          if (currentLocks !== previousLocks) {
            previousLocks = currentLocks;
            options.onLocksChanged?.(currentLocks);
          }

          // Update overlay text and gutter icons for locked blocks.
          // This runs on every transaction (including meta-only) —
          // necessary because NodeView.update() only fires on node changes.
          for (const [blockId, lock] of currentLocks) {
            const blockEl = view.dom.querySelector(
              `[data-block-id="${blockId}"]`
            ) as HTMLElement | null;
            if (!blockEl) continue;

            // Update streaming overlay text
            const overlay = blockEl.querySelector('.void-ai-stream-overlay') as HTMLElement | null;
            if (overlay && lock.phase === 'streaming') {
              overlay.textContent = lock.streamedText;
            } else if (overlay && lock.phase !== 'streaming') {
              overlay.textContent = '';
            }

            // Swap gutter icon for error phase
            const gutterIcon = blockEl.querySelector('.void-ai-gutter-icon') as HTMLElement | null;
            if (gutterIcon) {
              if (lock.phase === 'error' && !gutterIcon.dataset.aiError) {
                gutterIcon.innerHTML = ERROR_ICON;
                gutterIcon.dataset.aiError = '1';
              } else if (lock.phase !== 'error' && gutterIcon.dataset.aiError) {
                gutterIcon.innerHTML = SPARKLE_ICON;
                delete gutterIcon.dataset.aiError;
              }
            }
          }

          // Clear overlay/icon for blocks that were just unlocked
          for (const blockId of previousUnlockedIds) {
            const blockEl = view.dom.querySelector(
              `[data-block-id="${blockId}"]`
            ) as HTMLElement | null;
            if (!blockEl) continue;

            const overlay = blockEl.querySelector('.void-ai-stream-overlay') as HTMLElement | null;
            if (overlay) overlay.textContent = '';

            const gutterIcon = blockEl.querySelector('.void-ai-gutter-icon') as HTMLElement | null;
            if (gutterIcon && gutterIcon.dataset.aiError) {
              gutterIcon.innerHTML = SPARKLE_ICON;
              delete gutterIcon.dataset.aiError;
            }
          }

          // Track which blocks were unlocked this cycle
          previousUnlockedIds.clear();
          for (const id of previousLockIds) {
            if (!currentLocks.has(id)) {
              previousUnlockedIds.add(id);
            }
          }
          previousLockIds = new Set(currentLocks.keys());
        },
      };
    },

    filterTransaction(tr: Transaction, state: EditorState): boolean {
      // Allow non-doc-changing transactions (selection, meta-only)
      if (!tr.docChanged) return true;

      // Allow AI finalization transactions
      if (tr.getMeta(AI_BYPASS)) return true;

      // Allow AI meta transactions (lock/unlock/phase changes)
      if (tr.getMeta(aiBlockKey)) return true;

      // Allow undo/redo through — prosemirror-history uses 'history$' meta
      if (tr.getMeta('history$')) return true;

      // Check if any modified range overlaps a hard-locked block
      const locks = aiBlockKey.getState(state);
      if (!locks || locks.size === 0) return true;

      let blocked = false;
      tr.mapping.maps.forEach((stepMap, i) => {
        if (blocked) return;
        stepMap.forEach((oldStart, oldEnd) => {
          if (blocked) return;
          state.doc.nodesBetween(oldStart, oldEnd, (node) => {
            if (blocked) return false; // stop traversal
            const blockId = node.attrs?.id;
            if (!blockId) return;
            const lock = locks.get(blockId);
            // Only block edits in hard-lock phases; complete is a soft indicator
            if (lock && HARD_LOCK_PHASES.has(lock.phase)) {
              blocked = true;
              return false; // stop traversal
            }
          });
        });
      });

      return !blocked;
    },

    props: {
      decorations(state: EditorState): DecorationSet {
        const locks = aiBlockKey.getState(state);
        if (!locks || locks.size === 0) return DecorationSet.empty;

        const decorations: Decoration[] = [];
        const continuationTargets = new Set<string>();
        state.doc.descendants((node, pos) => {
          const blockId = node.attrs?.id;
          if (!blockId) return;
          const lock = locks.get(blockId);
          if (lock) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: `void-block--ai-${lock.phase}`,
              })
            );

            if (HARD_LOCK_PHASES.has(lock.phase) && !continuationTargets.has(blockId)) {
              const target = resolveAIContinuationTargetForBlockId(state, blockId);
              if (target) {
                continuationTargets.add(blockId);
                decorations.push(
                  Decoration.widget(
                    target.widgetPos,
                    (view) => createAIContinuationWidget(view, target),
                    {
                      side: 1,
                      key: `ai-block-continuation-${blockId}-${target.widgetPos}`,
                    }
                  )
                );
              }
            }
          }
        });

        return DecorationSet.create(state.doc, decorations);
      },

      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const locks = aiBlockKey.getState(view.state);
        if (!locks || locks.size === 0) return false;

        // Cmd+Escape: cancel ALL active AI operations
        if (event.key === 'Escape' && event.metaKey) {
          const tr = view.state.tr.setMeta(aiBlockKey, { type: 'CANCEL_ALL' });
          view.dispatch(tr);
          return true;
        }

        // Find the block at the cursor position
        const { $from } = view.state.selection;
        let cursorBlockId: string | undefined;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.attrs?.id) {
            cursorBlockId = node.attrs.id;
            break;
          }
        }
        if (!cursorBlockId) return false;

        const lock = locks.get(cursorBlockId);
        if (!lock) return false;

        // Enter, or Down at the lower edge, continues below final AI text
        // instead of leaving the cursor trapped in the hard lock.
        if (
          shouldActivateAIContinuationFromKey(view, event) &&
          HARD_LOCK_PHASES.has(lock.phase)
        ) {
          const target = resolveAIContinuationTargetForBlockId(view.state, cursorBlockId);
          if (target && insertAIContinuation(view, target)) {
            event.preventDefault();
            return true;
          }
        }

        // Escape in an AI block cancels active work or dismisses terminal state.
        if (event.key === 'Escape') {
          if (lock.phase === 'queued' || lock.phase === 'streaming' || lock.phase === 'locking') {
            const tr = view.state.tr.setMeta(aiBlockKey, {
              type: 'CANCEL',
              blockId: cursorBlockId,
            });
            view.dispatch(tr);
            return true;
          }
          if (lock.phase === 'complete' || lock.phase === 'error') {
            const tr = view.state.tr.setMeta(aiBlockKey, {
              type: 'ACCEPT',
              blockId: cursorBlockId,
            });
            view.dispatch(tr);
            return true;
          }
        }

        // Cmd+Enter in complete/error: dismiss the indicator.
        if (event.key === 'Enter' && event.metaKey && (lock.phase === 'complete' || lock.phase === 'error')) {
          const tr = view.state.tr.setMeta(aiBlockKey, {
            type: 'ACCEPT',
            blockId: cursorBlockId,
          });
          view.dispatch(tr);
          return true;
        }

        // Block all editing keys in hard-locked blocks
        if (HARD_LOCK_PHASES.has(lock.phase)) {
          if (isEditingKey(event)) {
            return true; // swallow the event
          }
        }

        return false;
      },

      handleTextInput(view: EditorView): boolean {
        // Block text input in hard-locked blocks
        const locks = aiBlockKey.getState(view.state);
        if (!locks || locks.size === 0) return false;

        const { $from } = view.state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          const blockId = node.attrs?.id;
          if (!blockId) continue;
          const lock = locks.get(blockId);
          if (lock && HARD_LOCK_PHASES.has(lock.phase)) {
            return true; // swallow
          }
          break;
        }
        return false;
      },
    },
  });
}

/** Check if a key event is an editing key (typing, deletion, etc.) */
function isEditingKey(event: KeyboardEvent): boolean {
  // Allow navigation keys
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
       'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(event.key)) {
    return false;
  }
  // Allow modifier-only key presses
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
    return false;
  }
  // Allow Cmd+C (copy), Cmd+A (select all)
  if (event.metaKey && ['c', 'a'].includes(event.key)) {
    return false;
  }
  // Everything else is editing
  return true;
}
