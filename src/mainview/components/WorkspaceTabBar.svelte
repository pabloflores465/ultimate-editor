<script lang="ts">
  import { workspaceStore } from "../stores/workspaceStore.svelte";

  // ── Drag state ───────────────────────────────────────────────
  let dragIdx    = $state<number | null>(null);
  let dragOverIdx = $state<number | null>(null);

  function onDragStart(e: DragEvent, idx: number) {
    dragIdx = idx;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", String(idx));
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
  }

  function onDragEnd() {
    dragIdx = null;
    dragOverIdx = null;
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
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: #1e1f22;
    border-bottom: 1px solid #2d2f33;
    height: 34px;
    flex-shrink: 0;
    overflow: hidden;
    user-select: none;
  }

  .tabs {
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    min-width: 0;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }

  .tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 14px;
    min-width: 100px;
    max-width: 200px;
    height: 34px;
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
    background: #27282c;
    color: #bbbec4;
  }

  .tab--active {
    background: #2b2d30;
    color: #dfe1e5;
    border-bottom: 2px solid #4e7bf0;
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
    display: none;
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
    display: flex;
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
    width: 52px;
    height: 34px;
    border: none;
    background: transparent;
    color: #7e8185;
    font-size: 18px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 100ms ease, color 100ms ease;
    border-right: 1px solid #2d2f33;
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
    height: 34px;
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
  }

  .tab-ws:hover {
    background: #27282c;
    color: #dfe1e5;
  }
</style>
