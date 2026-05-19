import { describe, expect, it } from 'vitest';
import {
  parseChord,
  serializeChord,
  formatChord,
  chordsEqual,
  chordFromKeyboardEvent,
  NULL_CHORD,
} from '$lib/domain/values/KeyChord';

describe('KeyChord', () => {
  describe('parseChord', () => {
    it('parses single key', () => {
      expect(parseChord('escape')).toEqual({
        key: 'escape',
        mod: false,
        shift: false,
        alt: false,
        ctrl: false,
      });
    });

    it('parses mod+key', () => {
      expect(parseChord('mod+k')).toEqual({
        key: 'k',
        mod: true,
        shift: false,
        alt: false,
        ctrl: false,
      });
    });

    it('parses mod+shift+key', () => {
      expect(parseChord('mod+shift+f')).toEqual({
        key: 'f',
        mod: true,
        shift: true,
        alt: false,
        ctrl: false,
      });
    });

    it('treats cmd and meta as mod', () => {
      expect(parseChord('cmd+k').mod).toBe(true);
      expect(parseChord('meta+k').mod).toBe(true);
    });

    it('aliases esc → escape, return → enter, up → arrowup', () => {
      expect(parseChord('esc').key).toBe('escape');
      expect(parseChord('return').key).toBe('enter');
      expect(parseChord('up').key).toBe('arrowup');
    });

    it('returns NULL_CHORD when no non-modifier key is present', () => {
      expect(parseChord('mod+shift')).toBe(NULL_CHORD);
      expect(parseChord('')).toBe(NULL_CHORD);
    });

    it('is order-independent', () => {
      expect(parseChord('shift+mod+k')).toEqual(parseChord('mod+shift+k'));
    });

    it('lowercases the key', () => {
      expect(parseChord('mod+K').key).toBe('k');
    });
  });

  describe('serializeChord', () => {
    it('round-trips simple chords', () => {
      const chord = parseChord('mod+shift+f');
      expect(serializeChord(chord)).toBe('mod+shift+f');
    });

    it('returns empty string for NULL_CHORD', () => {
      expect(serializeChord(NULL_CHORD)).toBe('');
    });
  });

  describe('chordsEqual', () => {
    it('compares all five fields', () => {
      const a = parseChord('mod+k');
      const b = parseChord('mod+k');
      expect(chordsEqual(a, b)).toBe(true);
    });

    it('detects modifier difference', () => {
      expect(chordsEqual(parseChord('mod+k'), parseChord('mod+shift+k'))).toBe(false);
    });

    it('detects key difference', () => {
      expect(chordsEqual(parseChord('mod+k'), parseChord('mod+j'))).toBe(false);
    });
  });

  describe('formatChord', () => {
    it('uses Mac glyphs on mac', () => {
      const chord = parseChord('mod+shift+f');
      expect(formatChord(chord, 'mac')).toBe('⇧⌘F');
    });

    it('uses word modifiers elsewhere', () => {
      const chord = parseChord('mod+shift+f');
      expect(formatChord(chord, 'other')).toBe('Ctrl+Shift+F');
    });

    it('formats arrow keys', () => {
      expect(formatChord(parseChord('mod+arrowup'), 'mac')).toBe('⌘↑');
    });
  });

  describe('chordFromKeyboardEvent', () => {
    it('treats metaKey as mod on mac', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
      });
      const chord = chordFromKeyboardEvent(event, 'mac');
      expect(chord.mod).toBe(true);
      expect(chord.key).toBe('k');
    });

    it('treats ctrlKey as mod on non-mac', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
      });
      const chord = chordFromKeyboardEvent(event, 'other');
      expect(chord.mod).toBe(true);
    });

    it('returns NULL_CHORD for pure modifier press', () => {
      const event = new KeyboardEvent('keydown', { key: 'Meta' });
      expect(chordFromKeyboardEvent(event, 'mac')).toBe(NULL_CHORD);
    });
  });
});
