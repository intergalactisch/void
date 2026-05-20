/**
 * Global test setup file
 *
 * This file runs before each test file and sets up the testing environment.
 */

import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

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
