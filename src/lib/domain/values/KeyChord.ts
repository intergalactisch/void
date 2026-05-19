/**
 * KeyChord - pure value object representing a keyboard shortcut.
 *
 * A chord is a single key (`key`) plus a set of modifier flags. The `mod`
 * flag is platform-aware: it represents Cmd on macOS and Ctrl on other
 * platforms. Codepaths that build a chord from a KeyboardEvent should set
 * `mod` whenever the corresponding platform's primary modifier is held.
 *
 * Wire format: lowercase strings joined by '+', e.g. 'mod+shift+f', 'mod+/',
 * 'escape', 'mod+['.
 *
 * No external dependencies. Pure domain value.
 */

export type Platform = 'mac' | 'other';

export interface KeyChord {
  /** The non-modifier key in lowercase. Examples: 'a', 'enter', 'escape', '/', 'arrowup'. */
  key: string;
  /** Platform-aware primary modifier (Cmd on macOS, Ctrl elsewhere). */
  mod: boolean;
  /** Shift modifier. */
  shift: boolean;
  /** Alt / Option modifier. */
  alt: boolean;
  /**
   * Literal Ctrl modifier (only relevant on macOS where it is distinct from Cmd).
   * Use sparingly — most cross-platform shortcuts should use `mod` instead.
   */
  ctrl: boolean;
}

/** A chord with no key set — sentinel for invalid parses. */
export const NULL_CHORD: KeyChord = {
  key: '',
  mod: false,
  shift: false,
  alt: false,
  ctrl: false,
};

const MODIFIER_TOKENS = new Set([
  'mod',
  'cmd',
  'ctrl',
  'control',
  'shift',
  'alt',
  'opt',
  'option',
  'meta',
]);

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  ins: 'insert',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pagedown: 'pagedown',
  pageup: 'pageup',
};

const DISPLAY_KEYS_MAC: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: '↵',
  escape: 'Esc',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
  ' ': 'Space',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  home: 'Home',
  end: 'End',
};

const DISPLAY_KEYS_OTHER: Record<string, string> = {
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  enter: 'Enter',
  escape: 'Esc',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  ' ': 'Space',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  home: 'Home',
  end: 'End',
};

/**
 * Parse a string of the form `'mod+shift+f'` into a KeyChord.
 * Returns NULL_CHORD if the string contains no non-modifier key.
 *
 * Token order is irrelevant. Aliases (cmd, ctrl, control, opt, option,
 * meta, esc, return, up, down, etc.) are normalized.
 */
export function parseChord(input: string): KeyChord {
  const tokens = input
    .toLowerCase()
    .trim()
    .split('+')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  let mod = false;
  let shift = false;
  let alt = false;
  let ctrl = false;
  let key = '';

  for (const token of tokens) {
    if (MODIFIER_TOKENS.has(token)) {
      switch (token) {
        case 'mod':
        case 'cmd':
        case 'meta':
          mod = true;
          break;
        case 'ctrl':
        case 'control':
          // Treat 'ctrl' alone as `mod` so authors can write 'ctrl+k' on
          // non-mac and have it work; explicit ctrl-only on mac is rare and
          // can be expressed via the API directly.
          mod = true;
          ctrl = true;
          break;
        case 'shift':
          shift = true;
          break;
        case 'alt':
        case 'opt':
        case 'option':
          alt = true;
          break;
      }
    } else {
      key = KEY_ALIASES[token] ?? token;
    }
  }

  if (!key) return NULL_CHORD;

  return { key, mod, shift, alt, ctrl };
}

/**
 * Produce a human-readable string for a chord. Uses Mac glyph conventions
 * on Mac and word-style modifiers elsewhere.
 */
export function formatChord(chord: KeyChord, platform: Platform = 'mac'): string {
  if (!chord.key) return '';

  const parts: string[] = [];
  const display = platform === 'mac' ? DISPLAY_KEYS_MAC : DISPLAY_KEYS_OTHER;

  if (platform === 'mac') {
    if (chord.ctrl && !chord.mod) parts.push('⌃');
    if (chord.alt) parts.push('⌥');
    if (chord.shift) parts.push('⇧');
    if (chord.mod) parts.push('⌘');
  } else {
    if (chord.mod) parts.push('Ctrl');
    if (chord.alt) parts.push('Alt');
    if (chord.shift) parts.push('Shift');
  }

  const rendered = display[chord.key] ?? formatKey(chord.key);
  parts.push(rendered);

  return platform === 'mac' ? parts.join('') : parts.join('+');
}

/**
 * Wire-format a chord back into the canonical 'mod+shift+f' shape. Used for
 * persistence and equality keys.
 */
export function serializeChord(chord: KeyChord): string {
  if (!chord.key) return '';

  const parts: string[] = [];
  if (chord.mod) parts.push('mod');
  if (chord.ctrl && !chord.mod) parts.push('ctrl');
  if (chord.alt) parts.push('alt');
  if (chord.shift) parts.push('shift');
  parts.push(chord.key);
  return parts.join('+');
}

/** Strict equality on all five fields. */
export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return (
    a.key === b.key &&
    a.mod === b.mod &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    a.ctrl === b.ctrl
  );
}

/**
 * Build a chord from a KeyboardEvent.
 *
 * The `platform` argument controls which physical modifier becomes `mod`:
 * Cmd (metaKey) on Mac, Ctrl on others. Ctrl on Mac is preserved as `ctrl`
 * to support unusual shortcuts; on other platforms Ctrl always becomes
 * `mod` (and `ctrl` is left false for cross-platform behaviour).
 */
export function chordFromKeyboardEvent(
  event: KeyboardEvent,
  platform: Platform = detectPlatform()
): KeyChord {
  const rawKey = event.key.toLowerCase();
  // Skip pure modifier presses — they aren't a chord on their own.
  if (
    rawKey === 'meta' ||
    rawKey === 'control' ||
    rawKey === 'shift' ||
    rawKey === 'alt' ||
    rawKey === 'os' ||
    rawKey === 'fn'
  ) {
    return NULL_CHORD;
  }

  const key = KEY_ALIASES[rawKey] ?? rawKey;

  if (platform === 'mac') {
    return {
      key,
      mod: event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey,
    };
  }

  return {
    key,
    mod: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: false,
  };
}

/** Best-effort platform detection. Falls back to 'other' in non-browser contexts. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const platform = (navigator.platform || '').toLowerCase();
  const ua = (navigator.userAgent || '').toLowerCase();
  if (platform.startsWith('mac') || ua.includes('mac os x')) return 'mac';
  return 'other';
}

function formatKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  // Title-case multi-char keys
  return key.charAt(0).toUpperCase() + key.slice(1);
}
