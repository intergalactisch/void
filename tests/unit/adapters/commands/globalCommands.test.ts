import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlobalCommands } from '$lib/adapters/commands/globalCommands';
import { events } from '$lib/events';
import { EMPTY_SCOPE } from '$lib/domain/values';
import type { CommandContext } from '$lib/ports/outbound';

describe('createGlobalCommands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers foreground workspace shortcuts', () => {
    const commands = createGlobalCommands();

    expect(commands.find((command) => command.id === 'view.toggleTasks')).toMatchObject({
      defaultKeybinding: 'mod+shift+t',
    });
    expect(commands.find((command) => command.id === 'view.openTrash')).toMatchObject({
      defaultKeybinding: 'mod+shift+backspace',
    });
    expect(commands.find((command) => command.id === 'view.openWorkspaces')).toMatchObject({
      defaultKeybinding: 'mod+shift+w',
    });
  });

  it('emits navigation events for Trash and Workspaces', () => {
    const emit = vi.spyOn(events, 'emit');
    const commands = createGlobalCommands();
    const context = { scope: { ...EMPTY_SCOPE } } as CommandContext;

    commands.find((command) => command.id === 'view.openTrash')?.execute(context);
    commands.find((command) => command.id === 'view.openWorkspaces')?.execute(context);

    expect(emit).toHaveBeenCalledWith('app:navigate', { view: 'trash' });
    expect(emit).toHaveBeenCalledWith('app:navigate', { view: 'workspaces' });
  });
});
