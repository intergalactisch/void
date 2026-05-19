import { err, ok, type Result } from '$lib/core';
import {
  EMPTY_SIDEBAR_PREFERENCES,
  SIDEBAR_PREFERENCES_VERSION,
  sidebarFavoriteKey,
  type SidebarFavoriteKind,
  type SidebarFavoriteRef,
  type SidebarPreferences,
} from '$lib/domain';
import type {
  FolderDropPosition,
  FolderMoveDirection,
  SidebarPreferencesService,
} from '$lib/ports/inbound/SidebarPreferencesService';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';

const SIDEBAR_PREFERENCES_PATH = 'navigation/sidebar.json';

export class SidebarPreferencesServiceImpl implements SidebarPreferencesService {
  private state: SidebarPreferences = {
    ...EMPTY_SIDEBAR_PREFERENCES,
    favorites: [],
    folderOrder: {},
  };
  private subscribers = new Set<(state: SidebarPreferences) => void>();
  private loaded = false;

  constructor(
    private readonly storage: VoidStoragePort,
    private readonly notesDir: string
  ) {}

  async load(): Promise<Result<void, Error>> {
    const result = await this.storage.readJson<unknown>(this.notesDir, SIDEBAR_PREFERENCES_PATH);
    if (!result.ok) return err(result.error);

    this.state = this.parsePreferences(result.value);
    this.loaded = true;
    this.notifySubscribers();
    return ok(undefined);
  }

  getState(): SidebarPreferences {
    return this.cloneState();
  }

  subscribe(callback: (state: SidebarPreferences) => void): () => void {
    this.subscribers.add(callback);
    callback(this.cloneState());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async toggleFavorite(ref: SidebarFavoriteRef): Promise<Result<void, Error>> {
    const normalized = this.normalizeFavoriteRef(ref);
    if (!normalized) return err(new Error('Favorite path cannot be empty'));

    const key = sidebarFavoriteKey(normalized);
    const favorites = this.state.favorites.filter((favorite) => sidebarFavoriteKey(favorite) !== key);
    if (favorites.length === this.state.favorites.length) {
      favorites.push(normalized);
    }

    return this.updateState({ favorites });
  }

  isFavorite(ref: SidebarFavoriteRef): boolean {
    const normalized = this.normalizeFavoriteRef(ref);
    if (!normalized) return false;
    const key = sidebarFavoriteKey(normalized);
    return this.state.favorites.some((favorite) => sidebarFavoriteKey(favorite) === key);
  }

  async removeFavorite(ref: SidebarFavoriteRef): Promise<Result<void, Error>> {
    const normalized = this.normalizeFavoriteRef(ref);
    if (!normalized) return ok(undefined);
    const key = sidebarFavoriteKey(normalized);
    return this.updateState({
      favorites: this.state.favorites.filter((favorite) => sidebarFavoriteKey(favorite) !== key),
    });
  }

  async moveFolder(
    parentPath: string,
    folderPath: string,
    direction: FolderMoveDirection,
    siblingFolderPaths: string[] = []
  ): Promise<Result<void, Error>> {
    const parent = normalizePath(parentPath);
    const folder = normalizePath(folderPath);
    if (!folder) return err(new Error('Folder path cannot be empty'));

    const order = this.orderFor(parent, siblingFolderPaths);
    const index = order.indexOf(folder);
    if (index < 0) return err(new Error('Folder is not in the current parent'));

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= order.length) return ok(undefined);

    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved!);
    return this.setFolderOrder(parent, next);
  }

  async reorderFolder(
    parentPath: string,
    folderPath: string,
    targetFolderPath: string,
    position: FolderDropPosition,
    siblingFolderPaths: string[] = []
  ): Promise<Result<void, Error>> {
    const parent = normalizePath(parentPath);
    const folder = normalizePath(folderPath);
    const target = normalizePath(targetFolderPath);
    if (!folder || !target) return err(new Error('Folder path cannot be empty'));
    if (folder === target) return ok(undefined);

    const order = this.orderFor(parent, siblingFolderPaths);
    if (!order.includes(folder) || !order.includes(target)) {
      return err(new Error('Folders must share the same parent'));
    }

    const withoutMoved = order.filter((path) => path !== folder);
    const targetIndex = withoutMoved.indexOf(target);
    if (targetIndex < 0) return err(new Error('Drop target is not in the current parent'));

    const insertAt = position === 'before' ? targetIndex : targetIndex + 1;
    const next = [...withoutMoved];
    next.splice(insertAt, 0, folder);

    return this.setFolderOrder(parent, next);
  }

  async renamePath(
    oldPath: string,
    newPath: string,
    kind: SidebarFavoriteKind
  ): Promise<Result<void, Error>> {
    const oldNormalized = normalizePath(oldPath);
    const newNormalized = normalizePath(newPath);
    if (!oldNormalized || !newNormalized || oldNormalized === newNormalized) return ok(undefined);

    const favorites = this.state.favorites
      .map((favorite) => remapFavorite(favorite, oldNormalized, newNormalized, kind))
      .filter(isSidebarFavoriteRef);

    const folderOrder: Record<string, string[]> = {};
    for (const [parent, order] of Object.entries(this.state.folderOrder)) {
      const nextParent = kind === 'folder'
        ? remapPathUnder(parent, oldNormalized, newNormalized)
        : parent;
      folderOrder[nextParent] = uniqueStrings(order.map((path) =>
        kind === 'folder' ? remapPathUnder(path, oldNormalized, newNormalized) : path
      ));
    }

    return this.updateState({
      favorites: uniqueFavorites(favorites),
      folderOrder,
    });
  }

  async deletePath(
    path: string,
    kind: SidebarFavoriteKind
  ): Promise<Result<void, Error>> {
    const normalized = normalizePath(path);
    if (!normalized) return ok(undefined);

    const favorites = this.state.favorites.filter((favorite) => !matchesDeletedPath(favorite, normalized, kind));
    const folderOrder: Record<string, string[]> = {};

    for (const [parent, order] of Object.entries(this.state.folderOrder)) {
      if (kind === 'folder' && isSameOrUnder(parent, normalized)) continue;
      const next = order.filter((folderPath) =>
        kind === 'folder'
          ? !isSameOrUnder(folderPath, normalized)
          : folderPath !== normalized
      );
      if (next.length > 0) {
        folderOrder[parent] = next;
      }
    }

    return this.updateState({
      favorites,
      folderOrder,
    });
  }

  private async setFolderOrder(parentPath: string, order: string[]): Promise<Result<void, Error>> {
    const parent = normalizePath(parentPath);
    const folderOrder = { ...this.state.folderOrder };
    const nextOrder = uniqueStrings(order.map(normalizePath).filter(Boolean));
    if (nextOrder.length === 0) {
      delete folderOrder[parent];
    } else {
      folderOrder[parent] = nextOrder;
    }
    return this.updateState({ folderOrder });
  }

  private orderFor(parentPath: string, siblingFolderPaths: string[]): string[] {
    const siblings = uniqueStrings(siblingFolderPaths.map(normalizePath).filter(Boolean));
    const existing = this.state.folderOrder[parentPath] ?? [];

    if (siblings.length === 0) {
      return uniqueStrings(existing);
    }

    const siblingSet = new Set(siblings);
    const orderedKnown = existing.filter((path) => siblingSet.has(path));
    const knownSet = new Set(orderedKnown);
    const orderedUnknown = siblings.filter((path) => !knownSet.has(path));
    return [...orderedKnown, ...orderedUnknown];
  }

  private async updateState(partial: Partial<SidebarPreferences>): Promise<Result<void, Error>> {
    const next = this.parsePreferences({
      ...this.state,
      ...partial,
      version: SIDEBAR_PREFERENCES_VERSION,
    });

    this.state = next;
    this.notifySubscribers();

    if (!this.loaded) return ok(undefined);

    const result = await this.storage.writeJson(this.notesDir, SIDEBAR_PREFERENCES_PATH, next);
    if (!result.ok) return err(result.error);
    return ok(undefined);
  }

  private notifySubscribers(): void {
    const state = this.cloneState();
    for (const callback of this.subscribers) {
      callback(state);
    }
  }

  private cloneState(): SidebarPreferences {
    return {
      version: SIDEBAR_PREFERENCES_VERSION,
      favorites: this.state.favorites.map((favorite) => ({ ...favorite })),
      folderOrder: Object.fromEntries(
        Object.entries(this.state.folderOrder).map(([parent, order]) => [parent, [...order]])
      ),
    };
  }

  private parsePreferences(input: unknown): SidebarPreferences {
    if (!input || typeof input !== 'object') {
      return this.cloneEmpty();
    }

    const raw = input as Record<string, unknown>;
    const favorites = Array.isArray(raw.favorites)
      ? uniqueFavorites(raw.favorites.map((entry) => this.normalizeFavoriteRef(entry)).filter(isSidebarFavoriteRef))
      : [];

    const folderOrder: Record<string, string[]> = {};
    if (raw.folderOrder && typeof raw.folderOrder === 'object' && !Array.isArray(raw.folderOrder)) {
      for (const [parent, value] of Object.entries(raw.folderOrder)) {
        if (!Array.isArray(value)) continue;
        const order = uniqueStrings(value.map((entry) =>
          typeof entry === 'string' ? normalizePath(entry) : ''
        ).filter(Boolean));
        if (order.length > 0) {
          folderOrder[normalizePath(parent)] = order;
        }
      }
    }

    return {
      version: SIDEBAR_PREFERENCES_VERSION,
      favorites,
      folderOrder,
    };
  }

  private cloneEmpty(): SidebarPreferences {
    return {
      version: SIDEBAR_PREFERENCES_VERSION,
      favorites: [],
      folderOrder: {},
    };
  }

  private normalizeFavoriteRef(input: unknown): SidebarFavoriteRef | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    if (raw.kind !== 'note' && raw.kind !== 'folder') return null;
    if (typeof raw.path !== 'string') return null;
    const path = normalizePath(raw.path);
    if (!path) return null;
    return { kind: raw.kind, path };
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueFavorites(values: SidebarFavoriteRef[]): SidebarFavoriteRef[] {
  const seen = new Set<string>();
  const out: SidebarFavoriteRef[] = [];
  for (const value of values) {
    const key = sidebarFavoriteKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isSidebarFavoriteRef(value: SidebarFavoriteRef | null): value is SidebarFavoriteRef {
  return value !== null;
}

function isSameOrUnder(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function remapPathUnder(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  const oldPrefix = `${oldPath}/`;
  if (!path.startsWith(oldPrefix)) return path;
  return `${newPath}/${path.slice(oldPrefix.length)}`;
}

function remapFavorite(
  favorite: SidebarFavoriteRef,
  oldPath: string,
  newPath: string,
  kind: SidebarFavoriteKind
): SidebarFavoriteRef | null {
  if (kind === 'note') {
    return favorite.kind === 'note' && favorite.path === oldPath
      ? { ...favorite, path: newPath }
      : favorite;
  }

  if (!isSameOrUnder(favorite.path, oldPath)) return favorite;
  return {
    ...favorite,
    path: remapPathUnder(favorite.path, oldPath, newPath),
  };
}

function matchesDeletedPath(
  favorite: SidebarFavoriteRef,
  deletedPath: string,
  kind: SidebarFavoriteKind
): boolean {
  if (kind === 'note') {
    return favorite.kind === 'note' && favorite.path === deletedPath;
  }
  return isSameOrUnder(favorite.path, deletedPath);
}

