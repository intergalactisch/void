import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachGlobalKeymapBinder } from '$lib/keymap/globalKeymapBinder';
import type { CommandService, KeymapService } from '$lib/ports/inbound';
import { ok } from '$lib/core';

describe('globalKeymapBinder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches Mod+W to tab.close without closing the app window', async () => {
    const keymap = {
      resolve: vi.fn().mockReturnValue('tab.close'),
    } as unknown as KeymapService;
    const commands = {
      executeById: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as CommandService;
    const originalClose = window.close;
    const closeWindow = vi.fn();
    Object.defineProperty(window, 'close', {
      configurable: true,
      value: closeWindow,
    });

    const binder = attachGlobalKeymapBinder({
      keymap,
      commands,
      platform: 'mac',
    });

    try {
      const event = new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);
      await Promise.resolve();

      expect(keymap.resolve).toHaveBeenCalledWith(
        { key: 'w', mod: true, shift: false, alt: false, ctrl: false },
        expect.any(Object),
      );
      expect(commands.executeById).toHaveBeenCalledWith('tab.close', {
        scope: expect.any(Object),
      });
      expect(event.defaultPrevented).toBe(true);
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      binder.dispose();
      Object.defineProperty(window, 'close', {
        configurable: true,
        value: originalClose,
      });
    }
  });
});
