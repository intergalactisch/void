import { describe, it, expect, beforeEach } from 'vitest';
import { KeymapServiceImpl } from '$lib/application/services/KeymapServiceImpl';
import { MemoryKeymapStorageAdapter } from '$lib/adapters/keymap';
import { parseChord, NULL_CHORD } from '$lib/domain/values/KeyChord';
import { EMPTY_SCOPE } from '$lib/domain/values/ScopeSnapshot';

describe('KeymapServiceImpl', () => {
  let service: KeymapServiceImpl;
  let storage: MemoryKeymapStorageAdapter;

  beforeEach(() => {
    storage = new MemoryKeymapStorageAdapter();
    service = new KeymapServiceImpl(storage);
  });

  describe('register + resolve', () => {
    it('resolves a global chord to its commandId', async () => {
      service.register('view.toggleSidebar', parseChord('mod+b'));
      const result = service.resolve(parseChord('mod+b'), { ...EMPTY_SCOPE });
      expect(result).toBe('view.toggleSidebar');
    });

    it('returns null for unknown chords', () => {
      service.register('view.toggleSidebar', parseChord('mod+b'));
      expect(service.resolve(parseChord('mod+x'), EMPTY_SCOPE)).toBeNull();
    });

    it('returns null when chord has no key', () => {
      service.register('view.toggleSidebar', parseChord('mod+b'));
      expect(service.resolve(NULL_CHORD, EMPTY_SCOPE)).toBeNull();
    });
  });

  describe('scope resolution', () => {
    it('editor-scope binding outranks global-scope binding when editor focused', () => {
      service.register('editor.bold', parseChord('mod+b'), { scope: ['editor'] });
      service.register('view.toggleSidebar', parseChord('mod+b'), { scope: ['global'] });

      const editorFocused = { ...EMPTY_SCOPE, editorFocused: true };
      expect(service.resolve(parseChord('mod+b'), editorFocused)).toBe('editor.bold');

      const noFocus = { ...EMPTY_SCOPE };
      expect(service.resolve(parseChord('mod+b'), noFocus)).toBe('view.toggleSidebar');
    });

    it('priority breaks ties for same scope specificity', () => {
      service.register('first', parseChord('mod+x'), { scope: ['global'], priority: 0 });
      service.register('second', parseChord('mod+x'), { scope: ['global'], priority: 5 });
      expect(service.resolve(parseChord('mod+x'), EMPTY_SCOPE)).toBe('second');
    });

    it('does not match when scope predicate is inactive', () => {
      service.register('palette.next', parseChord('arrowdown'), { scope: ['palette-open'] });
      expect(service.resolve(parseChord('arrowdown'), EMPTY_SCOPE)).toBeNull();
      expect(
        service.resolve(parseChord('arrowdown'), { ...EMPTY_SCOPE, paletteOpen: true })
      ).toBe('palette.next');
    });
  });

  describe('overrides', () => {
    it('user override replaces default chord', async () => {
      service.register('view.toggleSidebar', parseChord('mod+b'));
      await service.setOverride('view.toggleSidebar', parseChord('mod+shift+b'));
      expect(service.resolve(parseChord('mod+b'), EMPTY_SCOPE)).toBeNull();
      expect(service.resolve(parseChord('mod+shift+b'), EMPTY_SCOPE)).toBe('view.toggleSidebar');
    });

    it('clearOverride restores default', async () => {
      service.register('view.toggleSidebar', parseChord('mod+b'));
      await service.setOverride('view.toggleSidebar', parseChord('mod+shift+b'));
      await service.clearOverride('view.toggleSidebar');
      expect(service.resolve(parseChord('mod+b'), EMPTY_SCOPE)).toBe('view.toggleSidebar');
    });

    it('NULL_CHORD override unbinds the command', async () => {
      service.register('view.toggleSidebar', parseChord('mod+b'));
      await service.setOverride('view.toggleSidebar', NULL_CHORD);
      expect(service.resolve(parseChord('mod+b'), EMPTY_SCOPE)).toBeNull();
    });

    it('overrides persist via storage round-trip', async () => {
      service.register('view.toggleSidebar', parseChord('mod+b'));
      await service.setOverride('view.toggleSidebar', parseChord('mod+shift+b'));

      // New service reads same storage
      const second = new KeymapServiceImpl(storage);
      second.register('view.toggleSidebar', parseChord('mod+b'));
      await second.load();
      expect(second.resolve(parseChord('mod+shift+b'), EMPTY_SCOPE)).toBe('view.toggleSidebar');
    });
  });

  describe('conflicts', () => {
    it('detects two commands with same chord in overlapping scope', () => {
      service.register('a', parseChord('mod+k'), { scope: ['global'] });
      service.register('b', parseChord('mod+k'), { scope: ['global'] });
      const conflicts = service.findConflicts();
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]?.bindings.length).toBe(2);
    });

    it('does not flag disjoint scopes as conflicts', () => {
      service.register('a', parseChord('mod+k'), { scope: ['editor'] });
      service.register('b', parseChord('mod+k'), { scope: ['tasks-workspace'] });
      const conflicts = service.findConflicts();
      expect(conflicts.length).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('notifies subscribers on register', () => {
      let calls = 0;
      service.subscribe(() => {
        calls += 1;
      });
      // Initial call happens once during subscribe
      expect(calls).toBe(1);
      service.register('view.toggleSidebar', parseChord('mod+b'));
      expect(calls).toBe(2);
    });
  });
});
