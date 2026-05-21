import { describe, expect, it } from 'vitest';
import {
  generateManagedWorkspacePath,
  isAbsoluteOrTildePath,
  needsManagedDefaultWorkspaceMigration,
  sanitizeWorkspaceFolderName,
  validateSettings,
} from '$lib/domain';

describe('workspace path helpers', () => {
  it('generates managed workspace paths from names', () => {
    expect(generateManagedWorkspacePath('Test')).toBe('~/Documents/Void/Test');
  });

  it('sanitizes names before using them as folder names', () => {
    expect(sanitizeWorkspaceFolderName('  Research / Drafts:*  ')).toBe('Research Drafts');
    expect(generateManagedWorkspacePath('///')).toBe('~/Documents/Void/Workspace');
  });

  it('appends a suffix when a managed folder is already used', () => {
    expect(generateManagedWorkspacePath('Test', [
      '~/Documents/Void/Test',
      '/Users/sander/Documents/Void/Test 2',
    ])).toBe('~/Documents/Void/Test 3');
  });

  it('accepts only absolute or tilde paths for custom folders', () => {
    expect(isAbsoluteOrTildePath('/notes/test')).toBe(true);
    expect(isAbsoluteOrTildePath('~/notes/test')).toBe(true);
    expect(isAbsoluteOrTildePath('Test')).toBe(false);
  });

  it('detects legacy default workspace layouts that need migration', () => {
    const settings = validateSettings({ notesPath: '~/Documents/void' });

    expect(needsManagedDefaultWorkspaceMigration(
      settings.workspaces,
      settings.activeWorkspaceId,
    )).toBe(true);
  });
});
