/**
 * Built-in Command Implementations
 *
 * Default slash commands that provide basic editor functionality.
 * Each command uses the block commands from Phase 16 to manipulate
 * the ProseMirror document.
 *
 * Part of the commands infrastructure adapter.
 */

import type { RegisteredCommand, CommandContext } from '$lib/ports/outbound';
import { BUILTIN_COMMANDS } from '$lib/domain/values/Command';
import type { BlockType } from '$lib/domain/values/BlockType';
import type { Block } from '$lib/domain/entities/Block';
import { getLogger } from '$lib/logging';

const log = getLogger('CommandRegistry');

/**
 * Create a block type command that sets the current block type.
 *
 * @param blockType - The domain block type to set
 */
function createSetBlockTypeCommand(
  blockType: BlockType
): (context: CommandContext) => void {
  return (context: CommandContext) => {
    if (!context.editor) {
      console.warn('No editor available for command execution');
      return;
    }
    context.editor.execute('setBlockType', blockType);
  };
}

/**
 * Create a block insertion command.
 *
 * @param blockType - The domain block type to insert
 * @param attrs - Optional attributes for the block
 */
function createInsertBlockCommand(
  blockType: BlockType,
  attrs?: Block['attrs']
): (context: CommandContext) => void {
  return (context: CommandContext) => {
    if (!context.editor) {
      console.warn('No editor available for command execution');
      return;
    }
    context.editor.execute('insertBlock', blockType, attrs);
  };
}

/**
 * Create registered commands from built-in command definitions.
 * Maps domain command definitions to executable registered commands.
 *
 * @returns Array of registered commands ready for the registry
 */
export function createBuiltinCommands(): RegisteredCommand[] {
  const commands: RegisteredCommand[] = [];

  for (const cmd of BUILTIN_COMMANDS) {
    let execute: RegisteredCommand['execute'];

    switch (cmd.id) {
      // Basic text blocks
      case 'paragraph':
        execute = createSetBlockTypeCommand('paragraph');
        break;

      // Headings
      case 'heading1':
        execute = createSetBlockTypeCommand('heading1');
        break;
      case 'heading2':
        execute = createSetBlockTypeCommand('heading2');
        break;
      case 'heading3':
        execute = createSetBlockTypeCommand('heading3');
        break;

      // Lists
      case 'bulletList':
        execute = createSetBlockTypeCommand('bulletList');
        break;
      case 'numberedList':
        execute = createSetBlockTypeCommand('numberedList');
        break;
      case 'todoItem':
        execute = createSetBlockTypeCommand('todoItem');
        break;

      // Formatting blocks
      case 'blockquote':
        execute = createSetBlockTypeCommand('blockquote');
        break;
      case 'codeBlock':
        execute = createSetBlockTypeCommand('codeBlock');
        break;
      case 'horizontalRule':
        execute = createInsertBlockCommand('horizontalRule');
        break;

      // Advanced blocks
      case 'callout':
        execute = createSetBlockTypeCommand('callout');
        break;
      case 'toggle':
        execute = createInsertBlockCommand('toggle', {
          type: 'toggle',
          open: true,
        });
        break;
      case 'table':
        execute = createInsertBlockCommand('table', {
          type: 'table',
          rows: [
            {
              cells: [
                { content: 'Name', header: true },
                { content: 'Notes', header: true },
              ],
            },
            {
              cells: [
                { content: '' },
                { content: '' },
              ],
            },
          ],
        });
        break;

      // Media
      case 'image':
        execute = (context) => {
          if (!context.editor) {
            console.warn('No editor available for command execution');
            return;
          }

          const src = typeof window !== 'undefined'
            ? window.prompt('Image URL')?.trim()
            : '';
          if (!src) {
            log.info('Image insertion cancelled');
            return;
          }

          context.editor.execute('insertBlock', 'image', {
            type: 'image',
            src,
            alt: null,
            title: null,
            caption: null,
            width: null,
          });
        };
        break;

      default:
        // Default no-op for unknown commands
        execute = () => {
          console.warn(`Unknown command: ${cmd.id}`);
        };
    }

    commands.push({
      ...cmd,
      execute,
    });
  }

  return commands;
}

/**
 * Register all built-in commands with the given registry functions.
 *
 * @param register - Function to register a command
 */
export function registerBuiltinCommands(
  register: (command: RegisteredCommand) => void
): void {
  const commands = createBuiltinCommands();
  for (const cmd of commands) {
    register(cmd);
  }
}
