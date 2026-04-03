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

  // ── Tiling availability (reactive) ──────────────────────────
  let canVsplit  = $derived(workspaceStore.canTile("vsplit"));
  let canHsplit  = $derived(workspaceStore.canTile("hsplit"));
  let canTriple  = $derived(workspaceStore.canTile("triple"));
  let canQuarter = $derived(workspaceStore.canTile("quarter"));
  let defVsplit  = $derived(workspaceStore.tilingDeficit("vsplit"));
  let defHsplit  = $derived(workspaceStore.tilingDeficit("hsplit"));
  let defTriple  = $derived(workspaceStore.tilingDeficit("triple"));
  let defQuarter = $derived(workspaceStore.tilingDeficit("quarter"));

  // ── Tiling position per workspace tab ──────────────────────
  // Colors for tiling positions (up to 4)
  const TILE_COLORS = ["#4e7bf0", "#e06c75", "#e5c07b", "#56b6c2"];

  /**
   * Maps workspace index → tiling position (1-based) when tiling is active.
   */
  let tilePositionMap = $derived.by(() => {
    if (workspaceStore.tilingLayout === "single") return new Map<number, number>();
    const map = new Map<number, number>();
    workspaceStore.tiledIndices.forEach((wsIdx, pos) => {
      map.set(wsIdx, pos + 1); // 1-based
    });
    return map;
  });

  /**
   * Maps workspace index → MRU position (1-based).
   * When tiling is active, tiled workspaces are skipped (they use tilePositionMap),
   * and non-tiled positions continue after the tile count to avoid duplicates.
   */
  let mruPositionMap = $derived.by(() => {
    const map = new Map<number, number>();
    const mru = workspaceStore.mruIndices;
    const tiledSet = new Set(isTiled ? workspaceStore.tiledIndices : []);
    // When tiling, non-tiled positions start after tile count
    let pos = isTiled ? tiledSet.size + 1 : 1;
    // Assign from MRU order, skipping already-tiled workspaces
    for (const idx of mru) {
      if (idx < workspaceStore.workspaces.length && !map.has(idx) && !tiledSet.has(idx)) {
        map.set(idx, pos++);
      }
    }
    // Fill unvisited, non-tiled workspaces
    for (let i = 0; i < workspaceStore.workspaces.length; i++) {
      if (!map.has(i) && !tiledSet.has(i)) {
        map.set(i, pos++);
      }
    }
    return map;
  });

  let isTiled = $derived(workspaceStore.tilingLayout !== "single");
</script>

<div class="tab-bar electrobun-webkit-app-region-drag">
  <!-- macOS traffic-light spacer: -webkit-app-region:drag fills this area,
       the OS overlays the close/minimise/maximise buttons here. -->
  <div class="traffic-light-spacer"></div>

  <button
    class="tab-add electrobun-webkit-app-region-no-drag"
    onclick={() => workspaceStore.addWorkspace()}
    title="New workspace (Ctrl+Alt+N)"
    aria-label="Add workspace"
  >+</button>

  <div class="tabs">
    {#each workspaceStore.workspaces as ws, i (ws.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tab electrobun-webkit-app-region-no-drag"
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
            {#if isTiled && tilePositionMap.has(i)}
              {@const pos = tilePositionMap.get(i)!}
              <span
                class="tile-badge"
                style:background={TILE_COLORS[(pos - 1) % TILE_COLORS.length]}
              >{pos}</span>
            {:else}
              {@const mruPos = mruPositionMap.get(i) ?? (i + 1)}
              <span class="tile-badge tile-badge--mru"
                style:background={TILE_COLORS[(mruPos - 1) % TILE_COLORS.length]}
              >{mruPos}</span>
            {/if}
            <span class="tab-name">{ws.name}</span>
            {#if ws.openTabs.some(t => t.modified)}
              <span class="tab-dot" title="Unsaved changes"></span>
            {/if}
            <!-- Always show close button - allow closing the last workspace -->
            <button
              class="tab-close"
              class:tab-close--always-visible={workspaceStore.workspaces.length === 1}
              onclick={(e) => closeTab(ws.id, e)}
              tabindex="-1"
              aria-label="Close workspace"
            >×</button>
          {/if}
        </div>
    {/each}
  </div>

  <!-- Tiling layout buttons -->
  <div class="tiling-btns electrobun-webkit-app-region-no-drag">
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'single' && workspaceStore.workspaces.length > 0}
      class:tiling-btn--disabled={workspaceStore.workspaces.length === 0}
      title={workspaceStore.workspaces.length === 0 ? "No workspaces" : "Single workspace"}
      disabled={workspaceStore.workspaces.length === 0}
      onclick={() => workspaceStore.setTilingLayout("single")}
    >
      <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke-width="1.2">
        <rect x="1" y="1" width="16" height="16" rx="1.5" stroke="#4e7bf0"/>
        <text x="9" y="12" text-anchor="middle" fill="#4e7bf0" stroke="none" font-size="7" font-weight="700" font-family="system-ui">1</text>
      </svg>
    </button>
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'vsplit'}
      class:tiling-btn--disabled={!canVsplit}
      title={canVsplit ? "Two workspaces side by side" : `Need ${defVsplit} more workspace(s)`}
      disabled={!canVsplit}
      onclick={() => workspaceStore.setTilingLayout("vsplit")}
    >
      <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke-width="1.2">
        <rect x="1" y="1" width="7" height="16" rx="1.5" stroke="#4e7bf0" fill="#4e7bf0" fill-opacity="0.15"/>
        <rect x="10" y="1" width="7" height="16" rx="1.5" stroke="#e06c75" fill="#e06c75" fill-opacity="0.15"/>
        <text x="4.5" y="12" text-anchor="middle" fill="#4e7bf0" stroke="none" font-size="7" font-weight="700" font-family="system-ui">1</text>
        <text x="13.5" y="12" text-anchor="middle" fill="#e06c75" stroke="none" font-size="7" font-weight="700" font-family="system-ui">2</text>
      </svg>
    </button>
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'hsplit'}
      class:tiling-btn--disabled={!canHsplit}
      title={canHsplit ? "Two workspaces stacked" : `Need ${defHsplit} more workspace(s)`}
      disabled={!canHsplit}
      onclick={() => workspaceStore.setTilingLayout("hsplit")}
    >
      <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke-width="1.2">
        <rect x="1" y="1" width="16" height="7" rx="1.5" stroke="#4e7bf0" fill="#4e7bf0" fill-opacity="0.15"/>
        <rect x="1" y="10" width="16" height="7" rx="1.5" stroke="#e06c75" fill="#e06c75" fill-opacity="0.15"/>
        <text x="9" y="7" text-anchor="middle" fill="#4e7bf0" stroke="none" font-size="7" font-weight="700" font-family="system-ui">1</text>
        <text x="9" y="16" text-anchor="middle" fill="#e06c75" stroke="none" font-size="7" font-weight="700" font-family="system-ui">2</text>
      </svg>
    </button>
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'triple'}
      class:tiling-btn--disabled={!canTriple}
      title={canTriple ? "Three workspaces (1+2)" : `Need ${defTriple} more workspace(s)`}
      disabled={!canTriple}
      onclick={() => workspaceStore.setTilingLayout("triple")}
    >
      <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke-width="1.2">
        <rect x="1" y="1" width="7" height="16" rx="1.5" stroke="#4e7bf0" fill="#4e7bf0" fill-opacity="0.15"/>
        <rect x="10" y="1" width="7" height="7" rx="1" stroke="#e06c75" fill="#e06c75" fill-opacity="0.15"/>
        <rect x="10" y="10" width="7" height="7" rx="1" stroke="#e5c07b" fill="#e5c07b" fill-opacity="0.15"/>
        <text x="4.5" y="12" text-anchor="middle" fill="#4e7bf0" stroke="none" font-size="7" font-weight="700" font-family="system-ui">1</text>
        <text x="13.5" y="7" text-anchor="middle" fill="#e06c75" stroke="none" font-size="6" font-weight="700" font-family="system-ui">2</text>
        <text x="13.5" y="16" text-anchor="middle" fill="#e5c07b" stroke="none" font-size="6" font-weight="700" font-family="system-ui">3</text>
      </svg>
    </button>
    <button
      class="tiling-btn"
      class:tiling-btn--active={workspaceStore.tilingLayout === 'quarter'}
      class:tiling-btn--disabled={!canQuarter}
      title={canQuarter ? "Four workspaces (2x2)" : `Need ${defQuarter} more workspace(s)`}
      disabled={!canQuarter}
      onclick={() => workspaceStore.setTilingLayout("quarter")}
    >
      <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke-width="1.2">
        <rect x="1" y="1" width="7" height="7" rx="1" stroke="#4e7bf0" fill="#4e7bf0" fill-opacity="0.15"/>
        <rect x="10" y="1" width="7" height="7" rx="1" stroke="#e06c75" fill="#e06c75" fill-opacity="0.15"/>
        <rect x="1" y="10" width="7" height="7" rx="1" stroke="#e5c07b" fill="#e5c07b" fill-opacity="0.15"/>
        <rect x="10" y="10" width="7" height="7" rx="1" stroke="#56b6c2" fill="#56b6c2" fill-opacity="0.15"/>
        <text x="4.5" y="7" text-anchor="middle" fill="#4e7bf0" stroke="none" font-size="6" font-weight="700" font-family="system-ui">1</text>
        <text x="13.5" y="7" text-anchor="middle" fill="#e06c75" stroke="none" font-size="6" font-weight="700" font-family="system-ui">2</text>
        <text x="4.5" y="16" text-anchor="middle" fill="#e5c07b" stroke="none" font-size="6" font-weight="700" font-family="system-ui">3</text>
        <text x="13.5" y="16" text-anchor="middle" fill="#56b6c2" stroke="none" font-size="6" font-weight="700" font-family="system-ui">4</text>
      </svg>
    </button>
  </div>

  <!-- Workspace overview button -->
  <button
    class="tab-ws electrobun-webkit-app-region-no-drag"
    onclick={() => workspaceStore.toggleOverview()}
    title="Workspace Overview (Ctrl+Shift+`)"
    aria-label="Workspace overview"
    disabled={workspaceStore.workspaces.length === 0}
  >
    <svg viewBox="0 0 14 14" width="16" height="16" fill="currentColor">
      <rect x="1" y="1" width="5" height="5" rx="0.7" opacity="0.95"/>
      <rect x="8" y="1" width="5" height="5" rx="0.7" opacity="0.5"/>
      <rect x="1" y="8" width="5" height="5" rx="0.7" opacity="0.5"/>
      <rect x="8" y="8" width="5" height="5" rx="0.7" opacity="0.5"/>
    </svg>
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

  .tile-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
    line-height: 1;
    font-family: system-ui, -apple-system, sans-serif;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .tile-badge--mru {
    opacity: 0.5;
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

  .tab-close--always-visible {
    visibility: visible;
  }

  .tab--empty {
    cursor: default;
    color: #555759;
  }

  .tab--empty:hover {
    background: transparent;
  }

  .tab-name--empty {
    font-style: italic;
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

  .tab-ws:hover:not(:disabled) {
    background: #27282c;
    color: #dfe1e5;
  }

  .tab-ws:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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

  .tiling-btn:hover:not(:disabled) {
    background: #27282c;
    color: #bbbec4;
  }

  .tiling-btn--disabled {
    opacity: 0.3;
    cursor: not-allowed !important;
    pointer-events: auto;
  }

  .tiling-btn--active {
    color: #bbbec4;
    background: #2e3036;
  }
</style>
