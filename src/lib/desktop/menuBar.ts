/**
 * Typed bridge for native menu bar commands emitted by the Tauri shell.
 */

import type { Event } from '@tauri-apps/api/event';

export const MENU_BAR_COMMAND_EVENT = 'void:menu-command';

export type MenuBarCommand =
  | 'new-note'
  | 'open-search'
  | 'ask-void'
  | 'open-tasks'
  | 'open-settings'
  | 'check-updates';

interface MenuBarCommandPayload {
  command?: unknown;
}

function isMenuBarCommand(command: unknown): command is MenuBarCommand {
  return (
    command === 'new-note' ||
    command === 'open-search' ||
    command === 'ask-void' ||
    command === 'open-tasks' ||
    command === 'open-settings' ||
    command === 'check-updates'
  );
}

export async function listenToMenuBarCommands(
  handler: (command: MenuBarCommand) => void
): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<MenuBarCommandPayload>(
      MENU_BAR_COMMAND_EVENT,
      (event: Event<MenuBarCommandPayload>) => {
        const command = event.payload?.command;
        if (isMenuBarCommand(command)) {
          handler(command);
        }
      }
    );
  } catch {
    return () => {};
  }
}
