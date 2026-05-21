<script lang="ts">
  /**
   * Breadcrumbs Component
   *
   * Displays the full path hierarchy from the selected note path.
   * Parent segments are clickable to navigate to parent folders.
   * Long paths are truncated with ellipsis in the middle.
   */

  interface Props {
    /** The full path of the current note (e.g., "folder/subfolder/note.md") */
    path: string;
    /** The title of the current note */
    title: string;
    /** Callback when a parent segment is clicked */
    onNavigate?: (folderPath: string) => void;
    /** Maximum visible segments before truncating (default: 3) */
    maxSegments?: number;
  }

  let { path, title, onNavigate, maxSegments = 3 }: Props = $props();

  /**
   * Parse the path into segments for display.
   * Returns an array of { label, path, isClickable } objects.
   */
  let segments = $derived.by(() => {
    // Split path into parts, remove the filename
    const parts = path.split('/').filter(Boolean);

    // Remove the last part (the file itself) since we display title separately
    const folderParts = parts.slice(0, -1);

    // Build segments with cumulative paths
    const result: Array<{ label: string; path: string; isClickable: boolean }> = [];

    // Add "Workspace" as the root
    result.push({
      label: 'Workspace',
      path: '',
      isClickable: folderParts.length > 0,
    });

    // Add folder segments
    let cumulativePath = '';
    for (const part of folderParts) {
      cumulativePath = cumulativePath ? `${cumulativePath}/${part}` : part;
      result.push({
        label: part,
        path: cumulativePath,
        isClickable: true, // All folder segments are clickable
      });
    }

    return result;
  });

  /** Segment type for type safety */
  type Segment = { label: string; path: string; isClickable: boolean };

  /**
   * Get displayable segments with truncation if needed.
   */
  let displaySegments = $derived.by((): { before: Segment[]; truncated: boolean; after: Segment[] } => {
    if (segments.length <= maxSegments) {
      return { before: segments, truncated: false, after: [] };
    }

    // Keep first segment (Workspace) and last (maxSegments - 2) segments
    // Show ellipsis for the middle
    const firstSegment = segments[0];
    const before: Segment[] = firstSegment ? [firstSegment] : [];
    const after: Segment[] = segments.slice(-(maxSegments - 1));

    return { before, truncated: true, after };
  });

  function handleSegmentClick(segmentPath: string) {
    onNavigate?.(segmentPath);
  }
</script>

<nav class="breadcrumbs" aria-label="Breadcrumb">
  <!-- Before truncation -->
  {#each displaySegments.before as segment, index}
    {#if segment.isClickable}
      <button
        type="button"
        class="breadcrumb-segment"
        onclick={() => handleSegmentClick(segment.path)}
      >
        {segment.label}
      </button>
    {:else}
      <span class="breadcrumb-segment-static">
        {segment.label}
      </span>
    {/if}

    <span class="breadcrumb-separator">/</span>
  {/each}

  <!-- Truncation indicator -->
  {#if displaySegments.truncated}
    <span class="breadcrumb-ellipsis" title="Path truncated">...</span>
    <span class="breadcrumb-separator">/</span>

    {#each displaySegments.after as segment, index}
      {#if segment.isClickable}
        <button
          type="button"
          class="breadcrumb-segment"
          onclick={() => handleSegmentClick(segment.path)}
        >
          {segment.label}
        </button>
      {:else}
        <span class="breadcrumb-segment-static">
          {segment.label}
        </span>
      {/if}

      <span class="breadcrumb-separator">/</span>
    {/each}
  {/if}

  <!-- Current note title (always visible, not clickable) -->
  <span class="breadcrumb-current">
    {title}
  </span>
</nav>

<style>
  /* ─── Breadcrumbs ─── refined, restrained */
  .breadcrumbs {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-caption);
    color: var(--text-tertiary);
    letter-spacing: -0.003em;
    margin-left: 4px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    flex-wrap: nowrap;
  }

  .breadcrumb-segment {
    color: var(--text-tertiary);
    background: none;
    border: none;
    padding: 2px 5px;
    margin: 0 -3px;
    cursor: pointer;
    border-radius: var(--radius-xs);
    font: inherit;
    transition: background var(--transition-fast), color var(--transition-fast);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .breadcrumb-segment:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .breadcrumb-segment:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .breadcrumb-segment-static {
    color: var(--text-tertiary);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 2px;
  }

  .breadcrumb-separator {
    color: var(--text-placeholder);
    user-select: none;
    font-size: 11px;
    margin: 0 1px;
  }

  .breadcrumb-ellipsis {
    color: var(--text-muted);
    user-select: none;
    cursor: default;
  }

  .breadcrumb-current {
    color: var(--text-primary);
    font-weight: 500;
    min-width: 0;
    flex-shrink: 1;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }

  /* Tablet: shrink parent segments to keep the current title legible. */
  @media (max-width: 879px) {
    .breadcrumb-segment,
    .breadcrumb-segment-static {
      max-width: 90px;
    }

    .breadcrumb-current {
      max-width: 200px;
    }
  }

  /* Phone: collapse parent context — only show current note title. */
  @media (max-width: 479px) {
    .breadcrumb-segment,
    .breadcrumb-segment-static,
    .breadcrumb-separator,
    .breadcrumb-ellipsis {
      display: none;
    }

    .breadcrumb-current {
      max-width: 60vw;
    }
  }
</style>
