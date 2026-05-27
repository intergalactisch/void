import type { Result } from '$lib/core';
import type { AssetMetadata } from '$lib/ports/outbound';

export interface MediaAttachmentOptions {
  alt?: string;
  title?: string;
  caption?: string;
  width?: number;
  placement?: 'cursor' | 'append' | 'media-section';
  creator?: string;
  license?: string;
}

export interface MediaAttachmentResult {
  notePath: string;
  asset: AssetMetadata;
  markdownPath: string;
  markdown: string;
  renderUrl?: string;
}

export interface MediaAttachmentFailure {
  sourcePath: string;
  message: string;
}

export interface MediaAttachmentBatchResult {
  notePath: string;
  attached: MediaAttachmentResult[];
  failed: MediaAttachmentFailure[];
  markdown: string;
  inserted: boolean;
  insertionError?: string;
}

export interface MediaOrphanReport {
  referenced: string[];
  assets: AssetMetadata[];
  orphaned: AssetMetadata[];
  deleted: string[];
}

export interface MediaAttachmentService {
  importLocalImage(
    notePath: string,
    sourcePath: string,
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>>;
  importImageBytes(
    notePath: string,
    originalName: string,
    bytes: Uint8Array | ArrayBuffer | number[],
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>>;
  downloadImage(
    notePath: string,
    url: string,
    options?: MediaAttachmentOptions & { originalName?: string },
  ): Promise<Result<MediaAttachmentResult, Error>>;
  insertExistingAsset(
    notePath: string,
    relativePath: string,
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>>;
  attachLocalImage(
    notePath: string,
    sourcePath: string,
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>>;
  attachLocalImages(
    notePath: string,
    sourcePaths: string[],
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentBatchResult, Error>>;
  attachImageBytes(
    notePath: string,
    originalName: string,
    bytes: Uint8Array | ArrayBuffer | number[],
    options?: MediaAttachmentOptions,
  ): Promise<Result<MediaAttachmentResult, Error>>;
  attachRemoteImage(
    notePath: string,
    url: string,
    options?: MediaAttachmentOptions & { originalName?: string },
  ): Promise<Result<MediaAttachmentResult, Error>>;
  listAssets(): Promise<Result<AssetMetadata[], Error>>;
  /** Note paths whose markdown references the given asset (workspace-relative `assets/...` path). */
  findReferencingNotePaths(relativePath: string): Promise<Result<string[], Error>>;
  cleanupOrphans(options?: { dryRun?: boolean }): Promise<Result<MediaOrphanReport, Error>>;
  saveAssetAs(relativePath: string, destinationPath: string): Promise<Result<AssetMetadata, Error>>;
  deleteAsset(relativePath: string): Promise<Result<void, Error>>;
  resolveRenderUrl(relativePath: string): Promise<Result<string, Error>>;
  buildImageMarkdown(notePath: string, asset: AssetMetadata, options?: MediaAttachmentOptions): MediaAttachmentResult;
}
