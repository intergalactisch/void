/**
 * captureWindowManager — unit tests for the chord → Tauri accelerator
 * mapping. The window-management itself is integration-level (needs a
 * Tauri runtime) and is verified end-to-end via `npm run tauri:install`.
 */

import { describe, it, expect } from 'vitest';
import { chordToTauriAccelerator } from '$lib/adapters/capture/captureWindowManager';
import { parseChord } from '$lib/domain';

describe('chordToTauriAccelerator', () => {
  it('maps mod+alt+space to CommandOrControl+Alt+Space', () => {
    expect(chordToTauriAccelerator(parseChord('mod+alt+space'))).toBe(
      'CommandOrControl+Alt+Space',
    );
  });

  it('maps mod+shift+space to CommandOrControl+Shift+Space', () => {
    expect(chordToTauriAccelerator(parseChord('mod+shift+space'))).toBe(
      'CommandOrControl+Shift+Space',
    );
  });

  it('uppercases single letter keys', () => {
    expect(chordToTauriAccelerator(parseChord('mod+k'))).toBe(
      'CommandOrControl+K',
    );
  });

  it('preserves modifier order: CommandOrControl, Control, Alt, Shift, key', () => {
    expect(chordToTauriAccelerator(parseChord('shift+alt+mod+x'))).toBe(
      'CommandOrControl+Alt+Shift+X',
    );
  });

  it('maps named keys to Tauri canonical form', () => {
    expect(chordToTauriAccelerator(parseChord('mod+enter'))).toBe(
      'CommandOrControl+Enter',
    );
    expect(chordToTauriAccelerator(parseChord('mod+escape'))).toBe(
      'CommandOrControl+Escape',
    );
    expect(chordToTauriAccelerator(parseChord('mod+arrowup'))).toBe(
      'CommandOrControl+ArrowUp',
    );
  });

  it('maps function keys to FN form', () => {
    expect(chordToTauriAccelerator(parseChord('mod+f1'))).toBe(
      'CommandOrControl+F1',
    );
    expect(chordToTauriAccelerator(parseChord('f12'))).toBe('F12');
  });

  it('handles a key alone (no modifier)', () => {
    expect(chordToTauriAccelerator(parseChord('escape'))).toBe('Escape');
    expect(chordToTauriAccelerator(parseChord('a'))).toBe('A');
  });

  it('returns empty when chord has no key', () => {
    // parseChord('mod+shift') with no key → NULL_CHORD → empty key
    const empty = parseChord('mod+shift');
    expect(chordToTauriAccelerator(empty)).toBe('');
  });
});
