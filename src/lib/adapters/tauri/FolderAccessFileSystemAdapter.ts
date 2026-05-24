import type { FileEntry, Result } from '$lib/core';
import type { FileSystemPort, FolderAccessPort } from '$lib/ports/outbound';

export class FolderAccessFileSystemAdapter implements FileSystemPort {
  constructor(
    private readonly inner: FileSystemPort,
    private readonly folderAccess: FolderAccessPort,
    private readonly workspaceId: string,
    private readonly notesPath: string,
  ) {}

  readFile(path: string): Promise<Result<string, Error>> {
    return this.withFolderAccess(path, () => this.inner.readFile(path));
  }

  writeFile(path: string, content: string): Promise<Result<void, Error>> {
    return this.withFolderAccess(path, () => this.inner.writeFile(path, content));
  }

  deleteFile(path: string): Promise<Result<void, Error>> {
    return this.withFolderAccess(path, () => this.inner.deleteFile(path));
  }

  listDirectory(path: string): Promise<Result<FileEntry[], Error>> {
    return this.withFolderAccess(path, () => this.inner.listDirectory(path));
  }

  exists(path: string): Promise<Result<boolean, Error>> {
    return this.withFolderAccess(path, () => this.inner.exists(path));
  }

  createDirectory(path: string): Promise<Result<void, Error>> {
    return this.withFolderAccess(path, () => this.inner.createDirectory(path));
  }

  deleteDirectory(path: string): Promise<Result<void, Error>> {
    return this.withFolderAccess(path, () => this.inner.deleteDirectory(path));
  }

  moveToTrash(path: string): Promise<Result<void, Error>> {
    return this.withFolderAccess(path, () => this.inner.moveToTrash(path));
  }

  renamePath(from: string, to: string): Promise<Result<void, Error>> {
    return this.withFolderAccess(from, () => this.inner.renamePath(from, to));
  }

  private withFolderAccess<T>(path: string, operation: () => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    if (!isInsideNotesRoot(path, this.notesPath)) return operation();
    return this.folderAccess.withAccess(this.workspaceId, this.notesPath, operation);
  }
}

function isInsideNotesRoot(path: string, notesPath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(notesPath);
  if (!normalizedRoot) return false;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}
