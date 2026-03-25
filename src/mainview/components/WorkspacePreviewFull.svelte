<script lang="ts">
  import type { WorkspaceState } from "../stores/workspaceStore.svelte";

  let { ws }: { ws: WorkspaceState } = $props();

  // Generate deterministic "code line" widths based on workspace id
  const codeLines = Array.from({ length: 32 }, (_, i) => {
    const hash = ws.id.charCodeAt(i % ws.id.length) + i * 7;
    return {
      width: 20 + (hash % 60),
      color: [
        "#a9b7c6", "#a9b7c6", "#a9b7c6",
        "#cc7832", "#6a9955", "#4e9ede", "#ffc66d", "#9876aa",
      ][hash % 8],
      indent: (hash % 5) * 16,
    };
  });
</script>

<!-- Full-screen workspace preview — shows during swipe gestures -->
<div class="ws-preview-full">

  <!-- Title bar -->
  <div class="ws-preview-full__titlebar">
    <div class="ws-preview-full__dots">
      <span style="background:#ff5f57"></span>
      <span style="background:#ffbd2e"></span>
      <span style="background:#28c840"></span>
    </div>
    <span class="ws-preview-full__title">{ws.name} — WebStorm</span>
  </div>

  <!-- Toolbar strip -->
  <div class="ws-preview-full__toolbar">
    <div class="ws-preview-full__toolbar-btn"></div>
    <div class="ws-preview-full__toolbar-sep"></div>
    <div class="ws-preview-full__toolbar-run">
      <div class="ws-preview-full__toolbar-runbtn"></div>
      <div class="ws-preview-full__toolbar-runbtn"></div>
      <div class="ws-preview-full__toolbar-runbtn"></div>
    </div>
  </div>

  <!-- Body -->
  <div class="ws-preview-full__body">

    <!-- Left strip (always) -->
    <div class="ws-preview-full__left-strip">
      {#each ["P", "S", "G", "B"] as label}
        <div class="ws-preview-full__strip-btn">{label}</div>
      {/each}
    </div>

    <!-- Left panel (optional) -->
    {#if ws.leftPanelOpen}
      <div class="ws-preview-full__left-panel" style="width: {ws.leftWidth}px">
        <div class="ws-preview-full__panel-header">
          <span>{ws.activeTool === "project" ? "Project" : ws.activeTool === "git" ? "Git" : ws.activeTool === "structure" ? "Structure" : "Bookmarks"}</span>
        </div>
        <div class="ws-preview-full__panel-tree">
          {#each Array.from({ length: 18 }) as _, i}
            <div
              class="ws-preview-full__tree-line"
              style="width: {40 + (i * 13) % 55}%; margin-left: {(i % 4) * 12}px"
            ></div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Editor column -->
    <div class="ws-preview-full__editor">
      <!-- Tab bar -->
      <div class="ws-preview-full__tabs">
        <div class="ws-preview-full__tab ws-preview-full__tab--active">
          <span class="ws-preview-full__tab-dot" style="background:#ff6b6b"></span>
          {ws.activeRoute === "/" ? "index.svelte" : "triangle.svelte"}
        </div>
        <div class="ws-preview-full__tab">
          <span class="ws-preview-full__tab-dot" style="background:#ff6b6b"></span>
          {ws.activeRoute === "/" ? "triangle.svelte" : "index.svelte"}
        </div>
      </div>

      <!-- Code area with gutter -->
      <div class="ws-preview-full__code-area">
        <!-- Gutter -->
        <div class="ws-preview-full__gutter">
          {#each Array.from({ length: 32 }) as _, i}
            <div class="ws-preview-full__line-num">{i + 1}</div>
          {/each}
        </div>
        <!-- Code lines -->
        <div class="ws-preview-full__code">
          {#each codeLines as line}
            <div
              class="ws-preview-full__code-line"
              style="width: {line.width}%; margin-left: {line.indent}px; background: {line.color};"
            ></div>
          {/each}
        </div>
      </div>

      <!-- Bottom panel (optional) -->
      {#if ws.bottomPanelOpen}
        <div class="ws-preview-full__bottom" style="height: {ws.bottomHeight}px">
          <div class="ws-preview-full__bottom-tabs">
            {#each ["Terminal", "Problems", "Git"] as t}
              <div class="ws-preview-full__bottom-tab" class:active={ws.activeBottom === t.toLowerCase()}>{t}</div>
            {/each}
          </div>
          <div class="ws-preview-full__bottom-content">
            {#each Array.from({ length: 5 }) as _, i}
              <div class="ws-preview-full__term-line" style="width: {30 + i * 14}%"></div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- Right strip -->
    <div class="ws-preview-full__right-strip">
      {#each ["D", "N", "E"] as label}
        <div class="ws-preview-full__strip-btn">{label}</div>
      {/each}
    </div>

  </div>

  <!-- Status bar -->
  <div class="ws-preview-full__statusbar">
    <span>⎇ main</span>
    <span class="ws-preview-full__status-right">UTF-8 · Svelte · {ws.activeRoute === "/" ? "index.svelte" : "triangle.svelte"}</span>
  </div>

  <!-- Workspace name overlay (centered, subtle) -->
  <div class="ws-preview-full__name-overlay">
    {ws.name}
  </div>

</div>

<style>
  .ws-preview-full {
    width: 100%;
    height: 100%;
    background: #2b2b2b;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    color: #a9b7c6;
    position: relative;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
  }

  /* Title bar */
  .ws-preview-full__titlebar {
    height: 28px;
    background: #3c3f41;
    border-bottom: 1px solid #555759;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    flex-shrink: 0;
  }
  .ws-preview-full__dots {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .ws-preview-full__dots span {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
  }
  .ws-preview-full__title {
    font-size: 12px;
    color: #808080;
    font-weight: 500;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }

  /* Toolbar */
  .ws-preview-full__toolbar {
    height: 38px;
    background: #3c3f41;
    border-bottom: 1px solid #555759;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    flex-shrink: 0;
  }
  .ws-preview-full__toolbar-btn {
    width: 26px;
    height: 26px;
    background: #555759;
    border-radius: 4px;
    opacity: 0.5;
  }
  .ws-preview-full__toolbar-sep {
    width: 1px;
    height: 20px;
    background: #555759;
    margin: 0 4px;
  }
  .ws-preview-full__toolbar-run {
    display: flex;
    gap: 2px;
  }
  .ws-preview-full__toolbar-runbtn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #4c5052;
    opacity: 0.6;
  }

  /* Body */
  .ws-preview-full__body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  /* Strips */
  .ws-preview-full__left-strip,
  .ws-preview-full__right-strip {
    width: 25px;
    background: #3c3f41;
    border-right: 1px solid #555759;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 8px;
    gap: 4px;
    flex-shrink: 0;
  }
  .ws-preview-full__right-strip {
    border-right: none;
    border-left: 1px solid #555759;
  }
  .ws-preview-full__strip-btn {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 10px;
    color: #808080;
    padding: 8px 0;
    opacity: 0.7;
  }

  /* Left panel */
  .ws-preview-full__left-panel {
    background: #3c3f41;
    border-right: 1px solid #555759;
    display: flex;
    flex-direction: column;
    min-width: 150px;
    max-width: 550px;
    flex-shrink: 0;
  }
  .ws-preview-full__panel-header {
    height: 30px;
    background: #313335;
    border-bottom: 1px solid #555759;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 600;
    color: #c0c0c0;
  }
  .ws-preview-full__panel-tree {
    flex: 1;
    padding: 6px 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow: hidden;
  }
  .ws-preview-full__tree-line {
    height: 13px;
    background: #555759;
    border-radius: 2px;
    opacity: 0.5;
  }

  /* Editor */
  .ws-preview-full__editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  /* Tabs */
  .ws-preview-full__tabs {
    height: 32px;
    background: #3c3f41;
    border-bottom: 1px solid #555759;
    display: flex;
    align-items: flex-end;
    flex-shrink: 0;
  }
  .ws-preview-full__tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 32px;
    font-size: 13px;
    color: #808080;
    border-right: 1px solid #555759;
    background: #3c3f41;
  }
  .ws-preview-full__tab--active {
    background: #2b2b2b;
    color: #c0c0c0;
    border-top: 2px solid #4e9ede;
  }
  .ws-preview-full__tab-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
  }

  /* Code area */
  .ws-preview-full__code-area {
    flex: 1;
    display: flex;
    overflow: hidden;
    background: #2b2b2b;
  }
  .ws-preview-full__gutter {
    width: 44px;
    background: #2b2b2b;
    border-right: 1px solid #4b4b4b;
    padding: 10px 6px;
    display: flex;
    flex-direction: column;
    gap: 5.6px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .ws-preview-full__line-num {
    font-family: monospace;
    font-size: 11px;
    color: #5c6370;
    text-align: right;
    line-height: 1;
    height: 13px;
  }
  .ws-preview-full__code {
    flex: 1;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 5.6px;
    overflow: hidden;
  }
  .ws-preview-full__code-line {
    height: 13px;
    border-radius: 2px;
    opacity: 0.45;
    flex-shrink: 0;
  }

  /* Bottom panel */
  .ws-preview-full__bottom {
    background: #2b2b2b;
    border-top: 1px solid #555759;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 60px;
    max-height: 550px;
    overflow: hidden;
  }
  .ws-preview-full__bottom-tabs {
    height: 30px;
    background: #313335;
    border-bottom: 1px solid #555759;
    display: flex;
    align-items: flex-end;
    flex-shrink: 0;
  }
  .ws-preview-full__bottom-tab {
    padding: 0 12px;
    height: 30px;
    display: flex;
    align-items: center;
    font-size: 12px;
    color: #808080;
    border-top: 2px solid transparent;
  }
  .ws-preview-full__bottom-tab.active {
    color: #c0c0c0;
    border-top-color: #4e9ede;
  }
  .ws-preview-full__bottom-content {
    flex: 1;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow: hidden;
  }
  .ws-preview-full__term-line {
    height: 12px;
    background: #555759;
    border-radius: 2px;
    opacity: 0.4;
  }

  /* Status bar */
  .ws-preview-full__statusbar {
    height: 22px;
    background: #313335;
    border-top: 1px solid #555759;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    font-size: 11px;
    color: #808080;
    flex-shrink: 0;
  }
  .ws-preview-full__status-right {
    opacity: 0.7;
  }

  /* Workspace name overlay — shows centered, subtle */
  .ws-preview-full__name-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 28px;
    font-weight: 300;
    color: rgba(255, 255, 255, 0.08);
    letter-spacing: 4px;
    text-transform: uppercase;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
