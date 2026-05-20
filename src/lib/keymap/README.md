# Keymap layer

The keymap is the application's single source of truth for "which keystroke
fires which command." It is a thin pure-logic service plus one DOM adapter
that wires `window.keydown` to it.

## Layers

```
+----------------------------------------------+
|  src/routes/+layout.svelte (onMount)         |
|  attaches globalKeymapBinder once at boot    |
+----------------------------------------------+
|  globalKeymapBinder.ts (THIS DIR)            |
|  the only file that calls                    |
|  window.addEventListener('keydown')          |
+----------------------------------------------+
|  KeymapServiceImpl (application/services)    |
|  pure: chord+scope -> commandId              |
+----------------------------------------------+
|  CommandService.executeById(commandId, ctx)  |
+----------------------------------------------+
```

## Editor vs global boundary

ProseMirror plugin keymaps fire BEFORE `window.keydown`. When the editor
consumes a key (returns `true` from a chained command, e.g. `Mod-B` for bold),
ProseMirror calls `event.preventDefault()` on the underlying DOM event. Our
global handler checks `event.defaultPrevented` and skips dispatch when true.

This means:

- **Editor-internal shortcuts** (bold, italic, undo, slash, AI inline,
  block-selection escalation, etc.) live in the ProseMirror keymap and never
  enter the global keymap. They are NOT registered with `KeymapService`.
- **Global app shortcuts** (`Cmd+P`, `Cmd+Shift+O`, `Cmd+,`, `Cmd+S`, …) live
  in `KeymapService` and dispatch through the global binder.
- **Conflicts** like `Cmd+B` (bold inside editor, toggle sidebar outside) work
  because the editor's keymap consumes it when focused; outside the editor,
  the editor's keymap doesn't match and the global binder gets to fire.

Scope predicates (in `scopes.ts`) let a command be enabled only when certain
conditions hold — e.g., `find-bar` scope so `Mod+G` only resolves to
"find next" while the find/replace bar is open.

## Adding a new shortcut

1. Define the command somewhere it logically belongs (usually
   `src/lib/adapters/commands/globalCommands.ts` for app-wide commands).
2. Set `defaultKeybinding` on the command (e.g., `'mod+shift+f'`).
3. Optionally set `scope` (defaults to `['global']`).
4. Register the command via the `CommandRegistryPort`. The bootstrap helper
   `wireCommandKeybindings(keymap, registry)` reads each registered command
   and registers its default chord with the `KeymapService`.

That's it. The shortcut works in the palette, in the shortcut sheet, in
settings (where it can be rebound), and via keystroke — all from one
registration.

## Why not put `window.addEventListener` in a service?

The DOM is infrastructure. Services in this app are pure (`KeymapService`
returns `string | null`; no side effects). The binder is a primary adapter:
it reads from the DOM, calls the service, and dispatches via another service.
This keeps the service unit-testable without a JSDOM environment.
