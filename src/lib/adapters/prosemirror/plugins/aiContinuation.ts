import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import {
  createFinalBlockContinuationWidget,
  insertFinalBlockContinuation,
  resolveFinalBlockContinuationTargetForBlockId,
  resolveFinalBlockContinuationTargetForRange,
  shouldActivateFinalBlockContinuationFromKey,
  type FinalBlockContinuationTarget,
} from './finalBlockContinuation';

export type AIContinuationTarget = FinalBlockContinuationTarget;

export function resolveAIContinuationTargetForBlockId(
  state: EditorState,
  blockId: string
): AIContinuationTarget | null {
  return resolveFinalBlockContinuationTargetForBlockId(state, blockId);
}

export function resolveAIContinuationTargetForRange(
  state: EditorState,
  from: number,
  to: number
): AIContinuationTarget | null {
  return resolveFinalBlockContinuationTargetForRange(state, from, to);
}

export function insertAIContinuation(view: EditorView, target: AIContinuationTarget): boolean {
  return insertFinalBlockContinuation(view, target);
}

export function shouldActivateAIContinuationFromKey(
  _view: EditorView,
  event: KeyboardEvent
): boolean {
  return shouldActivateFinalBlockContinuationFromKey(event);
}

export function createAIContinuationWidget(
  view: EditorView,
  target: AIContinuationTarget
): HTMLElement {
  return createFinalBlockContinuationWidget(view, target, {
    title: 'Continue writing below AI text',
    ariaLabel: 'Continue writing below AI text',
  });
}
