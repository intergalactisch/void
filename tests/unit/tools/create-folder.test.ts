import { describe, expect, it, vi } from 'vitest';
import { ok } from '$lib/core';
import createFolder from '$lib/tools/note/create-folder.tool';
import type { ToolInvocation } from '$lib/domain/entities/ToolInvocation';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import type { ToolExecutionContext } from '$lib/ports/outbound/ToolExecutorPort';

describe('note:create-folder', () => {
  it('rejects folder traversal before touching the filesystem', async () => {
    const createDirectory = vi.fn();
    const services = {
      settings: {
        load: vi.fn().mockResolvedValue(ok({ notesPath: '/vault' })),
      },
      files: { createDirectory },
      notes: { refresh: vi.fn() },
    } as unknown as ToolServices;

    await expect(
      createFolder.handler({ folder: '../outside' }, createContext(services))
    ).rejects.toThrow('Folder path cannot contain "." or ".." segments');
    expect(createDirectory).not.toHaveBeenCalled();
  });
});

function createContext(services: ToolServices): ToolExecutionContext {
  return {
    services,
    reportProgress: vi.fn(),
    isCancelled: () => false,
    signal: new AbortController().signal,
    invocation: { id: 'inv-create-folder' } as ToolInvocation,
  } as ToolExecutionContext;
}
