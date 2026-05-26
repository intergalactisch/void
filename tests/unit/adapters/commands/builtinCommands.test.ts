import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBuiltinCommands } from '$lib/adapters/commands/builtinCommands';
import type { CommandContext, EditorPort } from '$lib/ports/outbound';
import { EMPTY_SCOPE } from '$lib/domain/values';
import { events } from '$lib/events';

describe('createBuiltinCommands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests image insertion via the attachment flow when the Image command runs', () => {
    const emit = vi.spyOn(events, 'emit');
    const editor = { execute: vi.fn() } as unknown as EditorPort;
    const command = createBuiltinCommands().find((cmd) => cmd.id === 'image');

    expect(command).toMatchObject({
      label: 'Add image',
      description: 'Upload, paste, or download an image into this note',
      category: 'media',
      icon: 'image',
    });
    expect(command?.keywords).toEqual(expect.arrayContaining(['image', 'img', 'upload', 'file', 'url', 'attach']));

    command?.execute(createContext(editor));

    // The Image command delegates to the media-attachment flow rather than
    // inserting a block synchronously.
    expect(emit).toHaveBeenCalledWith('editor:request-insert-image', undefined);
    expect(editor.execute).not.toHaveBeenCalled();
  });

  it('does nothing when no editor is available', () => {
    const emit = vi.spyOn(events, 'emit');
    const command = createBuiltinCommands().find((cmd) => cmd.id === 'image');

    command?.execute({ ...createContext(null as unknown as EditorPort) });

    expect(emit).not.toHaveBeenCalledWith('editor:request-insert-image', undefined);
  });
});

function createContext(editor: EditorPort): CommandContext {
  return {
    editor,
    selection: {
      from: 0,
      to: 0,
      text: '',
    },
    scope: { ...EMPTY_SCOPE, editorFocused: true },
  };
}
