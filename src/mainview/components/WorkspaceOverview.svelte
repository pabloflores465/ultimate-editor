<script lang="ts">
  import { workspaceStore } from "../stores/workspaceStore.svelte";
  import WorkspaceCard from "./WorkspaceCard.svelte";

  let searchQuery = $state("");
  let searchInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (searchInput) searchInput.focus();
  });

  const filteredWorkspaces = $derived(
    searchQuery.trim() === ""
      ? workspaceStore.workspaces.map((ws, i) => ({ ws, i }))
      : workspaceStore.workspaces
          .map((ws, i) => ({ ws, i }))
          .filter(({ ws }) => ws.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Custom Svelte transition using Material Decelerate easing
  // cubic-bezier(0, 0, 0.2, 1) ≈ t^(1/3) approximation
  function overviewTransition(node: Element, { duration = 220 } = {}) {
    return {
      duration,
      css: (t: number) => {
        // ease-out cubic: maps t with cubic-bezier(0, 0, 0.2, 1) feel
        const eased = 1 - Math.pow(1 - t, 3);
        return `
          opacity: ${eased};
          transform: scale(${0.97 + eased * 0.03});
        `;
      },
    };
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) workspaceStore.toggleOverview();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (searchQuery) {
        searchQuery = "";
      } else {
        workspaceStore.toggleOverview();
      }
    }
  }
</script>

<!-- Full-screen overview overlay -->
<div
  class="ws-overview-backdrop"
  role="dialog"
  aria-label="Workspace Overview"
  aria-modal="true"
  tabindex="-1"
  transition:overviewTransition
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <!-- Header -->
  <div class="ws-overview-header">
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="opacity:0.7">
      <rect x="1" y="1" width="6" height="6" rx="1"/>
      <rect x="9" y="1" width="6" height="6" rx="1" opacity="0.5"/>
      <rect x="1" y="9" width="6" height="6" rx="1" opacity="0.5"/>
      <rect x="9" y="9" width="6" height="6" rx="1" opacity="0.5"/>
    </svg>
    <span>Workspaces</span>
    <span style="font-size:11px; opacity:0.45; font-weight:400;">
      Ctrl+Alt+← → to switch · Ctrl+Shift+` to toggle · Ctrl+Alt+N to add
    </span>
  </div>

  <!-- Search bar -->
  <div class="ws-overview-search">
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="#c0c0c0" stroke-width="1.5" style="flex-shrink:0;">
      <circle cx="6.5" cy="6.5" r="5"/>
      <path d="M10.5 10.5L14 14"/>
    </svg>
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      type="text"
      placeholder="Filter workspaces…"
      class="ws-overview-search-input"
      onclick={(e) => e.stopPropagation()}
    />
    {#if searchQuery}
      <button class="ws-overview-search-clear" onclick={(e) => { e.stopPropagation(); searchQuery = ""; searchInput?.focus(); }}>✕</button>
    {/if}
  </div>

  <!-- Card grid -->
  <div class="ws-overview-grid">
    {#each filteredWorkspaces as { ws, i } (ws.id)}
      <WorkspaceCard
        {ws}
        active={i === workspaceStore.activeIndex}
        canDelete={workspaceStore.workspaces.length > 1}
        onclick={() => workspaceStore.switchTo(i)}
        ondelete={() => workspaceStore.removeWorkspace(ws.id)}
      />
    {/each}
    {#if filteredWorkspaces.length === 0}
      <p style="color: rgba(255,255,255,0.35); font-size:13px; grid-column:1/-1; text-align:center; margin:0;">No workspaces match "{searchQuery}"</p>
    {/if}

    <!-- Add new workspace button -->
    <button
      class="ws-add-card"
      onclick={() => workspaceStore.addWorkspace()}
      title="New Workspace (Ctrl+Alt+N)"
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v8M8 12h8"/>
      </svg>
      <span style="font-size:12px;">New Workspace</span>
    </button>
  </div>
</div>
