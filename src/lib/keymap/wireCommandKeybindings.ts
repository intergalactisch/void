/**
 * Bridge between CommandRegistryPort and KeymapService.
 *
 * For every registered command that ships with a `defaultKeybinding`, register
 * the parsed chord with the KeymapService under the command's scope. Skips
 * commands without a binding. Also replays existing user overrides so the
 * binding state matches what's persisted in storage.
 */

import type { CommandRegistryPort } from '$lib/ports/outbound';
import type { KeymapService } from '$lib/ports/inbound/KeymapService';
import { parseChord, NULL_CHORD } from '$lib/domain/values/KeyChord';

export function wireCommandKeybindings(
  registry: CommandRegistryPort,
  keymap: KeymapService
): void {
  for (const command of registry.getAll()) {
    if (!command.defaultKeybinding) continue;
    const chord = parseChord(command.defaultKeybinding);
    if (chord === NULL_CHORD) {
      console.warn(
        `[keymap] Could not parse default chord '${command.defaultKeybinding}' ` +
          `for command '${command.id}'.`
      );
      continue;
    }
    keymap.register(command.id, chord, {
      scope: command.scope ?? ['global'],
      priority: command.priority ?? 0,
    });
  }
}
