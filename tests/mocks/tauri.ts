/**
 * Mock Tauri APIs for testing
 */
import { vi } from 'vitest';

export const mockInvoke = vi.fn();
export const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
};

export function setupTauriMocks() {
  vi.mock('@tauri-apps/api/core', () => ({
    invoke: mockInvoke,
  }));

  vi.mock('@tauri-apps/plugin-store', () => ({
    Store: vi.fn().mockImplementation(() => mockStore),
  }));
}

export function resetTauriMocks() {
  mockInvoke.mockReset();
  mockStore.get.mockReset();
  mockStore.set.mockReset();
  mockStore.save.mockReset();
  mockStore.load.mockReset();
}
