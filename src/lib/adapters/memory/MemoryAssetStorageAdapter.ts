import { err, ok, type Result } from '$lib/core';
import type { AssetKind, AssetMetadata, AssetStoragePort } from '$lib/ports/outbound';

const MAX_ASSET_BYTES = 25 * 1024 * 1024;

interface MemoryAssetRecord {
  metadata: AssetMetadata;
  bytes: Uint8Array;
}

export class MemoryAssetStorageAdapter implements AssetStoragePort {
  private readonly assets = new Map<string, MemoryAssetRecord>();

  async importFile(notesDir: string, notePath: string, sourcePath: string): Promise<Result<AssetMetadata, Error>> {
    const name = sourcePath.split(/[\\/]/).pop() || 'image.png';
    return this.importBytes(notesDir, notePath, name, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
  }

  async importBytes(
    notesDir: string,
    notePath: string,
    originalName: string,
    bytes: Uint8Array | ArrayBuffer | number[],
  ): Promise<Result<AssetMetadata, Error>> {
    try {
      return ok(this.store(notesDir, notePath, originalName, normalizeBytes(bytes), null, null, null));
    } catch (error) {
      return err(toError(error));
    }
  }

  async downloadImage(
    notesDir: string,
    notePath: string,
    url: string,
    originalName?: string,
  ): Promise<Result<AssetMetadata, Error>> {
    try {
      if (!url.startsWith('https://')) throw new Error('Image downloads require HTTPS');
      const name = originalName || url.split('/').pop() || 'downloaded-image.png';
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
      return ok(this.store(notesDir, notePath, name, bytes, url, url, new Date().toISOString()));
    } catch (error) {
      return err(toError(error));
    }
  }

  async metadata(_notesDir: string, relativePath: string): Promise<Result<AssetMetadata, Error>> {
    const record = this.assets.get(relativePath);
    return record ? ok(record.metadata) : err(new Error(`Asset not found: ${relativePath}`));
  }

  async list(_notesDir: string): Promise<Result<AssetMetadata[], Error>> {
    return ok(Array.from(this.assets.values()).map((record) => record.metadata));
  }

  async saveAs(_notesDir: string, relativePath: string, _destinationPath: string): Promise<Result<AssetMetadata, Error>> {
    return this.metadata('', relativePath);
  }

  async delete(_notesDir: string, relativePath: string): Promise<Result<void, Error>> {
    this.assets.delete(relativePath);
    return ok(undefined);
  }

  async resolveRenderUrl(_notesDir: string, relativePath: string): Promise<Result<string, Error>> {
    return this.assets.has(relativePath)
      ? ok(`memory-asset://${relativePath}`)
      : err(new Error(`Asset not found: ${relativePath}`));
  }

  seed(record: MemoryAssetRecord): void {
    this.assets.set(record.metadata.relativePath, record);
  }

  private store(
    notesDir: string,
    notePath: string,
    originalName: string,
    bytes: Uint8Array,
    sourceUrl: string | null,
    finalUrl: string | null,
    fetchedAt: string | null,
  ): AssetMetadata {
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('Image exceeds 25 MB limit');
    const kind = detectKind(bytes, originalName);
    const sha256 = pseudoHash(bytes);
    const slug = slugify(notePath.split('/').pop()?.replace(/\.md$/i, '') || 'note');
    const safeName = slugify(originalName.replace(/\.[a-z0-9]+$/i, '')) || 'image';
    const relativePath = `assets/${slug}/${sha256.slice(0, 12)}-${safeName}.${kind === 'jpeg' ? 'jpg' : kind}`;
    const metadata: AssetMetadata = {
      relativePath,
      absolutePath: `${notesDir.replace(/\/$/, '')}/${relativePath}`,
      fileName: relativePath.split('/').pop() || 'image',
      contentType: contentTypeForKind(kind),
      kind,
      sha256,
      size: bytes.byteLength,
      originalName,
      sourceUrl,
      finalUrl,
      fetchedAt,
    };
    this.assets.set(relativePath, { metadata, bytes });
    return metadata;
  }
}

function normalizeBytes(bytes: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes);
}

function detectKind(bytes: Uint8Array, originalName: string): AssetKind {
  const lower = originalName.toLowerCase();
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes[0] === 0x52 && bytes[8] === 0x57) return 'webp';
  if (lower.endsWith('.svg')) return 'svg';
  throw new Error('Unsupported image type');
}

function contentTypeForKind(kind: AssetKind): string {
  if (kind === 'jpg' || kind === 'jpeg') return 'image/jpeg';
  if (kind === 'svg') return 'image/svg+xml';
  return `image/${kind}`;
}

function pseudoHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
