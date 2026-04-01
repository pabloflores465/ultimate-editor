<script lang="ts">
  import { workspaceStore } from "../stores/workspaceStore.svelte";

  // ── Drag state ───────────────────────────────────────────────
  let dragIdx    = $state<number | null>(null);
  let dragOverIdx = $state<number | null>(null);

  function onDragStart(e: DragEvent, idx: number) {
    dragIdx = idx;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", String(idx));
    // Signal WorkspaceSwitcher to show tiling drop zones
    workspaceStore.tilingDragWsIdx = idx;
  }

  function onDragOver(e: DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    dragOverIdx = idx;
  }

  function onDrop(e: DragEvent, toIdx: number) {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== toIdx) {
      workspaceStore.reorderWorkspace(dragIdx, toIdx);
    }
    dragIdx = null;
    dragOverIdx = null;
    workspaceStore.tilingDragWsIdx = null;
  }

  function onDragEnd() {
    dragIdx = null;
    dragOverIdx = null;
    // Clear only if placeTiledWorkspace hasn't already done so
    workspaceStore.tilingDragWsIdx = null;
  }

  // ── Double-click to rename ───────────────────────────────────
  let editingId = $state<string | null>(null);
  let editValue = $state("");

  function startRename(id: string, name: string, e: MouseEvent) {
    e.stopPropagation();
    editingId = id;
    editValue = name;
  }

  function commitRename(id: string) {
    if (editValue.trim()) workspaceStore.renameWorkspace(id, editValue.trim());
    editingId = null;
  }

  function onRenameKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter") commitRename(id);
    else if (e.key === "Escape") editingId = null;
    e.stopPropagation();
  }

  function closeTab(id: string, e: MouseEvent) {
    e.stopPropagation();
    workspaceStore.removeWorkspace(id);
  }
</script>

<div class="tab-bar">
  <!-- macOS traffic-light spacer: -webkit-app-region:drag fills this area,
       the OS overlays the close/minimise/maximise buttons here. -->
  <div class="traffic-light-spacer"></div>

  <button
    class="tab-add"
    onclick={() => workspaceStore.addWorkspace()}
    title="New workspace (Ctrl+Alt+N)"
    aria-label="Add workspace"
  >+</button>

  <div class="tabs">
    {#each workspaceStore.workspaces as ws, i (ws.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tab"
        class:tab--active={i === workspaceStore.activeIndex}
        class:tab--drag-over={dragOverIdx === i && dragIdx !== i}
        class:tab--dragging={dragIdx === i}
        draggable="true"
        onclick={() => workspaceStore.switchTo(i)}
        ondblclick={(e) => startRename(ws.id, ws.name, e)}
        ondragstart={(e) => onDragStart(e, i)}
        ondragover={(e) => onDragOver(e, i)}
        ondrop={(e) => onDrop(e, i)}
        ondragend={onDragEnd}
        role="tab"
        tabindex="0"
        aria-selected={i === workspaceStore.activeIndex}
        onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") workspaceStore.switchTo(i); }}
      >
        {#if editingId === ws.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="tab-rename"
            bind:value={editValue}
            onblur={() => commitRename(ws.id)}
            onkeydown={(e) => onRenameKey(e, ws.id)}
            autofocus
            onclick={(e) => e.stopPropagation()}
          />
        {:else}
          <span class="tab-name">{ws.name}</span>
          {#if ws.openTabs.some(t => t.modified)}
            <span class="tab-dot" title="Unsaved changes"></span>
          {/if}
          {#if workspaceStore.workspaces.length > 1}
            <button
              class="tab-close"
              onclick={(e) => closeTab(ws.id, e)}
              tabindex="-1"
              aria-label="Close workspace"
            >×</button>
          {/if}
        {/if}
      </div>
    {/each}
  </div>

  <!-- Tiling layout buttons -->
  <div class="tiling-btns">
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'single'}
      title="Single workspace"
      onclick={() => workspaceStore.setTilingLayout("single")}
    >
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="1" y="1" width="12" height="12" rx="1"/>
      </svg>
    </button>
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'vsplit'}
      title="Two workspaces side by side"
      onclick={() => workspaceStore.setTilingLayout("vsplit")}
    >
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="1" y="1" width="5" height="12" rx="1"/>
        <rect x="8" y="1" width="5" height="12" rx="1"/>
      </svg>
    </button>
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'hsplit'}
      title="Two workspaces stacked"
      onclick={() => workspaceStore.setTilingLayout("hsplit")}
    >
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="1" y="1" width="12" height="5" rx="1"/>
        <rect x="1" y="8" width="12" height="5" rx="1"/>
      </svg>
    </button>
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'quarter'}
      title="Four workspaces (2×2)"
      onclick={() => workspaceStore.setTilingLayout("quarter")}
    >
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="1" y="1" width="5" height="5" rx="0.8"/>
        <rect x="8" y="1" width="5" height="5" rx="0.8"/>
        <rect x="1" y="8" width="5" height="5" rx="0.8"/>
        <rect x="8" y="8" width="5" height="5" rx="0.8"/>
      </svg>
    </button>
  </div>

  <!-- Workspace overview button -->
  <button
    class="tab-ws"
    onclick={() => workspaceStore.toggleOverview()}
    title="Workspace Overview (Ctrl+Shift+`)"
    aria-label="Workspace overview"
  >
    <svg viewBox="0 0 14 14" width="11" height="11" fill="currentColor">
      <rect x="1" y="1" width="5" height="5" rx="0.7" opacity="0.95"/>
      <rect x="8" y="1" width="5" height="5" rx="0.7" opacity="0.5"/>
      <rect x="1" y="8" width="5" height="5" rx="0.7" opacity="0.5"/>
      <rect x="8" y="8" width="5" height="5" rx="0.7" opacity="0.5"/>
    </svg>
    <span>{workspaceStore.active.name}</span>
  </button>
</div>

<style>
  /* ── Client-side decorations (CSD) ────────────────────────
     The whole tab bar is a drag region; buttons opt out via no-drag.
     With titleBarStyle:"hiddenInset" the OS renders traffic lights
     at ~(8,7) inside the window — the spacer reserves that area.  */
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: #1e1f22;
    border-bottom: 1px solid #2d2f33;
    height: 38px;
    flex-shrink: 0;
    overflow: hidden;
    user-select: none;
    -webkit-app-region: drag;
  }

  .traffic-light-spacer {
    width: 76px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }

  .tabs {
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    min-width: 0;
    scrollbar-width: none;
    -webkit-app-region: no-drag;
  }
  .tabs::-webkit-scrollbar { display: none; }

  .tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 14px;
    min-width: 100px;
    max-width: 200px;
    height: 38px;
    cursor: pointer;
    border-right: 1px solid #2d2f33;
    color: #7e8185;
    font-size: 12px;
    font-family: inherit;
    position: relative;
    transition: background 120ms ease, color 120ms ease;
    flex-shrink: 0;
  }

  .tab:hover {
    background: #33353a;
    color: #dfe1e5;
  }

  .tab--active {
    background: #2b2d30;
    color: #ffffff;
    border-bottom: 2px solid #4e7bf0;
  }

  .tab--active:hover {
    background: #35373c;
    color: #ffffff;
  }

  .tab--dragging {
    opacity: 0.4;
  }

  .tab--drag-over {
    background: #2e3142;
    border-left: 2px solid #4e7bf0;
  }

  .tab-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #7e8185;
    flex-shrink: 0;
  }

  .tab--active .tab-dot {
    background: #4e7bf0;
  }

  .tab-close {
    display: flex;
    visibility: hidden;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: #7e8185;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: background 100ms ease, color 100ms ease;
  }

  .tab:hover .tab-close,
  .tab--active .tab-close {
    visibility: visible;
  }

  .tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #dfe1e5;
  }

  .tab-rename {
    flex: 1;
    min-width: 0;
    background: #3c3f41;
    border: 1px solid #4e7bf0;
    border-radius: 3px;
    color: #dfe1e5;
    font-size: 12px;
    font-family: inherit;
    padding: 1px 4px;
    outline: none;
  }

  .tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border: none;
    background: transparent;
    color: #7e8185;
    font-size: 18px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 100ms ease, color 100ms ease;
    border-right: 1px solid #2d2f33;
    -webkit-app-region: no-drag;
  }

  .tab-add:hover {
    background: #27282c;
    color: #dfe1e5;
  }

  .tab-ws {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 38px;
    border: none;
    border-left: 1px solid #2d2f33;
    background: transparent;
    color: #7e8185;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
    transition: background 100ms ease, color 100ms ease;
    -webkit-app-region: no-drag;
  }

  .tab-ws:hover {
    background: #27282c;
    color: #dfe1e5;
  }

  .tiling-btns {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 6px;
    border-left: 1px solid #2d2f33;
    -webkit-app-region: no-drag;
  }

  .tiling-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: #555a60;
    cursor: pointer;
    border-radius: 4px;
    transition: background 100ms ease, color 100ms ease;
  }

  .tiling-btn:hover {
    background: #27282c;
    color: #bbbec4;
  }

  .tiling-btn--active {
    color: #bbbec4;
    background: #2e3036;
  }
</style>
