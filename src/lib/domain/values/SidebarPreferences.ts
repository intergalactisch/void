export type SidebarFavoriteKind = 'note' | 'folder';

export interface SidebarFavoriteRef {
  kind: SidebarFavoriteKind;
  path: string;
}

export interface SidebarPreferences {
  version: 1;
  favorites: SidebarFavoriteRef[];
  folderOrder: Record<string, string[]>;
}

export const SIDEBAR_PREFERENCES_VERSION = 1 as const;

export const EMPTY_SIDEBAR_PREFERENCES: SidebarPreferences = {
  version: SIDEBAR_PREFERENCES_VERSION,
  favorites: [],
  folderOrder: {},
};

export function sidebarFavoriteKey(ref: SidebarFavoriteRef): string {
  return `${ref.kind}:${ref.path}`;
}

