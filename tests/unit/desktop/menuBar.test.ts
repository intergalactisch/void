import { describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { isMenuBarCommand, listenToMenuBarCommands } from '$lib/desktop/menuBar';

describe('menuBar command bridge', () => {
  it('accepts the native open markdown command', () => {
    expect(isMenuBarCommand('open-markdown-file')).toBe(true);
    expect(isMenuBarCommand('open-markdown')).toBe(false);
    expect(isMenuBarCommand('note.txt')).toBe(false);
  });

  it('emits the open markdown command from the native menu listener', async () => {
    const unlisten = vi.fn();
    const listenMock = vi.mocked(listen);
    let captured: ((event: { payload: { command?: unknown } }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event, callback) => {
      captured = callback as typeof captured;
      return unlisten;
    });

    const handler = vi.fn();
    const dispose = await listenToMenuBarCommands(handler);
    captured?.({ payload: { command: 'open-markdown-file' } });
    captured?.({ payload: { command: 'note.txt' } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('open-markdown-file');
    dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
