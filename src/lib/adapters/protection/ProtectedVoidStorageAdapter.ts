import type { Result } from '$lib/core';
import { redactSensitiveValue } from '$lib/core/privacyRedaction';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import type { OperationDigest } from '$lib/domain/values/OperationDigest';

/**
 * Sidecar privacy decorator.
 *
 * V1 protected notes keep sidecars to receipt-grade data by redacting obvious
 * secrets before they reach .void journals, conversations, agent traces, or
 * indexes. True per-note sidecar encryption can replace this decorator without
 * touching callers because all writes already cross VoidStoragePort.
 */
export class ProtectedVoidStorageAdapter implements VoidStoragePort {
  constructor(private readonly delegate: VoidStoragePort) {}

  ensureStructure(notesDir: string): Promise<Result<void, Error>> {
    return this.delegate.ensureStructure(notesDir);
  }

  appendProvenance(
    notesDir: string,
    noteName: string,
    event: ProvenanceEvent,
  ): Promise<Result<void, Error>> {
    return this.delegate.appendProvenance(notesDir, noteName, redactSidecarValue(event, true) as ProvenanceEvent);
  }

  readProvenance(notesDir: string, noteName: string): Promise<Result<ProvenanceEvent[], Error>> {
    return this.delegate.readProvenance(notesDir, noteName);
  }

  writeJson(notesDir: string, relativePath: string, data: unknown): Promise<Result<void, Error>> {
    return this.delegate.writeJson(notesDir, relativePath, redactSidecarValue(data, isHighRiskSidecarPath(relativePath)));
  }

  readJson<T>(notesDir: string, relativePath: string): Promise<Result<T | null, Error>> {
    return this.delegate.readJson<T>(notesDir, relativePath);
  }

  appendJsonl(notesDir: string, relativePath: string, entry: unknown): Promise<Result<void, Error>> {
    return this.delegate.appendJsonl(notesDir, relativePath, redactSidecarValue(entry, isHighRiskSidecarPath(relativePath)));
  }

  readJsonl<T>(notesDir: string, relativePath: string): Promise<Result<T[], Error>> {
    return this.delegate.readJsonl<T>(notesDir, relativePath);
  }

  listDir(notesDir: string, relativePath: string): Promise<Result<string[], Error>> {
    return this.delegate.listDir(notesDir, relativePath);
  }

  appendDigest(notesDir: string, entry: OperationDigest): Promise<Result<void, Error>> {
    return this.delegate.appendDigest(notesDir, redactSidecarValue(entry, true) as OperationDigest);
  }
}

function redactSidecarValue(value: unknown, aggressive: boolean): unknown {
  return redactSensitiveValue(value, { aggressive });
}

function isHighRiskSidecarPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  return /^(conversations|inline-ai|inlineai|agents|lineage|branches|operations)\//.test(normalized)
    || normalized.includes('/conversations/')
    || normalized.includes('/agents/');
}
