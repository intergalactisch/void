/**
 * FrecencyServiceImpl - in-memory frecency with throttled persistence.
 *
 * Score formula: `frequency_log + recency_decay`
 *   - frequency_log = ln(count + 1)         — sub-linear so a single click
 *                                              doesn't outrank dozens of others
 *   - recency_decay = exp(-Δhours / halfLife) — half-life of 30 days
 *
 * Persists to `.void/index/frecency.json`. Command writes are throttled to 1
 * per `PERSIST_INTERVAL_MS` to avoid disk thrash. Note writes persist
 * immediately because the sidebar Recent list depends on them across restarts.
 */

import { ok, err, type Result } from '$lib/core';
import type {
  FrecencyService,
  FrecencyEntry,
  FrecencyKind,
} from '$lib/ports/inbound/FrecencyService';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';

const FRECENCY_PATH = 'index/frecency.json';
const PERSIST_INTERVAL_MS = 10_000;
const HALF_LIFE_HOURS = 24 * 30;
const HALF_LIFE_MS = HALF_LIFE_HOURS * 60 * 60 * 1000;

interface PersistedShape {
  entries: FrecencyEntry[];
}

function key(kind: FrecencyKind, id: string): string {
  return `${kind}::${id}`;
}

export class FrecencyServiceImpl implements FrecencyService {
  private entries: Map<string, FrecencyEntry> = new Map();
  private dirty = false;
  private lastPersistAt = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistInFlight: Promise<void> | null = null;
  private persistQueued = false;
  private loaded = false;

  constructor(
    private readonly storage: VoidStoragePort,
    private readonly notesDir: string
  ) {}

  async load(): Promise<Result<void, Error>> {
    const result = await this.storage.readJson<PersistedShape>(this.notesDir, FRECENCY_PATH);
    if (!result.ok) {
      this.loaded = true;
      return err(result.error);
    }
    if (result.value && Array.isArray(result.value.entries)) {
      this.entries.clear();
      for (const entry of result.value.entries) {
        if (this.isValidEntry(entry)) {
          this.entries.set(key(entry.kind, entry.id), entry);
        }
      }
    }
    this.loaded = true;
    return ok(undefined);
  }

  record(kind: FrecencyKind, id: string): void {
    if (!id) return;
    const k = key(kind, id);
    const existing = this.entries.get(k);
    const now = Date.now();
    if (existing) {
      existing.count += 1;
      existing.lastAt = now;
    } else {
      this.entries.set(k, { kind, id, count: 1, lastAt: now });
    }
    this.markDirty(kind);
  }

  score(kind: FrecencyKind, id: string): number {
    const entry = this.entries.get(key(kind, id));
    if (!entry) return 0;
    const ageMs = Math.max(0, Date.now() - entry.lastAt);
    const decay = Math.exp(-ageMs / HALF_LIFE_MS);
    const freq = Math.log(entry.count + 1);
    return freq + decay;
  }

  topRecent(kind: FrecencyKind, limit: number): string[] {
    const ids: Array<{ id: string; score: number }> = [];
    for (const entry of this.entries.values()) {
      if (entry.kind !== kind) continue;
      ids.push({ id: entry.id, score: this.score(kind, entry.id) });
    }
    ids.sort((a, b) => b.score - a.score);
    return ids.slice(0, limit).map((e) => e.id);
  }

  lastAccessed(kind: FrecencyKind, limit: number): FrecencyEntry[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }

  compare(kind: FrecencyKind, a: string, b: string): number {
    return this.score(kind, b) - this.score(kind, a);
  }

  forget(kind: FrecencyKind, id: string): void {
    if (!this.entries.delete(key(kind, id))) return;
    this.markDirty(kind);
  }

  move(kind: FrecencyKind, oldId: string, newId: string): void {
    if (!oldId || !newId || oldId === newId) return;
    const oldKey = key(kind, oldId);
    const oldEntry = this.entries.get(oldKey);
    if (!oldEntry) return;

    const newKey = key(kind, newId);
    const existingNewEntry = this.entries.get(newKey);
    this.entries.delete(oldKey);

    this.entries.set(newKey, existingNewEntry
      ? {
          kind,
          id: newId,
          count: existingNewEntry.count + oldEntry.count,
          lastAt: Math.max(existingNewEntry.lastAt, oldEntry.lastAt),
        }
      : { ...oldEntry, id: newId }
    );
    this.markDirty(kind);
  }

  clear(kind: FrecencyKind): void {
    const keysToRemove: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.kind === kind) {
        keysToRemove.push(key(entry.kind, entry.id));
      }
    }
    for (const k of keysToRemove) {
      this.entries.delete(k);
    }
    if (keysToRemove.length > 0) {
      this.markDirty(kind);
    }
  }

  // ───── private ─────

  private isValidEntry(entry: unknown): entry is FrecencyEntry {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e.id === 'string' &&
      (e.kind === 'command' || e.kind === 'note') &&
      typeof e.count === 'number' &&
      typeof e.lastAt === 'number'
    );
  }

  private markDirty(kind: FrecencyKind): void {
    this.dirty = true;
    if (!this.loaded) return;
    if (kind === 'note') {
      this.requestPersist();
      return;
    }
    const sinceLast = Date.now() - this.lastPersistAt;
    if (sinceLast >= PERSIST_INTERVAL_MS) {
      this.requestPersist();
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.requestPersist();
    }, PERSIST_INTERVAL_MS - sinceLast);
  }

  private requestPersist(): void {
    if (this.persistInFlight) {
      this.persistQueued = true;
      return;
    }
    this.persistInFlight = this.persist().finally(() => {
      this.persistInFlight = null;
      if (this.persistQueued) {
        this.persistQueued = false;
        this.requestPersist();
      }
    });
  }

  private async persist(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    this.lastPersistAt = Date.now();
    const data: PersistedShape = {
      entries: Array.from(this.entries.values()),
    };
    const result = await this.storage.writeJson(this.notesDir, FRECENCY_PATH, data);
    if (!result.ok) {
      // Re-mark dirty so the next interaction retries; don't loop on failure.
      this.dirty = true;
      console.warn('[Frecency] persist failed:', result.error);
    }
  }
}
