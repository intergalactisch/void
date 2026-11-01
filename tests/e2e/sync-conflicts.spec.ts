import { expect, test } from '@playwright/test';

test('conflict drafts survive file switches and closing, with safe merge choices', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create new note', exact: true }).waitFor();
  await page.evaluate(async () => {
    const adaptersPath = '/src/lib/adapters/memory/index.ts';
    const servicesPath = '/src/lib/application/services/index.ts';
    const portsPath = '/src/lib/ports/inbound/index.ts';
    const valuesPath = '/src/lib/domain/values/index.ts';
    const syncPath = '/src/lib/stores/sync.svelte.ts';
    const uiPath = '/src/lib/stores/ui.svelte.ts';
    const { MemoryCredentialAdapter, MemoryGitHubAdapter, MemoryGitRepositoryAdapter, MemorySettingsAdapter, MemoryVoidStorageAdapter } = await import(adaptersPath);
    const { CredentialServiceImpl, SettingsServiceImpl, SyncServiceImpl } = await import(servicesPath);
    const { CREDENTIAL_KEYS } = await import(portsPath);
    const { createVoidRepoManifest } = await import(valuesPath);
    const { syncStore } = await import(syncPath);
    const { uiStore } = await import(uiPath);
    const notesPath = '/sync-test';
    const git = new MemoryGitRepositoryAdapter();
    const github = new MemoryGitHubAdapter();
    const settings = new SettingsServiceImpl(new MemorySettingsAdapter({ notesPath }));
    await settings.load();
    github.seedVoidManifest('test/notes', createVoidRepoManifest({ workspaceId: settings.current().activeWorkspaceId }));
    const credentials = new CredentialServiceImpl(new MemoryCredentialAdapter());
    await credentials.store(CREDENTIAL_KEYS.GITHUB_ACCESS_TOKEN, 'test-only');
    const sync = new SyncServiceImpl(git, github, settings, credentials, notesPath,
      { refresh: async () => ({ ok: true, value: [] }) }, undefined, undefined, new MemoryVoidStorageAdapter());
    await sync.attachRepository({ remoteUrl: 'https://github.com/test/notes.git' });
    git.seed(notesPath, { ahead: 1, behind: 1, lastCommit: 'local' });
    for (const path of ['plan.md', 'tasks.md']) {
      git.seedMergeConflict(notesPath, { path, base: '# Shared\nOriginal\n',
        local: '# Shared\nOffline laptop edit\n', remote: '# Shared\nOther device edit\n' });
    }
    await sync.syncNow();
    syncStore.init(sync);
    uiStore.openSyncConflictWorkspace();
  });
  const dialog = page.getByRole('dialog', { name: 'GitHub sync conflicts' });
  const draft = dialog.getByRole('textbox', { name: 'Merged' });
  await expect(draft).toHaveValue(/<<<<<<< local/);
  await expect(dialog.getByRole('button', { name: 'Use Merged', exact: true })).toBeDisabled();
  await draft.fill('# Plan\nOffline laptop edit\nOther device edit\nCombined safely');
  await dialog.getByRole('button', { name: /tasks.md pending/ }).click();
  await expect(draft).toHaveValue(/<<<<<<< local/);
  await draft.fill('# Tasks\nIndependent draft');
  await dialog.getByRole('button', { name: /plan.md pending/ }).click();
  await expect(draft).toHaveValue('# Plan\nOffline laptop edit\nOther device edit\nCombined safely');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/lib/stores/ui.svelte.ts';
    (await import(path)).uiStore.openSyncConflictWorkspace();
  });
  await expect(draft).toHaveValue('# Plan\nOffline laptop edit\nOther device edit\nCombined safely');
  await expect(dialog.getByRole('button', { name: 'Use Merged', exact: true })).toBeEnabled();
  await page.screenshot({ path: '/tmp/void-sync-conflicts.png' });
  await dialog.getByRole('button', { name: 'Use Merged', exact: true }).click();
  await dialog.getByRole('button', { name: /plan.md resolved/ }).click();
  await expect(draft).toBeDisabled();
  await dialog.getByRole('button', { name: /tasks.md pending/ }).click();
  await expect(draft).toHaveValue('# Tasks\nIndependent draft');
  await dialog.getByRole('button', { name: 'Keep Both', exact: true }).click();
  await expect(dialog.getByText('No active sync conflicts.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
