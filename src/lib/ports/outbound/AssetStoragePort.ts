import type { Result } from '$lib/core';

export type AssetKind = 'png' | 'jpg' | 'jpeg' | 'svg' | 'gif' | 'webp';

export interface AssetMetadata {
  relativePath: string;
  absolutePath?: string;
  fileName: string;
  contentType: string;
  kind: AssetKind;
  sha256: string;
  size: number;
  width?: number | null;
  height?: number | null;
  originalName?: string | null;
  sourceUrl?: string | null;
  finalUrl?: string | null;
  fetchedAt?: string | null;
  creator?: string | null;
  license?: string | null;
  reviewStatus?: 'trusted' | 'needs-review' | 'rejected';
}

export interface AssetStoragePort {
  importFile(notesDir: string, notePath: string, sourcePath: string): Promise<Result<AssetMetadata, Error>>;
  importBytes(
    notesDir: string,
    notePath: string,
    originalName: string,
    bytes: Uint8Array | ArrayBuffer | number[],
  ): Promise<Result<AssetMetadata, Error>>;
  downloadImage(
    notesDir: string,
    notePath: string,
    url: string,
    originalName?: string,
  ): Promise<Result<AssetMetadata, Error>>;
  metadata(notesDir: string, relativePath: string): Promise<Result<AssetMetadata, Error>>;
  list(notesDir: string): Promise<Result<AssetMetadata[], Error>>;
  saveAs(notesDir: string, relativePath: string, destinationPath: string): Promise<Result<AssetMetadata, Error>>;
  delete(notesDir: string, relativePath: string): Promise<Result<void, Error>>;
  resolveRenderUrl(notesDir: string, relativePath: string): Promise<Result<string, Error>>;
}
