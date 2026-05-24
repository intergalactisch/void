import type {
  FolderAccessGrant,
  FolderAccessPort,
  FolderAccessStatus,
} from '$lib/ports/outbound';

class FolderAccessStore {
  #port: FolderAccessPort | null = null;
  #workspaceId = '';
  #notesPath = '';

  status = $state<FolderAccessStatus | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);

  init(
    port: FolderAccessPort,
    workspaceId: string,
    notesPath: string,
    initialStatus: FolderAccessStatus | null = null,
  ) {
    this.#port = port;
    this.#workspaceId = workspaceId;
    this.#notesPath = notesPath;
    this.status = initialStatus;
    this.error = null;
  }

  get reconnectRequired(): boolean {
    return this.status?.state === 'reconnect_required';
  }

  async refresh(): Promise<boolean> {
    if (!this.#port) return false;
    const result = await this.#port.checkAccess(this.#workspaceId, this.#notesPath);
    if (result.ok) {
      this.status = result.value;
      this.error = null;
      return result.value.state === 'available' || result.value.state === 'unsupported';
    }
    this.error = result.error;
    return false;
  }

  async reconnect(): Promise<FolderAccessGrant | null> {
    if (!this.#port) return null;
    this.loading = true;
    const result = await this.#port.requestAccess(this.#workspaceId, this.#notesPath);
    this.loading = false;
    if (!result.ok) {
      this.error = result.error;
      return null;
    }
    const verified = await this.refresh();
    if (!verified) {
      this.error = new Error(
        this.status?.message
          ?? 'Void saved the folder choice, but macOS access could not be verified.',
      );
      return null;
    }
    return result.value;
  }
}

export const folderAccessStore = new FolderAccessStore();
