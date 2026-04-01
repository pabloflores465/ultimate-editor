<script lang="ts">
  import type { WorkspaceState } from "../stores/workspaceStore.svelte";

  let {
    ws,
    active,
    canDelete,
    onclick,
    ondelete,
  }: {
    ws: WorkspaceState;
    active: boolean;
    canDelete: boolean;
    onclick: () => void;
    ondelete: () => void;
  } = $props();
</script>

<div
  class="ws-card"
  class:ws-card--active={active}
  role="button"
  tabindex="0"
  {onclick}
  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onclick(); }}}
>
  <!-- Delete button (shown on hover, only if not the last workspace) -->
  {#if canDelete}
    <button
      class="ws-card-delete"
      title="Close workspace"
      onclick={(e) => { e.stopPropagation(); ondelete(); }}
    >
      <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">
        <line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>
      </svg>
    </button>
  {/if}

  <!-- Miniature IDE preview -->
  <div class="ws-card-preview">
    <!-- Title bar -->
    <div class="ws-card-titlebar">
      <span class="ws-card-dot" style="background:#ff5f57"></span>
      <span class="ws-card-dot" style="background:#ffbd2e"></span>
      <span class="ws-card-dot" style="background:#28c840"></span>
    </div>
    <!-- Toolbar strip -->
    <div class="ws-card-toolbar"></div>
    <!-- Body: sidebar + editor -->
    <div class="ws-card-body">
      {#if ws.leftPanelOpen}
        <div class="ws-card-sidebar">
          {#each {length: 8} as _}
            <div class="ws-card-sidebar-line"></div>
          {/each}
        </div>
      {/if}
      <div class="ws-card-editor">
        {#each {length: 8} as _}
          <div class="ws-card-line"></div>
        {/each}
      </div>
    </div>
    <!-- Bottom panel -->
    {#if ws.bottomPanelOpen}
      <div class="ws-card-bottom-bar"></div>
    {/if}
    <!-- Status bar -->
    <div class="ws-card-statusbar"></div>
  </div>

  <!-- Label -->
  <div class="ws-card-label">
    <span class="ws-card-label-name">{ws.name}</span>
    <span class="ws-card-label-route">{ws.activeRoute === "/" ? "index.svelte" : ws.activeRoute.replace("/","") + ".svelte"}</span>
  </div>
</div>
