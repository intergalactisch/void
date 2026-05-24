import { err, ok, toError, type Result } from '$lib/core';
import type {
  FolderAccessGrant,
  FolderAccessPort,
  FolderAccessStatus,
  SettingsStoragePort,
} from '$lib/ports/outbound';
import type { Settings, Workspace } from '$lib/domain';
import { folderAccessCommands } from './commands';

export class TauriFolderAccessAdapter implements FolderAccessPort {
  constructor(private readonly settings: SettingsStoragePort) {}

  async checkAccess(workspaceId: string, notesPath: string): Promise<Result<FolderAccessStatus, Error>> {
    const grant = await this.findGrant(workspaceId);
    if (grant && grant.bookmarkData) {
      try {
        const resolved = await folderAccessCommands.resolveBookmark(grant.bookmarkData);
        if (resolved.stale) {
          const refreshed = {
            ...grant,
            path: resolved.path,
            bookmarkData: resolved.bookmarkData,
            stale: false,
          };
          await this.saveGrant(workspaceId, refreshed);
        }
        if (!sameFolderPath(resolved.path, notesPath)) {
          return ok({
            workspaceId,
            notesPath,
            state: 'reconnect_required',
            message: 'The saved folder access points to a different folder. Reconnect the current notes folder.',
            grant,
          });
        }
        return ok({
          workspaceId,
          notesPath,
          state: 'available',
          grant: {
            ...grant,
            path: resolved.path,
            bookmarkData: resolved.bookmarkData,
            stale: false,
          },
        });
      } catch (error) {
        return ok({
          workspaceId,
          notesPath,
          state: 'reconnect_required',
          message: toError(error).message,
          grant,
        });
      }
    }

    if (needsScopedFolderReconnect(notesPath)) {
      return ok({
        workspaceId,
        notesPath,
        state: 'reconnect_required',
        message: 'macOS needs confirmation before Void can read this Desktop folder.',
      });
    }

    return ok({ workspaceId, notesPath, state: 'available' });
  }

  async requestAccess(workspaceId: string, suggestedPath: string): Promise<Result<FolderAccessGrant, Error>> {
    try {
      const bookmark = await folderAccessCommands.requestAccess(suggestedPath);
      if (!sameFolderPath(bookmark.path, suggestedPath)) {
        return err(new Error(`Choose the current notes folder: ${suggestedPath}`));
      }
      const grant: FolderAccessGrant = {
        workspaceId,
        path: bookmark.path,
        bookmarkData: bookmark.bookmarkData,
        grantedAt: new Date().toISOString(),
        stale: bookmark.stale,
      };
      const saved = await this.saveGrant(workspaceId, grant);
      if (!saved.ok) return saved;
      return ok(grant);
    } catch (error) {
      return err(toError(error));
    }
  }

  async withAccess<T>(
    workspaceId: string,
    _path: string,
    operation: () => Promise<Result<T, Error>>,
  ): Promise<Result<T, Error>> {
    const grant = await this.findGrant(workspaceId);
    if (!grant?.bookmarkData) return operation();

    let started = false;
    try {
      await folderAccessCommands.start(grant.bookmarkData);
      started = true;
      return await operation();
    } catch (error) {
      return err(toError(error));
    } finally {
      if (started) {
        try {
          await folderAccessCommands.stop(grant.bookmarkData);
        } catch {
          // The next filesystem operation will surface a fresh reconnect error.
        }
      }
    }
  }

  async forgetAccess(workspaceId: string): Promise<Result<void, Error>> {
    const loaded = await this.settings.load();
    if (!loaded.ok) return err(loaded.error);
    const next: Settings = {
      ...loaded.value,
      workspaces: loaded.value.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? withoutFolderAccess(workspace)
          : workspace
      ),
    };
    return this.settings.save(next);
  }

  private async findGrant(workspaceId: string): Promise<FolderAccessGrant | null> {
    const loaded = await this.settings.load();
    if (!loaded.ok) return null;
    const workspace = loaded.value.workspaces.find((item) => item.id === workspaceId);
    if (!workspace?.folderAccess) return null;
    return {
      workspaceId,
      path: workspace.folderAccess.path,
      bookmarkData: workspace.folderAccess.bookmarkData,
      grantedAt: workspace.folderAccess.grantedAt,
      ...(workspace.folderAccess.stale ? { stale: true } : {}),
    };
  }

  private async saveGrant(workspaceId: string, grant: FolderAccessGrant): Promise<Result<FolderAccessGrant, Error>> {
    const loaded = await this.settings.load();
    if (!loaded.ok) return err(loaded.error);
    let updated = false;
    const next: Settings = {
      ...loaded.value,
      workspaces: loaded.value.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? (() => {
              updated = true;
              return {
                ...workspace,
                folderAccess: {
                  path: grant.path,
                  bookmarkData: grant.bookmarkData,
                  grantedAt: grant.grantedAt,
                  ...(grant.stale ? { stale: true } : {}),
                },
              };
            })()
          : workspace
      ),
    };
    if (!updated) {
      return err(new Error('Could not save folder access because the active workspace was not found.'));
    }
    const saved = await this.settings.save(next);
    if (!saved.ok) return err(saved.error);
    return ok(grant);
  }
}

function withoutFolderAccess(workspace: Workspace): Workspace {
  const { folderAccess: _folderAccess, ...rest } = workspace;
  return rest;
}

function needsScopedFolderReconnect(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized.startsWith('~/desktop')
    || normalized.includes('/desktop/')
    || normalized.endsWith('/desktop')
    || normalized.startsWith('~/downloads')
    || normalized.includes('/downloads/')
    || normalized.endsWith('/downloads');
}

function sameFolderPath(a: string, b: string): boolean {
  return normalizeFolderPath(a) === normalizeFolderPath(b);
}

function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}
