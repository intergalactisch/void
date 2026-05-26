import { convertFileSrc } from '@tauri-apps/api/core';
import { err, ok, type Result } from '$lib/core';
import type { AssetMetadata, AssetStoragePort } from '$lib/ports/outbound';
import { assetCommands } from './commands';

export class TauriAssetStorageAdapter implements AssetStoragePort {
  async importFile(notesDir: string, notePath: string, sourcePath: string): Promise<Result<AssetMetadata, Error>> {
    return this.wrap(() => assetCommands.importFile(notesDir, notePath, sourcePath));
  }

  async importBytes(
    notesDir: string,
    notePath: string,
    originalName: string,
    bytes: Uint8Array | ArrayBuffer | number[],
  ): Promise<Result<AssetMetadata, Error>> {
    return this.wrap(() => assetCommands.importBytes(notesDir, notePath, originalName, bytes));
  }

  async downloadImage(
    notesDir: string,
    notePath: string,
    url: string,
    originalName?: string,
  ): Promise<Result<AssetMetadata, Error>> {
    return this.wrap(() => assetCommands.downloadImage(notesDir, notePath, url, originalName));
  }

  async metadata(notesDir: string, relativePath: string): Promise<Result<AssetMetadata, Error>> {
    return this.wrap(() => assetCommands.metadata(notesDir, relativePath));
  }

  async list(notesDir: string): Promise<Result<AssetMetadata[], Error>> {
    return this.wrap(() => assetCommands.list(notesDir));
  }

  async saveAs(
    notesDir: string,
    relativePath: string,
    destinationPath: string,
  ): Promise<Result<AssetMetadata, Error>> {
    return this.wrap(() => assetCommands.saveAs(notesDir, relativePath, destinationPath));
  }

  async delete(notesDir: string, relativePath: string): Promise<Result<void, Error>> {
    return this.wrap(() => assetCommands.delete(notesDir, relativePath));
  }

  async resolveRenderUrl(notesDir: string, relativePath: string): Promise<Result<string, Error>> {
    try {
      const absolutePath = await assetCommands.resolveAssetUrl(notesDir, relativePath);
      return ok(convertFileSrc(absolutePath));
    } catch (error) {
      return err(toError(error));
    }
  }

  private async wrap<T>(operation: () => Promise<T>): Promise<Result<T, Error>> {
    try {
      return ok(await operation());
    } catch (error) {
      return err(toError(error));
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
