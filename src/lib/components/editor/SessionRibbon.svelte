<script lang="ts">
  import {
    Bot,
    ChevronDown,
    Combine,
    ExternalLink,
    Layers,
    Link2,
    Microscope,
    Spool,
    Sparkles,
    Telescope,
    UserPlus,
    Users,
    X,
  } from '@lucide/svelte';
  import { sessionsStore, notesStore, uiStore, commandCenterStore } from '$lib/stores';
  import { events } from '$lib/events';
  import type { Session, SessionKind } from '$lib/domain/entities/Session';

  interface Props {
    notePath: string;
  }

  let { notePath }: Props = $props();

  $effect(() => {
    void sessionsStore.fetchFor(notePath);
  });

  const MAX_VISIBLE = 2;

  let sessions = $derived(sessionsStore.sessions);
  let visibleSessions = $derived(sessions.slice(0, MAX_VISIBLE));
  let overflowCount = $derived(Math.max(0, sessions.length - MAX_VISIBLE));
  let expandedId = $derived(sessionsStore.expandedSessionId);
  let expandedSession = $derived(sessions.find((s) => s.id === expandedId) ?? null);
  let showAllList = $state(false);

  function iconFor(kind: SessionKind) {
    switch (kind) {
      case 'thread': return Spool;
      case 'synthesize': return Combine;
      case 'bridge': return Link2;
      case 'extract': return Layers;
      case 'deep-research': return Telescope;
      case 'swarm': return Microscope;
      case 'manual': return UserPlus;
      default: return Sparkles;
    }
  }

  function labelFor(kind: SessionKind): string {
    return kind === 'deep-research' ? 'Research' : kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  function relativeTime(iso: string): string {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return '';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
  }

  function toggleChip(session: Session) {
    if (showAllList) showAllList = false;
    sessionsStore.toggleExpanded(session.id);
  }

  function toggleAll() {
    if (showAllList) {
      showAllList = false;
      sessionsStore.toggleExpanded(null);
    } else {
      sessionsStore.toggleExpanded(null);
      showAllList = true;
    }
  }

  function closeExpander() {
    showAllList = false;
    sessionsStore.toggleExpanded(null);
  }

  function navigateToPeer(path: string) {
    if (path === notePath) return;
    notesStore.selectNote(path);
    events.emit('app:navigate', { view: 'note', path });
  }

  function openRun(session: Session) {
    if (!session.agentRunId) return;
    uiStore.openAISidebar();
    commandCenterStore.selectRun(session.agentRunId);
  }

  async function removeFromSession(session: Session) {
    await sessionsStore.removeNoteFromSession(session.id, notePath);
  }

  function peerLabel(path: string): string {
    const tail = path.split('/').at(-1) ?? path;
    return tail.replace(/\.md$/, '');
  }

  function roleLabel(role: string): string {
    return role === 'derived' ? 'output' : role;
  }
</script>

{#if sessions.length > 0}
  <div class="session-ribbon" aria-label="Session memberships">
    <div class="ribbon-chips">
      {#each visibleSessions as session (session.id)}
        {@const Icon = iconFor(session.kind)}
        <button
          type="button"
          class="session-chip"
          class:active={expandedId === session.id && !showAllList}
          data-source={session.createdBy}
          onclick={() => toggleChip(session)}
          title={session.title}
        >
          <span class="chip-icon" aria-hidden="true">
            <Icon size={12} strokeWidth={2} />
          </span>
          <span class="chip-label">{labelFor(session.kind)}</span>
          <span class="chip-title">{session.title}</span>
          <span class="chip-meta">{session.members.length}</span>
          <span class="chip-time">{relativeTime(session.updatedAt)}</span>
        </button>
      {/each}

      {#if overflowCount > 0}
        <button
          type="button"
          class="session-chip overflow-chip"
          class:active={showAllList}
          onclick={toggleAll}
        >
          <Users size={12} strokeWidth={2} aria-hidden="true" />
          <span>+{overflowCount} more</span>
          <span class="chip-chevron" aria-hidden="true">
            <ChevronDown size={11} strokeWidth={2} />
          </span>
        </button>
      {/if}
    </div>

    {#if showAllList}
      <div class="ribbon-expander" role="region" aria-label="All sessions">
        <div class="expander-head">
          <strong>{sessions.length} session{sessions.length === 1 ? '' : 's'}</strong>
          <button type="button" class="expander-close" onclick={closeExpander} aria-label="Close">
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div class="all-sessions-list">
          {#each sessions as session (session.id)}
            {@const Icon = iconFor(session.kind)}
            <button
              type="button"
              class="all-session-row"
              onclick={() => {
                showAllList = false;
                sessionsStore.toggleExpanded(session.id);
              }}
            >
              <span class="all-session-icon" aria-hidden="true">
                <Icon size={13} strokeWidth={1.9} />
              </span>
              <div class="all-session-text">
                <strong>{session.title}</strong>
                <span>{labelFor(session.kind)} · {session.members.length} note{session.members.length === 1 ? '' : 's'} · {relativeTime(session.updatedAt)}</span>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {:else if expandedSession}
      <div class="ribbon-expander" role="region" aria-label={`Session ${expandedSession.title}`}>
        <div class="expander-head">
          <strong>{expandedSession.title}</strong>
          <span class="expander-meta">
            <span>{labelFor(expandedSession.kind)}</span>
            <span class="dot" aria-hidden="true">·</span>
            <span>{expandedSession.createdBy === 'ai-agent' ? 'AI-created' : expandedSession.createdBy}</span>
            <span class="dot" aria-hidden="true">·</span>
            <span>{relativeTime(expandedSession.createdAt)} ago</span>
            <span class="dot" aria-hidden="true">·</span>
            <span data-status={expandedSession.status}>{expandedSession.status}</span>
          </span>
          <button type="button" class="expander-close" onclick={closeExpander} aria-label="Close session detail">
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div class="peer-list" aria-label={`${expandedSession.members.length} peer notes`}>
          <span class="peer-list-label">Peer notes ({expandedSession.members.length})</span>
          {#each expandedSession.members as member (member.notePath)}
            <button
              type="button"
              class="peer-row"
              class:self={member.notePath === notePath}
              onclick={() => navigateToPeer(member.notePath)}
              disabled={member.notePath === notePath}
            >
              <span class="peer-title">{peerLabel(member.notePath)}</span>
              <span class="peer-role">{roleLabel(member.role)}</span>
              {#if member.notePath === notePath}
                <span class="peer-self-tag">this note</span>
              {/if}
            </button>
          {/each}
        </div>

        <div class="expander-actions">
          {#if expandedSession.agentRunId}
            <button type="button" class="action-link" onclick={() => openRun(expandedSession)}>
              <Bot size={12} strokeWidth={1.9} aria-hidden="true" />
              <span>Open AI run</span>
              <ExternalLink size={11} strokeWidth={1.9} aria-hidden="true" />
            </button>
          {/if}
          <button type="button" class="action-link danger" onclick={() => removeFromSession(expandedSession)}>
            <X size={12} strokeWidth={1.9} aria-hidden="true" />
            <span>Remove this note from session</span>
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .session-ribbon {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
    animation: ribbon-fade-in 280ms var(--ease-out, ease-out);
  }

  @keyframes ribbon-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .ribbon-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .session-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 12px 0 9px;
    border: 1px solid var(--border-light);
    border-left: 3px solid var(--accent-muted, var(--border-medium));
    border-radius: var(--radius-full);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .session-chip[data-source='ai-agent'] {
    border-left-color: var(--ai-accent);
  }

  .session-chip[data-source='ai-agent'] .chip-icon {
    color: var(--ai-accent);
  }

  .session-chip:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .session-chip.active {
    border-color: var(--ai-accent);
    background: color-mix(in srgb, var(--ai-tint, var(--bg-card)) 70%, var(--bg-card));
    color: var(--text-primary);
  }

  .chip-icon {
    display: inline-flex;
    color: var(--text-muted);
  }

  .chip-label {
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking, 0.02em);
    text-transform: uppercase;
  }

  .chip-title {
    overflow: hidden;
    max-width: 280px;
    color: var(--text-primary);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-meta,
  .chip-time {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
  }

  .overflow-chip {
    border-left-width: 1px;
    border-left-style: solid;
    border-left-color: var(--border-light);
  }

  .chip-chevron {
    display: inline-flex;
    color: var(--text-muted);
  }

  .ribbon-expander {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    animation: ribbon-fade-in 280ms var(--ease-out, ease-out);
  }

  .expander-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
  }

  .expander-head strong {
    grid-column: 1 / 2;
    overflow: hidden;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .expander-meta {
    grid-column: 1 / 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 10.5px;
    text-transform: capitalize;
  }

  .expander-meta .dot {
    color: var(--text-muted);
  }

  .expander-meta span[data-status='active'] {
    color: var(--ai-accent);
    font-weight: 600;
  }

  .expander-meta span[data-status='completed'] {
    color: var(--color-success);
    font-weight: 600;
  }

  .expander-close {
    grid-column: 2 / 3;
    grid-row: 1 / span 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .expander-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .peer-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .peer-list-label {
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking, 0.02em);
    text-transform: uppercase;
  }

  .peer-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .peer-row:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .peer-row:disabled {
    cursor: default;
  }

  .peer-row.self {
    color: var(--text-primary);
    font-weight: 600;
  }

  .peer-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .peer-role {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    text-transform: lowercase;
  }

  .peer-self-tag {
    color: var(--text-muted);
    font-size: 10px;
    font-style: italic;
  }

  .expander-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-faint);
  }

  .action-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .action-link:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .action-link.danger:hover {
    border-color: color-mix(in srgb, var(--color-error) 38%, var(--border-light));
    color: var(--color-error);
  }

  .all-sessions-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .all-session-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .all-session-row:hover {
    background: var(--bg-hover);
  }

  .all-session-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .all-session-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .all-session-text strong {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .all-session-text span {
    color: var(--text-muted);
    font-size: 10.5px;
  }
</style>
