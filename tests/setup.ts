/**
 * Global test setup file
 *
 * This file runs before each test file and sets up the testing environment.
 */

import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// Node 25 exposes a native global `localStorage` that is non-functional unless
// `--localstorage-file` is configured: `typeof localStorage` is "object" but
// `localStorage.getItem` is undefined, so calling it throws. happy-dom does not
// shadow it, so any code using Web Storage breaks in tests even though the
// `typeof localStorage === 'undefined'` guards pass. Install a working
// in-memory Storage so tests behave like a real browser.
class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  clear(): void {
    this.#map.clear();
  }
  getItem(key: string): string | null {
    return this.#map.has(key) ? this.#map.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.#map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, String(value));
  }
}

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const current = (globalThis as Record<string, unknown>)[name];
  // Only replace when the native/happy-dom instance is missing or non-functional.
  if (current && typeof (current as Storage).getItem === 'function') return;
  const storage = new MemoryStorage();
  for (const target of [globalThis, (globalThis as { window?: unknown }).window].filter(Boolean)) {
    Object.defineProperty(target, name, {
      value: storage,
      writable: true,
      configurable: true,
    });
  }
}

installStorage('localStorage');
installStorage('sessionStorage');

// Mock Tauri APIs globally
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
    load: vi.fn(),
  })),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  confirm: vi.fn(),
}));

// Stub browser dialog APIs that happy-dom / vitest don't always initialize as functions.
// Tests use vi.spyOn(window, 'prompt') which requires the property to exist as a function.
if (typeof window.prompt !== 'function') {
  window.prompt = () => null;
}
if (typeof window.alert !== 'function') {
  window.alert = () => undefined;
}
if (typeof window.confirm !== 'function') {
  window.confirm = () => true;
}

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
