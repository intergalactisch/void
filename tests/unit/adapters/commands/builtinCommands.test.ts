import { describe, expect, it, vi, afterEach } from 'vitest';
import { createBuiltinCommands } from '$lib/adapters/commands/builtinCommands';
import type { CommandContext, EditorPort } from '$lib/ports/outbound';
import { EMPTY_SCOPE } from '$lib/domain/values';

describe('createBuiltinCommands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts an image block when the Image command receives a URL', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('https://example.com/image.png');
    const editor = { execute: vi.fn() } as unknown as EditorPort;
    const command = createBuiltinCommands().find((cmd) => cmd.id === 'image');

    command?.execute(createContext(editor));

    expect(editor.execute).toHaveBeenCalledWith('insertBlock', 'image', {
      type: 'image',
      src: 'https://example.com/image.png',
      alt: null,
      title: null,
      caption: null,
      width: null,
    });
  });

  it('does not insert an image when the Image URL prompt is cancelled', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('');
    const editor = { execute: vi.fn() } as unknown as EditorPort;
    const command = createBuiltinCommands().find((cmd) => cmd.id === 'image');

    command?.execute(createContext(editor));

    expect(editor.execute).not.toHaveBeenCalled();
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
