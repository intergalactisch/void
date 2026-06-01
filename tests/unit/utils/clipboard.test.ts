import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { copyTextToClipboard } from '$lib/utils/clipboard';

const mockInvoke = vi.mocked(invoke);

function setClipboard(value: Clipboard | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value,
  });
}

function setExecCommand(result: boolean) {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => result),
  });
}

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    setClipboard(undefined);
    setExecCommand(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the browser clipboard when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText } as unknown as Clipboard);

    await expect(copyTextToClipboard('void://todo/abc')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('void://todo/abc');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('falls back to a hidden textarea when browser clipboard writing fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    setClipboard({ writeText } as unknown as Clipboard);
    setExecCommand(true);

    await expect(copyTextToClipboard('void://todo/abc')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('void://todo/abc');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('falls back to the Tauri clipboard command when web clipboard paths fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    setClipboard({ writeText } as unknown as Clipboard);
    mockInvoke.mockResolvedValue(undefined);

    await expect(copyTextToClipboard('void://todo/abc')).resolves.toBe(true);

    expect(mockInvoke).toHaveBeenCalledWith('copy_to_clipboard', { text: 'void://todo/abc' });
  });

  it('returns false when every clipboard path fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    setClipboard({ writeText } as unknown as Clipboard);
    mockInvoke.mockRejectedValue(new Error('native clipboard failed'));

    await expect(copyTextToClipboard('void://todo/abc')).resolves.toBe(false);
  });
});
