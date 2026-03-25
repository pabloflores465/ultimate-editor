<script lang="ts">
  import { workspaceStore } from "../stores/workspaceStore.svelte";
  import WorkspaceCard from "./WorkspaceCard.svelte";

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
  onkeydown={(e) => { if (e.key === "Escape") workspaceStore.toggleOverview(); }}
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

  <!-- Card grid -->
  <div class="ws-overview-grid">
    {#each workspaceStore.workspaces as ws, i (ws.id)}
      <WorkspaceCard
        {ws}
        active={i === workspaceStore.activeIndex}
        canDelete={workspaceStore.workspaces.length > 1}
        onclick={() => workspaceStore.switchTo(i)}
        ondelete={() => workspaceStore.removeWorkspace(ws.id)}
      />
    {/each}

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
