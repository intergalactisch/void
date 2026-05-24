import type { Result } from '$lib/core/result';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import type { OperationDigest } from '$lib/domain/values/OperationDigest';
import type { FolderAccessPort, VoidStoragePort } from '$lib/ports/outbound';

export class FolderAccessVoidStorageAdapter implements VoidStoragePort {
  constructor(
    private readonly inner: VoidStoragePort,
    private readonly folderAccess: FolderAccessPort,
    private readonly workspaceId: string,
  ) {}

  ensureStructure(notesDir: string): Promise<Result<void, Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () => this.inner.ensureStructure(notesDir));
  }

  appendProvenance(notesDir: string, noteName: string, event: ProvenanceEvent): Promise<Result<void, Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.appendProvenance(notesDir, noteName, event)
    );
  }

  readProvenance(notesDir: string, noteName: string): Promise<Result<ProvenanceEvent[], Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.readProvenance(notesDir, noteName)
    );
  }

  writeJson(notesDir: string, relativePath: string, data: unknown): Promise<Result<void, Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.writeJson(notesDir, relativePath, data)
    );
  }

  readJson<T>(notesDir: string, relativePath: string): Promise<Result<T | null, Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.readJson<T>(notesDir, relativePath)
    );
  }

  appendJsonl(notesDir: string, relativePath: string, entry: unknown): Promise<Result<void, Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.appendJsonl(notesDir, relativePath, entry)
    );
  }

  readJsonl<T>(notesDir: string, relativePath: string): Promise<Result<T[], Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.readJsonl<T>(notesDir, relativePath)
    );
  }

  listDir(notesDir: string, relativePath: string): Promise<Result<string[], Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.listDir(notesDir, relativePath)
    );
  }

  appendDigest(notesDir: string, entry: OperationDigest): Promise<Result<void, Error>> {
    return this.folderAccess.withAccess(this.workspaceId, notesDir, () =>
      this.inner.appendDigest(notesDir, entry)
    );
  }
}
