<script lang="ts">
  /**
   * GitHubSyncSection — full GitHub sync settings UI.
   *
   * Self-contained state machine:
   *   1. Not signed in   → Sign-in card (device flow tab + PAT tab).
   *   2. Signed in, no repo → Account card + repo create/attach tabs.
   *   3. Attached         → Account card + repo card with branch picker.
   *
   * Talks only to {@link syncStore}; never touches Tauri or the service
   * directly so the panel stays testable.
   */

  import { settingsStore, syncStore, toastStore, uiStore, workspaceStore } from '$lib/stores';
  import {
    AlertTriangle,
    Check,
    ChevronDown,
    Circle,
    Copy,
    ExternalLink,
    GitBranch,
    Loader2,
    Lock,
    LogOut,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Search,
    Unlink,
    UploadCloud,
    User,
    X,
  } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import {
    VOID_GITHUB_SCOPE,
    type GitBranchInfo,
    type GitHubBranchSummary,
    type GitHubRepoSummary,
  } from '$lib/domain/values';
  import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener';

  interface Props {
    /**
     * Workspace this section is bound to. Defaults to the active workspace.
     * The underlying sync service still operates on the active workspace only,
     * so passing a non-active id is mostly for display correctness — controls
     * should only be rendered when this id matches the active workspace.
     */
    workspaceId?: string;
  }

  let { workspaceId }: Props = $props();

  // ─── State ───
  type AuthTab = 'device' | 'token';
  type RepoTab = 'create' | 'attach';
  type AttachMode = 'browse' | 'url';

  let authTab = $state<AuthTab>('device');
  let repoTab = $state<RepoTab>('create');
  let attachMode = $state<AttachMode>('browse');

  let busy = $state(false);

  // Sign-in inputs
  let clientIdInput = $state('');
  let tokenInput = $state('');
  let tokenRevealed = $state(false);

  // Device-code copy feedback
  let codeCopied = $state(false);

  // Create repo inputs
  let newRepoName = $state('void-notes');
  let newRepoDescription = $state('');
  let newRepoBranch = $state('main');
  let newRepoNameStatus = $state<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  let newRepoNameReason = $state<string | null>(null);
  let newRepoNameTimer: ReturnType<typeof setTimeout> | null = null;

  // Attach inputs
  let attachUrl = $state('');
  let attachBranch = $state('main');
  let repoFilter = $state('');
  let selectedRepoFullName = $state<string | null>(null);

  // Local branch creation
  let branchPickerOpen = $state(false);
  let creatingBranch = $state(false);
  let newBranchName = $state('');

  // Conflict detail
  let activeConflict = $state<string | null>(null);

  // Derived: current settings + status (from stores)
  const settings = $derived(settingsStore.settings);
  const status = $derived(syncStore.status);
  const user = $derived(syncStore.user);

  // The workspace this section is bound to. Falls back to the active workspace
  // when no id is provided.
  const boundWorkspaceId = $derived(workspaceId ?? workspaceStore.activeWorkspace?.id);
  const boundWorkspace = $derived(
    boundWorkspaceId
      ? settings?.workspaces.find((w) => w.id === boundWorkspaceId) ?? null
      : null,
  );

  // The sync config to read. Prefer the per-workspace sync; fall back to the
  // top-level mirror for legacy settings that haven't been normalised yet.
  const boundSync = $derived(boundWorkspace?.sync ?? settings?.sync ?? null);

  const isSignedIn = $derived(syncStore.isSignedIn);
  const isAttached = $derived(syncStore.isAttached && !!boundSync?.repository);
  const authMode = $derived(boundSync?.authMode ?? 'github-app');

  // Pull cached branches on attach
  $effect(() => {
    if (isAttached && syncStore.localBranches.length === 0) {
      void syncStore.refreshLocalBranches();
    }
  });

  // ─── Helpers ───
  function chordOpenUrl(url: string): void {
    // Prefer the Tauri opener (uses system default browser) inside the
    // desktop shell. Falls back to window.open in the browser dev preview.
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      void tauriOpenUrl(url).catch((e) => {
        console.warn('[sync] openUrl failed', e);
      });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function repoWebUrl(): string | null {
    const repo = boundSync?.repository;
    if (!repo) return null;
    return repo.htmlUrl ?? `https://github.com/${repo.fullName}`;
  }

  function formatRelative(iso: string | null): string {
    if (!iso) return 'never';
    const past = new Date(iso).getTime();
    const seconds = Math.max(1, Math.floor((Date.now() - past) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function formatCountdown(ms: number | null): string {
    if (ms === null) return '';
    const total = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  async function copyText(text: string, flag: 'code' | 'other' = 'other'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (flag === 'code') {
        codeCopied = true;
        setTimeout(() => (codeCopied = false), 1500);
      }
    } catch {
      // Some webviews block clipboard without user activation — silently
      // ignore, the user can still copy by hand.
    }
  }

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    busy = true;
    try {
      return await action();
    } finally {
      busy = false;
    }
  }

  // ─── Auth flow ───

  async function connectWithToken(): Promise<void> {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    await run(async () => {
      const user = await syncStore.connectWithToken(trimmed);
      if (user) {
        tokenInput = '';
        tokenRevealed = false;
        toastStore.success(`Signed in as @${user.login}`);
      }
      return user;
    });
  }

  async function beginDeviceAuth(): Promise<void> {
    const trimmed = clientIdInput.trim();
    if (!trimmed) return;
    await run(async () => {
      const session = await syncStore.beginDeviceAuth(trimmed);
      if (!session) return null;
      return session;
    });
  }

  function openVerificationUrl(): void {
    const session = syncStore.deviceAuth;
    if (!session) return;
    chordOpenUrl(session.device.verificationUri);
    syncStore.startDevicePolling();
  }

  function cancelDeviceFlow(): void {
    syncStore.cancelDeviceAuth();
  }

  async function signOut(): Promise<void> {
    if (busy) return;
    if (!confirm('Sign out of GitHub? This clears the token from this device but keeps your repo configured.')) {
      return;
    }
    await run(async () => syncStore.signOut());
  }

  // ─── Create / attach ───

  /**
   * Local-only validation. Runs on every keystroke; cheap and never hits the
   * network. The "is this name taken?" probe is intentionally NOT auto-fired —
   * it would burn a GitHub API call (and surface confusing toasts during the
   * sign-in→signed-in transition) for the default placeholder name.
   */
  function validateNameLocally(): void {
    if (newRepoNameTimer) clearTimeout(newRepoNameTimer);
    newRepoNameTimer = null;
    newRepoNameReason = null;
    const name = newRepoName.trim();
    if (!name) {
      newRepoNameStatus = 'idle';
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > 100) {
      newRepoNameStatus = 'invalid';
      newRepoNameReason = 'Use letters, numbers, hyphens, underscores, or dots (max 100 chars).';
      return;
    }
    newRepoNameStatus = 'idle';
  }

  /**
   * Probes GitHub for repo-name availability. Triggered on input blur and
   * before Create, never on signed-in transition. Silent on transport errors —
   * the Create button will surface any real failure that matters.
   */
  function checkNameAvailability(): void {
    if (newRepoNameTimer) clearTimeout(newRepoNameTimer);
    newRepoNameTimer = null;
    const name = newRepoName.trim();
    if (!name) return;
    if (newRepoNameStatus === 'invalid') return;
    if (!isSignedIn) return;
    newRepoNameStatus = 'checking';
    void (async () => {
      const result = await syncStore.checkRepositoryName(name);
      if (newRepoName.trim() !== name) return; // user kept typing
      if (!result) {
        // Network/auth error already raised as a toast elsewhere; fall back
        // silently to idle rather than getting stuck on "checking".
        newRepoNameStatus = 'idle';
        return;
      }
      if (result.available) {
        newRepoNameStatus = 'available';
        newRepoNameReason = null;
      } else {
        newRepoNameStatus = 'taken';
        newRepoNameReason = result.reason;
      }
    })();
  }

  function scheduleNameCheck(): void {
    if (newRepoNameTimer) clearTimeout(newRepoNameTimer);
    validateNameLocally();
    if (newRepoNameStatus === 'invalid') return;
    if (!newRepoName.trim()) return;
    if (!isSignedIn) return;
    // Debounce the network probe so we don't fire a request per keystroke.
    newRepoNameTimer = setTimeout(() => {
      newRepoNameTimer = null;
      checkNameAvailability();
    }, 600);
  }

  onDestroy(() => {
    if (newRepoNameTimer) clearTimeout(newRepoNameTimer);
  });

  async function createRepo(): Promise<void> {
    const name = newRepoName.trim();
    if (!name) return;
    if (newRepoNameStatus === 'taken' || newRepoNameStatus === 'invalid') return;
    await run(async () => {
      const description = newRepoDescription.trim();
      const result = await syncStore.createRepository({
        name,
        private: true,
        branch: newRepoBranch.trim() || 'main',
        ...(description ? { description } : {}),
      });
      if (result) {
        toastStore.success(`Created ${result.repository?.fullName}`);
        newRepoDescription = '';
      }
      return result;
    });
  }

  async function loadRepos(): Promise<void> {
    await run(async () => syncStore.refreshRemoteRepos());
  }

  async function selectRepoForAttach(repo: GitHubRepoSummary): Promise<void> {
    selectedRepoFullName = repo.fullName;
    attachUrl = repo.cloneUrl;
    attachBranch = repo.defaultBranch;
    await run(async () => syncStore.refreshRemoteBranches(repo.owner, repo.name));
  }

  function repoMatchesFilter(repo: GitHubRepoSummary): boolean {
    const q = repoFilter.trim().toLowerCase();
    if (!repo.private) return false;
    if (!q) return true;
    return (
      repo.fullName.toLowerCase().includes(q) ||
      (repo.description ?? '').toLowerCase().includes(q)
    );
  }

  async function attachRepo(): Promise<void> {
    const url = attachUrl.trim();
    if (!url) return;
    await run(async () => {
      const result = await syncStore.attachRepository(url, attachBranch.trim() || 'main');
      if (result) toastStore.success('Repository attached');
      return result;
    });
  }

  // ─── Connected actions ───

  async function syncNow(): Promise<void> {
    await run(async () => syncStore.syncNow());
  }

  async function refreshStatus(): Promise<void> {
    await run(async () => syncStore.refreshStatus());
  }

  async function openConflictWorkspace(): Promise<void> {
    uiStore.openSyncConflictWorkspace();
    await syncStore.refreshConflictSession();
  }

  async function detach(): Promise<void> {
    if (!confirm('Detach this notes folder from GitHub? Your notes and local Git history stay intact.')) {
      return;
    }
    await run(async () => {
      const result = await syncStore.detach();
      if (result) toastStore.success('Repository detached');
      return result;
    });
  }

  async function setAutoSync(next: boolean): Promise<void> {
    await run(async () => syncStore.setAutoSync(next));
  }

  async function togglePaused(): Promise<void> {
    const next = !(boundSync?.paused ?? false);
    await run(async () => syncStore.setPaused(next));
  }

  async function switchToBranch(branch: GitBranchInfo): Promise<void> {
    branchPickerOpen = false;
    if (branch.isCurrent) return;
    await run(async () => syncStore.switchBranch(branch.name));
  }

  async function attachToRemoteBranch(branch: GitHubBranchSummary): Promise<void> {
    branchPickerOpen = false;
    const repo = boundSync?.repository;
    if (!repo) return;
    if (status.branch === branch.name) return;
    // Switch the active branch — if it exists locally, switch; otherwise
    // create a tracking branch.
    const local = syncStore.localBranches.find((b) => b.name === branch.name);
    if (local) {
      await run(async () => syncStore.switchBranch(branch.name));
    } else {
      await run(async () =>
        syncStore.createBranch(branch.name, { base: `origin/${branch.name}` }),
      );
    }
  }

  async function createBranchAndAttach(): Promise<void> {
    const name = newBranchName.trim();
    if (!name) return;
    creatingBranch = true;
    try {
      const ok = await syncStore.createBranch(name, status.branch ? { base: status.branch } : {});
      if (ok) {
        newBranchName = '';
        branchPickerOpen = false;
        toastStore.success(`Created and switched to ${name}`);
      }
    } finally {
      creatingBranch = false;
    }
  }

  function openRepo(): void {
    const url = repoWebUrl();
    if (url) chordOpenUrl(url);
  }
</script>

{#snippet ghIcon(size: number)}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.88-1.54-3.88-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.17.92-.26 1.9-.39 2.88-.39.98 0 1.96.13 2.88.39 2.2-1.48 3.16-1.17 3.16-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.37-5.25 5.66.41.36.78 1.07.78 2.16v3.21c0 .31.21.66.78.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
  </svg>
{/snippet}

<section class="gh-section" aria-label="GitHub sync">
  <header class="gh-section-head">
    {@render ghIcon(14)}
    <span class="gh-section-title">GitHub sync</span>
    {#if isAttached}
      <span class="gh-status-pill {status.kind}">
        <span class="gh-status-dot {status.kind}"></span>
        {syncStore.label}
      </span>
    {/if}
  </header>

  {#if !isSignedIn}
    <!-- ────── State 1: Not signed in ────── -->
    <div class="gh-card">
      <div class="gh-card-intro">
        <h3 class="gh-card-title">Connect to GitHub</h3>
        <p class="gh-card-sub">Sync your notes folder to a private GitHub repository. Your token stays in the system keychain.</p>
      </div>

      <div class="gh-tabs" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={authTab === 'device'}
          class="gh-tab"
          class:gh-tab-active={authTab === 'device'}
          onclick={() => (authTab = 'device')}
        >Device flow</button>
        <button
          type="button"
          role="tab"
          aria-selected={authTab === 'token'}
          class="gh-tab"
          class:gh-tab-active={authTab === 'token'}
          onclick={() => (authTab = 'token')}
        >Personal access token</button>
      </div>

      {#if authTab === 'device'}
        <div class="gh-form" role="tabpanel">
          {#if !syncStore.deviceAuth}
            <label class="gh-label" for="gh-clientid">GitHub OAuth client ID</label>
            <input
              id="gh-clientid"
              type="text"
              class="gh-input"
              autocomplete="off"
              spellcheck="false"
              placeholder="Iv23li…"
              bind:value={clientIdInput}
              disabled={busy}
            />
            <p class="gh-hint">
              Create a GitHub <a class="gh-link" href="https://github.com/settings/apps/new" onclick={(e) => { e.preventDefault(); chordOpenUrl('https://github.com/settings/apps/new'); }}>OAuth App</a> with device flow enabled, then paste its client ID here. Void requests scope <code>{VOID_GITHUB_SCOPE}</code>.
            </p>
            <div class="gh-actions">
              <button
                type="button"
                class="gh-btn gh-btn-primary"
                onclick={beginDeviceAuth}
                disabled={busy || !clientIdInput.trim()}
              >
                {#if busy}<Loader2 size={14} class="gh-spin" />{:else}{@render ghIcon(14)}{/if}
                Start device authorization
              </button>
            </div>
          {:else}
            {@const session = syncStore.deviceAuth}
            {@const phase = syncStore.deviceAuthPhase}
            {@const expires = syncStore.deviceAuthExpiresInMs}
            <div class="gh-device">
              <div class="gh-device-step">
                <span class="gh-step-num">1</span>
                <div class="gh-device-copy">
                  <p class="gh-device-headline">Copy this code</p>
                  <div class="gh-code-row">
                    <span class="gh-code">{session.device.userCode}</span>
                    <button
                      type="button"
                      class="gh-btn gh-btn-ghost gh-btn-sm"
                      onclick={() => copyText(session.device.userCode, 'code')}
                      aria-label="Copy device code"
                    >
                      {#if codeCopied}<Check size={12} /> Copied{:else}<Copy size={12} /> Copy{/if}
                    </button>
                  </div>
                </div>
              </div>

              <div class="gh-device-step">
                <span class="gh-step-num">2</span>
                <div class="gh-device-copy">
                  <p class="gh-device-headline">Open GitHub and paste it in</p>
                  <button
                    type="button"
                    class="gh-btn gh-btn-primary"
                    onclick={openVerificationUrl}
                    disabled={phase === 'authorized'}
                  >
                    <ExternalLink size={13} /> Open {session.device.verificationUri.replace(/^https?:\/\//, '')}
                  </button>
                </div>
              </div>

              <div class="gh-device-step">
                <span class="gh-step-num">3</span>
                <div class="gh-device-copy">
                  <p class="gh-device-headline">
                    {#if phase === 'waiting'}<Loader2 size={12} class="gh-spin" /> Waiting for authorization…{/if}
                    {#if phase === 'authorized'}<Check size={12} /> Signed in. Configuring sync…{/if}
                    {#if phase === 'expired' || phase === 'denied' || phase === 'error'}
                      <AlertTriangle size={12} /> {syncStore.deviceAuthMessage ?? 'Sign-in failed'}
                    {/if}
                  </p>
                  {#if phase === 'waiting'}
                    <p class="gh-device-meta">
                      Code expires in <strong>{formatCountdown(expires)}</strong>. We'll detect the authorization automatically.
                    </p>
                  {/if}
                </div>
              </div>

              <div class="gh-actions">
                {#if phase === 'waiting'}
                  <button type="button" class="gh-btn gh-btn-ghost" onclick={() => syncStore.startDevicePolling()}>
                    <RefreshCw size={12} /> Check now
                  </button>
                {/if}
                <button type="button" class="gh-btn gh-btn-ghost" onclick={cancelDeviceFlow}>
                  <X size={12} /> Cancel
                </button>
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="gh-form" role="tabpanel">
          <label class="gh-label" for="gh-token">Personal access token (classic or fine-grained)</label>
          <div class="gh-input-row">
            <input
              id="gh-token"
              type={tokenRevealed ? 'text' : 'password'}
              class="gh-input"
              autocomplete="off"
              spellcheck="false"
              placeholder="ghp_… or github_pat_…"
              bind:value={tokenInput}
              disabled={busy}
            />
            <button
              type="button"
              class="gh-btn gh-btn-ghost gh-btn-sm"
              aria-pressed={tokenRevealed}
              aria-label={tokenRevealed ? 'Hide token' : 'Show token'}
              onclick={() => (tokenRevealed = !tokenRevealed)}
              disabled={!tokenInput}
            >{tokenRevealed ? 'Hide' : 'Show'}</button>
          </div>
          <p class="gh-hint">
            Needs the <code>repo</code> scope. Generate one at
            <a class="gh-link" href="https://github.com/settings/tokens/new?scopes=repo&description=Void%20notes%20sync" onclick={(e) => { e.preventDefault(); chordOpenUrl('https://github.com/settings/tokens/new?scopes=repo&description=Void%20notes%20sync'); }}>github.com/settings/tokens</a>.
          </p>
          <div class="gh-actions">
            <button
              type="button"
              class="gh-btn gh-btn-primary"
              onclick={connectWithToken}
              disabled={busy || !tokenInput.trim()}
            >
              {#if busy}<Loader2 size={14} class="gh-spin" />{:else}{@render ghIcon(14)}{/if}
              Connect
            </button>
          </div>
        </div>
      {/if}
    </div>

  {:else}
    <!-- ────── State 2 & 3: signed in ────── -->
    <div class="gh-account">
      <div class="gh-account-id">
        <User size={14} aria-hidden="true" />
        <span class="gh-account-login">@{user?.login ?? 'github'}</span>
        {#if user?.name}<span class="gh-account-name">· {user.name}</span>{/if}
        <span class="gh-account-mode">via {authMode === 'token' ? 'token' : 'device flow'}</span>
      </div>
      <button
        type="button"
        class="gh-btn gh-btn-ghost gh-btn-sm"
        onclick={signOut}
        disabled={busy}
      ><LogOut size={12} /> Sign out</button>
    </div>

    {#if !isAttached}
      <!-- State 2 -->
      <div class="gh-card">
        <div class="gh-card-intro">
          <h3 class="gh-card-title">Pick a repository</h3>
          <p class="gh-card-sub">Create a new private Void-ready repo, or attach an existing private repo that already has <code>.void/repo.json</code>.</p>
        </div>

        <div class="gh-tabs" role="tablist" aria-label="Repository">
          <button
            type="button"
            role="tab"
            aria-selected={repoTab === 'create'}
            class="gh-tab"
            class:gh-tab-active={repoTab === 'create'}
            onclick={() => (repoTab = 'create')}
          >Create new</button>
          <button
            type="button"
            role="tab"
            aria-selected={repoTab === 'attach'}
            class="gh-tab"
            class:gh-tab-active={repoTab === 'attach'}
            onclick={() => (repoTab = 'attach')}
          >Attach existing</button>
        </div>

        {#if repoTab === 'create'}
          <div class="gh-form" role="tabpanel">
            <div class="gh-grid">
              <div class="gh-field">
                <label class="gh-label" for="gh-newname">Repository name</label>
                <input
                  id="gh-newname"
                  type="text"
                  class="gh-input"
                  autocomplete="off"
                  spellcheck="false"
                  bind:value={newRepoName}
                  oninput={scheduleNameCheck}
                  onblur={checkNameAvailability}
                  disabled={busy}
                />
                <div class="gh-availability gh-availability-{newRepoNameStatus}">
                  {#if newRepoNameStatus === 'checking'}
                    <Loader2 size={11} class="gh-spin" /> Checking @{user?.login}/{newRepoName.trim()}
                  {:else if newRepoNameStatus === 'available'}
                    <Check size={11} /> Available as @{user?.login}/{newRepoName.trim()}
                  {:else if newRepoNameStatus === 'taken'}
                    <AlertTriangle size={11} /> {newRepoNameReason ?? 'Already in use'}
                  {:else if newRepoNameStatus === 'invalid'}
                    <AlertTriangle size={11} /> {newRepoNameReason}
                  {:else}
                    <span class="gh-availability-placeholder">Stored under @{user?.login}</span>
                  {/if}
                </div>
              </div>

              <div class="gh-field">
                <label class="gh-label" for="gh-newbranch">Default branch</label>
                <input
                  id="gh-newbranch"
                  type="text"
                  class="gh-input gh-input-narrow"
                  autocomplete="off"
                  bind:value={newRepoBranch}
                  disabled={busy}
                />
              </div>
            </div>

            <label class="gh-label" for="gh-newdesc">Description <span class="gh-label-opt">(optional)</span></label>
            <input
              id="gh-newdesc"
              type="text"
              class="gh-input"
              autocomplete="off"
              bind:value={newRepoDescription}
              disabled={busy}
            />

            <div class="gh-private-only">
              <Lock size={13} aria-hidden="true" />
              <span>Void sync creates private Void-ready repositories only.</span>
            </div>

            <div class="gh-actions">
              <button
                type="button"
                class="gh-btn gh-btn-primary"
                onclick={createRepo}
                disabled={busy || !newRepoName.trim() || newRepoNameStatus === 'taken' || newRepoNameStatus === 'invalid'}
              >
                {#if busy}<Loader2 size={14} class="gh-spin" />{:else}<UploadCloud size={14} />{/if}
                Create &amp; attach
              </button>
            </div>
          </div>
        {:else}
          <div class="gh-form" role="tabpanel">
            <div class="gh-segmented">
              <button
                type="button"
                class="gh-seg"
                class:gh-seg-active={attachMode === 'browse'}
                onclick={() => { attachMode = 'browse'; if (syncStore.remoteRepos.length === 0) void loadRepos(); }}
              >Browse my repositories</button>
              <button
                type="button"
                class="gh-seg"
                class:gh-seg-active={attachMode === 'url'}
                onclick={() => (attachMode = 'url')}
              >Paste URL</button>
            </div>

            {#if attachMode === 'browse'}
              <div class="gh-search">
                <Search size={13} aria-hidden="true" />
                <input
                  type="text"
                  class="gh-input gh-input-bare"
                  placeholder="Filter repositories…"
                  bind:value={repoFilter}
                  disabled={busy}
                />
                <button
                  type="button"
                  class="gh-btn gh-btn-ghost gh-btn-sm"
                  onclick={loadRepos}
                  disabled={busy}
                  aria-label="Refresh repositories"
                ><RefreshCw size={12} class={busy ? 'gh-spin' : ''} /></button>
              </div>

              {#if syncStore.remoteRepos.length === 0}
                <div class="gh-empty">
                  {#if busy}
                    <Loader2 size={14} class="gh-spin" /> Loading your repositories…
                  {:else}
                    No Void-ready private repositories loaded yet. <button type="button" class="gh-link" onclick={loadRepos}>Load now</button>.
                  {/if}
                </div>
              {:else}
                <ul class="gh-repo-list" role="listbox" aria-label="Your repositories">
                  {#each syncStore.remoteRepos.filter(repoMatchesFilter) as repo (repo.fullName)}
                    <li>
                      <button
                        type="button"
                        class="gh-repo-row"
                        class:gh-repo-row-active={selectedRepoFullName === repo.fullName}
                        onclick={() => selectRepoForAttach(repo)}
                        disabled={busy || !repo.permissionsPush}
                        title={!repo.permissionsPush ? 'You do not have push permission for this repository' : 'Void-ready repository'}
                      >
                        <span class="gh-repo-title">
                          {repo.fullName}
                          {#if repo.private}<Lock size={10} aria-label="private" />{/if}
                          <span class="gh-repo-badge">Void-ready</span>
                          {#if !repo.permissionsPush}<span class="gh-repo-badge">read-only</span>{/if}
                        </span>
                        {#if repo.description}
                          <span class="gh-repo-desc">{repo.description}</span>
                        {/if}
                        <span class="gh-repo-meta">
                          <span>default: {repo.defaultBranch}</span>
                          {#if repo.pushedAt}<span>· pushed {formatRelative(repo.pushedAt)}</span>{/if}
                        </span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}

              {#if selectedRepoFullName}
                <div class="gh-attach-detail">
                  <div class="gh-field">
                    <label class="gh-label" for="gh-attachbranch">Branch</label>
                    {#if syncStore.remoteBranches.length > 0}
                      <select
                        id="gh-attachbranch"
                        class="gh-input"
                        bind:value={attachBranch}
                        disabled={busy}
                      >
                        {#each syncStore.remoteBranches as branch (branch.name)}
                          <option value={branch.name}>
                            {branch.name}{branch.isDefault ? ' (default)' : ''}{branch.protected ? ' · protected' : ''}
                          </option>
                        {/each}
                      </select>
                    {:else if busy}
                      <div class="gh-loading"><Loader2 size={12} class="gh-spin" /> Loading branches…</div>
                    {:else}
                      <input
                        id="gh-attachbranch"
                        type="text"
                        class="gh-input"
                        autocomplete="off"
                        bind:value={attachBranch}
                        disabled={busy}
                      />
                    {/if}
                  </div>
                  <div class="gh-actions">
                    <button
                      type="button"
                      class="gh-btn gh-btn-primary"
                      onclick={attachRepo}
                      disabled={busy || !attachUrl.trim() || !attachBranch.trim()}
                    >
                      {#if busy}<Loader2 size={14} class="gh-spin" />{:else}<UploadCloud size={14} />{/if}
                      Attach {selectedRepoFullName}
                    </button>
                  </div>
                </div>
              {/if}
            {:else}
              <label class="gh-label" for="gh-attachurl">Remote URL</label>
              <input
                id="gh-attachurl"
                type="text"
                class="gh-input"
                autocomplete="off"
                spellcheck="false"
                placeholder="https://github.com/owner/repo.git"
                bind:value={attachUrl}
                disabled={busy}
              />
              <p class="gh-hint">HTTPS or SSH GitHub remotes only. The repo must be private, writable, and contain <code>.void/repo.json</code>.</p>

              <label class="gh-label" for="gh-attachurlbranch">Branch</label>
              <input
                id="gh-attachurlbranch"
                type="text"
                class="gh-input gh-input-narrow"
                autocomplete="off"
                bind:value={attachBranch}
                disabled={busy}
              />

              <div class="gh-actions">
                <button
                  type="button"
                  class="gh-btn gh-btn-primary"
                  onclick={attachRepo}
                  disabled={busy || !attachUrl.trim()}
                >
                  {#if busy}<Loader2 size={14} class="gh-spin" />{:else}<UploadCloud size={14} />{/if}
                  Attach
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

    {:else}
      <!-- State 3: connected -->
      {@const repo = boundSync?.repository}
      <div class="gh-card">
        <div class="gh-connected-head">
          <div class="gh-connected-id">
            {@render ghIcon(14)}
            <span class="gh-repo-fullname">{repo?.fullName}</span>
            {#if repo?.htmlUrl}
              <button type="button" class="gh-btn gh-btn-ghost gh-btn-sm" onclick={openRepo} aria-label="Open repo on GitHub">
                <ExternalLink size={11} />
              </button>
            {/if}
          </div>
          <div class="gh-connected-meta">
            <span>Last sync {formatRelative(status.lastSyncAt)}</span>
            <span class="gh-divider">·</span>
            <span>{status.changedFiles} changed · {status.ahead} ↑ · {status.behind} ↓</span>
          </div>
        </div>

        <div class="gh-branch-row">
          <label class="gh-label gh-label-inline" for="gh-branch-trigger">Branch</label>
          <div class="gh-branch-picker">
            <button
              id="gh-branch-trigger"
              type="button"
              class="gh-branch-trigger"
              aria-haspopup="listbox"
              aria-expanded={branchPickerOpen}
              onclick={() => (branchPickerOpen = !branchPickerOpen)}
              disabled={busy}
            >
              <GitBranch size={12} aria-hidden="true" />
              <span class="gh-branch-name">{status.branch ?? repo?.branch ?? 'main'}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>

            {#if branchPickerOpen}
              <div class="gh-branch-menu" role="listbox">
                {#if syncStore.localBranches.length === 0}
                  <div class="gh-branch-empty"><Loader2 size={11} class="gh-spin" /> Loading branches…</div>
                {:else}
                  <div class="gh-branch-section">Local</div>
                  {#each syncStore.localBranches as branch (branch.name)}
                    <button
                      type="button"
                      role="option"
                      aria-selected={branch.isCurrent}
                      class="gh-branch-item"
                      class:gh-branch-item-active={branch.isCurrent}
                      onclick={() => switchToBranch(branch)}
                    >
                      {#if branch.isCurrent}<Check size={11} />{:else}<Circle size={6} class="gh-circle-faint" />{/if}
                      <span class="gh-branch-item-name">{branch.name}</span>
                      {#if branch.upstream}<span class="gh-branch-item-meta">{branch.upstream}</span>{/if}
                    </button>
                  {/each}
                {/if}

                {#if repo && syncStore.remoteBranchesFor !== repo.fullName}
                  <button
                    type="button"
                    class="gh-branch-load"
                    onclick={() => syncStore.refreshRemoteBranches(repo.owner, repo.name)}
                    disabled={busy}
                  >
                    <RefreshCw size={11} class={busy ? 'gh-spin' : ''} /> Show remote branches
                  </button>
                {:else if syncStore.remoteBranches.length > 0}
                  <div class="gh-branch-section">Remote</div>
                  {#each syncStore.remoteBranches as branch (branch.name)}
                    {@const isLocal = syncStore.localBranches.some((b) => b.name === branch.name)}
                    {#if !isLocal}
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        class="gh-branch-item"
                        onclick={() => attachToRemoteBranch(branch)}
                      >
                        <Circle size={6} class="gh-circle-faint" />
                        <span class="gh-branch-item-name">{branch.name}</span>
                        {#if branch.isDefault}<span class="gh-branch-item-meta">default</span>{/if}
                      </button>
                    {/if}
                  {/each}
                {/if}

                <div class="gh-branch-create">
                  <input
                    type="text"
                    class="gh-input gh-input-bare gh-input-sm"
                    placeholder="new-branch-name"
                    autocomplete="off"
                    bind:value={newBranchName}
                    disabled={creatingBranch}
                  />
                  <button
                    type="button"
                    class="gh-btn gh-btn-primary gh-btn-sm"
                    onclick={createBranchAndAttach}
                    disabled={creatingBranch || !newBranchName.trim()}
                  >
                    {#if creatingBranch}<Loader2 size={11} class="gh-spin" />{:else}<Plus size={11} />{/if}
                    Create
                  </button>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="gh-action-row">
          <button
            type="button"
            class="gh-btn gh-btn-primary"
            onclick={syncNow}
            disabled={busy || (boundSync?.paused ?? false)}
          >
            {#if busy || status.operation !== 'idle'}<Loader2 size={13} class="gh-spin" />{:else}<UploadCloud size={13} />{/if}
            Sync now
          </button>
          <button type="button" class="gh-btn gh-btn-ghost" onclick={refreshStatus} disabled={busy}>
            <RefreshCw size={12} class={busy ? 'gh-spin' : ''} /> Refresh
          </button>
          <button type="button" class="gh-btn gh-btn-ghost" onclick={togglePaused} disabled={busy}>
            {#if boundSync?.paused}<Play size={12} /> Resume{:else}<Pause size={12} /> Pause{/if}
          </button>
          <span class="gh-flex-1"></span>
          <button type="button" class="gh-btn gh-btn-ghost gh-btn-danger" onclick={detach} disabled={busy}>
            <Unlink size={12} /> Detach
          </button>
        </div>

        <div class="gh-toggle-row">
          <button
            type="button"
            role="switch"
            aria-checked={boundSync?.autoSync ?? true}
            aria-label="Toggle gentle auto-sync"
            class="gh-toggle"
            class:gh-toggle-on={boundSync?.autoSync ?? true}
            onclick={() => setAutoSync(!(boundSync?.autoSync ?? true))}
            disabled={busy}
          >
            <span class="gh-knob" class:gh-knob-on={boundSync?.autoSync ?? true}></span>
          </button>
          <div class="gh-toggle-text">
            <span class="gh-toggle-title">Gentle auto-sync</span>
            <span class="gh-toggle-sub">Push and pull in the background when there's nothing else going on.</span>
          </div>
        </div>

        {#if status.message}
          <p class="gh-status-message">{status.message}</p>
        {/if}

        {#if syncStore.hasConflicts}
          <div class="gh-conflicts">
            <div class="gh-conflicts-head">
              <AlertTriangle size={13} />
              <span>{status.conflicts.length} conflict{status.conflicts.length === 1 ? '' : 's'} need review</span>
              <button type="button" class="gh-btn gh-btn-ghost gh-btn-sm" onclick={openConflictWorkspace}>
                Open workspace
              </button>
            </div>
            {#each status.conflicts as conflict (conflict.id)}
              <div class="gh-conflict" class:gh-conflict-active={activeConflict === conflict.id}>
                <button
                  type="button"
                  class="gh-conflict-summary"
                  onclick={() => (activeConflict = activeConflict === conflict.id ? null : conflict.id)}
                >
                  <ChevronDown size={11} class={activeConflict === conflict.id ? 'gh-chevron-open' : ''} />
                  <span class="gh-conflict-path">{conflict.path ?? 'Repository history'}</span>
                  <span class="gh-conflict-kind">{conflict.kind.replace('-', ' ')}</span>
                </button>
                {#if activeConflict === conflict.id}
                  <div class="gh-conflict-detail">
                    <p>{conflict.message}</p>
                    {#if conflict.localRef || conflict.remoteRef}
                      <p class="gh-conflict-refs">
                        {#if conflict.localRef}<code>local: {conflict.localRef}</code>{/if}
                        {#if conflict.remoteRef}<code>remote: {conflict.remoteRef}</code>{/if}
                      </p>
                    {/if}
                    <div class="gh-conflict-actions">
                      <button
                        type="button"
                        class="gh-btn gh-btn-ghost gh-btn-sm"
                        onclick={() => syncStore.resolveConflict(conflict.id, 'keep-local')}
                      >Keep local</button>
                      <button
                        type="button"
                        class="gh-btn gh-btn-ghost gh-btn-sm"
                        onclick={() => syncStore.resolveConflict(conflict.id, 'take-remote')}
                      >Take remote</button>
                      <button
                        type="button"
                        class="gh-btn gh-btn-ghost gh-btn-sm"
                        onclick={() => syncStore.resolveConflict(conflict.id, 'manual')}
                      >Resolve manually</button>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  /* ─── Section frame ─── */
  .gh-section { display: flex; flex-direction: column; gap: 10px; }
  .gh-section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-tertiary);
    font-size: var(--text-label);
    font-weight: var(--text-label-weight);
    text-transform: uppercase;
    letter-spacing: var(--text-label-tracking);
  }
  .gh-section-title { flex-shrink: 0; }
  .gh-status-pill {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
    color: var(--text-secondary);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.01em;
    text-transform: none;
  }
  .gh-status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--text-placeholder);
    flex-shrink: 0;
  }
  .gh-status-dot.ready { background: var(--color-success); }
  .gh-status-dot.syncing { background: var(--accent-primary); animation: gh-pulse 1.4s ease-in-out infinite; }
  .gh-status-dot.pending { background: var(--color-warning); }
  .gh-status-dot.auth-required { background: var(--color-warning); }
  .gh-status-dot.conflicted { background: var(--color-error); }
  .gh-status-dot.paused { background: var(--text-muted); }
  .gh-status-dot.error { background: var(--color-error); }
  .gh-status-dot.disabled { background: var(--text-placeholder); }

  @keyframes gh-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }

  /* ─── Card ─── */
  .gh-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-xs);
  }
  .gh-card-intro { display: flex; flex-direction: column; gap: 3px; }
  .gh-card-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.005em;
  }
  .gh-card-sub {
    margin: 0;
    font-size: 12px;
    color: var(--text-tertiary);
    line-height: 1.45;
  }

  /* ─── Tabs ─── */
  .gh-tabs {
    display: inline-flex;
    align-items: center;
    padding: 2px;
    background: var(--bg-subtle);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-faint);
    align-self: flex-start;
  }
  .gh-tab {
    padding: 4px 12px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .gh-tab:hover:not(.gh-tab-active) { color: var(--text-primary); }
  .gh-tab-active {
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .gh-segmented {
    display: inline-flex;
    align-items: stretch;
    align-self: flex-start;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .gh-seg {
    padding: 4px 10px;
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-card);
    border: none;
    cursor: pointer;
  }
  .gh-seg + .gh-seg { border-left: 1px solid var(--border-light); }
  .gh-seg:hover:not(.gh-seg-active) { background: var(--bg-hover); }
  .gh-seg-active { background: var(--accent-secondary); color: var(--accent-primary); }

  /* ─── Form ─── */
  .gh-form { display: flex; flex-direction: column; gap: 8px; }
  .gh-label {
    display: block;
    font-size: 11.5px;
    color: var(--text-secondary);
    font-weight: 500;
    margin-top: 4px;
  }
  .gh-label-opt { color: var(--text-tertiary); font-weight: 400; }
  .gh-label-inline { margin: 0; }
  .gh-grid {
    display: grid;
    grid-template-columns: 1fr 160px;
    gap: 10px;
  }
  .gh-field { display: flex; flex-direction: column; gap: 4px; }
  .gh-input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 9px;
    font-family: inherit;
    font-size: 13px;
    color: var(--text-primary);
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  .gh-input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .gh-input:disabled { opacity: 0.5; cursor: not-allowed; }
  .gh-input-narrow { max-width: 160px; }
  .gh-input-bare {
    border: none;
    background: transparent;
    padding: 4px 0;
    font-size: 12.5px;
    flex: 1;
  }
  .gh-input-bare:focus { box-shadow: none; }
  .gh-input-sm { font-size: 12px; padding: 4px 8px; }

  .gh-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .gh-availability {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    min-height: 15px;
  }
  .gh-availability-idle .gh-availability-placeholder { color: var(--text-tertiary); }
  .gh-availability-checking { color: var(--text-tertiary); }
  .gh-availability-available { color: var(--color-success); }
  .gh-availability-taken,
  .gh-availability-invalid { color: var(--color-error); }

  .gh-hint {
    margin: -2px 0 2px;
    font-size: 11.5px;
    color: var(--text-tertiary);
    line-height: 1.5;
  }
  .gh-hint code,
  .gh-conflict-refs code {
    font-family: var(--font-mono);
    font-size: 10.5px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-faint);
    border-radius: 3px;
    padding: 0 4px;
  }
  .gh-link {
    color: var(--accent-primary);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
  }
  .gh-link:hover { color: var(--accent-hover); }

  .gh-private-only {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    margin-top: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    background: var(--accent-light);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
  }

  /* ─── Buttons ─── */
  .gh-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .gh-action-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .gh-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
    line-height: 1;
  }
  .gh-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .gh-btn-sm { padding: 4px 8px; font-size: 11.5px; }
  .gh-btn-primary {
    background: var(--accent-primary);
    color: var(--text-inverse);
    box-shadow: 0 1px 2px rgba(20, 19, 16, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }
  .gh-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .gh-btn-ghost {
    background: var(--bg-card);
    border-color: var(--border-light);
    color: var(--text-secondary);
  }
  .gh-btn-ghost:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-medium);
    color: var(--text-primary);
  }
  .gh-btn-danger { color: var(--color-error); border-color: var(--border-light); }
  .gh-btn-danger:hover:not(:disabled) { background: var(--color-error-bg); border-color: var(--color-error-bg); color: var(--color-error); }

  /* ─── Device flow ─── */
  .gh-device { display: flex; flex-direction: column; gap: 12px; }
  .gh-device-step {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    background: var(--bg-subtle);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
  }
  .gh-step-num {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent-primary);
    color: var(--text-inverse);
    font-size: 10.5px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
  }
  .gh-device-copy { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
  .gh-device-headline {
    margin: 0;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .gh-device-meta {
    margin: 0;
    font-size: 11.5px;
    color: var(--text-tertiary);
  }
  .gh-code-row { display: flex; align-items: center; gap: 8px; }
  .gh-code {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.12em;
    padding: 4px 12px;
    color: var(--text-primary);
    background: var(--bg-card);
    border: 1px dashed var(--border-medium);
    border-radius: var(--radius-sm);
    user-select: all;
  }

  /* ─── Account ─── */
  .gh-account {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-md);
  }
  .gh-account-id {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 12.5px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .gh-account-login { font-weight: 600; color: var(--text-primary); }
  .gh-account-name { color: var(--text-tertiary); font-weight: 400; }
  .gh-account-mode {
    margin-left: 4px;
    padding: 1px 6px;
    font-size: 10.5px;
    color: var(--text-tertiary);
    background: var(--bg-subtle);
    border-radius: 3px;
  }

  /* ─── Repo browser ─── */
  .gh-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .gh-search:focus-within { border-color: var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-soft); }

  .gh-empty {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px;
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
    justify-content: center;
    background: var(--bg-subtle);
    border-radius: var(--radius-sm);
    border: 1px dashed var(--border-light);
  }

  .gh-repo-list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
  }
  .gh-repo-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid var(--border-faint);
    transition: background var(--transition-fast);
  }
  .gh-repo-row:last-child { border-bottom: none; }
  .gh-repo-row:hover:not(:disabled) { background: var(--bg-hover); }
  .gh-repo-row:disabled { opacity: 0.5; cursor: not-allowed; }
  .gh-repo-row-active { background: var(--accent-secondary); }
  .gh-repo-row-active:hover { background: var(--accent-secondary); }
  .gh-repo-title {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .gh-repo-desc {
    font-size: 11.5px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gh-repo-meta {
    display: flex;
    gap: 5px;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .gh-repo-badge {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-warning);
    background: var(--color-warning-bg);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .gh-attach-detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border-faint);
  }

  .gh-loading {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  /* ─── Connected state ─── */
  .gh-connected-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .gh-connected-id {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .gh-repo-fullname {
    font-family: var(--font-mono);
    font-size: 12.5px;
    letter-spacing: 0.005em;
  }
  .gh-connected-meta {
    display: flex;
    gap: 4px;
    font-size: 11.5px;
    color: var(--text-tertiary);
  }
  .gh-divider { color: var(--text-placeholder); }

  /* ─── Branch picker ─── */
  .gh-branch-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .gh-branch-picker { position: relative; flex: 1; min-width: 0; }
  .gh-branch-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 9px;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .gh-branch-trigger:hover:not(:disabled) { background: var(--bg-hover); }
  .gh-branch-trigger:disabled { opacity: 0.5; }
  .gh-branch-name { flex: 1; text-align: left; }
  .gh-branch-menu {
    position: absolute;
    z-index: var(--z-dropdown);
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popover);
    padding: 4px 0;
    max-height: 320px;
    overflow-y: auto;
  }
  .gh-branch-section {
    padding: 6px 10px 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
  }
  .gh-branch-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    font-family: inherit;
    font-size: 12px;
    color: var(--text-primary);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .gh-branch-item:hover { background: var(--bg-hover); }
  .gh-branch-item-active { color: var(--accent-primary); }
  .gh-branch-item-name { flex: 1; }
  .gh-branch-item-meta {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-tertiary);
  }
  .gh-branch-empty {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    font-size: 11.5px;
    color: var(--text-tertiary);
  }
  .gh-branch-load {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-top: 1px solid var(--border-faint);
    font-family: inherit;
    font-size: 11.5px;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
  }
  .gh-branch-load:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .gh-branch-create {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--border-faint);
    background: var(--bg-subtle);
  }

  /* ─── Toggle row ─── */
  .gh-toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding-top: 4px;
    border-top: 1px dashed var(--border-faint);
  }
  .gh-toggle {
    position: relative;
    width: 32px;
    height: 18px;
    border-radius: 999px;
    background: var(--border-medium);
    border: none;
    cursor: pointer;
    transition: background var(--transition-fast);
    flex-shrink: 0;
    margin-top: 1px;
  }
  .gh-toggle-on { background: var(--accent-primary); }
  .gh-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    background: white;
    border-radius: 50%;
    transition: transform var(--transition-fast);
  }
  .gh-knob-on { transform: translateX(14px); }
  .gh-toggle-text { display: flex; flex-direction: column; gap: 1px; }
  .gh-toggle-title { font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
  .gh-toggle-sub { font-size: 11px; color: var(--text-tertiary); }

  /* ─── Status message + conflicts ─── */
  .gh-status-message {
    margin: 0;
    padding: 6px 10px;
    background: var(--bg-subtle);
    border-radius: var(--radius-sm);
    font-size: 11.5px;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .gh-conflicts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--color-warning-bg);
    border: 1px solid var(--color-warning-bg);
    border-radius: var(--radius-sm);
  }
  .gh-conflicts-head {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-warning);
  }
  .gh-conflict {
    background: var(--bg-card);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .gh-conflict-active { border-color: var(--color-warning); }
  .gh-conflict-summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .gh-conflict-path {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text-primary);
  }
  .gh-conflict-kind {
    font-size: 10.5px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .gh-chevron-open { transform: rotate(180deg); }
  .gh-conflict-detail {
    padding: 6px 10px 10px;
    border-top: 1px solid var(--border-faint);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gh-conflict-detail p {
    margin: 0;
    font-size: 11.5px;
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .gh-conflict-refs { display: flex; gap: 6px; flex-wrap: wrap; }
  .gh-conflict-actions { display: flex; gap: 4px; flex-wrap: wrap; }

  .gh-flex-1 { flex: 1; }
  :global(.gh-spin) { animation: gh-spin 1s linear infinite; }
  :global(.gh-circle-faint) { color: var(--text-placeholder); }
  @keyframes gh-spin {
    to { transform: rotate(360deg); }
  }
</style>
