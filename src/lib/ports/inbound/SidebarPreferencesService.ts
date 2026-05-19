import type { Result } from '$lib/core';
import type {
  SidebarFavoriteKind,
  SidebarFavoriteRef,
  SidebarPreferences,
} from '$lib/domain';

export type FolderMoveDirection = 'up' | 'down';
export type FolderDropPosition = 'before' | 'after';

export interface SidebarPreferencesService {
  load(): Promise<Result<void, Error>>;

  getState(): SidebarPreferences;

  subscribe(callback: (state: SidebarPreferences) => void): () => void;

  toggleFavorite(ref: SidebarFavoriteRef): Promise<Result<void, Error>>;

  isFavorite(ref: SidebarFavoriteRef): boolean;

  removeFavorite(ref: SidebarFavoriteRef): Promise<Result<void, Error>>;

  moveFolder(
    parentPath: string,
    folderPath: string,
    direction: FolderMoveDirection,
    siblingFolderPaths?: string[]
  ): Promise<Result<void, Error>>;

  reorderFolder(
    parentPath: string,
    folderPath: string,
    targetFolderPath: string,
    position: FolderDropPosition,
    siblingFolderPaths?: string[]
  ): Promise<Result<void, Error>>;

  renamePath(
    oldPath: string,
    newPath: string,
    kind: SidebarFavoriteKind
  ): Promise<Result<void, Error>>;

  deletePath(
    path: string,
    kind: SidebarFavoriteKind
  ): Promise<Result<void, Error>>;
}

