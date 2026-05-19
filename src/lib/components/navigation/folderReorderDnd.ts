import type { FolderDropPosition } from '$lib/ports/inbound';
import {
  createSortableDnd,
  type ReorderIntent,
  type SortableRef,
  type SortableState,
} from '$lib/components/dnd/sortable';

export type FolderReorderDnd = ReturnType<typeof createFolderReorderDnd>;

export function createFolderReorderDnd(options: {
  onReorder: (path: string, targetPath: string, position: FolderDropPosition) => void | Promise<void>;
  onStateChange: (state: SortableState) => void;
}) {
  return createSortableDnd({
    canDrop: (source: SortableRef, target: SortableRef) => (
      source.groupId === target.groupId && source.id !== target.id
    ),
    onCommit: (intent: ReorderIntent) => options.onReorder(
      intent.sourceId,
      intent.targetId,
      intent.position
    ),
    onStateChange: options.onStateChange,
  });
}
